#!/usr/bin/env node
/**
 * Pins the T5 (issue #79) owner-decision policy: the 8 x 6 `resolveOwnerDecision`
 * table, the wire action -> `orderEvents.action` map, the reason vocabulary, and
 * the frozen legacy/8 x 8 surfaces the new table builds on.
 *
 * `convex/orderPolicy.ts` and `convex/orderCommitPolicy.ts` are pure modules, so
 * this suite runs without a Convex deployment, like `order-commit-policy.test.ts`.
 * Both expectation tables are spelled out literally: a permissive implementation
 * cannot pass by being compared against itself.
 *
 * Run: node --test scripts/order-transition-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EVENT_FOR_ACTION,
  ORDER_ACTIONS,
  ORDER_DB_STATUSES,
  ORDER_OWNER_ACTIONS,
  ORDER_PROTOCOL_ACTIONS,
  ORDER_STATUSES,
  TERMINAL_ORDER_STATUSES,
  resolveOrderAction,
  resolveOwnerDecision,
} from '../convex/orderPolicy.ts';
import type { OrderDbStatus, OrderOwnerAction, OrderOwnerDecision } from '../convex/orderPolicy.ts';
import {
  DEFAULT_NO_SHOW_REASON,
  DEFAULT_TTL_MS,
  EXPIRE_REASON,
  MAX_TRANSITION_REASON_LENGTH,
  VISITOR_CANCEL_REASON,
  validateTransitionReason,
} from '../convex/orderCommitPolicy.ts';

// ---------------------------------------------------------------------------
// Owner decision table: §6.1 L844-857 as revised by plan D1 (OQ-5).
// ---------------------------------------------------------------------------

// Every one of the 8 x 6 pairs, written independently of the resolver. The two
// decision actions use the narrow override (a late accept/decline loses the
// race with `ORDER_ALREADY_DECIDED`; a late accept on an expired order is
// `ORDER_EXPIRED`); the other four mirror the frozen `resolveOrderAction`
// matrix and are pinned separately by the delegation test below.
const EXPECTED: Record<OrderDbStatus, Record<OrderOwnerAction, OrderOwnerDecision>> = {
  new: {
    accept: { kind: 'move', to: 'accepted' },
    decline: { kind: 'move', to: 'declined' },
    cancel: { kind: 'move', to: 'cancelled' },
    ready: { kind: 'error', code: 'INVALID_TRANSITION' },
    complete: { kind: 'error', code: 'INVALID_TRANSITION' },
    noShow: { kind: 'error', code: 'INVALID_TRANSITION' },
  },
  accepted: {
    accept: { kind: 'reused' },
    decline: { kind: 'error', code: 'ORDER_ALREADY_DECIDED' },
    cancel: { kind: 'move', to: 'cancelled' },
    ready: { kind: 'move', to: 'ready' },
    complete: { kind: 'error', code: 'INVALID_TRANSITION' },
    noShow: { kind: 'error', code: 'INVALID_TRANSITION' },
  },
  ready: {
    accept: { kind: 'error', code: 'ORDER_TERMINAL' },
    decline: { kind: 'error', code: 'ORDER_ALREADY_DECIDED' },
    cancel: { kind: 'move', to: 'cancelled' },
    ready: { kind: 'reused' },
    complete: { kind: 'move', to: 'completed' },
    noShow: { kind: 'move', to: 'no_show' },
  },
  completed: {
    accept: { kind: 'error', code: 'ORDER_TERMINAL' },
    decline: { kind: 'error', code: 'ORDER_TERMINAL' },
    cancel: { kind: 'error', code: 'ORDER_TERMINAL' },
    ready: { kind: 'error', code: 'ORDER_TERMINAL' },
    complete: { kind: 'error', code: 'ORDER_TERMINAL' },
    noShow: { kind: 'error', code: 'ORDER_TERMINAL' },
  },
  declined: {
    accept: { kind: 'error', code: 'ORDER_ALREADY_DECIDED' },
    decline: { kind: 'reused' },
    cancel: { kind: 'error', code: 'ORDER_TERMINAL' },
    ready: { kind: 'error', code: 'ORDER_TERMINAL' },
    complete: { kind: 'error', code: 'ORDER_TERMINAL' },
    noShow: { kind: 'error', code: 'ORDER_TERMINAL' },
  },
  cancelled: {
    accept: { kind: 'error', code: 'ORDER_TERMINAL' },
    decline: { kind: 'error', code: 'ORDER_TERMINAL' },
    cancel: { kind: 'error', code: 'ORDER_TERMINAL' },
    ready: { kind: 'error', code: 'ORDER_TERMINAL' },
    complete: { kind: 'error', code: 'ORDER_TERMINAL' },
    noShow: { kind: 'error', code: 'ORDER_TERMINAL' },
  },
  expired: {
    accept: { kind: 'error', code: 'ORDER_EXPIRED' },
    decline: { kind: 'error', code: 'ORDER_TERMINAL' },
    cancel: { kind: 'error', code: 'ORDER_TERMINAL' },
    ready: { kind: 'error', code: 'ORDER_TERMINAL' },
    complete: { kind: 'error', code: 'ORDER_TERMINAL' },
    noShow: { kind: 'error', code: 'ORDER_TERMINAL' },
  },
  no_show: {
    accept: { kind: 'error', code: 'ORDER_TERMINAL' },
    decline: { kind: 'error', code: 'ORDER_TERMINAL' },
    cancel: { kind: 'error', code: 'ORDER_TERMINAL' },
    ready: { kind: 'error', code: 'ORDER_TERMINAL' },
    complete: { kind: 'error', code: 'ORDER_TERMINAL' },
    noShow: { kind: 'error', code: 'ORDER_TERMINAL' },
  },
};

test('pins the eight statuses and the six owner actions', () => {
  assert.deepEqual([...ORDER_DB_STATUSES], [
    'new',
    'accepted',
    'ready',
    'completed',
    'declined',
    'cancelled',
    'expired',
    'no_show',
  ]);
  assert.deepEqual([...ORDER_OWNER_ACTIONS], [
    'accept',
    'decline',
    'cancel',
    'ready',
    'complete',
    'noShow',
  ]);
});

test('resolves every owner action from every status (48 cells)', () => {
  for (const status of ORDER_DB_STATUSES) {
    for (const action of ORDER_OWNER_ACTIONS) {
      assert.deepEqual(
        resolveOwnerDecision(status, action),
        EXPECTED[status][action],
        `resolveOwnerDecision(${status}, ${action})`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Delegation: cancel | ready | complete | noShow are the frozen matrix's cells,
// not a second copy of the transition table.
// ---------------------------------------------------------------------------

const DELEGATED_ACTIONS: readonly OrderOwnerAction[] = ['cancel', 'ready', 'complete', 'noShow'];

test('delegates cancel/ready/complete/noShow to resolveOrderAction', () => {
  for (const status of ORDER_DB_STATUSES) {
    for (const action of DELEGATED_ACTIONS) {
      assert.deepEqual(
        resolveOwnerDecision(status, action),
        resolveOrderAction(status, action),
        `resolveOwnerDecision(${status}, ${action}) must equal resolveOrderAction`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Guard: the frozen surfaces above. `scripts/order-policy.test.ts` and
// `scripts/order-commit-policy.test.ts` own the exhaustive pins; these spot
// checks make an edit to the frozen legacy machine or the 8 x 8 matrix fail
// this suite too.
// ---------------------------------------------------------------------------

const FROZEN_MOVES = [
  ['new', 'accept', 'accepted'],
  ['new', 'decline', 'declined'],
  ['new', 'cancel', 'cancelled'],
  ['new', 'expire', 'expired'],
  ['accepted', 'ready', 'ready'],
  ['accepted', 'cancel', 'cancelled'],
  ['ready', 'complete', 'completed'],
  ['ready', 'noShow', 'no_show'],
  ['ready', 'cancel', 'cancelled'],
] as const;

const FROZEN_INVALID = [
  ['new', 'submit'],
  ['new', 'ready'],
  ['new', 'complete'],
  ['new', 'noShow'],
  ['accepted', 'submit'],
  ['accepted', 'complete'],
  ['accepted', 'noShow'],
  ['ready', 'submit'],
  ['ready', 'accept'],
  ['ready', 'decline'],
] as const;

const FROZEN_REUSED = [
  ['accepted', 'accept'],
  ['ready', 'ready'],
] as const;

test('the frozen legacy machine and 8 x 8 matrix still hold', () => {
  assert.deepEqual([...ORDER_STATUSES], ['new', 'accepted', 'ready', 'completed']);
  assert.deepEqual([...ORDER_ACTIONS], ['accept', 'ready', 'complete']);
  assert.deepEqual([...TERMINAL_ORDER_STATUSES], [
    'completed',
    'declined',
    'cancelled',
    'expired',
    'no_show',
  ]);
  assert.deepEqual([...ORDER_PROTOCOL_ACTIONS], [
    'submit',
    'accept',
    'decline',
    'cancel',
    'ready',
    'complete',
    'noShow',
    'expire',
  ]);

  // Terminal blanket: every protocol action from every terminal status.
  for (const status of TERMINAL_ORDER_STATUSES) {
    for (const action of ORDER_PROTOCOL_ACTIONS) {
      assert.deepEqual(
        resolveOrderAction(status, action),
        { kind: 'error', code: 'ORDER_TERMINAL' },
        `resolveOrderAction(${status}, ${action}) must stay ORDER_TERMINAL`
      );
    }
  }

  for (const [status, action, to] of FROZEN_MOVES) {
    assert.deepEqual(
      resolveOrderAction(status, action),
      { kind: 'move', to },
      `resolveOrderAction(${status}, ${action})`
    );
  }

  for (const [status, action] of FROZEN_INVALID) {
    assert.deepEqual(
      resolveOrderAction(status, action),
      { kind: 'error', code: 'INVALID_TRANSITION' },
      `resolveOrderAction(${status}, ${action})`
    );
  }

  for (const [status, action] of FROZEN_REUSED) {
    assert.deepEqual(
      resolveOrderAction(status, action),
      { kind: 'reused' },
      `resolveOrderAction(${status}, ${action})`
    );
  }
});

// ---------------------------------------------------------------------------
// Wire action -> event literal. `orderEvents.action` is frozen in schema.ts
// L298-307; `submitted` and `expired` are written by placeOrder and the system
// sweep, never by an owner decision.
// ---------------------------------------------------------------------------

test('maps each owner action 1:1 to its orderEvents.action literal', () => {
  assert.deepEqual(Object.keys(EVENT_FOR_ACTION), [
    'accept',
    'decline',
    'cancel',
    'ready',
    'complete',
    'noShow',
  ]);
  assert.deepEqual(EVENT_FOR_ACTION, {
    accept: 'accepted',
    decline: 'declined',
    cancel: 'cancelled',
    ready: 'ready',
    complete: 'completed',
    noShow: 'no_show',
  });
  assert.deepEqual(Object.values(EVENT_FOR_ACTION).sort(), [
    'accepted',
    'cancelled',
    'completed',
    'declined',
    'no_show',
    'ready',
  ]);
});

// ---------------------------------------------------------------------------
// Reason policy: trim first, then measure. Boundary values only.
// ---------------------------------------------------------------------------

test('treats a blank reason as missing only when required', () => {
  assert.equal(validateTransitionReason(undefined, true), 'missing');
  assert.equal(validateTransitionReason(undefined, false), 'ok');
  assert.equal(validateTransitionReason('', true), 'missing');
  assert.equal(validateTransitionReason('', false), 'ok');
  assert.equal(validateTransitionReason('   ', true), 'missing');
  assert.equal(validateTransitionReason('   ', false), 'ok');
  // Whitespace cannot be too long: 201 spaces trim to blank, so `required:
  // false` is ok — pinning that `too_long` is measured after the trim.
  assert.equal(validateTransitionReason(' '.repeat(201), true), 'missing');
  assert.equal(validateTransitionReason(' '.repeat(201), false), 'ok');
});

test('accepts one character and exactly the maximum length', () => {
  assert.equal(validateTransitionReason('a', true), 'ok');
  assert.equal(validateTransitionReason('a', false), 'ok');
  assert.equal(validateTransitionReason('a'.repeat(MAX_TRANSITION_REASON_LENGTH), true), 'ok');
  assert.equal(validateTransitionReason('a'.repeat(MAX_TRANSITION_REASON_LENGTH), false), 'ok');
});

test('rejects a trimmed reason past the maximum length', () => {
  assert.equal(
    validateTransitionReason('a'.repeat(MAX_TRANSITION_REASON_LENGTH + 1), true),
    'too_long'
  );
  assert.equal(
    validateTransitionReason('a'.repeat(MAX_TRANSITION_REASON_LENGTH + 1), false),
    'too_long'
  );
  // Surrounding whitespace does not change the measured length.
  assert.equal(
    validateTransitionReason(`  ${'a'.repeat(MAX_TRANSITION_REASON_LENGTH + 1)}  `, true),
    'too_long'
  );
});

test('measures the trimmed value, not the raw one', () => {
  const padded = `  ${'a'.repeat(MAX_TRANSITION_REASON_LENGTH)}  `;
  assert.equal(validateTransitionReason(padded, true), 'ok');
});

// ---------------------------------------------------------------------------
// Constants, pinned by value. `EXPIRE_REASON` is the human form of the TTL.
// ---------------------------------------------------------------------------

test('pins the reason vocabulary', () => {
  assert.equal(MAX_TRANSITION_REASON_LENGTH, 200);
  assert.equal(DEFAULT_NO_SHOW_REASON, 'Not picked up');
  assert.equal(VISITOR_CANCEL_REASON, 'Cancelled by customer');
  assert.equal(EXPIRE_REASON, 'Not accepted within 60 minutes');
});

test('keeps the expiry reason keyed to the 60-minute TTL', () => {
  // `EXPIRE_REASON`'s "60 minutes" and `DEFAULT_TTL_MS` are the same duration;
  // this pin fails if either is changed without the other.
  assert.equal(DEFAULT_TTL_MS, 3_600_000);
  assert.match(EXPIRE_REASON, /\b60 minutes\b/);
  assert.equal(DEFAULT_TTL_MS, 60 * 60 * 1000);
});
