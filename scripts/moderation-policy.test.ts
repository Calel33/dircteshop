#!/usr/bin/env node
/**
 * Pins the B3b (issue #13) moderation policy and its B6a extension
 * (issue #15, Task 3): the directory action set adds `suspend`/`restore`, the
 * reason matrix covers the five actions (suspend requires a reason;
 * approve/restore never carry one), and the audit builder records the ACTUAL
 * `fromStatus` plus an optional `targetName` snapshot.
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
import { readFileSync } from 'node:fs';
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
const reasonActions = ['requestChanges', 'reject', 'suspend'] as const;

test('exposes all five directory moderation actions', () => {
  assert.deepStrictEqual([...MODERATION_ACTIONS], [
    'approve',
    'requestChanges',
    'reject',
    'suspend',
    'restore',
  ]);
});

test('approve and restore never require a reason', () => {
  assert.doesNotThrow(() => assertModerationReason('approve', undefined));
  assert.doesNotThrow(() => assertModerationReason('approve', ''));
  assert.doesNotThrow(() => assertModerationReason('approve', 'ignored reason'));
  assert.doesNotThrow(() => assertModerationReason('restore', undefined));
  assert.doesNotThrow(() => assertModerationReason('restore', 'ignored reason'));
});

test('requestChanges, reject, and suspend accept a non-blank reason', () => {
  for (const action of reasonActions) {
    assert.doesNotThrow(() => assertModerationReason(action, 'Needs a clearer description'));
  }
});

test('requestChanges, reject, and suspend reject missing/blank/whitespace reasons', () => {
  for (const action of reasonActions) {
    const message = new RegExp(`${action} requires a reason`);
    assert.throws(() => assertModerationReason(action, undefined), message);
    assert.throws(() => assertModerationReason(action, ''), message);
    assert.throws(() => assertModerationReason(action, '   '), message);
    assert.throws(() => assertModerationReason(action, '\t\n '), message);
  }
});

test('approve and restore clear the moderation reason', () => {
  assert.equal(normalizeModerationReason('approve', undefined), undefined);
  assert.equal(normalizeModerationReason('approve', 'stale reason'), undefined);
  assert.equal(normalizeModerationReason('restore', undefined), undefined);
  assert.equal(normalizeModerationReason('restore', 'stale reason'), undefined);
});

test('requestChanges, reject, and suspend persist the trimmed reason', () => {
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
    fromStatus: 'pendingReview',
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
    fromStatus: 'pendingReview',
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
    fromStatus: 'pendingReview',
    toStatus: 'rejected',
    reason: 'Duplicate listing',
    createdAt: 42,
  });

  assert.equal(payload.toStatus, 'rejected');
  assert.equal(payload.reason, 'Duplicate listing');
  assert.equal(payload.createdAt, 42);
});

test('suspend audit payload records the actual fromStatus and the reason', () => {
  const payload = buildModerationAuditLog({
    actorUserId: adminId,
    action: 'suspend',
    targetId: businessId,
    fromStatus: 'approved',
    toStatus: 'suspended',
    reason: 'Policy violation',
    createdAt: 1_700_000_000_000,
  });

  assert.deepStrictEqual(payload, {
    actorUserId: adminId,
    action: 'suspend',
    targetType: 'business',
    targetId: businessId,
    fromStatus: 'approved',
    toStatus: 'suspended',
    reason: 'Policy violation',
    createdAt: 1_700_000_000_000,
  });
});

test('restore audit payload records suspended -> approved with no reason', () => {
  const payload = buildModerationAuditLog({
    actorUserId: adminId,
    action: 'restore',
    targetId: businessId,
    fromStatus: 'suspended',
    toStatus: 'approved',
    reason: undefined,
    createdAt: 1_700_000_000_000,
  });

  assert.equal(payload.fromStatus, 'suspended');
  assert.equal(payload.toStatus, 'approved');
  assert.equal(payload.reason, undefined);
});

test('the audit payload omits targetName unless one is supplied', () => {
  const withoutSnapshot = buildModerationAuditLog({
    actorUserId: adminId,
    action: 'approve',
    targetId: businessId,
    fromStatus: 'pendingReview',
    toStatus: 'approved',
    reason: undefined,
    createdAt: 1_700_000_000_000,
  });
  assert.equal('targetName' in withoutSnapshot, false);

  const withSnapshot = buildModerationAuditLog({
    actorUserId: adminId,
    action: 'approve',
    targetId: businessId,
    fromStatus: 'pendingReview',
    toStatus: 'approved',
    reason: undefined,
    createdAt: 1_700_000_000_000,
    targetName: 'Acme Coffee',
  });
  assert.equal(withSnapshot.targetName, 'Acme Coffee');
});

// ---------------------------------------------------------------------------
// B6a / issue #15 Task 3 — suspend/restore reason and status coverage.
// ---------------------------------------------------------------------------

test('suspend requires a non-blank reason', () => {
  assert.doesNotThrow(() => assertModerationReason('suspend', 'Policy violation'));

  const message = /suspend requires a reason/;
  assert.throws(() => assertModerationReason('suspend', undefined), message);
  assert.throws(() => assertModerationReason('suspend', ''), message);
  assert.throws(() => assertModerationReason('suspend', '   '), message);
});

test('restore never requires a reason', () => {
  assert.doesNotThrow(() => assertModerationReason('restore', undefined));
  assert.doesNotThrow(() => assertModerationReason('restore', ''));
  assert.doesNotThrow(() => assertModerationReason('restore', 'ignored reason'));
});

test('suspend persists the trimmed reason; restore clears it', () => {
  assert.equal(normalizeModerationReason('suspend', '  Policy violation  '), 'Policy violation');
  assert.equal(normalizeModerationReason('restore', 'stale reason'), undefined);
});

test('suspend audit payload records approved -> suspended with the reason', () => {
  const payload = buildModerationAuditLog({
    actorUserId: adminId,
    action: 'suspend',
    targetId: businessId,
    fromStatus: 'approved',
    toStatus: 'suspended',
    reason: 'Policy violation',
    createdAt: 7,
  });

  assert.equal(payload.fromStatus, 'approved');
  assert.equal(payload.toStatus, 'suspended');
  assert.equal(payload.reason, 'Policy violation');
});

test('restore audit payload records suspended -> approved with no reason', () => {
  const payload = buildModerationAuditLog({
    actorUserId: adminId,
    action: 'restore',
    targetId: businessId,
    fromStatus: 'suspended',
    toStatus: 'approved',
    reason: normalizeModerationReason('restore', 'stale reason'),
    createdAt: 8,
  });

  assert.equal(payload.fromStatus, 'suspended');
  assert.equal(payload.toStatus, 'approved');
  assert.equal(payload.reason, undefined);
});

test('audit payload carries the immutable business-name snapshot when supplied', () => {
  const payload = buildModerationAuditLog({
    actorUserId: adminId,
    action: 'approve',
    targetId: businessId,
    fromStatus: 'pendingReview',
    toStatus: 'approved',
    reason: undefined,
    targetName: 'Cedar Cafe',
    createdAt: 9,
  });

  assert.equal(payload.targetName, 'Cedar Cafe');
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

// ---------------------------------------------------------------------------
// PR #55 Round 3 / High #1 — the generic `transition` mutation cannot perform
// a moderation decision. `suspend`/`restore` are excluded from its action
// validator, so they are reachable only through `moderateListing`, which
// enforces the suspend-reason rule and writes the audit row in the same
// transaction. Asserted against the source because `mutations.ts` imports the
// Convex generated runtime, which `node --test` cannot load (see header).
// ---------------------------------------------------------------------------

const mutationsSource = readFileSync(
  new URL('../convex/businesses/mutations.ts', import.meta.url),
  'utf8'
);

/** Capture group 1 of a declaration pattern found in mutations.ts. */
function declarationBody(pattern: RegExp, description: string): string {
  const match = mutationsSource.match(pattern);
  assert.ok(match, `expected ${description} in mutations.ts`);
  const [, body] = match;
  assert.ok(body, `expected a body for ${description}`);
  return body;
}

/** Literal members of a `const <name> = v.union(...)` validator, sorted. */
function unionLiteralMembers(declaration: string): string[] {
  const body = declarationBody(
    new RegExp(`const ${declaration} = v\\.union\\(([\\s\\S]*?)\\);`),
    `the ${declaration} union`
  );
  const members: string[] = [];
  for (const literal of body.matchAll(/v\.literal\('([^']+)'\)/g)) {
    if (literal[1] !== undefined) {
      members.push(literal[1]);
    }
  }
  return members.sort();
}

test('the transition action validator admits only the owner lifecycle actions', () => {
  assert.deepStrictEqual(unionLiteralMembers('actionValidator'), [
    'reopenAsDraft',
    'submitForReview',
  ]);
});

test('suspend and restore are rejected by the transition validator', () => {
  const allowed = unionLiteralMembers('actionValidator');
  assert.ok(!allowed.includes('suspend'), 'transition must not accept suspend');
  assert.ok(!allowed.includes('restore'), 'transition must not accept restore');
});

test('moderateListing still admits all five moderation decisions', () => {
  assert.deepStrictEqual(unionLiteralMembers('moderationActionValidator'), [
    'approve',
    'reject',
    'requestChanges',
    'restore',
    'suspend',
  ]);
});

test('the transition handler writes no audit row; moderateListing writes one', () => {
  const transitionBody = declarationBody(
    /export const transition = mutation\(\{([\s\S]*?)\n\}\);/,
    'the transition mutation'
  );
  assert.ok(
    !transitionBody.includes("'auditLogs'"),
    'the transition handler must not write an auditLogs row'
  );

  const moderationBody = declarationBody(
    /export const moderateListing = mutation\(\{([\s\S]*?)\n\}\);/,
    'the moderateListing mutation'
  );
  assert.match(
    moderationBody,
    /ctx\.db\.insert\(\s*'auditLogs'/,
    'moderateListing must insert its auditLogs row in the same handler'
  );
  assert.ok(
    moderationBody.includes('buildModerationAuditLog('),
    'moderateListing must build its moderation audit payload'
  );
});

test('moderateListing requires suspend from approved and restore from suspended', () => {
  const requiredStatus = declarationBody(
    /const MODERATION_REQUIRED_STATUS[\s\S]*?= \{([\s\S]*?)\n\};/,
    'MODERATION_REQUIRED_STATUS'
  );
  assert.match(requiredStatus, /suspend:\s*'approved'/);
  assert.match(requiredStatus, /restore:\s*'suspended'/);
});
