#!/usr/bin/env node
/**
 * Pins the B3c (issue #14) approval-queue filter boundary (Task 1).
 *
 * `convex/businesses/moderationProjections.ts` turns the confirmed
 * category/priority/time filters into an inclusive `submittedAt` window that
 * `listPendingApprovals` applies as an index range BEFORE `.paginate`. These
 * pure helpers are asserted without a Convex runtime (runtime DB tests are
 * unavailable in this repo; see tasks/issue-13-context.md §4). The runtime
 * behavior — that the bounded page reads only the requested window — is
 * deferred to the authenticated Convex smoke check.
 *
 * The range must stay consistent with the presentation badge
 * (`app/admin/approvals/approval-priority.ts` `deriveAgePriority`), so the two
 * are cross-checked at the 48h boundary.
 *
 * Run: node --test scripts/moderation-queue.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveAgePriority } from '../app/admin/approvals/approval-priority.ts';
import {
  isSubmittedAtRangeEmpty,
  PRIORITY_HIGH_AFTER_HOURS,
  QUEUE_PAGE_SIZE,
  QUEUE_PRIORITY_FILTERS,
  QUEUE_TIME_FILTERS,
  resolveSubmittedAtRange,
} from '../convex/businesses/moderationProjections.ts';

const HOUR_MS = 3_600_000;
const NOW = 1_700_000_000_000;

test('exposes exactly the confirmed time and priority filters', () => {
  assert.deepStrictEqual([...QUEUE_TIME_FILTERS], ['all', '24h', '7d', '30d']);
  assert.deepStrictEqual([...QUEUE_PRIORITY_FILTERS], ['all', 'high', 'normal']);
});

test('the page size is 25 and the priority band is 48h', () => {
  assert.equal(QUEUE_PAGE_SIZE, 25);
  assert.equal(PRIORITY_HIGH_AFTER_HOURS, 48);
});

test('all/all is unbounded on both sides', () => {
  assert.deepStrictEqual(resolveSubmittedAtRange({ timeFilter: 'all', priority: 'all', now: NOW }), {});
});

test('each time window sets an inclusive lower bound of now minus the window', () => {
  assert.deepStrictEqual(resolveSubmittedAtRange({ timeFilter: '24h', priority: 'all', now: NOW }), {
    lowerInclusive: NOW - 24 * HOUR_MS,
  });
  assert.deepStrictEqual(resolveSubmittedAtRange({ timeFilter: '7d', priority: 'all', now: NOW }), {
    lowerInclusive: NOW - 7 * 24 * HOUR_MS,
  });
  assert.deepStrictEqual(resolveSubmittedAtRange({ timeFilter: '30d', priority: 'all', now: NOW }), {
    lowerInclusive: NOW - 30 * 24 * HOUR_MS,
  });
});

test('high priority sets an inclusive upper bound at the 48h cutoff', () => {
  assert.deepStrictEqual(resolveSubmittedAtRange({ timeFilter: 'all', priority: 'high', now: NOW }), {
    upperInclusive: NOW - 48 * HOUR_MS,
  });
});

test('normal priority sets a strict lower bound just past the 48h cutoff', () => {
  assert.deepStrictEqual(resolveSubmittedAtRange({ timeFilter: 'all', priority: 'normal', now: NOW }), {
    lowerInclusive: NOW - 48 * HOUR_MS + 1,
  });
});

test('combined filters intersect: lower is the greater floor, upper is kept', () => {
  assert.deepStrictEqual(resolveSubmittedAtRange({ timeFilter: '7d', priority: 'high', now: NOW }), {
    lowerInclusive: NOW - 7 * 24 * HOUR_MS,
    upperInclusive: NOW - 48 * HOUR_MS,
  });
  // 30d + normal: the 48h floor is tighter than the 30d floor.
  assert.deepStrictEqual(resolveSubmittedAtRange({ timeFilter: '30d', priority: 'normal', now: NOW }), {
    lowerInclusive: NOW - 48 * HOUR_MS + 1,
  });
  // 24h + normal: the 24h floor is tighter than the 48h floor.
  assert.deepStrictEqual(resolveSubmittedAtRange({ timeFilter: '24h', priority: 'normal', now: NOW }), {
    lowerInclusive: NOW - 24 * HOUR_MS,
  });
});

test('a contradictory window (24h + high) is empty and never drains the queue', () => {
  const range = resolveSubmittedAtRange({ timeFilter: '24h', priority: 'high', now: NOW });
  assert.equal(isSubmittedAtRangeEmpty(range), true);
});

test('a satisfiable combined window is not reported empty', () => {
  const range = resolveSubmittedAtRange({ timeFilter: '30d', priority: 'high', now: NOW });
  assert.equal(isSubmittedAtRangeEmpty(range), false);
});

test('the priority window agrees with deriveAgePriority at the exact 48h boundary', () => {
  const cutoffSubmission = NOW - 48 * HOUR_MS;
  const justUnder = cutoffSubmission + 1;

  assert.equal(deriveAgePriority(cutoffSubmission, NOW), 'high');
  assert.equal(deriveAgePriority(justUnder, NOW), 'normal');

  const high = resolveSubmittedAtRange({ timeFilter: 'all', priority: 'high', now: NOW });
  const normal = resolveSubmittedAtRange({ timeFilter: 'all', priority: 'normal', now: NOW });

  // high includes exactly the submissions aged >= 48h.
  assert.equal(high.upperInclusive !== undefined && cutoffSubmission <= high.upperInclusive, true);
  assert.equal(high.upperInclusive !== undefined && justUnder <= high.upperInclusive, false);
  // normal includes everything past the cutoff.
  assert.equal(normal.lowerInclusive !== undefined && justUnder >= normal.lowerInclusive, true);
  assert.equal(normal.lowerInclusive !== undefined && cutoffSubmission >= normal.lowerInclusive, false);
});

test('a future submission counts as recent and normal, matching the badge', () => {
  const future = NOW + 5 * HOUR_MS;
  assert.equal(deriveAgePriority(future, NOW), 'normal');

  const recent = resolveSubmittedAtRange({ timeFilter: '24h', priority: 'all', now: NOW });
  assert.equal(recent.lowerInclusive !== undefined && future >= recent.lowerInclusive, true);
});
