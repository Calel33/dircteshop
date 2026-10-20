import { ConvexError, v } from 'convex/values';

import { query } from '../_generated/server';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireBusinessOwner } from '../authz';
import { PHOTO_LIMITS, assertPhotosCount, invalidReasonForFile } from './photoPolicy';

// B7 (issue #7) Convex file-storage plumbing for listing photos. Storage ids are
// the only persisted handle; URLs are resolved on read and never cached or
// stored. `getUrl` returns public bearer URLs with no time-based expiry, revoked
// only by deleting the file. Attach-time `_storage` metadata is the authoritative
// size/type gate: Convex imposes no per-file cap and a raw storage POST accepts
// no constraints. Uploads are additionally pre-checked by the authenticated
// upload action, and every id is bound to its uploader in `storageUploads`.

type BusinessPhoto = Doc<'businesses'>['photos'][number];

/**
 * Resolves every photo to its storage URL, keyed by storage id. Files that no
 * longer exist (`getUrl` -> `null`) are omitted so the renderer falls back to
 * its placeholder.
 */
export async function resolvePhotoUrls(
  ctx: QueryCtx,
  photos: readonly BusinessPhoto[]
): Promise<Record<Id<'_storage'>, string>> {
  const storageIds = uniqueStorageIds(photos);
  const resolved = await resolveStorageUrls(ctx, storageIds);
  const urls: Record<Id<'_storage'>, string> = {};
  for (const storageId of storageIds) {
    const url = resolved[storageId];
    if (url !== null) {
      urls[storageId] = url;
    }
  }
  return urls;
}

/**
 * Owner-gated preview resolution for storage ids that are not persisted on the
 * business yet (the editor's unsaved uploads). Ids registered to another owner
 * or business map to `null` without a `getUrl` call, so the result is uniform
 * for "not yours" and "does not exist" and cannot be used as an existence
 * oracle. The input is deduplicated and capped at `PHOTO_LIMITS.maxPhotos`, so
 * a caller cannot turn it into an unbounded storage read.
 */
export const photoUrls = query({
  args: {
    businessId: v.id('businesses'),
    storageIds: v.array(v.id('_storage')),
  },
  handler: async (ctx, { businessId, storageIds }) => {
    const business = await requireBusinessOwner(ctx, businessId);
    const capped = [...new Set(storageIds)].slice(0, PHOTO_LIMITS.maxPhotos);
    const urls: Record<Id<'_storage'>, string | null> = {};
    for (const storageId of capped) {
      urls[storageId] = (await isUploadOwnedBy(ctx, storageId, business))
        ? await ctx.storage.getUrl(storageId)
        : null;
    }
    return urls;
  },
});

/**
 * Enforces the upload limits on every NEW storage id in `after` by reading the
 * `_storage` metadata. A POST without a Content-Type header stores no
 * `contentType`, so a missing type is a rejection, never a soft pass.
 *
 * Runs BEFORE the caller's patch: a rejected file is deleted and the save
 * throws, so a half-valid photo list is never written. Every new id must also
 * be registered to this owner + business by the upload action; unregistered
 * and foreign ids throw and are never deleted. `after` is `null` when the save
 * does not persist photos, in which case nothing is validated.
 */
export async function assertPhotoAttachmentsValid(
  ctx: MutationCtx,
  business: Pick<Doc<'businesses'>, '_id' | 'ownerId'>,
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

    // Ownership is checked before the size/type delete: a foreign id that fails
    // validation must never be deleted by the wrong listing.
    if (!(await isUploadOwnedBy(ctx, storageId, business))) {
      throw new ConvexError(
        'One of the selected photos was not uploaded for this listing. Upload it again and save.'
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
 * Deletes only ids registered to this owner + business by the upload action.
 * An unregistered or foreign id is never deleted: the attach gate is what makes
 * "an id in this listing's photos is owned by this listing" true, and the
 * pre-registry backfill registers legacy photos. A skipped delete leaves an
 * orphan, which is safer than deleting another tenant's file.
 * `after` is `null` when the save does not persist photos, in which case
 * nothing is reconciled.
 */
export async function reconcilePhotoStorage(
  ctx: MutationCtx,
  business: Pick<Doc<'businesses'>, '_id' | 'ownerId'>,
  before: readonly BusinessPhoto[],
  after: readonly BusinessPhoto[] | null
): Promise<void> {
  if (after === null) {
    return;
  }

  const afterIds = new Set(after.map((photo) => photo.storageId));
  const droppedIds = uniqueStorageIds(before).filter((storageId) => !afterIds.has(storageId));

  for (const storageId of droppedIds) {
    if (!(await isUploadOwnedBy(ctx, storageId, business))) {
      continue;
    }
    const metadata = await ctx.db.system.get('_storage', storageId);
    if (metadata === null) {
      continue;
    }
    await deleteStorageFileQuietly(ctx, storageId);
  }
}

/**
 * True when `storageId` was uploaded for this exact owner + business. Company
 * boundaries are compared, not just the owner: an id uploaded for another of
 * the same owner's listings must not be attachable or deletable from here.
 */
export async function isUploadOwnedBy(
  ctx: QueryCtx | MutationCtx,
  storageId: Id<'_storage'>,
  business: Pick<Doc<'businesses'>, '_id' | 'ownerId'>
): Promise<boolean> {
  const upload = await ctx.db
    .query('storageUploads')
    .withIndex('byStorageId', (q) => q.eq('storageId', storageId))
    .unique();
  return (
    upload !== null && upload.businessId === business._id && upload.ownerId === business.ownerId
  );
}

function uniqueStorageIds(photos: readonly BusinessPhoto[]): Id<'_storage'>[] {
  return [...new Set(photos.map((photo) => photo.storageId))];
}

export async function resolveStorageUrls(
  ctx: QueryCtx,
  storageIds: readonly Id<'_storage'>[]
): Promise<Record<Id<'_storage'>, string | null>> {
  const urls: Record<Id<'_storage'>, string | null> = {};
  await Promise.all(
    storageIds.map(async (storageId) => {
      urls[storageId] = await ctx.storage.getUrl(storageId);
    })
  );
  return urls;
}

export async function deleteStorageFileQuietly(
  ctx: MutationCtx,
  storageId: Id<'_storage'>
): Promise<void> {
  try {
    await ctx.storage.delete(storageId);
  } catch (error) {
    console.warn(`photoStorage: could not delete storage file ${storageId}`, error);
  }
}
