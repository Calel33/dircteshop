#!/usr/bin/env node
/**
 * Pins the B6a featured-pin mutation policy (issue #15, Task 4):
 *
 * - `setFeatured` writes only on an ACTUAL change: a no-op toggle (same value
 *   as the current one) performs no business write and no audit insert, so the
 *   audit feed never shows misleading duplicate events (contract §B7).
 * - A real toggle records exactly one `auditLogs` row: `action: 'feature'`,
 *   `reason: 'pinned' | 'unpinned'` (the direction), `targetType: 'business'`,
 *   and no statuses — the featured flag is not a state-machine transition.
 *
 * `convex/businesses/adminPolicy.ts` is pure (type-only generated imports), so
 * the decisions are asserted without a live Convex deployment. The handler in
 * `convex/businesses/adminMutations.ts` wires these into `requireSuperAdmin`,
 * the `isFeatured`/`lastUpdatedAt` patch, and the audit insert in one
 * transaction; the B4 public feed contract (`featuredForLanding`) is unchanged
 * and stays approved-only.
 *
 * Run: node --test scripts/admin-directory-mutations.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Id } from '../convex/_generated/dataModel.ts';
import {
  buildFeaturedAuditLog,
  resolveFeaturedChange,
} from '../convex/businesses/adminPolicy.ts';

// ---------------------------------------------------------------------------
// No-op detection: duplicate toggles write nothing.
// ---------------------------------------------------------------------------

test('toggling to the current value reports no change', () => {
  assert.deepStrictEqual(resolveFeaturedChange(true, true), { changed: false });
  assert.deepStrictEqual(resolveFeaturedChange(false, false), { changed: false });
});

test('pinning an unfeatured listing reports the pinned direction', () => {
  assert.deepStrictEqual(resolveFeaturedChange(false, true), {
    changed: true,
    reason: 'pinned',
  });
});

test('unpinning a featured listing reports the unpinned direction', () => {
  assert.deepStrictEqual(resolveFeaturedChange(true, false), {
    changed: true,
    reason: 'unpinned',
  });
});

// ---------------------------------------------------------------------------
// Audit row: one per actual change, direction as the reason, no statuses.
// ---------------------------------------------------------------------------

test('the featured audit row carries the direction and no statuses', () => {
  const row = buildFeaturedAuditLog({
    actorUserId: 'users_admin' as Id<'users'>,
    targetId: 'businesses_1' as Id<'businesses'>,
    reason: 'pinned',
    targetName: 'Cedar Cafe',
    createdAt: 1_700_000_000_000,
  });

  assert.deepStrictEqual(row, {
    actorUserId: 'users_admin' as Id<'users'>,
    action: 'feature',
    targetType: 'business',
    targetId: 'businesses_1' as Id<'businesses'>,
    reason: 'pinned',
    targetName: 'Cedar Cafe',
    createdAt: 1_700_000_000_000,
  });
  assert.equal('fromStatus' in row, false);
  assert.equal('toStatus' in row, false);
});

test('the audit row records an unpin as the unpinned reason', () => {
  const row = buildFeaturedAuditLog({
    actorUserId: 'users_admin' as Id<'users'>,
    targetId: 'businesses_2' as Id<'businesses'>,
    reason: 'unpinned',
    targetName: 'Cedar Cafe',
    createdAt: 42,
  });

  assert.equal(row.action, 'feature');
  assert.equal(row.reason, 'unpinned');
  assert.equal(row.createdAt, 42);
});
