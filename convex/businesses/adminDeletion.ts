import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { ListingStatus } from './helpers';

// B6a hard-delete cascade policy (issue #15, Task 5).
//
// Pure decision logic behind `hardDeleteBusiness` in ./adminMutations.ts: the
// server-side typed-name confirmation, the cascade coverage manifest, the
// storage-id collection, the delete audit row, and the ctx-taking cascade
// executor (the `notificationHelpers.insertNotification` pattern: the context
// is an argument, so the module stays importable by `node --test` for its pure
// half). The executor runs inside the caller's mutation: one Convex
// transaction — a throw rolls all database writes back, so the cascade never
// partially commits and the mutation never reports success on failure.
//
// Contract: tasks/issue-15-contracts.md §B7.
// Docs: https://docs.convex.dev/database/writing-data (atomic mutations) ·
//       https://docs.convex.dev/file-storage/delete-files (ctx.storage.delete in mutations)

/**
 * The directly linked child tables the cascade removes (contract §B7). The
 * handler queries each by its `byBusinessId` index — `notifications` uses the
 * B6a `byBusinessId` index added in convex/schema.ts. Deliberately NOT here:
 * `auditLogs` (the delete's own audit row must survive and audit rows are
 * immutable evidence; the cascade only fills a missing name snapshot — it
 * never deletes one) and `paymentAttempts` (no business foreign key; SPEC
 * scope limited to business-linked records).
 */
export const HARD_DELETE_CHILD_TABLES = [
  'menuGroups',
  'menuItems',
  'serviceOfferings',
  'stylists',
  'orders',
  'bookings',
  'quoteRequests',
  'notifications',
] as const;

export type HardDeleteChildTable = (typeof HARD_DELETE_CHILD_TABLES)[number];

/**
 * Server-side confirmation gate (contract §B7): the typed name must EXACTLY
 * match the current business name (case-sensitive after trimming the typed
 * value for copy/paste whitespace). A wrong or stale name throws before any
 * state is read for writing, so it performs zero deletes; the client-side
 * disable is UX only, never trusted.
 */
export function assertHardDeleteConfirmation(currentName: string, typedName: string): void {
  if (typedName.trim() !== currentName) {
    throw new ConvexError(
      'The typed name does not match this business\'s current name; deletion aborted.'
    );
  }
}

/**
 * Collects the unique storage ids the cascade owns: business photos first,
 * then menu-item images, then stylist photos, deduplicated in first-seen
 * order. Deduplication matters because Convex Storage has no reference
 * accounting: a file shared between records inside this cascade must be
 * deleted exactly once.
 *
 * Shared-file note (plan §Open assumptions): cross-record sharing OUTSIDE the
 * cascade cannot be checked here — the schema has no storage-reference index
 * (storage ids live in `businesses.photos[]`, `menuItems.imageStorageId`,
 * `stylists.photoStorageId`), and scanning those tables inside the delete
 * transaction would be unbounded. The plan's assumption stands: a storage id
 * referenced by this business is owned by this business. If a future B7
 * implementation permits cross-business sharing, it must introduce a
 * reference table/index before this deletion is widened.
 */
export function collectStorageIds(input: {
  business: Pick<Doc<'businesses'>, 'photos'>;
  menuItems: readonly Pick<Doc<'menuItems'>, 'imageStorageId'>[];
  stylists: readonly Pick<Doc<'stylists'>, 'photoStorageId'>[];
}): Id<'_storage'>[] {
  const seen = new Set<Id<'_storage'>>();
  const ids: Id<'_storage'>[] = [];

  const add = (storageId: Id<'_storage'> | undefined) => {
    if (storageId === undefined || seen.has(storageId)) {
      return;
    }
    seen.add(storageId);
    ids.push(storageId);
  };

  for (const photo of input.business.photos) {
    add(photo.storageId);
  }
  for (const menuItem of input.menuItems) {
    add(menuItem.imageStorageId);
  }
  for (const stylist of input.stylists) {
    add(stylist.photoStorageId);
  }

  return ids;
}

/**
 * The single `auditLogs` row for a hard delete (contract §B4/§B7), inserted
 * FIRST inside the delete transaction: prior status plus the REQUIRED name
 * snapshot (`targetName`), so the row stays readable after the business and
 * its children no longer exist. No `toStatus` and no `reason` — deletion is
 * not a state-machine transition.
 */
export type HardDeleteAuditLog = {
  actorUserId: Id<'users'>;
  action: 'delete';
  targetType: 'business';
  targetId: Id<'businesses'>;
  fromStatus: ListingStatus;
  targetName: string;
  createdAt: number;
};

export function buildHardDeleteAuditLog(input: {
  actorUserId: Id<'users'>;
  targetId: Id<'businesses'>;
  fromStatus: ListingStatus;
  targetName: string;
  createdAt: number;
}): HardDeleteAuditLog {
  return {
    actorUserId: input.actorUserId,
    action: 'delete',
    targetType: 'business',
    targetId: input.targetId,
    fromStatus: input.fromStatus,
    targetName: input.targetName,
    createdAt: input.createdAt,
  };
}

/**
 * Upper bound on audit rows whose name snapshot is backfilled at delete time
 * (contract §B4/§B7). Business audit rows written before B6a's write-time
 * snapshots have no `targetName`, and once the target is gone the audit read's
 * live-name fallback cannot resolve one. The `byTarget` read is ordered by
 * creation time, so the oldest rows — the ones most likely to predate the
 * snapshots — are patched first. The bound keeps the delete transaction within
 * Convex read/write limits; rows beyond it stay unnamed rather than making the
 * delete unbounded.
 */
export const AUDIT_NAME_BACKFILL_LIMIT = 100;

/**
 * Snapshots the business name onto legacy audit rows before the cascade
 * removes the target. Only a missing `targetName` is patched; existing
 * snapshots and the delete row inserted by the caller are left untouched.
 */
export async function backfillAuditTargetNames(
  ctx: MutationCtx,
  business: Pick<Doc<'businesses'>, '_id' | 'name'>
): Promise<void> {
  const logs = await ctx.db
    .query('auditLogs')
    .withIndex('byTarget', (q) => q.eq('targetType', 'business').eq('targetId', business._id))
    .take(AUDIT_NAME_BACKFILL_LIMIT);

  for (const log of logs) {
    if (log.targetName === undefined) {
      await ctx.db.patch(log._id, { targetName: business.name });
    }
  }
}

/**
 * Executes the cascade inside the caller's mutation transaction, in the
 * frozen order (contract §B7): read every linked child set FIRST (bounded by
 * `byBusinessId`), backfill legacy audit name snapshots, then delete the
 * children, then the parent, and finally the storage objects.
 *
 * - The parent delete is the caller-visible point of no return for the
 *   database; every database write commits or rolls back together.
 * - Storage deletes run LAST: `ctx.storage.delete` is available in mutations
 *   but is not part of the database transaction (research §2.4), so doing them
 *   after all database writes leaves no DB state pointing at already-deleted
 *   files if an earlier step throws. Ids are deduplicated
 *   (`collectStorageIds`), so a file shared inside the cascade is deleted
 *   exactly once.
 */
export async function cascadeHardDeleteBusiness(
  ctx: MutationCtx,
  business: Doc<'businesses'>
): Promise<void> {
  const businessId = business._id;

  const [
    menuGroups,
    menuItems,
    serviceOfferings,
    stylists,
    orders,
    bookings,
    quoteRequests,
    notifications,
  ] = await Promise.all([
    ctx.db
      .query('menuGroups')
      .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
      .collect(),
    ctx.db
      .query('menuItems')
      .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
      .collect(),
    ctx.db
      .query('serviceOfferings')
      .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
      .collect(),
    ctx.db
      .query('stylists')
      .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
      .collect(),
    ctx.db.query('orders').withIndex('byBusinessId', (q) => q.eq('businessId', businessId)).collect(),
    ctx.db
      .query('bookings')
      .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
      .collect(),
    ctx.db
      .query('quoteRequests')
      .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
      .collect(),
    ctx.db
      .query('notifications')
      .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
      .collect(),
  ]);

  // Legacy audit rows must keep their searchable name after the business is
  // gone; the audit read can only fall back to a live target.
  await backfillAuditTargetNames(ctx, business);

  for (const child of menuGroups) {
    await ctx.db.delete(child._id);
  }
  for (const child of menuItems) {
    await ctx.db.delete(child._id);
  }
  for (const child of serviceOfferings) {
    await ctx.db.delete(child._id);
  }
  for (const child of stylists) {
    await ctx.db.delete(child._id);
  }
  for (const child of orders) {
    await ctx.db.delete(child._id);
  }
  for (const child of bookings) {
    await ctx.db.delete(child._id);
  }
  for (const child of quoteRequests) {
    await ctx.db.delete(child._id);
  }
  for (const child of notifications) {
    await ctx.db.delete(child._id);
  }

  await ctx.db.delete(businessId);

  for (const storageId of collectStorageIds({ business, menuItems, stylists })) {
    await ctx.storage.delete(storageId);
  }
}
