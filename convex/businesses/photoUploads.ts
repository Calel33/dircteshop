import { ConvexError, v } from 'convex/values';

import { httpAction, internalMutation, internalQuery } from '../_generated/server';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { requireBusinessOwner } from '../authz';
import { invalidReasonForFile } from './photoPolicy';
import { ownerSaveMode } from './ownerSavePolicy';
import type { ListingStatus } from './helpers';

// B7 (issue #7) upload entry point. `ctx.storage.generateUploadUrl()` only mints
// a URL: the storage id is born when the bytes POST, so ownership cannot be
// recorded at URL-issue time. Uploads therefore go through this authenticated
// HTTP action, which reads the Clerk identity from the request, stores the
// file, and registers the new id to the owner + business that uploaded it.
// `assertPhotoAttachmentsValid` then rejects unregistered or foreign ids, and
// `reconcilePhotoStorage` deletes only ids this listing owns.
//
// The registry is the reference table `adminDeletion.ts:66-73` requires before
// an id may be treated as belonging to a business.

export const UPLOAD_PATH = '/photos/upload';

// The upload is called from the browser (Next.js origin) to the Convex site
// origin, so preflight and response headers are needed. Authorization is a
// bearer token, never a cookie, so `*` does not expose credentials.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

type UploadAuthorization =
  | { ok: true; businessId: Id<'businesses'>; ownerId: Id<'users'> }
  | { ok: false; status: number; message: string };

/**
 * Pre-storage authorization for the upload endpoint. Returns a discriminated
 * result instead of throwing so the HTTP action can map failures to a status
 * without parsing error messages. Ownership and read-only status are the same
 * gates every other owner write uses.
 */
export const authorizePhotoUpload = internalQuery({
  args: { businessId: v.id('businesses') },
  handler: async (ctx, { businessId }): Promise<UploadAuthorization> => {
    let business;
    try {
      business = await requireBusinessOwner(ctx, businessId);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'Unauthorized') {
        return { ok: false, status: 401, message: 'Sign in to upload photos.' };
      }
      return { ok: false, status: 403, message: 'You do not own this listing.' };
    }

    if (ownerSaveMode(business.status) === 'reject') {
      return { ok: false, status: 403, message: readOnlyUploadMessage(business.status) };
    }

    return { ok: true, businessId: business._id, ownerId: business.ownerId };
  },
});

/**
 * Records the owner + business that uploaded `storageId`. Re-checks ownership
 * rather than trusting the action's earlier authorization: the two calls are
 * not one transaction. Idempotent for a retried registration of the same id.
 */
export const registerStorageUpload = internalMutation({
  args: { storageId: v.id('_storage'), businessId: v.id('businesses') },
  handler: async (ctx, { storageId, businessId }) => {
    const business = await requireBusinessOwner(ctx, businessId);
    const existing = await findUpload(ctx, storageId);

    if (existing !== null) {
      if (existing.businessId !== businessId || existing.ownerId !== business.ownerId) {
        throw new ConvexError('This file was already uploaded for another listing.');
      }
      return existing._id;
    }

    return await ctx.db.insert('storageUploads', {
      storageId,
      ownerId: business.ownerId,
      businessId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Authenticated upload endpoint: `POST /photos/upload?businessId=<id>` with the
 * file bytes as the body. The client sends its Clerk token as a bearer token;
 * Convex validates it against `auth.config.ts` before the action runs.
 */
export const uploadPhoto = httpAction(async (ctx, request) => {
  const businessId = new URL(request.url).searchParams.get('businessId');
  if (businessId === null) {
    return jsonResponse(400, { error: 'businessId is required.' });
  }

  let authorization: UploadAuthorization;
  try {
    authorization = await ctx.runQuery(internal.businesses.photoUploads.authorizePhotoUpload, {
      businessId: businessId as Id<'businesses'>,
    });
  } catch {
    return jsonResponse(400, { error: 'businessId is invalid.' });
  }

  if (!authorization.ok) {
    return jsonResponse(authorization.status, { error: authorization.message });
  }

  const blob = await request.blob();
  const contentType = request.headers.get('content-type') ?? blob.type;
  const reason = invalidReasonForFile({ name: '', size: blob.size, type: contentType });
  if (reason !== null) {
    return jsonResponse(400, { error: reason });
  }

  const storageId = await ctx.storage.store(blob);

  try {
    await ctx.runMutation(internal.businesses.photoUploads.registerStorageUpload, {
      storageId,
      businessId: authorization.businessId,
    });
  } catch (error) {
    // The file is stored but no row can own it. Delete it rather than leave an
    // unreachable object behind; nobody can attach an unregistered id.
    await ctx.storage.delete(storageId);
    const message = error instanceof Error ? error.message : 'Upload could not be registered.';
    return jsonResponse(403, { error: message });
  }

  return jsonResponse(200, { storageId });
});

/** CORS preflight for the upload route. */
export const uploadPhotoOptions = httpAction(async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
});

/**
 * One-time backfill for listings that predate the registry: registers every
 * persisted `photos[].storageId` to the business that references it. Run with
 * `npx convex run businesses/photoUploads:backfillStorageUploads`.
 *
 * Idempotent. If a legacy id is referenced by more than one business, the
 * first row wins and later references are skipped, so a drop in any other
 * listing can never delete a file that business does not own.
 */
export const backfillStorageUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    let registered = 0;
    let skipped = 0;

    for await (const business of ctx.db.query('businesses')) {
      for (const photo of business.photos) {
        const existing = await findUpload(ctx, photo.storageId);
        if (existing !== null) {
          skipped += 1;
          continue;
        }

        await ctx.db.insert('storageUploads', {
          storageId: photo.storageId,
          ownerId: business.ownerId,
          businessId: business._id,
          createdAt: Date.now(),
        });
        registered += 1;
      }
    }

    return { registered, skipped };
  },
});

async function findUpload(ctx: QueryCtx | MutationCtx, storageId: Id<'_storage'>) {
  return await ctx.db
    .query('storageUploads')
    .withIndex('byStorageId', (q) => q.eq('storageId', storageId))
    .unique();
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function readOnlyUploadMessage(status: ListingStatus): string {
  if (status === 'rejected') {
    return 'Rejected listings are read-only; revise the listing to a draft before adding photos.';
  }
  return `Listings in status "${status}" are read-only and cannot accept photo uploads.`;
}
