#!/usr/bin/env node
/**
 * Pins the B3c (issue #14) cursor-page planning helper (review fix for the
 * SplitRequired pagination skip).
 *
 * `approval-pagination.ts` is a pure module (no React, no Convex), so the
 * next-cursor decision — including the SplitRequired re-scope that divides the
 * range at `splitCursor` without skipping the unreturned remainder — is asserted
 * with Node's test runner. The React wiring lives in the route; runtime behavior
 * is deferred to the authenticated manual check.
 *
 * Run: node --test app/admin/approvals/approval-pagination.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FIRST_QUEUE_PAGE, planQueuePage, type QueuePageRef } from './approval-pagination.ts';

test('a page with no result yet keeps its range and offers no Next', () => {
  const ref: QueuePageRef = { cursor: 'C0', endCursor: null };
  const plan = planQueuePage(ref, undefined);
  assert.strictEqual(plan.current, ref);
  assert.equal(plan.next, null);
});

test('a complete page advances Next to its continueCursor', () => {
  const ref: QueuePageRef = { cursor: null, endCursor: null };
  const plan = planQueuePage(ref, { continueCursor: 'C1', isDone: false, pageStatus: null });
  assert.deepStrictEqual(plan.current, ref);
  assert.deepStrictEqual(plan.next, { cursor: 'C1', endCursor: null });
});

test('the last page offers no Next', () => {
  const ref: QueuePageRef = { cursor: 'C1', endCursor: null };
  const plan = planQueuePage(ref, { continueCursor: 'C1', isDone: true, pageStatus: null });
  assert.equal(plan.next, null);
});

test('SplitRecommended is a complete page, so Next continues normally', () => {
  const ref: QueuePageRef = { cursor: null, endCursor: null };
  const plan = planQueuePage(ref, {
    continueCursor: 'C1',
    isDone: false,
    splitCursor: 'S',
    pageStatus: 'SplitRecommended',
  });
  assert.deepStrictEqual(plan.current, ref);
  assert.deepStrictEqual(plan.next, { cursor: 'C1', endCursor: null });
});

test('SplitRequired re-scopes the visible page to the first half', () => {
  const ref: QueuePageRef = { cursor: 'C0', endCursor: null };
  const plan = planQueuePage(ref, {
    continueCursor: 'C1',
    isDone: false,
    splitCursor: 'S',
    pageStatus: 'SplitRequired',
  });
  assert.deepStrictEqual(plan.current, { cursor: 'C0', endCursor: 'S' });
});

test('SplitRequired withholds Next so the unreturned remainder is not skipped', () => {
  const ref: QueuePageRef = { cursor: 'C0', endCursor: null };
  const plan = planQueuePage(ref, {
    continueCursor: 'C1',
    isDone: false,
    splitCursor: 'S',
    pageStatus: 'SplitRequired',
  });
  assert.equal(plan.next, null);
});

test('after the re-scope the second half is reachable from the split point', () => {
  // The re-scoped first half comes back complete; its continueCursor is the
  // split point, so Next resumes exactly where the first half ended.
  const ref: QueuePageRef = { cursor: 'C0', endCursor: 'S' };
  const plan = planQueuePage(ref, { continueCursor: 'S', isDone: false, pageStatus: null });
  assert.deepStrictEqual(plan.current, ref);
  assert.deepStrictEqual(plan.next, { cursor: 'S', endCursor: null });
});

test('re-scoping is idempotent — no loop while splitCursor is unchanged', () => {
  const ref: QueuePageRef = { cursor: 'C0', endCursor: 'S' };
  const plan = planQueuePage(ref, {
    continueCursor: 'S',
    isDone: false,
    splitCursor: 'S',
    pageStatus: 'SplitRequired',
  });
  assert.strictEqual(plan.current, ref);
  assert.equal(plan.next, null);
});

test('a deeper split re-scopes again to the nearer split point', () => {
  const ref: QueuePageRef = { cursor: 'C0', endCursor: 'S1' };
  const plan = planQueuePage(ref, {
    continueCursor: 'S1',
    isDone: false,
    splitCursor: 'S2',
    pageStatus: 'SplitRequired',
  });
  assert.deepStrictEqual(plan.current, { cursor: 'C0', endCursor: 'S2' });
  assert.equal(plan.next, null);
});

test('the first page range starts empty at both ends', () => {
  assert.deepStrictEqual(FIRST_QUEUE_PAGE, { cursor: null, endCursor: null });
});
