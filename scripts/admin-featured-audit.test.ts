#!/usr/bin/env node
/**
 * Pins the B6a featured audit row (issue #15 Task 4): the write must carry the
 * immutable business-name snapshot so the row stays searchable by name after a
 * hard delete. Pure builder, asserted without a Convex runtime.
 *
 * Run: node --test scripts/admin-featured-audit.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Id } from '../convex/_generated/dataModel';
import { buildFeaturedAuditLog } from '../convex/businesses/adminPolicy.ts';

test('featured audit row snapshots the business name', () => {
  const payload = buildFeaturedAuditLog({
    actorUserId: 'users_admin' as Id<'users'>,
    targetId: 'businesses_1' as Id<'businesses'>,
    reason: 'pinned',
    targetName: 'Cedar Cafe',
    createdAt: 42,
  });

  assert.deepStrictEqual(payload, {
    actorUserId: 'users_admin',
    action: 'feature',
    targetType: 'business',
    targetId: 'businesses_1',
    reason: 'pinned',
    targetName: 'Cedar Cafe',
    createdAt: 42,
  });
});
