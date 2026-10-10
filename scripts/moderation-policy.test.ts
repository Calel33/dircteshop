#!/usr/bin/env node
/**
 * Pins the B3b (issue #13) moderation policy for todo #3.
 *
 * `convex/businesses/moderationPolicy.ts` uses ConvexError for its expected
 * invalid-reason failure; its pure policy helpers and audit payload are
 * asserted without a live Convex deployment (runtime DB tests are unavailable
 * in this repo; see tasks/issue-13-context.md §4). The Convex handler in
 * `convex/businesses/mutations.ts` (`moderateListing`) wires these
 * pure functions into `requireSuperAdmin`, `resolveTransition` and one atomic
 * patch + audit insert; that runtime behavior is deferred to manual tracers.
 *
 * Run: node --test scripts/moderation-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Id } from '../convex/_generated/dataModel';
import {
  BULK_APPROVE_MAX,
  BULK_APPROVE_MIN,
  MODERATION_ACTIONS,
  assertAllPendingReview,
  assertModerationReason,
  buildModerationAuditLog,
  normalizeBulkApproveIds,
  normalizeModerationReason,
} from '../convex/businesses/moderationPolicy.ts';

const adminId = 'users_admin' as Id<'users'>;
const businessId = 'businesses_1' as Id<'businesses'>;
const reasonActions = ['requestChanges', 'reject'] as const;

test('exposes exactly the three queue decisions', () => {
  assert.deepStrictEqual([...MODERATION_ACTIONS], ['approve', 'requestChanges', 'reject']);
});

test('approve never requires a reason', () => {
  assert.doesNotThrow(() => assertModerationReason('approve', undefined));
  assert.doesNotThrow(() => assertModerationReason('approve', ''));
  assert.doesNotThrow(() => assertModerationReason('approve', 'ignored reason'));
});

test('requestChanges and reject accept a non-blank reason', () => {
  for (const action of reasonActions) {
    assert.doesNotThrow(() => assertModerationReason(action, 'Needs a clearer description'));
  }
});

test('requestChanges and reject reject missing/blank/whitespace reasons', () => {
  for (const action of reasonActions) {
    const message = new RegExp(`${action} requires a reason`);
    assert.throws(() => assertModerationReason(action, undefined), message);
    assert.throws(() => assertModerationReason(action, ''), message);
    assert.throws(() => assertModerationReason(action, '   '), message);
    assert.throws(() => assertModerationReason(action, '\t\n '), message);
  }
});

test('approve clears the moderation reason', () => {
  assert.equal(normalizeModerationReason('approve', undefined), undefined);
  assert.equal(normalizeModerationReason('approve', 'stale reason'), undefined);
});

test('requestChanges and reject persist the trimmed reason', () => {
  for (const action of reasonActions) {
    assert.equal(normalizeModerationReason(action, '  Needs work  '), 'Needs work');
    assert.equal(normalizeModerationReason(action, 'Already trimmed'), 'Already trimmed');
  }
});

test('builds the full audit payload for a decision', () => {
  const payload = buildModerationAuditLog({
    actorUserId: adminId,
    action: 'requestChanges',
    targetId: businessId,
    toStatus: 'changesRequested',
    reason: 'Add hours',
    createdAt: 1_700_000_000_000,
  });

  assert.deepStrictEqual(payload, {
    actorUserId: adminId,
    action: 'requestChanges',
    targetType: 'business',
    targetId: businessId,
    fromStatus: 'pendingReview',
    toStatus: 'changesRequested',
    reason: 'Add hours',
    createdAt: 1_700_000_000_000,
  });
});

test('approve audit payload carries no reason', () => {
  const payload = buildModerationAuditLog({
    actorUserId: adminId,
    action: 'approve',
    targetId: businessId,
    toStatus: 'approved',
    reason: undefined,
    createdAt: 1_700_000_000_000,
  });

  assert.equal(payload.reason, undefined);
  assert.equal(payload.toStatus, 'approved');
  assert.equal(payload.fromStatus, 'pendingReview');
  assert.equal(payload.targetType, 'business');
  assert.equal(payload.actorUserId, adminId);
  assert.equal(payload.targetId, businessId);
});

test('reject audit payload targets the rejected status', () => {
  const payload = buildModerationAuditLog({
    actorUserId: adminId,
    action: 'reject',
    targetId: businessId,
    toStatus: 'rejected',
    reason: 'Duplicate listing',
    createdAt: 42,
  });

  assert.equal(payload.toStatus, 'rejected');
  assert.equal(payload.reason, 'Duplicate listing');
  assert.equal(payload.createdAt, 42);
});

// ---------------------------------------------------------------------------
// B3c / issue #14 Task 2 — bulk approve bounds and all-or-nothing precondition.
// ---------------------------------------------------------------------------

const id = (n: number) => `businesses_${n}` as Id<'businesses'>;

test('bulk approve is bounded to 1–25 listings', () => {
  assert.equal(BULK_APPROVE_MIN, 1);
  assert.equal(BULK_APPROVE_MAX, 25);
});

test('normalizeBulkApproveIds preserves order and removes duplicates', () => {
  assert.deepStrictEqual(normalizeBulkApproveIds([id(3), id(1), id(3), id(2), id(1)]), [
    id(3),
    id(1),
    id(2),
  ]);
});

test('normalizeBulkApproveIds passes through a unique selection unchanged', () => {
  const unique = [id(1), id(2), id(3)];
  assert.deepStrictEqual(normalizeBulkApproveIds(unique), unique);
});

test('normalizeBulkApproveIds rejects an empty selection', () => {
  assert.throws(() => normalizeBulkApproveIds([]), /Select at least one listing/);
});

test('normalizeBulkApproveIds accepts exactly the maximum', () => {
  const atMax = Array.from({ length: BULK_APPROVE_MAX }, (_, i) => id(i + 1));
  assert.equal(normalizeBulkApproveIds(atMax).length, BULK_APPROVE_MAX);
});

test('normalizeBulkApproveIds rejects an oversized selection before any read', () => {
  const oversized = Array.from({ length: BULK_APPROVE_MAX + 1 }, (_, i) => id(i + 1));
  assert.throws(() => normalizeBulkApproveIds(oversized), /Approve at most 25 listings/);
});

test('normalizeBulkApproveIds bounds by unique ids, not raw length', () => {
  const duplicated = Array.from({ length: 60 }, () => id(1));
  assert.deepStrictEqual(normalizeBulkApproveIds(duplicated), [id(1)]);
});

test('assertAllPendingReview accepts an all-pending selection', () => {
  assert.doesNotThrow(() =>
    assertAllPendingReview(['pendingReview', 'pendingReview', 'pendingReview'])
  );
});

test('assertAllPendingReview rejects any already-decided listing (all-or-nothing)', () => {
  for (const stale of ['approved', 'changesRequested', 'rejected', 'draft', 'suspended'] as const) {
    assert.throws(
      () => assertAllPendingReview(['pendingReview', stale]),
      /no longer pending review/
    );
  }
});
