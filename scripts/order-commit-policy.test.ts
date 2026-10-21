#!/usr/bin/env node
/**
 * Pins the issue #75 order commit policy: the 8-state protocol machine, the
 * §6.2.4 constants, and the §6.5 error catalog.
 *
 * `convex/orderCommitPolicy.ts` is a pure module with no database imports, so
 * it is asserted without a Convex deployment, like `order-policy.test.ts`.
 * The matrix below is spelled out literally for all 8 statuses × 8 wire
 * actions so a permissive implementation cannot pass by mirroring itself.
 * `reuse` is §7.3 documentation vocabulary, not a wire action; it is covered
 * by the `{ kind: 'reused' }` resolution.
 *
 * Run: node --test scripts/order-commit-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BUSINESS_THROTTLE_10M,
  CONTACT_THROTTLE_10M,
  CONTACT_THROTTLE_24H,
  DEFAULT_TTL_MS,
  IDEMPOTENCY_TTL_MS,
  MAX_EMAIL,
  MAX_LINES,
  MAX_NAME,
  MAX_NOTE,
  MAX_ORDER_VALUE,
  MAX_PHONE_DIGITS,
  MAX_QUANTITY_PER_LINE,
  MAX_SELECTIONS_PER_LINE,
  MAX_TOTAL_UNITS,
  MIN_PHONE_DIGITS,
  MONEY,
  ORDER_COMMIT_CONSTANTS,
  ORDER_DB_STATUSES,
  ORDER_ERRORS,
  ORDER_ERROR_CODES,
  ORDER_PROTOCOL_ACTIONS,
  REFERENCE_ALPHABET,
  REFERENCE_COLLISION_RETRIES,
  REFERENCE_LENGTH,
  TERMINAL_ORDER_STATUSES,
  TOKEN_BYTES,
  canonicalArgsHash,
  createReference,
  isEffectiveOpen,
  parseContact,
  priceBasket,
  randomReference,
  resolveOrderAction,
  sha256Hex,
  validateBasket,
} from '../convex/orderCommitPolicy.ts';
import type {
  BasketLineInput,
  CanonicalArgsInput,
  Catalog,
  CatalogEntry,
  EffectiveOpenBusiness,
  OrderActionResolution,
  OrderDbStatus,
  OrderProtocolAction,
} from '../convex/orderCommitPolicy.ts';
import type { BusinessHours } from '../convex/businesses/publicHours.ts';
import { validateOrderSelections } from '../convex/orderPolicy.ts';
import type { OrderCustomizationGroup } from '../convex/orderPolicy.ts';
// `createAccessToken` lives in `convex/orderAccess.ts` (spec §7.2 S1 file
// assignment). That module's `_generated` imports are type-only, so it loads
// here without a Convex deployment — the same reason the plan calls it
// importable "in the interim".
import { createAccessToken } from '../convex/orderAccess.ts';

// ---------------------------------------------------------------------------
// State machine: §6.1 transition table plus the idempotent-repeat policy.
// ---------------------------------------------------------------------------

// Every one of the 8 x 8 wire pairs, spelled out independently of the
// resolver so a wrong mapping cannot pass by comparing the function to itself.
const EXPECTED: Record<OrderDbStatus, Record<OrderProtocolAction, OrderActionResolution>> = {
  new: {
    submit: { kind: 'error', code: 'INVALID_TRANSITION' },
    accept: { kind: 'move', to: 'accepted' },
    decline: { kind: 'move', to: 'declined' },
    cancel: { kind: 'move', to: 'cancelled' },
    ready: { kind: 'error', code: 'INVALID_TRANSITION' },
    complete: { kind: 'error', code: 'INVALID_TRANSITION' },
    noShow: { kind: 'error', code: 'INVALID_TRANSITION' },
    expire: { kind: 'move', to: 'expired' },
  },
  accepted: {
    submit: { kind: 'error', code: 'INVALID_TRANSITION' },
    accept: { kind: 'reused' },
    decline: { kind: 'error', code: 'INVALID_TRANSITION' },
    cancel: { kind: 'move', to: 'cancelled' },
    ready: { kind: 'move', to: 'ready' },
    complete: { kind: 'error', code: 'INVALID_TRANSITION' },
    noShow: { kind: 'error', code: 'INVALID_TRANSITION' },
    expire: { kind: 'error', code: 'INVALID_TRANSITION' },
  },
  ready: {
    submit: { kind: 'error', code: 'INVALID_TRANSITION' },
    accept: { kind: 'error', code: 'INVALID_TRANSITION' },
    decline: { kind: 'error', code: 'INVALID_TRANSITION' },
    cancel: { kind: 'move', to: 'cancelled' },
    ready: { kind: 'reused' },
    complete: { kind: 'move', to: 'completed' },
    noShow: { kind: 'move', to: 'no_show' },
    expire: { kind: 'error', code: 'INVALID_TRANSITION' },
  },
  completed: {
    submit: { kind: 'error', code: 'ORDER_TERMINAL' },
    accept: { kind: 'error', code: 'ORDER_TERMINAL' },
    decline: { kind: 'error', code: 'ORDER_TERMINAL' },
    cancel: { kind: 'error', code: 'ORDER_TERMINAL' },
    ready: { kind: 'error', code: 'ORDER_TERMINAL' },
    complete: { kind: 'error', code: 'ORDER_TERMINAL' },
    noShow: { kind: 'error', code: 'ORDER_TERMINAL' },
    expire: { kind: 'error', code: 'ORDER_TERMINAL' },
  },
  declined: {
    submit: { kind: 'error', code: 'ORDER_TERMINAL' },
    accept: { kind: 'error', code: 'ORDER_TERMINAL' },
    decline: { kind: 'error', code: 'ORDER_TERMINAL' },
    cancel: { kind: 'error', code: 'ORDER_TERMINAL' },
    ready: { kind: 'error', code: 'ORDER_TERMINAL' },
    complete: { kind: 'error', code: 'ORDER_TERMINAL' },
    noShow: { kind: 'error', code: 'ORDER_TERMINAL' },
    expire: { kind: 'error', code: 'ORDER_TERMINAL' },
  },
  cancelled: {
    submit: { kind: 'error', code: 'ORDER_TERMINAL' },
    accept: { kind: 'error', code: 'ORDER_TERMINAL' },
    decline: { kind: 'error', code: 'ORDER_TERMINAL' },
    cancel: { kind: 'error', code: 'ORDER_TERMINAL' },
    ready: { kind: 'error', code: 'ORDER_TERMINAL' },
    complete: { kind: 'error', code: 'ORDER_TERMINAL' },
    noShow: { kind: 'error', code: 'ORDER_TERMINAL' },
    expire: { kind: 'error', code: 'ORDER_TERMINAL' },
  },
  expired: {
    submit: { kind: 'error', code: 'ORDER_TERMINAL' },
    accept: { kind: 'error', code: 'ORDER_TERMINAL' },
    decline: { kind: 'error', code: 'ORDER_TERMINAL' },
    cancel: { kind: 'error', code: 'ORDER_TERMINAL' },
    ready: { kind: 'error', code: 'ORDER_TERMINAL' },
    complete: { kind: 'error', code: 'ORDER_TERMINAL' },
    noShow: { kind: 'error', code: 'ORDER_TERMINAL' },
    expire: { kind: 'error', code: 'ORDER_TERMINAL' },
  },
  no_show: {
    submit: { kind: 'error', code: 'ORDER_TERMINAL' },
    accept: { kind: 'error', code: 'ORDER_TERMINAL' },
    decline: { kind: 'error', code: 'ORDER_TERMINAL' },
    cancel: { kind: 'error', code: 'ORDER_TERMINAL' },
    ready: { kind: 'error', code: 'ORDER_TERMINAL' },
    complete: { kind: 'error', code: 'ORDER_TERMINAL' },
    noShow: { kind: 'error', code: 'ORDER_TERMINAL' },
    expire: { kind: 'error', code: 'ORDER_TERMINAL' },
  },
};

test('re-exports the eight protocol statuses in schema order', () => {
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
});

test('pins the eight wire actions and keeps reuse out of the union', () => {
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
  assert.equal(ORDER_PROTOCOL_ACTIONS.length, 8);
  assert.equal((ORDER_PROTOCOL_ACTIONS as readonly string[]).includes('reuse'), false);
});

test('pins the five terminal statuses from §6.1', () => {
  assert.deepEqual([...TERMINAL_ORDER_STATUSES], [
    'completed',
    'declined',
    'cancelled',
    'expired',
    'no_show',
  ]);
});

test('resolves all sixty-four status/action cells', () => {
  let moves = 0;
  let reused = 0;
  let invalid = 0;
  let terminal = 0;

  for (const status of ORDER_DB_STATUSES) {
    for (const action of ORDER_PROTOCOL_ACTIONS) {
      const expected = EXPECTED[status][action];
      assert.deepEqual(
        resolveOrderAction(status, action),
        expected,
        `status "${status}" + action "${action}"`
      );
      if (expected.kind === 'move') {
        moves += 1;
      } else if (expected.kind === 'reused') {
        reused += 1;
      } else if (expected.code === 'INVALID_TRANSITION') {
        invalid += 1;
      } else {
        terminal += 1;
      }
    }
  }

  assert.equal(moves, 9, 'nine legal moves across the matrix');
  assert.equal(reused, 2, 'two idempotent repeats');
  assert.equal(invalid, 13, 'thirteen non-terminal rejections');
  assert.equal(terminal, 40, 'five terminal statuses x eight actions');
});

test('rejects every action on each terminal status with ORDER_TERMINAL', () => {
  for (const status of TERMINAL_ORDER_STATUSES) {
    for (const action of ORDER_PROTOCOL_ACTIONS) {
      assert.deepEqual(
        resolveOrderAction(status, action),
        { kind: 'error', code: 'ORDER_TERMINAL' },
        `terminal "${status}" + action "${action}"`
      );
    }
  }
});

test('treats submit as a create step, never a transition', () => {
  for (const status of ORDER_DB_STATUSES) {
    const isTerminal = (TERMINAL_ORDER_STATUSES as readonly string[]).includes(status);
    assert.deepEqual(
      resolveOrderAction(status, 'submit'),
      isTerminal
        ? { kind: 'error', code: 'ORDER_TERMINAL' }
        : { kind: 'error', code: 'INVALID_TRANSITION' },
      `submit from "${status}"`
    );
  }
});

test('reuses only the repeat of an action already applied', () => {
  const reusedPairs: string[] = [];
  for (const status of ORDER_DB_STATUSES) {
    for (const action of ORDER_PROTOCOL_ACTIONS) {
      if (resolveOrderAction(status, action).kind === 'reused') {
        reusedPairs.push(`${status}:${action}`);
      }
    }
  }

  assert.deepEqual(reusedPairs, ['accepted:accept', 'ready:ready']);
});

// ---------------------------------------------------------------------------
// Constants: every §6.2.4 value, asserted against its literal table value.
// ---------------------------------------------------------------------------

test('pins every §6.2.4 constant to its literal value', () => {
  assert.equal(MAX_LINES, 20);
  assert.equal(MAX_QUANTITY_PER_LINE, 20);
  assert.equal(MAX_TOTAL_UNITS, 100);
  assert.equal(MAX_SELECTIONS_PER_LINE, 32);
  assert.equal(MAX_NAME, 80);
  assert.equal(MAX_NOTE, 500);
  assert.equal(MIN_PHONE_DIGITS, 7);
  assert.equal(MAX_PHONE_DIGITS, 20);
  assert.equal(MAX_EMAIL, 254);
  assert.equal(DEFAULT_TTL_MS, 3_600_000);
  assert.equal(DEFAULT_TTL_MS, 60 * 60 * 1000);
  assert.equal(IDEMPOTENCY_TTL_MS, 86_400_000);
  assert.equal(IDEMPOTENCY_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(TOKEN_BYTES, 32);
  assert.equal(REFERENCE_LENGTH, 6);
  assert.equal(REFERENCE_ALPHABET, '23456789ABCDEFGHJKLMNPQRSTUVWXYZ');
  assert.equal(REFERENCE_ALPHABET.length, 32);
  assert.equal(CONTACT_THROTTLE_10M, 3);
  assert.equal(CONTACT_THROTTLE_24H, 10);
  assert.equal(BUSINESS_THROTTLE_10M, 60);
  assert.equal(MAX_ORDER_VALUE, 100_000);
});

test('represents MONEY as the integer-cents convention, not a number', () => {
  assert.equal(MONEY, 'integer-cents');
});

test('exposes the same values through the frozen aggregate', () => {
  assert.deepEqual(ORDER_COMMIT_CONSTANTS, {
    MAX_LINES: 20,
    MAX_QUANTITY_PER_LINE: 20,
    MAX_TOTAL_UNITS: 100,
    MAX_SELECTIONS_PER_LINE: 32,
    MAX_NAME: 80,
    MAX_NOTE: 500,
    MIN_PHONE_DIGITS: 7,
    MAX_PHONE_DIGITS: 20,
    MAX_EMAIL: 254,
    DEFAULT_TTL_MS: 3_600_000,
    IDEMPOTENCY_TTL_MS: 86_400_000,
    TOKEN_BYTES: 32,
    REFERENCE_LENGTH: 6,
    REFERENCE_ALPHABET: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
    CONTACT_THROTTLE_10M: 3,
    CONTACT_THROTTLE_24H: 10,
    BUSINESS_THROTTLE_10M: 60,
    MAX_ORDER_VALUE: 100_000,
  });
  assert.equal(Object.isFrozen(ORDER_COMMIT_CONSTANTS), true);
});

// ---------------------------------------------------------------------------
// Error catalog: 28 rows, 29 codes (§6.5).
// ---------------------------------------------------------------------------

test('covers all twenty-nine §6.5 error codes', () => {
  assert.deepEqual([...ORDER_ERROR_CODES], [
    'BUSINESS_UNAVAILABLE',
    'MENU_UNAVAILABLE',
    'MENU_EMPTY',
    'ORDERING_CLOSED',
    'OUTSIDE_HOURS',
    'GROUP_UNAVAILABLE',
    'ITEM_UNAVAILABLE',
    'BASKET_EMPTY',
    'BASKET_TOO_LARGE',
    'QUANTITY_INVALID',
    'SELECTION_INVALID',
    'CONTACT_INVALID',
    'NOTE_TOO_LONG',
    'PRICE_CHANGED',
    'PRICE_UNAVAILABLE',
    'ORDER_VALUE_TOO_HIGH',
    'IDEMPOTENCY_CONFLICT',
    'TOO_MANY_REQUESTS',
    'ORDER_NOT_ACCEPTED',
    'ORDER_NOT_FOUND',
    'ORDER_EXPIRED',
    'CANNOT_CANCEL',
    'INVALID_TRANSITION',
    'ORDER_TERMINAL',
    'ORDER_ALREADY_DECIDED',
    'REASON_REQUIRED',
    'FORBIDDEN',
    'UNAUTHORIZED',
    'INTERNAL',
  ]);
  assert.equal(ORDER_ERROR_CODES.length, 29);
  assert.equal(Object.keys(ORDER_ERRORS).length, 29);
  assert.deepEqual(Object.keys(ORDER_ERRORS), [...ORDER_ERROR_CODES]);
  assert.equal(Object.isFrozen(ORDER_ERRORS), true);
});

test('gives every code a non-empty message and recovery action', () => {
  for (const code of ORDER_ERROR_CODES) {
    const entry = ORDER_ERRORS[code];
    assert.equal(typeof entry.message, 'string', `${code}: message must be a string`);
    assert.ok(entry.message.length > 0, `${code}: message must not be empty`);
    assert.equal(typeof entry.recovery, 'string', `${code}: recovery must be a string`);
    assert.ok(entry.recovery.length > 0, `${code}: recovery must not be empty`);
  }
});

test('pins the exact customer messages the client-facing paths depend on', () => {
  assert.equal(
    ORDER_ERRORS.PRICE_CHANGED.message,
    'Prices changed while you were ordering. Review the new total and send again.'
  );
  assert.equal(
    ORDER_ERRORS.PRICE_UNAVAILABLE.message,
    'One item has no price listed. Confirm the total with the business.'
  );
  assert.equal(
    ORDER_ERRORS.ORDER_VALUE_TOO_HIGH.message,
    'This order is too large to send online. Call the business.'
  );
  assert.equal(
    ORDER_ERRORS.CONTACT_INVALID.message,
    'Add a name and a phone or email so the business can reach you.'
  );
  assert.equal(
    ORDER_ERRORS.BASKET_TOO_LARGE.message,
    'This order is too large to send here. Call the business.'
  );
});

test('copies the spec messages with their exact ASCII apostrophes', () => {
  assert.equal(ORDER_ERRORS.BUSINESS_UNAVAILABLE.message, "This business isn't available right now.");
  assert.equal(ORDER_ERRORS.MENU_UNAVAILABLE.message, "This business hasn't published a menu yet.");
  assert.equal(ORDER_ERRORS.MENU_EMPTY.message, "There's nothing available to order right now.");
  assert.equal(
    ORDER_ERRORS.ORDER_NOT_FOUND.message,
    "We couldn't find that order. Check the link or call the business."
  );
  assert.equal(ORDER_ERRORS.FORBIDDEN.message, "You don't have access to this order.");
  assert.equal(ORDER_ERRORS.UNAUTHORIZED.message, "You don't have access to this order.");
});

test('keeps the handler placeholder tokens literal', () => {
  assert.ok(ORDER_ERRORS.ORDERING_CLOSED.message.includes('{phone}'));
  assert.ok(ORDER_ERRORS.OUTSIDE_HOURS.message.includes('{phone}'));
  assert.ok(ORDER_ERRORS.SELECTION_INVALID.message.includes('{item}'));
  assert.ok(ORDER_ERRORS.TOO_MANY_REQUESTS.message.includes('{n}'));
});

test('pins all twenty-nine §6.5 customer messages verbatim', () => {
  // The §6.5 table (docs/order-commitment-protocol.md L1275–L1304) is the
  // source of truth for this customer-facing copy, and every message is
  // asserted here character-for-character against it. The placeholder tokens
  // stay literal: the handler substitutes them, this module never
  // interpolates.
  assert.deepEqual(
    Object.fromEntries(
      ORDER_ERROR_CODES.map((code) => [code, ORDER_ERRORS[code].message] as const)
    ),
    {
      BUSINESS_UNAVAILABLE: "This business isn't available right now.",
      MENU_UNAVAILABLE: "This business hasn't published a menu yet.",
      MENU_EMPTY: "There's nothing available to order right now.",
      ORDERING_CLOSED: "This business isn't accepting orders right now. Call {phone}.",
      OUTSIDE_HOURS:
        'This business is closed right now. Call {phone} or check its hours.',
      GROUP_UNAVAILABLE:
        'One of the menu sections you picked is unavailable. Refresh the menu.',
      ITEM_UNAVAILABLE: 'One of the items you picked is sold out. Refresh the menu.',
      BASKET_EMPTY: 'Add at least one item before sending your order.',
      BASKET_TOO_LARGE: 'This order is too large to send here. Call the business.',
      QUANTITY_INVALID: 'Choose a quantity between 1 and 20.',
      SELECTION_INVALID:
        'Check the options for {item}; one is missing or no longer available.',
      CONTACT_INVALID: 'Add a name and a phone or email so the business can reach you.',
      NOTE_TOO_LONG: 'Keep the note under 500 characters.',
      PRICE_CHANGED:
        'Prices changed while you were ordering. Review the new total and send again.',
      PRICE_UNAVAILABLE: 'One item has no price listed. Confirm the total with the business.',
      ORDER_VALUE_TOO_HIGH: 'This order is too large to send online. Call the business.',
      IDEMPOTENCY_CONFLICT:
        'This order was already sent with different details. Refresh your order.',
      TOO_MANY_REQUESTS:
        'Too many order attempts. Try again in {n} minutes or call the business.',
      ORDER_NOT_ACCEPTED: "We can't accept this order online. Please call the business.",
      ORDER_NOT_FOUND:
        "We couldn't find that order. Check the link or call the business.",
      ORDER_EXPIRED: 'This order expired before it was accepted. Place a new order.',
      CANNOT_CANCEL: 'This order can no longer be cancelled online. Call the business.',
      INVALID_TRANSITION: "That action isn't available for this order anymore. Refresh.",
      ORDER_TERMINAL: 'This order is already closed.',
      ORDER_ALREADY_DECIDED: 'Someone already updated this order. Refresh the board.',
      REASON_REQUIRED: 'Add a short reason before continuing.',
      FORBIDDEN: "You don't have access to this order.",
      UNAUTHORIZED: "You don't have access to this order.",
      INTERNAL: 'Something went wrong. Try again or call the business.',
    }
  );
});

// ---------------------------------------------------------------------------
// Basket validation: caps, one business per order, and first-error precedence
// (spec §6.2.4, §6.5). Semantic selections and availability belong to pricing.
// ---------------------------------------------------------------------------

function catalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    businessId: 'business-1',
    name: 'Test Item',
    unitPrice: 1450,
    isAvailable: true,
    groupAvailable: true,
    groups: [],
    ...overrides,
  };
}

function catalogForIds(ids: readonly string[], businessId = 'business-1'): Catalog {
  const catalog = new Map<string, CatalogEntry>();
  for (const id of ids) {
    catalog.set(id, catalogEntry({ businessId, name: id }));
  }
  return catalog;
}

test('rejects a basket with no lines as BASKET_EMPTY', () => {
  assert.deepEqual(validateBasket({ lines: [] }, new Map()), {
    ok: false,
    code: 'BASKET_EMPTY',
  });
});

test('accepts twenty lines and rejects twenty-one as BASKET_TOO_LARGE', () => {
  const twentyIds = Array.from({ length: 20 }, (_, index) => `item-${index}`);
  const twentyLines = twentyIds.map((menuItemId) => ({ menuItemId, quantity: 1 }));
  assert.deepEqual(validateBasket({ lines: twentyLines }, catalogForIds(twentyIds)), {
    ok: true,
  });

  const twentyOneIds = Array.from({ length: 21 }, (_, index) => `item-${index}`);
  const twentyOneLines = twentyOneIds.map((menuItemId) => ({ menuItemId, quantity: 1 }));
  assert.deepEqual(validateBasket({ lines: twentyOneLines }, catalogForIds(twentyOneIds)), {
    ok: false,
    code: 'BASKET_TOO_LARGE',
  });
});

test('accepts quantities from one to twenty and rejects the rest', () => {
  const catalog = catalogForIds(['item-0']);

  for (const quantity of [1, 20]) {
    assert.deepEqual(
      validateBasket({ lines: [{ menuItemId: 'item-0', quantity }] }, catalog),
      { ok: true },
      `quantity ${quantity} should pass`
    );
  }

  for (const quantity of [-1, 0, 21, 1.5]) {
    assert.deepEqual(
      validateBasket({ lines: [{ menuItemId: 'item-0', quantity }] }, catalog),
      { ok: false, code: 'QUANTITY_INVALID', lineIndex: 0 },
      `quantity ${quantity} should fail`
    );
  }
});

test('caps total units at one hundred', () => {
  const ids = Array.from({ length: 20 }, (_, index) => `item-${index}`);
  const catalog = catalogForIds(ids);

  const atCap = ids.map((menuItemId) => ({ menuItemId, quantity: 5 }));
  assert.deepEqual(validateBasket({ lines: atCap }, catalog), { ok: true });

  const overCap = ids.map((menuItemId, index) => ({
    menuItemId,
    quantity: index === 0 ? 6 : 5,
  }));
  assert.deepEqual(validateBasket({ lines: overCap }, catalog), {
    ok: false,
    code: 'BASKET_TOO_LARGE',
  });
});

test('allows thirty-two selections per line and rejects thirty-three', () => {
  const catalog = catalogForIds(['bowl']);
  const selections = Array.from({ length: 32 }, (_, index) => ({
    optionName: 'Extras',
    choiceName: `Choice ${index}`,
  }));

  assert.deepEqual(
    validateBasket({ lines: [{ menuItemId: 'bowl', quantity: 1, selections }] }, catalog),
    { ok: true }
  );

  assert.deepEqual(
    validateBasket(
      {
        lines: [
          {
            menuItemId: 'bowl',
            quantity: 1,
            selections: [...selections, { optionName: 'Extras', choiceName: 'Choice 32' }],
          },
        ],
      },
      catalog
    ),
    { ok: false, code: 'SELECTION_INVALID', lineIndex: 0 }
  );
});

test('accepts notes up to five hundred trimmed characters and rejects longer ones', () => {
  const catalog = catalogForIds(['bowl']);
  const lines = [{ menuItemId: 'bowl', quantity: 1 }];

  for (const note of ['', '   ', 'a'.repeat(500), `  ${'a'.repeat(500)}  `]) {
    assert.deepEqual(validateBasket({ lines, note }, catalog), { ok: true }, `note length ${note.length}`);
  }

  assert.deepEqual(validateBasket({ lines, note: 'a'.repeat(501) }, catalog), {
    ok: false,
    code: 'NOTE_TOO_LONG',
  });
});

test('rejects an item missing from the catalog with ITEM_UNAVAILABLE', () => {
  const catalog = catalogForIds(['item-0']);
  assert.deepEqual(
    validateBasket(
      {
        lines: [
          { menuItemId: 'item-0', quantity: 1 },
          { menuItemId: 'missing', quantity: 1 },
        ],
      },
      catalog
    ),
    { ok: false, code: 'ITEM_UNAVAILABLE', lineIndex: 1 }
  );
});

test('rejects an order spanning two businesses with ITEM_UNAVAILABLE and no line index', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['item-a', catalogEntry({ businessId: 'business-1' })],
    ['item-b', catalogEntry({ businessId: 'business-2' })],
  ]);

  assert.deepEqual(
    validateBasket(
      {
        lines: [
          { menuItemId: 'item-a', quantity: 1 },
          { menuItemId: 'item-b', quantity: 1 },
        ],
      },
      catalog
    ),
    { ok: false, code: 'ITEM_UNAVAILABLE' }
  );
});

test('permits duplicate identical lines', () => {
  const catalog = catalogForIds(['bowl']);
  const line = {
    menuItemId: 'bowl',
    quantity: 2,
    selections: [{ optionName: 'Size', choiceName: 'Large' }],
  };

  assert.deepEqual(validateBasket({ lines: [line, { ...line }] }, catalog), { ok: true });
});

test('reports BASKET_TOO_LARGE before QUANTITY_INVALID', () => {
  const ids = Array.from({ length: 21 }, (_, index) => `item-${index}`);
  const lines = ids.map((menuItemId, index) => ({
    menuItemId,
    quantity: index === 0 ? 0 : 1,
  }));

  assert.deepEqual(validateBasket({ lines }, catalogForIds(ids)), {
    ok: false,
    code: 'BASKET_TOO_LARGE',
  });
});

test('checks every quantity before inspecting catalog membership', () => {
  const catalog = catalogForIds(['item-0']);
  assert.deepEqual(
    validateBasket(
      {
        lines: [
          { menuItemId: 'missing', quantity: 1 },
          { menuItemId: 'item-0', quantity: 0 },
        ],
      },
      catalog
    ),
    { ok: false, code: 'QUANTITY_INVALID', lineIndex: 1 }
  );
});

// ---------------------------------------------------------------------------
// Pricing: §6.2.5 arithmetic, snapshots, cap, and expectedSubtotal.
// Fixtures use integer cents directly; seed data is decimal dollars.
// ---------------------------------------------------------------------------

const BOWL_GROUPS: OrderCustomizationGroup[] = [
  {
    name: 'Size',
    required: true,
    options: [{ name: 'Regular' }, { name: 'Large', priceAdjustment: 150 }],
  },
  {
    name: 'Extras',
    required: false,
    options: [{ name: 'Cheese', priceAdjustment: 400 }],
  },
];

test('prices a line from the catalog and multiplies by quantity', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['bowl', catalogEntry({ name: 'Build Your Bowl', groups: BOWL_GROUPS })],
  ]);
  const result = priceBasket(
    {
      lines: [
        {
          menuItemId: 'bowl',
          quantity: 2,
          selections: [
            { optionName: 'Size', choiceName: 'Large' },
            { optionName: 'Extras', choiceName: 'Cheese' },
          ],
        },
      ],
      expectedSubtotal: 4000,
    },
    catalog
  );

  assert.deepEqual(result, {
    ok: true,
    items: [
      {
        menuItemId: 'bowl',
        name: 'Build Your Bowl',
        quantity: 2,
        unitPrice: 1450,
        lineTotal: 4000,
        selections: [
          { optionName: 'Size', choiceName: 'Large', priceAdjustment: 150 },
          { optionName: 'Extras', choiceName: 'Cheese', priceAdjustment: 400 },
        ],
      },
    ],
    subtotal: 4000,
  });
  assert.ok(result.ok);
  assert.ok(Number.isInteger(result.subtotal));
});

test('omits priceAdjustment from a selection that costs nothing', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['bowl', catalogEntry({ groups: BOWL_GROUPS })],
  ]);
  const result = priceBasket(
    {
      lines: [
        {
          menuItemId: 'bowl',
          quantity: 1,
          selections: [{ optionName: 'Size', choiceName: 'Regular' }],
        },
      ],
      expectedSubtotal: 1450,
    },
    catalog
  );

  assert.ok(result.ok);
  assert.deepEqual(result.items[0].selections, [
    { optionName: 'Size', choiceName: 'Regular' },
  ]);
});

test('omits lineTotal and returns a null subtotal for an unpriced line', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['soup', catalogEntry({ name: 'Soup of the Day', unitPrice: undefined })],
  ]);
  const result = priceBasket({ lines: [{ menuItemId: 'soup', quantity: 1 }] }, catalog);

  assert.ok(result.ok);
  assert.equal(result.subtotal, null);
  assert.ok(!('unitPrice' in result.items[0]));
  assert.ok(!('lineTotal' in result.items[0]));
  assert.deepEqual(result.items[0].selections, []);
});

test('returns a null subtotal instead of a partial sum when any line is unpriced', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['bowl', catalogEntry({ name: 'Bowl', unitPrice: 1450 })],
    ['soup', catalogEntry({ name: 'Soup', unitPrice: undefined })],
  ]);
  const result = priceBasket(
    {
      lines: [
        { menuItemId: 'bowl', quantity: 1 },
        { menuItemId: 'soup', quantity: 2 },
      ],
    },
    catalog
  );

  assert.ok(result.ok);
  assert.equal(result.items[0].lineTotal, 1450);
  assert.ok(!('lineTotal' in result.items[1]));
  assert.equal(result.subtotal, null);
});

test('rejects a non-integer unit price as an INTERNAL catalog fault', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['bowl', catalogEntry({ unitPrice: 14.5 })],
  ]);
  assert.deepEqual(
    priceBasket({ lines: [{ menuItemId: 'bowl', quantity: 1 }] }, catalog),
    { ok: false, code: 'INTERNAL' }
  );
});

test('rejects a non-integer price adjustment as an INTERNAL catalog fault', () => {
  const catalog = new Map<string, CatalogEntry>([
    [
      'bowl',
      catalogEntry({
        groups: [
          {
            name: 'Size',
            required: true,
            options: [{ name: 'Large', priceAdjustment: 1.5 }],
          },
        ],
      }),
    ],
  ]);
  assert.deepEqual(
    priceBasket(
      {
        lines: [
          {
            menuItemId: 'bowl',
            quantity: 1,
            selections: [{ optionName: 'Size', choiceName: 'Large' }],
          },
        ],
      },
      catalog
    ),
    { ok: false, code: 'INTERNAL' }
  );
});

test('caps the order value at one hundred thousand cents', () => {
  const atCap = new Map<string, CatalogEntry>([
    ['item', catalogEntry({ unitPrice: 100_000 })],
  ]);
  const accepted = priceBasket(
    { lines: [{ menuItemId: 'item', quantity: 1 }], expectedSubtotal: 100_000 },
    atCap
  );
  assert.ok(accepted.ok);
  assert.equal(accepted.subtotal, 100_000);

  const overCap = new Map<string, CatalogEntry>([
    ['item', catalogEntry({ unitPrice: 100_001 })],
  ]);
  assert.deepEqual(
    priceBasket({ lines: [{ menuItemId: 'item', quantity: 1 }] }, overCap),
    { ok: false, code: 'ORDER_VALUE_TOO_HIGH' }
  );
});

test('compares expectedSubtotal across all five cases', () => {
  const priced = new Map<string, CatalogEntry>([
    ['item', catalogEntry({ unitPrice: 1450 })],
  ]);
  const unpriced = new Map<string, CatalogEntry>([
    ['item', catalogEntry({ unitPrice: undefined })],
  ]);
  const lines = [{ menuItemId: 'item', quantity: 1 }];

  // Client sent none; server has none.
  assert.deepEqual(priceBasket({ lines }, unpriced), {
    ok: true,
    items: [{ menuItemId: 'item', name: 'Test Item', quantity: 1, selections: [] }],
    subtotal: null,
  });

  // Client sent none (omitted or explicit null); server has a number.
  for (const expectedSubtotal of [undefined, null]) {
    assert.deepEqual(priceBasket({ lines, expectedSubtotal }, priced), {
      ok: false,
      code: 'PRICE_CHANGED',
      actualSubtotal: 1450,
    });
  }

  // Client sent a number; server has none.
  assert.deepEqual(priceBasket({ lines, expectedSubtotal: 1450 }, unpriced), {
    ok: false,
    code: 'PRICE_UNAVAILABLE',
  });

  // Both numbers and equal.
  const matching = priceBasket({ lines, expectedSubtotal: 1450 }, priced);
  assert.ok(matching.ok);
  assert.equal(matching.subtotal, 1450);

  // Both numbers and different.
  assert.deepEqual(priceBasket({ lines, expectedSubtotal: 1400 }, priced), {
    ok: false,
    code: 'PRICE_CHANGED',
    actualSubtotal: 1450,
  });
});

test('prefers GROUP_UNAVAILABLE over ITEM_UNAVAILABLE', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['item', catalogEntry({ isAvailable: false, groupAvailable: false })],
  ]);
  assert.deepEqual(
    priceBasket({ lines: [{ menuItemId: 'item', quantity: 1 }] }, catalog),
    { ok: false, code: 'GROUP_UNAVAILABLE', lineIndex: 0 }
  );
});

test('prefers ITEM_UNAVAILABLE over an invalid selection', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['item', catalogEntry({ isAvailable: false, groups: BOWL_GROUPS })],
  ]);
  assert.deepEqual(
    priceBasket({ lines: [{ menuItemId: 'item', quantity: 1 }] }, catalog),
    { ok: false, code: 'ITEM_UNAVAILABLE', lineIndex: 0 }
  );
});

test('prefers SELECTION_INVALID over price math', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['item', catalogEntry({ unitPrice: 14.5, groups: BOWL_GROUPS })],
  ]);
  assert.deepEqual(
    priceBasket({ lines: [{ menuItemId: 'item', quantity: 1 }] }, catalog),
    { ok: false, code: 'SELECTION_INVALID', lineIndex: 0 }
  );
});

test('rejects an unknown item even without a prior validateBasket call', () => {
  assert.deepEqual(
    priceBasket({ lines: [{ menuItemId: 'missing', quantity: 1 }] }, new Map()),
    { ok: false, code: 'ITEM_UNAVAILABLE', lineIndex: 0 }
  );
});

test('rejects an empty basket instead of pricing it to zero', () => {
  // Pricing zero lines would succeed with an empty `items[]` and a
  // `subtotal` of 0 — a zero-value order that no other gate would catch.
  assert.deepEqual(priceBasket({ lines: [], expectedSubtotal: 0 }, new Map()), {
    ok: false,
    code: 'BASKET_EMPTY',
  });
  assert.deepEqual(priceBasket({ lines: [] }, new Map()), {
    ok: false,
    code: 'BASKET_EMPTY',
  });
});

test('prices from the catalog and ignores a smuggled request price', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['item', catalogEntry({ unitPrice: 1450 })],
  ]);
  const smuggled = {
    menuItemId: 'item',
    quantity: 1,
    unitPrice: 1,
  } as unknown as BasketLineInput;
  const result = priceBasket({ lines: [smuggled], expectedSubtotal: 1450 }, catalog);

  assert.ok(result.ok);
  assert.equal(result.items[0].unitPrice, 1450);
  assert.equal(result.subtotal, 1450);
});

test('rejects a priced order spanning two businesses', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['item-a', catalogEntry({ businessId: 'business-1' })],
    ['item-b', catalogEntry({ businessId: 'business-2' })],
  ]);
  assert.deepEqual(
    priceBasket(
      {
        lines: [
          { menuItemId: 'item-a', quantity: 1 },
          { menuItemId: 'item-b', quantity: 1 },
        ],
      },
      catalog
    ),
    { ok: false, code: 'ITEM_UNAVAILABLE', lineIndex: 1 }
  );
});

test('prices duplicate identical lines as separate lines', () => {
  const catalog = new Map<string, CatalogEntry>([
    ['item', catalogEntry({ unitPrice: 1450 })],
  ]);
  const line = { menuItemId: 'item', quantity: 1 };
  const result = priceBasket({ lines: [line, { ...line }], expectedSubtotal: 2900 }, catalog);

  assert.ok(result.ok);
  assert.equal(result.items.length, 2);
  assert.equal(result.subtotal, 2900);
});

test('prices a duplicate customization group name against the group the validator accepted', () => {
  // `menuItems.customizationOptions` does not constrain group names to be
  // unique, so two groups may share one name. `validateOrderSelections`
  // resolves a duplicate name to the LAST group, so pricing must resolve it
  // the same way — otherwise the charged adjustment came from a group the
  // validator never accepted (§6.2.5 step 4).
  const collidingGroups: OrderCustomizationGroup[] = [
    {
      name: 'Size',
      required: true,
      options: [{ name: 'Regular' }, { name: 'Large', priceAdjustment: 100 }],
    },
    {
      name: 'Size',
      required: true,
      options: [{ name: 'Regular' }, { name: 'Large', priceAdjustment: 500 }],
    },
  ];
  const selections = [{ optionName: 'Size', choiceName: 'Large' }];

  // The validator accepts this selection, and it accepts it against the
  // second group.
  assert.equal(validateOrderSelections(collidingGroups, selections), null);

  const catalog = new Map<string, CatalogEntry>([
    ['bowl', catalogEntry({ unitPrice: 1450, groups: collidingGroups })],
  ]);
  const result = priceBasket(
    { lines: [{ menuItemId: 'bowl', quantity: 1, selections }], expectedSubtotal: 1950 },
    catalog
  );

  assert.ok(result.ok, `pricing failed: ${JSON.stringify(result)}`);
  // 1450 base + 500 (the LAST group's adjustment) x 1 = 1950 cents.
  assert.equal(result.items[0].lineTotal, 1950);
  assert.equal(result.subtotal, 1950);
  assert.deepEqual(result.items[0].selections, [
    { optionName: 'Size', choiceName: 'Large', priceAdjustment: 500 },
  ]);
  // The first group's +100 must never be the one that is charged.
  assert.notEqual(result.items[0].lineTotal, 1550);
});

test('prices against the option set of the last duplicate customization group', () => {
  // Only the last group offers "Large", so only the last group can satisfy
  // the validator — and only the last group can supply the adjustment.
  const collidingGroups: OrderCustomizationGroup[] = [
    {
      name: 'Size',
      required: true,
      options: [{ name: 'Regular', priceAdjustment: 100 }],
    },
    {
      name: 'Size',
      required: true,
      options: [{ name: 'Large', priceAdjustment: 500 }],
    },
  ];
  const selections = [{ optionName: 'Size', choiceName: 'Large' }];

  assert.equal(validateOrderSelections(collidingGroups, selections), null);

  const catalog = new Map<string, CatalogEntry>([
    ['bowl', catalogEntry({ unitPrice: 1450, groups: collidingGroups })],
  ]);
  const result = priceBasket(
    { lines: [{ menuItemId: 'bowl', quantity: 1, selections }], expectedSubtotal: 1950 },
    catalog
  );

  assert.ok(result.ok, `pricing failed: ${JSON.stringify(result)}`);
  assert.equal(result.items[0].lineTotal, 1950);
  assert.equal(result.subtotal, 1950);
});

// ---------------------------------------------------------------------------
// Contact: normalization, channel rules, and the async contact hash
// (spec §6.2.4, plan D5). Every call is awaited — the hash is async.
// ---------------------------------------------------------------------------

test('computes the SHA-256 hex of a known vector', async () => {
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('rejects a phone shorter than seven digits', async () => {
  assert.deepEqual(await parseContact({ customerName: 'Ada', phone: '123456' }), {
    ok: false,
    code: 'CONTACT_INVALID',
  });
});

test('accepts phones at the seven- and twenty-digit boundaries', async () => {
  const seven = await parseContact({ customerName: 'Ada', phone: '1234567' });
  assert.ok(seven.ok);
  assert.equal(seven.contact.phoneDigits, '1234567');

  const twenty = await parseContact({ customerName: 'Ada', phone: '1'.repeat(20) });
  assert.ok(twenty.ok);
  assert.equal(twenty.contact.phoneDigits, '1'.repeat(20));
});

test('rejects a phone longer than twenty digits', async () => {
  assert.deepEqual(await parseContact({ customerName: 'Ada', phone: '1'.repeat(21) }), {
    ok: false,
    code: 'CONTACT_INVALID',
  });
});

test('normalizes formatted phones into display and digit forms', async () => {
  const local = await parseContact({ customerName: 'Ada', phone: '(555) 010-1234' });
  assert.ok(local.ok);
  assert.equal(local.contact.phone, '5550101234');
  assert.equal(local.contact.phoneDigits, '5550101234');

  const international = await parseContact({ customerName: 'Ada', phone: '+1 555-0100' });
  assert.ok(international.ok);
  assert.equal(international.contact.phone, '+15550100');
  assert.equal(international.contact.phoneDigits, '15550100');
});

test('hashes the same normalized phone identically across formats', async () => {
  const formatted = await parseContact({ customerName: 'Ada', phone: '+1 555-0100' });
  const digits = await parseContact({ customerName: 'Ada', phone: '15550100' });
  const separated = await parseContact({ customerName: 'Ada', phone: '1-555-0100' });

  assert.ok(formatted.ok);
  assert.ok(digits.ok);
  assert.ok(separated.ok);
  assert.equal(typeof formatted.contactHash, 'string');
  assert.match(formatted.contactHash, /^[0-9a-f]{64}$/);
  assert.equal(formatted.contactHash, digits.contactHash);
  assert.equal(formatted.contactHash, separated.contactHash);
});

test('hashes a different normalized phone differently', async () => {
  const first = await parseContact({ customerName: 'Ada', phone: '15550100' });
  const second = await parseContact({ customerName: 'Ada', phone: '15550101' });

  assert.ok(first.ok);
  assert.ok(second.ok);
  assert.notEqual(first.contactHash, second.contactHash);
});

test('rejects an email without a dotted domain', async () => {
  assert.deepEqual(await parseContact({ customerName: 'Ada', email: 'a@b' }), {
    ok: false,
    code: 'CONTACT_INVALID',
  });
});

test('accepts both channels and lowercases the email', async () => {
  const result = await parseContact({
    customerName: '  Ada Lovelace  ',
    phone: '(555) 010-1234',
    email: '  ADA@EXAMPLE.COM ',
  });

  assert.ok(result.ok);
  assert.equal(result.contact.customerName, 'Ada Lovelace');
  assert.equal(result.contact.phoneDigits, '5550101234');
  assert.equal(result.contact.email, 'ada@example.com');
});

test('rejects a contact with neither a phone nor an email', async () => {
  assert.deepEqual(await parseContact({ customerName: 'Ada' }), {
    ok: false,
    code: 'CONTACT_INVALID',
  });
  assert.deepEqual(
    await parseContact({ customerName: 'Ada', phone: '   ', email: '  ' }),
    { ok: false, code: 'CONTACT_INVALID' }
  );
});

test('accepts names from one to eighty characters and rejects the rest', async () => {
  assert.ok((await parseContact({ customerName: 'A', phone: '15550100' })).ok);
  assert.ok((await parseContact({ customerName: 'a'.repeat(80), phone: '15550100' })).ok);
  assert.deepEqual(
    await parseContact({ customerName: 'a'.repeat(81), phone: '15550100' }),
    { ok: false, code: 'CONTACT_INVALID' }
  );
  assert.deepEqual(await parseContact({ customerName: '   ', phone: '15550100' }), {
    ok: false,
    code: 'CONTACT_INVALID',
  });
});

test('rejects control characters in name, phone, and email', async () => {
  assert.deepEqual(
    await parseContact({ customerName: 'Ada\u0007Lovelace', phone: '15550100' }),
    { ok: false, code: 'CONTACT_INVALID' }
  );
  assert.deepEqual(
    await parseContact({ customerName: 'Ada', phone: '1555\u00070100' }),
    { ok: false, code: 'CONTACT_INVALID' }
  );
  assert.deepEqual(
    await parseContact({ customerName: 'Ada', email: 'ada\u0007@example.com' }),
    { ok: false, code: 'CONTACT_INVALID' }
  );
});

test('treats a whitespace-only email as absent when a phone is present', async () => {
  const result = await parseContact({
    customerName: 'Ada',
    phone: '15550100',
    email: '   ',
  });

  assert.ok(result.ok);
  assert.equal('email' in result.contact, false);
});

test('rejects a phone that carries no digits instead of silently dropping it', async () => {
  // A phone was supplied but holds no digits at all. §6.2.4 rejects obviously
  // incomplete numbers; dropping the phone here would let the order go by
  // email alone and leave the hashed-contact throttle key covering a number
  // the customer never supplied.
  for (const phone of ['+', '()', '...', '--', '+ () . -']) {
    assert.deepEqual(
      await parseContact({ customerName: 'Ada', phone, email: 'ada@example.com' }),
      { ok: false, code: 'CONTACT_INVALID' },
      `phone "${phone}" must be invalid, not absent`
    );
  }
});

test('treats a whitespace-only phone as absent when an email is present', async () => {
  // Nothing was supplied, so the channel is absent rather than invalid.
  const result = await parseContact({
    customerName: 'Ada',
    phone: '   ',
    email: 'ada@example.com',
  });

  assert.ok(result.ok);
  assert.equal('phone' in result.contact, false);
  assert.equal('phoneDigits' in result.contact, false);
});

test('accepts an email-only contact', async () => {
  const result = await parseContact({ customerName: 'Ada', email: 'ada@example.com' });

  assert.ok(result.ok);
  assert.equal(result.contact.email, 'ada@example.com');
  assert.equal('phone' in result.contact, false);
  assert.equal('phoneDigits' in result.contact, false);
});

test('accepts a 254-character email and rejects 255', async () => {
  const atLimit = `${'a'.repeat(242)}@example.com`;
  assert.equal(atLimit.length, 254);
  assert.ok((await parseContact({ customerName: 'Ada', email: atLimit })).ok);
  assert.deepEqual(
    await parseContact({ customerName: 'Ada', email: `${'a'.repeat(243)}@example.com` }),
    { ok: false, code: 'CONTACT_INVALID' }
  );
});

// ---------------------------------------------------------------------------
// Canonical args hash: the module-private canonical form, pinned here
// (spec §6.2.5, plan D5). Key order, line order, and selection order must not
// change the hash; the six difference axes must change it.
// ---------------------------------------------------------------------------

const CANONICAL_LINES: readonly BasketLineInput[] = [
  {
    menuItemId: 'bowl',
    quantity: 2,
    selections: [
      { optionName: 'Size', choiceName: 'Large' },
      { optionName: 'Extras', choiceName: 'Cheese' },
    ],
  },
  { menuItemId: 'soup', quantity: 1 },
];

function canonicalArgs(overrides: Partial<CanonicalArgsInput> = {}): CanonicalArgsInput {
  return {
    businessId: 'business-1',
    lines: CANONICAL_LINES,
    contact: {
      customerName: 'Ada Lovelace',
      phone: '+1 555-0100',
      email: 'ADA@example.com',
    },
    note: 'no onions',
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

test('hashes the canonical arguments to a stable SHA-256 hex', async () => {
  const hash = await canonicalArgsHash(canonicalArgs());
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, await canonicalArgsHash(canonicalArgs()));
});

test('pins the canonical arguments hash to a golden vector', async () => {
  // The canonical form is module-private, so this literal is the only thing
  // that stops a silent change to it. A relational (hash-vs-hash) assertion
  // keeps passing through ANY deterministic change to the canonical form,
  // and a changed canonical form turns a legitimate retry of a committed
  // order into a spurious IDEMPOTENCY_CONFLICT.
  assert.equal(
    await canonicalArgsHash(canonicalArgs()),
    '87dd99b20a0dd5668afbebdb6da1c1e3e2a28106362d8a6157ba069bc516c31a'
  );
});

test('hashes duplicate identical lines differently from the quantity-2 equivalent', async () => {
  // Plan D5: duplicate identical lines are permitted and priced as separate
  // lines, but they must not hash like the quantity-2 equivalent.
  const line = {
    menuItemId: 'bowl',
    quantity: 1,
    selections: [
      { optionName: 'Size', choiceName: 'Large' },
      { optionName: 'Extras', choiceName: 'Cheese' },
    ],
  };

  // Both baskets are permitted by `validateBasket`.
  assert.deepEqual(
    validateBasket({ lines: [line, { ...line }] }, catalogForIds(['bowl'])),
    { ok: true }
  );
  assert.deepEqual(
    validateBasket({ lines: [{ ...line, quantity: 2 }] }, catalogForIds(['bowl'])),
    { ok: true }
  );

  const duplicated = await canonicalArgsHash(canonicalArgs({ lines: [line, { ...line }] }));
  const doubled = await canonicalArgsHash(
    canonicalArgs({ lines: [{ ...line, quantity: 2 }] })
  );

  assert.notEqual(duplicated, doubled);
});

test('ignores the key order of the arguments', async () => {
  const ordered = await canonicalArgsHash({
    businessId: 'business-1',
    lines: CANONICAL_LINES,
    contact: {
      customerName: 'Ada Lovelace',
      phone: '+1 555-0100',
      email: 'ADA@example.com',
    },
    note: 'no onions',
    idempotencyKey: 'idem-1',
  });
  const permuted = await canonicalArgsHash({
    idempotencyKey: 'idem-1',
    note: 'no onions',
    contact: {
      email: 'ADA@example.com',
      phone: '+1 555-0100',
      customerName: 'Ada Lovelace',
    },
    lines: CANONICAL_LINES,
    businessId: 'business-1',
  });
  assert.equal(ordered, permuted);
});

test('ignores the order of the basket lines', async () => {
  const forward = await canonicalArgsHash(canonicalArgs({ lines: CANONICAL_LINES }));
  const reversed = await canonicalArgsHash(
    canonicalArgs({ lines: [...CANONICAL_LINES].reverse() })
  );
  assert.equal(forward, reversed);
});

test('ignores the order of the selections within a line', async () => {
  const forward = await canonicalArgsHash(canonicalArgs());
  const permuted = await canonicalArgsHash(
    canonicalArgs({
      lines: [
        {
          menuItemId: 'bowl',
          quantity: 2,
          selections: [
            { optionName: 'Extras', choiceName: 'Cheese' },
            { optionName: 'Size', choiceName: 'Large' },
          ],
        },
        { menuItemId: 'soup', quantity: 1 },
      ],
    })
  );
  assert.equal(forward, permuted);
});

test('hashes one contact identically across phone and email formats', async () => {
  const formatted = await canonicalArgsHash(
    canonicalArgs({
      contact: {
        customerName: 'Ada Lovelace',
        phone: '+1 555-0100',
        email: 'ADA@example.com',
      },
    })
  );
  const separated = await canonicalArgsHash(
    canonicalArgs({
      contact: {
        customerName: 'Ada Lovelace',
        phone: '1-555-0100',
        email: 'ada@example.com',
      },
    })
  );
  assert.equal(formatted, separated);
});

test('treats a phone with and without a country code as two different numbers', async () => {
  // The contact normalization this module reuses keeps the country code as
  // part of the number: `+1 555-0100` is 15550100 and `5550100` is
  // 5550100. Equating them would need a second, divergent normalization
  // rule, so the two numbers hash differently.
  const withCountryCode = await canonicalArgsHash(
    canonicalArgs({ contact: { customerName: 'Ada Lovelace', phone: '+1 555-0100' } })
  );
  const withoutCountryCode = await canonicalArgsHash(
    canonicalArgs({ contact: { customerName: 'Ada Lovelace', phone: '5550100' } })
  );
  assert.notEqual(withCountryCode, withoutCountryCode);
});

test('changes the hash for every difference axis', async () => {
  const base = await canonicalArgsHash(canonicalArgs());

  const differentItem = await canonicalArgsHash(
    canonicalArgs({
      lines: [
        {
          menuItemId: 'wrap',
          quantity: 2,
          selections: [
            { optionName: 'Size', choiceName: 'Large' },
            { optionName: 'Extras', choiceName: 'Cheese' },
          ],
        },
        { menuItemId: 'soup', quantity: 1 },
      ],
    })
  );
  assert.notEqual(base, differentItem, 'a different item must change the hash');

  const differentQuantity = await canonicalArgsHash(
    canonicalArgs({
      lines: [
        {
          menuItemId: 'bowl',
          quantity: 3,
          selections: [
            { optionName: 'Size', choiceName: 'Large' },
            { optionName: 'Extras', choiceName: 'Cheese' },
          ],
        },
        { menuItemId: 'soup', quantity: 1 },
      ],
    })
  );
  assert.notEqual(base, differentQuantity, 'a different quantity must change the hash');

  const differentSelection = await canonicalArgsHash(
    canonicalArgs({
      lines: [
        {
          menuItemId: 'bowl',
          quantity: 2,
          selections: [
            { optionName: 'Size', choiceName: 'Large' },
            { optionName: 'Extras', choiceName: 'Bacon' },
          ],
        },
        { menuItemId: 'soup', quantity: 1 },
      ],
    })
  );
  assert.notEqual(base, differentSelection, 'a different selection must change the hash');

  const differentName = await canonicalArgsHash(
    canonicalArgs({
      contact: {
        customerName: 'Grace Hopper',
        phone: '+1 555-0100',
        email: 'ADA@example.com',
      },
    })
  );
  assert.notEqual(base, differentName, 'a different name must change the hash');

  const differentNote = await canonicalArgsHash(canonicalArgs({ note: 'no onions please' }));
  assert.notEqual(base, differentNote, 'a different note must change the hash');

  const differentBusiness = await canonicalArgsHash(canonicalArgs({ businessId: 'business-2' }));
  assert.notEqual(base, differentBusiness, 'a different business must change the hash');
});

test('never reads a price from the arguments', async () => {
  const plain = await canonicalArgsHash(canonicalArgs());
  const smuggled = await canonicalArgsHash(
    canonicalArgs({
      lines: [
        {
          menuItemId: 'bowl',
          quantity: 2,
          unitPrice: 1,
          selections: [
            { optionName: 'Size', choiceName: 'Large' },
            { optionName: 'Extras', choiceName: 'Cheese' },
          ],
        } as unknown as BasketLineInput,
        { menuItemId: 'soup', quantity: 1 },
      ],
    })
  );
  assert.equal(plain, smuggled);
});

test('rejects an invalid contact instead of hashing it', async () => {
  await assert.rejects(
    canonicalArgsHash(canonicalArgs({ contact: { customerName: 'Ada' } })),
    /valid contact/
  );
});

// ---------------------------------------------------------------------------
// Reference minting: the §6.2.6 alphabet, the collision retry, and the
// seven-character fallback (spec §6.2.6, plan D2).
// ---------------------------------------------------------------------------

test('mints a six-character reference from the §6.2.4 alphabet', () => {
  const reference = createReference(new Set<string>());
  assert.equal(reference.length, REFERENCE_LENGTH);
  for (const character of reference) {
    assert.ok(
      REFERENCE_ALPHABET.includes(character),
      `"${character}" must be in the alphabet`
    );
  }
});

test('draws the requested number of alphabet characters', () => {
  for (const length of [1, 6, 7, 32]) {
    const reference = randomReference(length);
    assert.equal(reference.length, length);
    for (const character of reference) {
      assert.ok(
        REFERENCE_ALPHABET.includes(character),
        `"${character}" must be in the alphabet`
      );
    }
  }
});

test('never mints an ambiguous character', () => {
  const minted = new Set<string>();
  for (let index = 0; index < 200; index += 1) {
    const reference = createReference(minted);
    minted.add(reference);
    for (const character of reference) {
      assert.ok(
        !'0O1I'.includes(character),
        `"${character}" must not appear in a reference`
      );
    }
  }
});

test('never returns a member of the existing set', () => {
  const existing = new Set<string>();
  for (let index = 0; index < 50; index += 1) {
    const reference = createReference(existing);
    assert.equal(existing.has(reference), false);
    existing.add(reference);
  }
});

test('retries a colliding six-character candidate up to five times', () => {
  const existing = new Set(['AAAAAA']);
  let calls = 0;
  const random = (length: number): string => {
    calls += 1;
    assert.equal(length, REFERENCE_LENGTH);
    return calls <= REFERENCE_COLLISION_RETRIES ? 'AAAAAA' : 'BBBBBB';
  };

  assert.equal(createReference(existing, random), 'BBBBBB');
  assert.equal(calls, REFERENCE_COLLISION_RETRIES + 1);
});

test('falls back to seven characters when every six-character candidate collides', () => {
  const existing = new Set(['AAAAAA']);
  const random = (length: number): string =>
    length === REFERENCE_LENGTH ? 'AAAAAA' : 'AAAAAAA';

  const reference = createReference(existing, random);
  assert.equal(reference.length, REFERENCE_LENGTH + 1);
  assert.equal(reference, 'AAAAAAA');
});

test('throws a bounded error when every candidate collides', () => {
  const existing = new Set(['AAAAAA', 'AAAAAAA']);
  let calls = 0;
  const random = (length: number): string => {
    calls += 1;
    return length === REFERENCE_LENGTH ? 'AAAAAA' : 'AAAAAAA';
  };

  assert.throws(
    () => createReference(existing, random),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.length > 0, 'the error must carry a non-empty message');
      return true;
    }
  );
  assert.equal(calls, (REFERENCE_COLLISION_RETRIES + 1) * 2, 'the attempts are bounded');
});

// ---------------------------------------------------------------------------
// Access token: §6.2.6's 32 random bytes, the base64url charset, and the
// "never derived from the id" rule. The reference block above covers the
// human-facing code; this covers the bearer capability.
// ---------------------------------------------------------------------------

test('mints an access token of 32 random bytes as unpadded base64url', () => {
  const token = createAccessToken();

  // 32 bytes encode to 44 base64 characters; the single '=' pad is stripped,
  // leaving 43.
  assert.equal(token.length, 43);
  assert.equal(TOKEN_BYTES, 32);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(token.includes('='), false, 'base64 padding must be stripped');
  assert.equal(token.includes('+'), false, 'base64 "+" must become "-"');
  assert.equal(token.includes('/'), false, 'base64 "/" must become "_"');
});

test('never derives the access token from an id, a timestamp, or contact data', () => {
  // §6.2.6: "Do not derive it from the order id, timestamp, or contact."
  // `createAccessToken` takes no arguments at all, so there is no id, no
  // timestamp, and no contact for it to derive anything from.
  assert.equal(createAccessToken.length, 0);

  const first = createAccessToken();
  const second = createAccessToken();
  assert.notEqual(first, second, 'the token must not be a constant');
});

test('mints a distinct access token on every draw', () => {
  const tokens = new Set<string>();
  for (let index = 0; index < 100; index += 1) {
    tokens.add(createAccessToken());
  }
  assert.equal(tokens.size, 100, 'every draw must be a fresh token');
});

// ---------------------------------------------------------------------------
// Effective open: the §6.5 predicate. `now` is always passed in; the module
// never reads a clock.
// ---------------------------------------------------------------------------

function effectiveBusiness(
  overrides: Partial<EffectiveOpenBusiness> = {}
): EffectiveOpenBusiness {
  return {
    status: 'approved',
    acceptingOrders: true,
    hours: {},
    timezone: 'America/New_York',
    ...overrides,
  };
}

test('reports closed while the business is not approved', () => {
  assert.equal(
    isEffectiveOpen(effectiveBusiness({ status: 'pendingReview' }), Date.UTC(2026, 0, 12, 12, 0)),
    false
  );
});

test('reports closed while acceptingOrders is false', () => {
  assert.equal(
    isEffectiveOpen(effectiveBusiness({ acceptingOrders: false }), Date.UTC(2026, 0, 12, 12, 0)),
    false
  );
});

test('treats an undefined acceptingOrders as accepting', () => {
  const open: EffectiveOpenBusiness = {
    status: 'approved',
    hours: {},
    timezone: 'America/New_York',
  };
  assert.equal(isEffectiveOpen(open, Date.UTC(2026, 0, 12, 12, 0)), true);
});

test('reports closed once acceptingOrdersUntil has passed', () => {
  const now = Date.UTC(2026, 0, 12, 12, 0);
  assert.equal(isEffectiveOpen(effectiveBusiness({ acceptingOrdersUntil: now - 1 }), now), false);
});

test('reports closed when acceptingOrdersUntil is exactly now', () => {
  const now = Date.UTC(2026, 0, 12, 12, 0);
  assert.equal(isEffectiveOpen(effectiveBusiness({ acceptingOrdersUntil: now }), now), false);
});

test('reports open while acceptingOrdersUntil is in the future', () => {
  const now = Date.UTC(2026, 0, 12, 12, 0);
  assert.equal(isEffectiveOpen(effectiveBusiness({ acceptingOrdersUntil: now + 1 }), now), true);
});

test('reports open inside a configured opening period', () => {
  const hours: BusinessHours = { monday: [{ opensAt: '09:00', closesAt: '17:00' }] };
  // 2026-01-12T12:00Z is Monday 12:00 in London.
  assert.equal(
    isEffectiveOpen(
      effectiveBusiness({ hours, timezone: 'Europe/London' }),
      Date.UTC(2026, 0, 12, 12, 0)
    ),
    true
  );
});

test('reports closed outside a configured opening period', () => {
  const hours: BusinessHours = { monday: [{ opensAt: '09:00', closesAt: '17:00' }] };
  // 2026-01-12T12:00Z is Monday 07:00 in New York.
  assert.equal(
    isEffectiveOpen(
      effectiveBusiness({ hours, timezone: 'America/New_York' }),
      Date.UTC(2026, 0, 12, 12, 0)
    ),
    false
  );
});

test('skips the hours gate when no day carries an opening period', () => {
  const now = Date.UTC(2026, 0, 12, 12, 0);
  assert.equal(isEffectiveOpen(effectiveBusiness({ hours: {} }), now), true);
  assert.equal(isEffectiveOpen(effectiveBusiness({ hours: { monday: [] } }), now), true);
});

test('carries an overnight period into the next morning', () => {
  const hours: BusinessHours = { friday: [{ opensAt: '22:00', closesAt: '02:00' }] };
  // 2026-01-17T06:00Z is Saturday 01:00 in New York — inside Friday's period.
  assert.equal(
    isEffectiveOpen(effectiveBusiness({ hours }), Date.UTC(2026, 0, 17, 6, 0)),
    true
  );
  // 2026-01-17T07:30Z is Saturday 02:30 in New York — past the close.
  assert.equal(
    isEffectiveOpen(effectiveBusiness({ hours }), Date.UTC(2026, 0, 17, 7, 30)),
    false
  );
});

test('follows the spring-forward transition in the business timezone', () => {
  const hours: BusinessHours = { sunday: [{ opensAt: '01:00', closesAt: '02:00' }] };
  // 2026-03-08T06:30Z is 01:30 EST, inside the period.
  assert.equal(
    isEffectiveOpen(effectiveBusiness({ hours }), Date.UTC(2026, 2, 8, 6, 30)),
    true
  );
  // 2026-03-08T07:30Z is 03:30 EDT; local 02:00-02:59 does not exist that day.
  assert.equal(
    isEffectiveOpen(effectiveBusiness({ hours }), Date.UTC(2026, 2, 8, 7, 30)),
    false
  );
});

test('agrees on both sides of the repeated fall-back hour', () => {
  const hours: BusinessHours = { sunday: [{ opensAt: '01:00', closesAt: '02:00' }] };
  // 2026-11-01T05:30Z is 01:30 EDT and 2026-11-01T06:30Z is 01:30 EST. The
  // evaluator reads a wall clock, so the two instants cannot be told apart.
  const first = isEffectiveOpen(effectiveBusiness({ hours }), Date.UTC(2026, 10, 1, 5, 30));
  const second = isEffectiveOpen(effectiveBusiness({ hours }), Date.UTC(2026, 10, 1, 6, 30));
  assert.equal(first, second);
  assert.equal(first, true);
});

test('resolves one instant differently in two timezones', () => {
  const hours: BusinessHours = { monday: [{ opensAt: '09:00', closesAt: '17:00' }] };
  const now = Date.UTC(2026, 0, 12, 12, 0);
  assert.equal(isEffectiveOpen(effectiveBusiness({ hours, timezone: 'Europe/London' }), now), true);
  assert.equal(
    isEffectiveOpen(effectiveBusiness({ hours, timezone: 'America/New_York' }), now),
    false
  );
});
