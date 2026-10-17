#!/usr/bin/env node
/**
 * Pins the delete-time audit-name backfill (issue #15 Task 5, T4 review round
 * 2): EVERY legacy audit row for the deleting business must receive its
 * `targetName` snapshot before the cascade removes the target — not just the
 * first 100-row window the previous `.take(100)` implementation covered. The
 * fake ctx replays the `byTarget` index range a real read would serve.
 *
 * Run: node --test scripts/admin-deletion-backfill.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { backfillAuditTargetNames } from '../convex/businesses/adminDeletion.ts';

type AuditRow = {
  _id: string;
  _creationTime: number;
  targetType: string;
  targetId: string;
  targetName?: string;
};

type BackfillCtx = Parameters<typeof backfillAuditTargetNames>[0];
type BackfillBusiness = Parameters<typeof backfillAuditTargetNames>[1];

type FakeIndexRange = {
  eq: (field: string, value: string) => FakeIndexRange;
};

const BUSINESS_ID = 'businesses_1';
const BUSINESS_NAME = 'Cedar Cafe';

const business = {
  _id: BUSINESS_ID,
  name: BUSINESS_NAME,
} as unknown as BackfillBusiness;

/**
 * Minimal `ctx` stand-in for the backfill's `byTarget` range read: applies the
 * positional `eq` chain like a Convex index range, then serves `.collect()`
 * and `.take(n)`. `patch` writes through to the row so later reads observe the
 * snapshot, and every patch is recorded for assertions.
 */
function createFakeCtx(rows: AuditRow[]) {
  const patches: Array<{ id: string; targetName: string }> = [];

  const ctx = {
    db: {
      query(tableName: string) {
        assert.equal(tableName, 'auditLogs');
        return {
          withIndex(indexName: string, indexRange: (q: FakeIndexRange) => FakeIndexRange) {
            assert.equal(indexName, 'byTarget');
            const equalities: Array<[string, string]> = [];
            const range: FakeIndexRange = {
              eq(field: string, value: string) {
                equalities.push([field, value]);
                return range;
              },
            };
            indexRange(range);
            const matching = rows.filter((row) =>
              equalities.every(
                ([field, value]) => (row as Record<string, unknown>)[field] === value
              )
            );
            return {
              collect: async () => matching,
              take: async (n: number) => matching.slice(0, n),
            };
          },
        };
      },
      async patch(id: string, patch: { targetName: string }) {
        patches.push({ id, targetName: patch.targetName });
        const row = rows.find((candidate) => candidate._id === id);
        if (row !== undefined) {
          row.targetName = patch.targetName;
        }
      },
    },
  };

  return { ctx: ctx as unknown as BackfillCtx, patches };
}

function makeRows(input: { count: number; idOffset: number; targetId: string }): AuditRow[] {
  return Array.from({ length: input.count }, (_, index) => ({
    _id: `auditLogs_${input.idOffset + index}`,
    _creationTime: 1_700_000_000_000 + input.idOffset + index,
    targetType: 'business',
    targetId: input.targetId,
  }));
}

test('backfills every legacy audit row past the old 100-row window', async () => {
  const rows = [
    ...makeRows({ count: 250, idOffset: 0, targetId: BUSINESS_ID }),
    ...makeRows({ count: 3, idOffset: 1_000, targetId: 'businesses_other' }),
  ];
  const { ctx, patches } = createFakeCtx(rows);

  await backfillAuditTargetNames(ctx, business);

  assert.equal(patches.length, 250);
  for (const row of rows.slice(0, 250)) {
    assert.equal(row.targetName, BUSINESS_NAME);
  }
  // Another target's audit rows stay outside the range and untouched.
  for (const row of rows.slice(250)) {
    assert.equal(row.targetName, undefined);
  }
});

test('named rows inside the first window do not block unnamed rows beyond it', async () => {
  const rows = makeRows({ count: 250, idOffset: 0, targetId: BUSINESS_ID });
  for (const row of rows.slice(0, 100)) {
    row.targetName = 'Archived Name';
  }
  const { ctx, patches } = createFakeCtx(rows);

  await backfillAuditTargetNames(ctx, business);

  assert.equal(patches.length, 150);
  for (const row of rows.slice(0, 100)) {
    assert.equal(row.targetName, 'Archived Name');
  }
  for (const row of rows.slice(100)) {
    assert.equal(row.targetName, BUSINESS_NAME);
  }
});
