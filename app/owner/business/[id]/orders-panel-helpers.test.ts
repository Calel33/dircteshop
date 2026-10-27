#!/usr/bin/env node
/**
 * Pins the pure contract of the owner order board (issue #82, T7): the
 * per-status action set, the age thresholds, the label/pill coverage, note
 * truncation, the filter order, and the live `new`-page merge/pagination
 * rules. No React rendering here.
 *
 * Run: node --test "app/owner/business/[[]id[]]/*.test.ts"
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ORDER_DB_STATUSES,
  ORDER_OWNER_ACTIONS,
  TERMINAL_ORDER_STATUSES,
  resolveOwnerDecision,
} from '../../../../convex/orderPolicy.ts';
import {
  AGE_AMBER_MS,
  AGE_BADGE_CLASSES,
  AGE_RED_MS,
  NOTE_PREVIEW_LENGTH,
  ORDER_ACTION_LABELS,
  ORDER_CONTACT_ACTIONS,
  ORDER_CONTACT_ACTION_LABELS,
  ORDER_FILTERS,
  ORDER_STATUS_LABELS,
  STATUS_PILL_CLASSES,
  ageClass,
  canLoadMore,
  contactActionAnnouncement,
  contactActionErrorFallback,
  countChipLabel,
  formatAge,
  isLoadingMore,
  isTerminalStatus,
  mergeLiveOrderPages,
  nextActionForStatus,
  summarizeNote,
  type AgeTone,
  type OrderBoardStatus,
} from './orders-panel-helpers.ts';

const MINUTE = 60 * 1000;
const CREATED_AT = 1_700_000_000_000;

/** The merge only reads `_id`; `status` stands in for the live row value. */
type TestRow = { _id: string; status: string };

function row(_id: string, status = 'new'): TestRow {
  return { _id, status };
}

test('ORDER_ACTION_LABELS covers the six-action owner union', () => {
  assert.deepEqual(Object.keys(ORDER_ACTION_LABELS).sort(), [...ORDER_OWNER_ACTIONS].sort());
  for (const action of ORDER_OWNER_ACTIONS) {
    assert.ok(ORDER_ACTION_LABELS[action].trim().length > 0, action);
  }
});

test('contact controls stay outside the protocol action union', () => {
  assert.deepEqual(Object.keys(ORDER_CONTACT_ACTION_LABELS).sort(), [
    ...ORDER_CONTACT_ACTIONS,
  ].sort());
  for (const action of ORDER_CONTACT_ACTIONS) {
    assert.equal(
      (ORDER_OWNER_ACTIONS as readonly string[]).includes(action),
      false,
      `${action} must not be a protocol action`
    );
  }
});

test('contactActionAnnouncement names the change and reports a no-op honestly', () => {
  assert.equal(
    contactActionAnnouncement('block', 'Ada', 2),
    "Blocked the contact for Ada's order."
  );
  assert.equal(
    contactActionAnnouncement('block', 'Ada', 0),
    "The contact for Ada's order was already blocked."
  );
  assert.equal(
    contactActionAnnouncement('unblock', 'Ada', 1),
    "Unblocked the contact for Ada's order."
  );
  assert.equal(
    contactActionAnnouncement('unblock', 'Ada', 0),
    "The contact for Ada's order was not blocked."
  );
  assert.equal(
    contactActionAnnouncement('clear_throttle', 'Ada', 2),
    "Cleared the throttle for Ada's order."
  );
  assert.equal(
    contactActionAnnouncement('clear_throttle', 'Ada', 0),
    "There was no throttle to clear for Ada's order."
  );
});

test('contactActionErrorFallback has copy for every contact control', () => {
  for (const action of ORDER_CONTACT_ACTIONS) {
    assert.ok(contactActionErrorFallback(action).trim().length > 0, action);
  }
});

test('nextActionForStatus offers the §6.8 button set for every status', () => {
  const expected: Record<OrderBoardStatus, readonly string[]> = {
    new: ['accept', 'decline'],
    accepted: ['ready', 'cancel'],
    ready: ['complete', 'noShow', 'cancel'],
    completed: [],
    declined: [],
    cancelled: [],
    expired: [],
    no_show: [],
  };

  for (const status of ORDER_DB_STATUSES) {
    assert.deepEqual(nextActionForStatus(status), expected[status], status);
  }
});

test('every offered board action is a legal policy move', () => {
  for (const status of ORDER_DB_STATUSES) {
    for (const action of nextActionForStatus(status)) {
      const decision = resolveOwnerDecision(status, action);
      assert.equal(decision.kind, 'move', `${status} -> ${action}`);
    }
  }
});

test('terminal statuses offer no action and report themselves as terminal', () => {
  for (const status of TERMINAL_ORDER_STATUSES) {
    assert.equal(isTerminalStatus(status), true, status);
    assert.deepEqual(nextActionForStatus(status), [], status);
  }
  for (const status of ORDER_DB_STATUSES) {
    assert.equal(
      isTerminalStatus(status),
      (TERMINAL_ORDER_STATUSES as readonly string[]).includes(status),
      status
    );
  }
});

test('ageClass turns amber at exactly five minutes and red at exactly fifteen', () => {
  assert.equal(ageClass(CREATED_AT, CREATED_AT + AGE_AMBER_MS - 1), 'neutral');
  assert.equal(ageClass(CREATED_AT, CREATED_AT + AGE_AMBER_MS), 'amber');
  assert.equal(ageClass(CREATED_AT, CREATED_AT + AGE_RED_MS - 1), 'amber');
  assert.equal(ageClass(CREATED_AT, CREATED_AT + AGE_RED_MS), 'danger');
  assert.equal(ageClass(CREATED_AT, CREATED_AT - MINUTE), 'neutral');
});

test('AGE_BADGE_CLASSES has token classes for every age tone', () => {
  const tones: readonly AgeTone[] = ['neutral', 'amber', 'danger'];
  for (const tone of tones) {
    assert.ok(AGE_BADGE_CLASSES[tone].trim().length > 0, tone);
  }
});

test('formatAge buckets minutes and hours', () => {
  assert.equal(formatAge(CREATED_AT, CREATED_AT + 30_000), 'under a minute');
  assert.equal(formatAge(CREATED_AT, CREATED_AT + MINUTE), '1 min');
  assert.equal(formatAge(CREATED_AT, CREATED_AT + 59 * MINUTE), '59 min');
  assert.equal(formatAge(CREATED_AT, CREATED_AT + 60 * MINUTE), '1 h');
  assert.equal(formatAge(CREATED_AT, CREATED_AT + 90 * MINUTE), '1 h 30 min');
});

test('status pills and labels cover all eight statuses', () => {
  assert.deepEqual(Object.keys(STATUS_PILL_CLASSES).sort(), [...ORDER_DB_STATUSES].sort());
  assert.deepEqual(Object.keys(ORDER_STATUS_LABELS).sort(), [...ORDER_DB_STATUSES].sort());
  for (const status of ORDER_DB_STATUSES) {
    assert.ok(STATUS_PILL_CLASSES[status].trim().length > 0, status);
    assert.ok(ORDER_STATUS_LABELS[status].trim().length > 0, status);
  }
});

test('summarizeNote clamps only past the limit and collapses whitespace', () => {
  assert.equal(summarizeNote(null), null);
  assert.equal(summarizeNote('   '), null);

  const exact = 'a'.repeat(NOTE_PREVIEW_LENGTH);
  assert.deepEqual(summarizeNote(exact), { text: exact, truncated: false });

  const over = 'b'.repeat(NOTE_PREVIEW_LENGTH + 1);
  assert.deepEqual(summarizeNote(over), {
    text: `${'b'.repeat(NOTE_PREVIEW_LENGTH)}…`,
    truncated: true,
  });

  assert.deepEqual(summarizeNote('  ring   twice  '), {
    text: 'ring twice',
    truncated: false,
  });
  assert.deepEqual(summarizeNote('short', 5), { text: 'short', truncated: false });
  assert.deepEqual(summarizeNote('longer', 5), { text: 'longe…', truncated: true });
});

test('ORDER_FILTERS lists the nine filters in spec order', () => {
  assert.deepEqual(ORDER_FILTERS, [
    { value: 'new', label: 'New' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'ready', label: 'Ready' },
    { value: 'completed', label: 'Completed' },
    { value: 'declined', label: 'Declined' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'expired', label: 'Expired' },
    { value: 'no_show', label: 'No-show' },
    { value: 'all', label: 'All' },
  ]);
});

test('countChipLabel saturates at 99+', () => {
  assert.equal(countChipLabel(0, false), '0');
  assert.equal(countChipLabel(99, false), '99');
  assert.equal(countChipLabel(100, false), '99+');
  assert.equal(countChipLabel(12, true), '99+');
});

test('a row no live page returns is absent from the merge', () => {
  // Before the transition the row is on page 1; after it leaves `new` the
  // live page no longer returns it, and nothing frozen keeps it alive.
  assert.deepEqual(mergeLiveOrderPages({ rows: [row('a')] }, [], new Map()), [row('a')]);

  const pageResults = new Map([['c1', { rows: [row('b')] }]]);
  const merged = mergeLiveOrderPages({ rows: [] }, ['c1'], pageResults);
  assert.deepEqual(merged, [row('b')]);
  assert.equal(
    merged.some((entry) => entry._id === 'a'),
    false,
    'a row that left `new` must not survive'
  );
});

test('overlapping ids merge once: later page value, first page position', () => {
  const firstPage = { rows: [row('a', 'new'), row('b', 'new')] };
  const pageResults = new Map([['c1', { rows: [row('a', 'accepted'), row('c', 'new')] }]]);

  assert.deepEqual(mergeLiveOrderPages(firstPage, ['c1'], pageResults), [
    row('a', 'accepted'),
    row('b', 'new'),
    row('c', 'new'),
  ]);
});

test('a single page merges to exactly that page', () => {
  const firstPage = { rows: [row('a'), row('b')] };
  assert.deepEqual(mergeLiveOrderPages(firstPage, [], new Map()), firstPage.rows);
});

test('no pages merge to an empty list', () => {
  assert.deepEqual(mergeLiveOrderPages({ rows: [] }, [], new Map()), []);
});

test('canLoadMore is `new`-only, stops at isDone, and survives an empty tail', () => {
  assert.equal(canLoadMore('accepted', 12, { isDone: false }, 3), false);
  assert.equal(canLoadMore('all', 12, { isDone: false }, 0), false);
  assert.equal(canLoadMore('new', 50, { isDone: true }, 1), false);
  assert.equal(canLoadMore('new', 50, { isDone: true }, 0), false);
  // Before any extra page is loaded the old row-count guard still applies.
  assert.equal(canLoadMore('new', 0, { isDone: false }, 0), false);
  // C6: every visible row left `new`, but the live last page has more.
  assert.equal(canLoadMore('new', 0, { isDone: false }, 1), true);
  // While the requested page is still loading the control stays (disabled).
  assert.equal(canLoadMore('new', 50, undefined, 1), true);
});

test('an undelivered page result neither blanks the list nor ends loading', () => {
  const pages = ['c1'];
  assert.deepEqual(mergeLiveOrderPages({ rows: [row('a')] }, pages, new Map()), [row('a')]);
  assert.equal(isLoadingMore(pages, undefined), true);
  assert.equal(isLoadingMore(pages, { isDone: false }), false);
  assert.equal(isLoadingMore([], { isDone: false }), false);
});
