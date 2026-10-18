#!/usr/bin/env node
/**
 * Pins the B6b analytics counts-stub contract (issue #16, Task 3):
 *
 * - `toAnalyticsCounts` returns the three supplied values under the exact
 *   orders, bookings, and quote-request keys.
 * - The boundary shape carries only those three counts (SPEC §13 Open Items:
 *   "the stub shows counts from existing tables: views TBD,
 *   orders/bookings/quotes counts real"). There is NO view tracking in v1, so
 *   no views field exists here and no number is invented for one: the UI
 *   renders `ANALYTICS_VIEWS_PLACEHOLDER` where a views metric would appear.
 *
 * `convex/adminProjections.ts` is pure, so these helper tests do not need a
 * live Convex deployment. They do not invoke `analyticsCounts` or compare its
 * results with table rows; authenticated runtime count verification remains
 * outstanding. Loading/error states live in `app/admin/analytics/analytics-summary.tsx`.
 *
 * Run: node --test scripts/admin-analytics.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ANALYTICS_VIEWS_PLACEHOLDER, toAnalyticsCounts } from '../convex/adminProjections.ts';

// ---------------------------------------------------------------------------
// Boundary shape: exactly the three real table counts, nothing estimated.
// ---------------------------------------------------------------------------

test('the boundary carries exactly the three real table counts', () => {
  const counts = toAnalyticsCounts(4, 7, 2);

  assert.deepStrictEqual(counts, { orders: 4, bookings: 7, quoteRequests: 2 });
  assert.deepStrictEqual(Object.keys(counts).sort(), ['bookings', 'orders', 'quoteRequests']);
});

test('a zero-count table stays 0 — an empty result is a real count, not a missing metric', () => {
  const counts = toAnalyticsCounts(0, 0, 0);

  assert.equal(counts.orders, 0);
  assert.equal(counts.bookings, 0);
  assert.equal(counts.quoteRequests, 0);
});

test('the shape has no views field — v1 has no view tracking, so none is invented', () => {
  assert.equal(Object.keys(toAnalyticsCounts(1, 2, 3)).includes('views'), false);
});

// ---------------------------------------------------------------------------
// Views: TBD — the v1 placeholder, never a number.
// ---------------------------------------------------------------------------

test('the views metric renders the TBD placeholder', () => {
  assert.equal(ANALYTICS_VIEWS_PLACEHOLDER, 'TBD');
});
