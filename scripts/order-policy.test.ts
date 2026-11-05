#!/usr/bin/env node
/**
 * Pins the B8 (issue #8) order policy: the forward-only status machine and the
 * server-side validation for the anonymous order form.
 *
 * `convex/orderPolicy.ts` is a pure module with no runtime imports, so it is
 * asserted without a Convex deployment, like `scripts/notifications.test.ts`.
 * `convex/orders.ts` wires these helpers into `submitOrder` and
 * `transitionOrderStatus`; that runtime behavior is proven by the T10 Reticle
 * drive, not here. Selector semantics follow the schema: a required group is
 * single-select (exactly one choice), an optional group is multi-select (zero
 * or more).
 *
 * Error messages are owned by the module, so assertions only require a
 * non-empty string; no message wording is pinned here.
 *
 * Run: node --test scripts/order-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ORDER_ACTIONS,
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  nextOrderStatus,
  validateOrderContact,
  validateOrderSelections,
} from '../convex/orderPolicy.ts';
import type {
  OrderAction,
  OrderCustomizationGroup,
  OrderSelection,
  OrderStatus,
} from '../convex/orderPolicy.ts';

/** Fails unless the helper returned a non-empty user-facing message. */
function assertUserError(error: string | null, label: string): void {
  assert.ok(error !== null, `${label}: expected an error`);
  assert.equal(typeof error, 'string', `${label}: error must be a string`);
  assert.ok(error.length > 0, `${label}: error must not be empty`);
}

// ---------------------------------------------------------------------------
// Status machine: new -> accepted -> ready -> completed, with no shortcuts.
// ---------------------------------------------------------------------------

test('pins the forward-only status chain and the terminal state', () => {
  assert.deepEqual([...ORDER_STATUSES], ['new', 'accepted', 'ready', 'completed']);
  assert.deepEqual(ORDER_STATUS_TRANSITIONS, {
    new: 'accepted',
    accepted: 'ready',
    ready: 'completed',
    completed: null,
  });
});

test('pins the owner actions in board order', () => {
  assert.deepEqual([...ORDER_ACTIONS], ['accept', 'ready', 'complete']);
});

test('returns the target status for the one legal action at each step', () => {
  assert.equal(nextOrderStatus('new', 'accept'), 'accepted');
  assert.equal(nextOrderStatus('accepted', 'ready'), 'ready');
  assert.equal(nextOrderStatus('ready', 'complete'), 'completed');
});

test('keeps completed terminal for every action', () => {
  for (const action of ORDER_ACTIONS) {
    assert.equal(nextOrderStatus('completed', action), null, `completed + ${action}`);
  }
});

// Every one of the 4 x 3 pairs, spelled out independently of the module's
// mapping so a permissive implementation cannot pass by mirroring itself.
const EXPECTED_NEXT: Record<`${OrderStatus}:${OrderAction}`, OrderStatus | null> = {
  'new:accept': 'accepted',
  'new:ready': null,
  'new:complete': null,
  'accepted:accept': null,
  'accepted:ready': 'ready',
  'accepted:complete': null,
  'ready:accept': null,
  'ready:ready': null,
  'ready:complete': 'completed',
  'completed:accept': null,
  'completed:ready': null,
  'completed:complete': null,
};

test('rejects all twelve status/action pairs except the three legal steps', () => {
  let legal = 0;
  for (const status of ORDER_STATUSES) {
    for (const action of ORDER_ACTIONS) {
      const expected = EXPECTED_NEXT[`${status}:${action}`];
      assert.equal(
        nextOrderStatus(status, action),
        expected,
        `status "${status}" + action "${action}"`
      );
      if (expected !== null) {
        legal += 1;
      }
    }
  }
  assert.equal(legal, 3, 'exactly three of the twelve pairs may advance');
});

// ---------------------------------------------------------------------------
// Selection validation: required = exactly one, optional = zero or more.
// ---------------------------------------------------------------------------

const SIZE_GROUP: OrderCustomizationGroup = {
  name: 'Size',
  required: true,
  options: [{ name: 'Small' }, { name: 'Large' }],
};

const MILK_GROUP: OrderCustomizationGroup = {
  name: 'Milk',
  required: true,
  options: [{ name: 'Whole' }, { name: 'Oat', priceAdjustment: 75 }],
};

const EXTRAS_GROUP: OrderCustomizationGroup = {
  name: 'Extras',
  required: false,
  options: [{ name: 'Cheese', priceAdjustment: 150 }, { name: 'Bacon' }],
};

const CUSTOMIZABLE_GROUPS: OrderCustomizationGroup[] = [SIZE_GROUP, MILK_GROUP, EXTRAS_GROUP];

function selection(optionName: string, choiceName: string): OrderSelection {
  return { optionName, choiceName };
}

test('accepts exactly one choice for each required group', () => {
  const error = validateOrderSelections(CUSTOMIZABLE_GROUPS, [
    selection('Size', 'Small'),
    selection('Milk', 'Oat'),
  ]);
  assert.equal(error, null);
});

test('accepts an omitted optional group', () => {
  const error = validateOrderSelections(
    [SIZE_GROUP, EXTRAS_GROUP],
    [selection('Size', 'Large')]
  );
  assert.equal(error, null);
});

test('accepts several choices in an optional group', () => {
  const error = validateOrderSelections(
    [SIZE_GROUP, EXTRAS_GROUP],
    [selection('Size', 'Small'), selection('Extras', 'Cheese'), selection('Extras', 'Bacon')]
  );
  assert.equal(error, null);
});

test('accepts selections in any order across groups', () => {
  const error = validateOrderSelections(CUSTOMIZABLE_GROUPS, [
    selection('Extras', 'Bacon'),
    selection('Milk', 'Oat'),
    selection('Size', 'Large'),
  ]);
  assert.equal(error, null);
});

test('accepts an empty group list with no selections', () => {
  assert.equal(validateOrderSelections([], []), null);
});

test('rejects any selection when the item has no customization groups', () => {
  assertUserError(validateOrderSelections([], [selection('Size', 'Small')]), 'no groups');
});

test('rejects a missing required group', () => {
  const error = validateOrderSelections(CUSTOMIZABLE_GROUPS, [selection('Size', 'Small')]);
  assertUserError(error, 'Milk missing');
});

test('rejects two distinct choices in a required single-select group', () => {
  const error = validateOrderSelections(CUSTOMIZABLE_GROUPS, [
    selection('Size', 'Small'),
    selection('Size', 'Large'),
    selection('Milk', 'Whole'),
  ]);
  assertUserError(error, 'two Size choices');
});

test('rejects an unknown option name', () => {
  const error = validateOrderSelections(CUSTOMIZABLE_GROUPS, [
    selection('Sauce', 'Ketchup'),
    selection('Size', 'Small'),
    selection('Milk', 'Whole'),
  ]);
  assertUserError(error, 'unknown group');
});

test('rejects an unknown choice name inside a known group', () => {
  const error = validateOrderSelections(CUSTOMIZABLE_GROUPS, [
    selection('Size', 'Medium'),
    selection('Milk', 'Whole'),
  ]);
  assertUserError(error, 'unknown choice');
});

test('rejects the same option/choice pair twice', () => {
  const error = validateOrderSelections(CUSTOMIZABLE_GROUPS, [
    selection('Size', 'Small'),
    selection('Size', 'Small'),
    selection('Milk', 'Whole'),
  ]);
  assertUserError(error, 'duplicate pair');
});

test('rejects a duplicate pair in an optional group', () => {
  const error = validateOrderSelections(CUSTOMIZABLE_GROUPS, [
    selection('Size', 'Small'),
    selection('Milk', 'Whole'),
    selection('Extras', 'Bacon'),
    selection('Extras', 'Bacon'),
  ]);
  assertUserError(error, 'duplicate optional pair');
});

// ---------------------------------------------------------------------------
// Contact validation: name required, at least one reachable channel.
// ---------------------------------------------------------------------------

const VALID_NAME = 'Ada Lovelace';
const VALID_PHONE = '555-0100';
const VALID_EMAIL = 'ada@example.com';

test('accepts a name with a phone only', () => {
  assert.equal(
    validateOrderContact({ customerName: VALID_NAME, contactPhone: VALID_PHONE }),
    null
  );
});

test('accepts a name with an email only', () => {
  assert.equal(
    validateOrderContact({ customerName: VALID_NAME, contactEmail: VALID_EMAIL }),
    null
  );
});

test('accepts a name with both contact channels', () => {
  assert.equal(
    validateOrderContact({
      customerName: VALID_NAME,
      contactPhone: VALID_PHONE,
      contactEmail: VALID_EMAIL,
    }),
    null
  );
});

test('trims the name and treats a blank phone as absent when an email is present', () => {
  assert.equal(
    validateOrderContact({
      customerName: `  ${VALID_NAME}  `,
      contactPhone: '   ',
      contactEmail: VALID_EMAIL,
    }),
    null
  );
});

test('rejects a blank or whitespace-only name', () => {
  for (const customerName of ['', '   ', '\t\n ']) {
    assertUserError(
      validateOrderContact({ customerName, contactPhone: VALID_PHONE }),
      JSON.stringify(customerName)
    );
  }
});

test('accepts a 120-character name and rejects 121', () => {
  assert.equal(
    validateOrderContact({ customerName: 'a'.repeat(120), contactPhone: VALID_PHONE }),
    null
  );
  assertUserError(
    validateOrderContact({ customerName: 'a'.repeat(121), contactPhone: VALID_PHONE }),
    '121-char name'
  );
});

test('measures the name limit after trimming', () => {
  const padded = `  ${'a'.repeat(120)}  `;
  assert.equal(validateOrderContact({ customerName: padded, contactPhone: VALID_PHONE }), null);
});

test('rejects a submission with neither phone nor email', () => {
  const contactCases: { contactPhone?: string; contactEmail?: string }[] = [
    {},
    { contactPhone: '' },
    { contactEmail: '   ' },
    { contactPhone: ' ', contactEmail: '\t' },
  ];
  for (const contact of contactCases) {
    assertUserError(
      validateOrderContact({ customerName: VALID_NAME, ...contact }),
      JSON.stringify(contact)
    );
  }
});

test('accepts a 200-character phone and rejects 201', () => {
  assert.equal(
    validateOrderContact({ customerName: VALID_NAME, contactPhone: '5'.repeat(200) }),
    null
  );
  assertUserError(
    validateOrderContact({ customerName: VALID_NAME, contactPhone: '5'.repeat(201) }),
    '201-char phone'
  );
});

test('accepts a 200-character email and rejects 201', () => {
  assert.equal(
    validateOrderContact({
      customerName: VALID_NAME,
      contactEmail: `${'a'.repeat(188)}@example.com`,
    }),
    null
  );
  assertUserError(
    validateOrderContact({
      customerName: VALID_NAME,
      contactEmail: `${'a'.repeat(189)}@example.com`,
    }),
    '201-char email'
  );
});
