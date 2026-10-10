import { ConvexError } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { ListingStatus } from './helpers';

// B3b moderation policy (issue #13, Task 3): the pure decision logic behind the
// `/admin/approvals` queue. It imports ConvexError only for the expected
// invalid-reason application error; the pure policy helpers remain importable
// by `node --test` (runtime DB tests are unavailable in this repo). The Convex
// handler (`moderateListing` in ./mutations.ts) is a thin shell over these
// functions: it authorizes, resolves the transition, and commits the patch +
// audit row atomically.

/** The only three queue decisions (SPEC §10). Suspend/Restore stay out of scope. */
export const MODERATION_ACTIONS = ['approve', 'requestChanges', 'reject'] as const;

export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/**
 * `requestChanges` and `reject` must carry a non-blank moderation reason
 * (SPEC §10: the reason is shown to the owner). `approve` never requires a
 * reason. Mirrors `assertReasonProvided` in ./mutations.ts and runs before any
 * state is read or written, so a rejected call performs no writes.
 */
export function assertModerationReason(
  action: ModerationAction,
  reason: string | undefined
): void {
  if (action === 'approve') {
    return;
  }

  if ((reason ?? '').trim().length === 0) {
    throw new ConvexError(`${action} requires a reason`);
  }
}

/**
 * The value persisted to `businesses.moderationReason`. `approve` clears any
 * stale reason (`undefined` removes the field on patch); Changes/Reject store
 * the trimmed reason. Callers must run `assertModerationReason` first — this
 * function only normalizes, it does not validate.
 */
export function normalizeModerationReason(
  action: ModerationAction,
  reason: string | undefined
): string | undefined {
  if (action === 'approve') {
    return undefined;
  }

  return (reason ?? '').trim();
}

/** The single `auditLogs` row shape written per moderation decision. */
export type ModerationAuditLog = {
  actorUserId: Id<'users'>;
  action: ModerationAction;
  targetType: 'business';
  targetId: Id<'businesses'>;
  fromStatus: ListingStatus;
  toStatus: ListingStatus;
  reason: string | undefined;
  createdAt: number;
};

/**
 * Builds the audit payload inserted in the same transaction as the business
 * patch (convex/schema.ts `auditLogs`). `fromStatus` is always `pendingReview`:
 * the queue mutation refuses any other current status, so a decision can only
 * move a listing out of review. Pure so the payload can be asserted without a
 * Convex runtime.
 */
export function buildModerationAuditLog(input: {
  actorUserId: Id<'users'>;
  action: ModerationAction;
  targetId: Id<'businesses'>;
  toStatus: ListingStatus;
  reason: string | undefined;
  createdAt: number;
}): ModerationAuditLog {
  return {
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: 'business',
    targetId: input.targetId,
    fromStatus: 'pendingReview',
    toStatus: input.toStatus,
    reason: input.reason,
    createdAt: input.createdAt,
  };
}

// ---------------------------------------------------------------------------
// B3c / issue #14 bulk approve (Task 2).
//
// Bulk approval is approve-only (SPEC §10) and page-scoped. The selection is a
// deduplicated set of 1–25 current-page ids — the atomic mutation validates the
// WHOLE selection before any write, so a stale id rejects the entire operation
// with no partial business or audit writes (one transaction, all-or-none). Pure
// so the boundary is `node --test`-able without a Convex runtime; the runtime
// atomicity is guaranteed by Convex and verified in the authenticated dev check.
// ---------------------------------------------------------------------------

/** A bulk approval targets the currently displayed page; never the whole queue. */
export const BULK_APPROVE_MIN = 1;
export const BULK_APPROVE_MAX = 25;

/**
 * Deduplicates and bounds a bulk-approve selection. Order is preserved so the
 * audit rows follow the admin's page order. An empty (nothing selected) or
 * oversized selection is rejected before any state is read.
 */
export function normalizeBulkApproveIds(ids: readonly Id<'businesses'>[]): Id<'businesses'>[] {
  const unique = [...new Set(ids)];
  if (unique.length < BULK_APPROVE_MIN) {
    throw new ConvexError('Select at least one listing to approve.');
  }
  if (unique.length > BULK_APPROVE_MAX) {
    throw new ConvexError(
      `Approve at most ${BULK_APPROVE_MAX} listings at a time; narrow the selection.`
    );
  }
  return unique;
}

/**
 * The all-or-nothing precondition: every selected listing must still be
 * `pendingReview` at write time. A single stale/decided id aborts the whole
 * batch, so the admin refreshes and reselects rather than getting a partial
 * success. Mirrors `moderateListing`'s explicit `pendingReview` guard.
 */
export function assertAllPendingReview(statuses: readonly ListingStatus[]): void {
  if (statuses.some((status) => status !== 'pendingReview')) {
    throw new ConvexError('One or more listings are no longer pending review; refresh the queue.');
  }
}
