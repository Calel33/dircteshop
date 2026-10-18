import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import { requireBusinessOwner } from '../authz';
import { ownerSaveMode } from './ownerSavePolicy';
import type { ListingStatus } from './helpers';

// B7 (issue #7) upload entry point. The mutation that generates the upload URL
// is the documented control point for who may upload
// (https://docs.convex.dev/file-storage/upload-files): the client POSTs the
// file bytes to the returned URL, receives `{ storageId }`, and attaches it
// through the normal save. Ownership and the listing's save mode are both
// enforced here; a read-only listing accepts no uploads.

export const generateUploadUrl = mutation({
  args: { businessId: v.id('businesses') },
  handler: async (ctx, { businessId }) => {
    const business = await requireBusinessOwner(ctx, businessId);

    if (ownerSaveMode(business.status) === 'reject') {
      throw new ConvexError(readOnlyUploadMessage(business.status));
    }

    return await ctx.storage.generateUploadUrl();
  },
});

function readOnlyUploadMessage(status: ListingStatus): string {
  if (status === 'rejected') {
    return 'Rejected listings are read-only; revise the listing to a draft before adding photos.';
  }
  return `Listings in status "${status}" are read-only and cannot accept photo uploads.`;
}
