import { ConvexError } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { ListingStatus } from './helpers';

// B3b moderation policy (issue #13, Task 3), extended by B6a (issue #15,
// Task 3): the pure decision logic behind the `/admin/approvals` queue and the
// `/admin/directory` status actions. It imports ConvexError only for the
// expected invalid-reason application error; the pure policy helpers remain
// importable by `node --test` (runtime DB tests are unavailable in this repo).
// The Convex handler (`moderateListing` in ./mutations.ts) is a thin shell
// over these functions: it authorizes, resolves the transition, and commits
// the patch + audit row atomically.
//
// Contract: tasks/issue-15-contracts.md §A/§B4/§B6.

/**
 * The five directory moderation actions (contract §A). Approve / Request
 * changes / Reject decide a `pendingReview` listing; Suspend/Restore manage a
 * live one (Suspend: `approved`; Restore: `suspended`). The B3 queue keeps
 * sending only the first three.
 */
export const MODERATION_ACTIONS = [
  'approve',
  'requestChanges',
  'reject',
  'suspend',
  'restore',
] as const;

export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

/**
 * `requestChanges`, `reject`, and `suspend` must carry a non-blank reason
 * (SPEC §10: the reason is shown to the owner; contract §A). `approve` and
 * `restore` never require one. Runs before any state is read or written, so a
 * rejected call performs no writes.
 */
export function assertModerationReason(
  action: ModerationAction,
  reason: string | undefined
): void {
  if (action === 'approve' || action === 'restore') {
    return;
  }

  if ((reason ?? '').trim().length === 0) {
    throw new ConvexError(`${action} requires a reason`);
  }
}

/**
 * The value persisted to `businesses.moderationReason`. `approve`/`restore`
 * clear any stale reason (`undefined` removes the field on patch);
 * Changes/Reject/Suspend store the trimmed reason. Callers must run
 * `assertModerationReason` first — this function only normalizes, it does not
 * validate.
 */
export function normalizeModerationReason(
  action: ModerationAction,
  reason: string | undefined
): string | undefined {
  if (action === 'approve' || action === 'restore') {
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
  /** Present only when the caller supplies an immutable name snapshot. */
  targetName?: string;
  createdAt: number;
};

/**
 * Builds the audit payload inserted in the same transaction as the business
 * patch (convex/schema.ts `auditLogs`). `fromStatus` is the ACTUAL current
 * status (contract §B6: generalized for suspend/restore); the caller resolves
 * the transition first, so `fromStatus`/`toStatus` always describe the
 * committed change. The handler supplies `targetName` as an immutable snapshot
 * so the row survives a later hard delete; it stays optional so callers that
 * have no name (and legacy rows) keep the live-name fallback
 * (auditProjections.ts). Pure so the payload can be asserted without a Convex
 * runtime.
 */
export function buildModerationAuditLog(input: {
  actorUserId: Id<'users'>;
  action: ModerationAction;
  targetId: Id<'businesses'>;
  fromStatus: ListingStatus;
  toStatus: ListingStatus;
  reason: string | undefined;
  createdAt: number;
  targetName?: string;
}): ModerationAuditLog {
  return {
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: 'business',
    targetId: input.targetId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    reason: input.reason,
    ...(input.targetName === undefined ? {} : { targetName: input.targetName }),
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
