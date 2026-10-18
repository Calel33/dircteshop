#!/usr/bin/env node
/**
 * Pins the B6b overview-count contract (issue #16, Task 1):
 *
 * - `localMonthRange` converts an instant to the admin's LOCAL calendar month:
 *   `monthStart` is local day 1 at 00:00:00.000 (inclusive) and
 *   `monthEndExclusive` is the next month's local day 1 (exclusive). These
 *   tests cover the helper's window only; they do not verify query index usage
 *   or count equality against businesses rows.
 * - `assertOverviewWindow` rejects a non-finite or empty window with a
 *   `ConvexError`. The handler's authorization/read ordering is not exercised.
 *
 * `convex/adminProjections.ts` is pure, so these helper tests do not need a
 * live Convex deployment. They do not invoke `overviewStats`; authenticated
 * runtime count verification remains outstanding. Loading/error states live
 * in `app/admin/admin-overview-cards.tsx`.
 *
 * Distinct from `convex/businesses/adminProjections.ts` (the B6a directory
 * projection): this module owns the `/admin` overview surface only.
 *
 * Run: node --test scripts/admin-overview.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertOverviewWindow, localMonthRange } from '../convex/adminProjections.ts';

// ---------------------------------------------------------------------------
// localMonthRange — local calendar month, start-inclusive / end-exclusive.
// ---------------------------------------------------------------------------

test('localMonthRange starts at local midnight of the current month', () => {
  const now = new Date(2026, 8, 17, 13, 45, 30, 500).getTime();

  const { monthStart } = localMonthRange(now);

  const start = new Date(monthStart);
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 8);
  assert.equal(start.getDate(), 1);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getSeconds(), 0);
  assert.equal(start.getMilliseconds(), 0);
});

test('localMonthRange ends at the next month local midnight (exclusive)', () => {
  const now = new Date(2026, 8, 17, 13, 45, 30, 500).getTime();

  const { monthEndExclusive } = localMonthRange(now);

  const end = new Date(monthEndExclusive);
  assert.equal(end.getFullYear(), 2026);
  assert.equal(end.getMonth(), 9);
  assert.equal(end.getDate(), 1);
  assert.equal(end.getHours(), 0);
  assert.equal(end.getMinutes(), 0);
  assert.equal(end.getSeconds(), 0);
  assert.equal(end.getMilliseconds(), 0);
});

test('the input instant lies inside its local month window', () => {
  const now = new Date(2026, 8, 17, 13, 45, 30, 500).getTime();

  const { monthStart, monthEndExclusive } = localMonthRange(now);

  assert.ok(Number.isInteger(monthStart), 'monthStart is an epoch-ms integer');
  assert.ok(Number.isInteger(monthEndExclusive), 'monthEndExclusive is an epoch-ms integer');
  assert.ok(monthStart <= now, 'monthStart is inclusive');
  assert.ok(now < monthEndExclusive, 'monthEndExclusive excludes the next month');
});

test('an instant at the exclusive end starts the next month window', () => {
  const september = localMonthRange(new Date(2026, 8, 30, 23, 59, 59, 999).getTime());

  const october = localMonthRange(september.monthEndExclusive);

  assert.equal(october.monthStart, september.monthEndExclusive);
  assert.ok(october.monthEndExclusive > september.monthEndExclusive);
});

test('December rolls the exclusive end into January of the next year', () => {
  const { monthStart, monthEndExclusive } = localMonthRange(new Date(2026, 11, 5, 9).getTime());

  assert.equal(new Date(monthStart).getMonth(), 11);

  const end = new Date(monthEndExclusive);
  assert.equal(end.getFullYear(), 2027);
  assert.equal(end.getMonth(), 0);
  assert.equal(end.getDate(), 1);
  assert.equal(end.getHours(), 0);
});

// ---------------------------------------------------------------------------
// assertOverviewWindow — the server-side bound that runs before any read.
// ---------------------------------------------------------------------------

test('assertOverviewWindow accepts a real month window', () => {
  assert.doesNotThrow(() => assertOverviewWindow(localMonthRange(Date.now())));
  assert.doesNotThrow(() => assertOverviewWindow({ monthStart: 1, monthEndExclusive: 2 }));
});

test('assertOverviewWindow rejects an empty or inverted window', () => {
  assert.throws(
    () => assertOverviewWindow({ monthStart: 100, monthEndExclusive: 100 }),
    /month window/
  );
  assert.throws(
    () => assertOverviewWindow({ monthStart: 200, monthEndExclusive: 100 }),
    /month window/
  );
});

test('assertOverviewWindow rejects non-finite bounds', () => {
  assert.throws(
    () => assertOverviewWindow({ monthStart: Number.NaN, monthEndExclusive: 100 }),
    /month window/
  );
  assert.throws(
    () => assertOverviewWindow({ monthStart: 0, monthEndExclusive: Number.POSITIVE_INFINITY }),
    /month window/
  );
});
