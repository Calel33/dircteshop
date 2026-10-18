import { ConvexError, v } from 'convex/values';

import { query } from '../_generated/server';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireBusinessOwner } from '../authz';
import { PHOTO_LIMITS, assertPhotosCount, invalidReasonForFile } from './photoPolicy';

// B7 (issue #7) Convex file-storage plumbing for listing photos. Storage ids are
// the only persisted handle; URLs are resolved on read and never cached or
// stored. `getUrl` returns public bearer URLs with no time-based expiry, revoked
// only by deleting the file. Attach-time `_storage` metadata is the only
// server-side size/type gate: Convex imposes no per-file cap and
// `generateUploadUrl` accepts no constraints.

type BusinessPhoto = Doc<'businesses'>['photos'][number];

/**
 * Resolves every photo to its storage URL, keyed by storage id. Files that no
 * longer exist (`getUrl` -> `null`) are omitted so the renderer falls back to
 * its placeholder.
 */
export async function resolvePhotoUrls(
  ctx: QueryCtx,
  photos: readonly BusinessPhoto[]
): Promise<Record<string, string>> {
  const resolved = await resolveStorageUrls(ctx, uniqueStorageIds(photos));
  const urls: Record<string, string> = {};
  for (const [storageId, url] of Object.entries(resolved)) {
    if (url !== null) {
      urls[storageId] = url;
    }
  }
  return urls;
}

/**
 * Owner-gated preview resolution for storage ids that are not persisted on the
 * business yet (the editor's unsaved uploads). Returns `null` for a missing
 * file. The input is deduplicated and capped at `PHOTO_LIMITS.maxPhotos`, so a
 * caller cannot turn it into an unbounded storage read.
 */
export const photoUrls = query({
  args: {
    businessId: v.id('businesses'),
    storageIds: v.array(v.id('_storage')),
  },
  handler: async (ctx, { businessId, storageIds }) => {
    await requireBusinessOwner(ctx, businessId);
    const capped = [...new Set(storageIds)].slice(0, PHOTO_LIMITS.maxPhotos);
    return await resolveStorageUrls(ctx, capped);
  },
});

/**
 * Enforces the upload limits on every NEW storage id in `after` by reading the
 * `_storage` metadata. A POST without a Content-Type header stores no
 * `contentType`, so a missing type is a rejection, never a soft pass.
 *
 * Runs BEFORE the caller's patch: a rejected file is deleted and the save
 * throws, so a half-valid photo list is never written. `after` is `null` when
 * the save does not persist photos, in which case nothing is validated.
 */
export async function assertPhotoAttachmentsValid(
  ctx: MutationCtx,
  before: readonly BusinessPhoto[],
  after: readonly BusinessPhoto[] | null
): Promise<void> {
  if (after === null) {
    return;
  }

  const countReason = assertPhotosCount(after);
  if (countReason !== null) {
    throw new ConvexError(countReason);
  }

  const beforeIds = new Set(before.map((photo) => photo.storageId));
  const addedIds = uniqueStorageIds(after).filter((storageId) => !beforeIds.has(storageId));

  for (const storageId of addedIds) {
    const metadata = await ctx.db.system.get('_storage', storageId);
    if (metadata === null) {
      throw new ConvexError(
        'One of the selected photos is no longer available. Upload it again and save.'
      );
    }

    const reason = invalidReasonForFile({
      name: '',
      size: metadata.size,
      type: metadata.contentType,
    });
    if (reason !== null) {
      await deleteStorageFileQuietly(ctx, storageId);
      throw new ConvexError(reason);
    }
  }
}

/**
 * Deletes storage files the save dropped from `photos` (delete-on-remove, issue
 * #7 D4). Call this AFTER every database write in the handler: `ctx.storage.delete`
 * is not part of the database transaction (`adminDeletion.ts:181-186`), so an
 * earlier delete would remove a file the commit never ends up referencing.
 *
 * Each delete is guarded by an existence read and by a swallowed failure, so a
 * missing or failing file cannot fail an otherwise-committed save. A failed
 * delete leaves an orphan (bounded by `PHOTO_LIMITS.maxBytes`, dashboard
 * cleanable), which is safer than reporting a save that actually persisted.
 *
 * The admin cascade's assumption (`adminDeletion.ts:66-73`) stands: an id in
 * this business's photos is owned by this business. No cross-business sharing
 * is possible here because ids arrive only through this owner's attach saves.
 * `after` is `null` when the save does not persist photos, in which case
 * nothing is reconciled.
 */
export async function reconcilePhotoStorage(
  ctx: MutationCtx,
  before: readonly BusinessPhoto[],
  after: readonly BusinessPhoto[] | null
): Promise<void> {
  if (after === null) {
    return;
  }

  const afterIds = new Set(after.map((photo) => photo.storageId));
  const droppedIds = uniqueStorageIds(before).filter((storageId) => !afterIds.has(storageId));

  for (const storageId of droppedIds) {
    const metadata = await ctx.db.system.get('_storage', storageId);
    if (metadata === null) {
      continue;
    }
    await deleteStorageFileQuietly(ctx, storageId);
  }
}

function uniqueStorageIds(photos: readonly BusinessPhoto[]): Id<'_storage'>[] {
  return [...new Set(photos.map((photo) => photo.storageId))];
}

async function resolveStorageUrls(
  ctx: QueryCtx,
  storageIds: readonly Id<'_storage'>[]
): Promise<Record<string, string | null>> {
  const urls: Record<string, string | null> = {};
  await Promise.all(
    storageIds.map(async (storageId) => {
      urls[storageId] = await ctx.storage.getUrl(storageId);
    })
  );
  return urls;
}

async function deleteStorageFileQuietly(
  ctx: MutationCtx,
  storageId: Id<'_storage'>
): Promise<void> {
  try {
    await ctx.storage.delete(storageId);
  } catch (error) {
    console.warn(`photoStorage: could not delete storage file ${storageId}`, error);
  }
}
