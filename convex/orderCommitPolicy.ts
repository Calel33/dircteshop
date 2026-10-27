// Order commit policy (issue #75, T3): the DB-free half of the basket order
// protocol. Pure module — no database, no Convex function surface, no
// generated API.
//
// Spec: docs/order-commitment-protocol.md §6.2.4–§6.2.6 (constants, pricing,
// token/reference), §6.5 (effective-open predicate, error catalog), §7.3
// (pure test matrix). The S1 handler owns the transaction; this module owns
// the vocabulary, validators, and arithmetic that need no database.
//
// Rules this module keeps:
//   (a) runtime imports only from `convex/orderPolicy.ts` and, from Task 8,
//       `convex/businesses/publicHours.ts` — both pure modules;
//   (b) no `convex/values` / `ConvexError` import — this module exports the
//       error catalog only; the handler throws;
//   (c) no runtime import from `convex/_generated`;
//   (d) hashing is async via `globalThis.crypto.subtle` — no `node:crypto`
//       and no `Buffer` (neither exists in the Convex default runtime);
//   (e) no `Date.now()` and no `Math.random()` here — callers pass `now`,
//       and randomness is injected;
//   (f) reference minting here duplicates `convex/orderAccess.ts` by design;
//       S1 collapses `orderAccess` to import from this module.

export {
  ORDER_DB_STATUSES,
  ORDER_PROTOCOL_ACTIONS,
  TERMINAL_ORDER_STATUSES,
  resolveOrderAction,
} from './orderPolicy.ts';
export type {
  OrderActionResolution,
  OrderDbStatus,
  OrderProtocolAction,
  TerminalOrderStatus,
} from './orderPolicy.ts';
import { validateOrderSelections } from './orderPolicy.ts';
import type { OrderCustomizationGroup, OrderSelection } from './orderPolicy.ts';
import {
  businessClock,
  createBusinessFormatter,
  openStatusAt,
} from './businesses/publicHours.ts';
import type { BusinessHours } from './businesses/publicHours.ts';

// ---------------------------------------------------------------------------
// Constants (spec §6.2.4)
// ---------------------------------------------------------------------------

export const MAX_LINES = 20;
export const MAX_QUANTITY_PER_LINE = 20;
export const MAX_TOTAL_UNITS = 100;
export const MAX_SELECTIONS_PER_LINE = 32;
export const MAX_NAME = 80;
export const MAX_NOTE = 500;
export const MIN_PHONE_DIGITS = 7;
export const MAX_PHONE_DIGITS = 20;
export const MAX_EMAIL = 254;
export const DEFAULT_TTL_MS = 3_600_000;
export const IDEMPOTENCY_TTL_MS = 86_400_000;
export const TOKEN_BYTES = 32;
export const REFERENCE_LENGTH = 6;
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CONTACT_THROTTLE_10M = 3;
export const CONTACT_THROTTLE_24H = 10;
/**
 * The fixed window for the `contact:<businessId>:<hash>:24h` key, whose shape
 * the protocol pins at §6.2.2 L1009. The 10-minute sibling window is not
 * duplicated here: `convex/orderThrottle.ts` owns it as
 * `BUSINESS_THROTTLE_WINDOW_MS` and the S4 contact keys reuse it.
 */
export const CONTACT_THROTTLE_WINDOW_24H_MS = 24 * 60 * 60_000;
export const BUSINESS_THROTTLE_10M = 60;
export const MAX_ORDER_VALUE = 100_000;

/**
 * §6.2.4's `MONEY` is a unit convention, not a numeric limit: every amount is
 * an integer number of cents (`Number.isInteger`), never a float. There is
 * deliberately no number to export for it.
 */
export const MONEY = 'integer-cents';

/** Every §6.2.4 value behind one frozen object, for consumers that want them all. */
export const ORDER_COMMIT_CONSTANTS = Object.freeze({
  MAX_LINES,
  MAX_QUANTITY_PER_LINE,
  MAX_TOTAL_UNITS,
  MAX_SELECTIONS_PER_LINE,
  MAX_NAME,
  MAX_NOTE,
  MIN_PHONE_DIGITS,
  MAX_PHONE_DIGITS,
  MAX_EMAIL,
  DEFAULT_TTL_MS,
  IDEMPOTENCY_TTL_MS,
  TOKEN_BYTES,
  REFERENCE_LENGTH,
  REFERENCE_ALPHABET,
  CONTACT_THROTTLE_10M,
  CONTACT_THROTTLE_24H,
  BUSINESS_THROTTLE_10M,
  MAX_ORDER_VALUE,
} as const);

// ---------------------------------------------------------------------------
// Retention policy (issue #84, T10 / plan D5; protocol E74 :282, INV-30 :326)
//
// Decided values, not spec numbers: E74 prints its windows as "e.g." and says
// retention is "not implemented v1". `orderRetention.purgeRetainedOrders`
// enforces them. `RETENTION_BATCH` bounds one run in the style of
// `orderThrottleCleanup.CLEANUP_BATCH`; one order also removes at most its five
// companion kinds, so a full batch is roughly 350 document writes.
// ---------------------------------------------------------------------------

export const RETENTION_TERMINAL_DAYS_MS = 90 * 24 * 60 * 60_000;
export const RETENTION_COMPLETED_DAYS_MS = 365 * 24 * 60 * 60_000;
export const RETENTION_BATCH = 50;

// ---------------------------------------------------------------------------
// Owner fake-order flag reasons (issue #84, T10 / protocol §7.2 S5 :1645)
//
// The owner picks one label and `orderFlags.flagOrder` validates against this
// closed list, so a flag reason is always one of five labels and no free text
// reaches an `auditLogs` row.
// ---------------------------------------------------------------------------

export const FLAG_REASONS = [
  'Fake order',
  'Wrong number',
  'Duplicate',
  'Prank',
  'Other',
] as const;

// ---------------------------------------------------------------------------
// Client-reported rejection codes (issue #84, T10 / plan D4, research design A)
//
// A rejection cannot be counted where it happens: every rejection path throws,
// and a Convex mutation discards its writes when it throws. So the customer's
// client reports the failure through `orderMetrics.recordOrderRejection`, and
// this closed list is the only vocabulary that report accepts — a counter row
// is never an arbitrary key. One code per rejection class the §4.4 rates need;
// codes that have no rate here (`GROUP_UNAVAILABLE`, `PRICE_UNAVAILABLE`,
// `ORDER_VALUE_TOO_HIGH`, …) are deliberately not reported.
// ---------------------------------------------------------------------------

export const REJECTION_CODES = [
  'throttle_rejected',
  'block_hit',
  'price_changed',
  'item_unavailable',
  'ordering_closed',
  'outside_hours',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

// ---------------------------------------------------------------------------
// Error catalog (spec §6.5, table at L1275–1304)
//
// The table has 28 rows but 29 codes: `FORBIDDEN` and `UNAUTHORIZED` share one
// row. Messages are copied character-for-character, including the `{phone}`,
// `{n}`, and `{item}` placeholder tokens — the handler substitutes them; this
// module never interpolates.
// ---------------------------------------------------------------------------

export const ORDER_ERROR_CODES = [
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
] as const;
export type OrderErrorCode = (typeof ORDER_ERROR_CODES)[number];

export const ORDER_ERRORS: Record<
  OrderErrorCode,
  { message: string; recovery: string }
> = Object.freeze({
  BUSINESS_UNAVAILABLE: {
    message: "This business isn't available right now.",
    recovery: 'Back to directory',
  },
  MENU_UNAVAILABLE: {
    message: "This business hasn't published a menu yet.",
    recovery: 'Call the business',
  },
  MENU_EMPTY: {
    message: "There's nothing available to order right now.",
    recovery: 'Call the business',
  },
  ORDERING_CLOSED: {
    message: "This business isn't accepting orders right now. Call {phone}.",
    recovery: 'Call; retry later',
  },
  OUTSIDE_HOURS: {
    message: 'This business is closed right now. Call {phone} or check its hours.',
    recovery: 'Call; retry when open',
  },
  GROUP_UNAVAILABLE: {
    message: 'One of the menu sections you picked is unavailable. Refresh the menu.',
    recovery: 'Refresh; remove section',
  },
  ITEM_UNAVAILABLE: {
    message: 'One of the items you picked is sold out. Refresh the menu.',
    recovery: 'Refresh; remove line',
  },
  BASKET_EMPTY: {
    message: 'Add at least one item before sending your order.',
    recovery: 'Add item',
  },
  BASKET_TOO_LARGE: {
    message: 'This order is too large to send here. Call the business.',
    recovery: 'Call',
  },
  QUANTITY_INVALID: {
    message: 'Choose a quantity between 1 and 20.',
    recovery: 'Fix quantity',
  },
  SELECTION_INVALID: {
    message: 'Check the options for {item}; one is missing or no longer available.',
    recovery: 'Re-select',
  },
  CONTACT_INVALID: {
    message: 'Add a name and a phone or email so the business can reach you.',
    recovery: 'Fix contact',
  },
  NOTE_TOO_LONG: {
    message: 'Keep the note under 500 characters.',
    recovery: 'Shorten',
  },
  PRICE_CHANGED: {
    message: 'Prices changed while you were ordering. Review the new total and send again.',
    recovery: 'Show old/new; re-confirm',
  },
  PRICE_UNAVAILABLE: {
    message: 'One item has no price listed. Confirm the total with the business.',
    recovery: 'Call / remove',
  },
  ORDER_VALUE_TOO_HIGH: {
    message: 'This order is too large to send online. Call the business.',
    recovery: 'Call',
  },
  IDEMPOTENCY_CONFLICT: {
    message: 'This order was already sent with different details. Refresh your order.',
    recovery: 'Refresh',
  },
  TOO_MANY_REQUESTS: {
    message: 'Too many order attempts. Try again in {n} minutes or call the business.',
    recovery: 'Wait / call',
  },
  ORDER_NOT_ACCEPTED: {
    message: "We can't accept this order online. Please call the business.",
    recovery: 'Call',
  },
  ORDER_NOT_FOUND: {
    message: "We couldn't find that order. Check the link or call the business.",
    recovery: 'Call',
  },
  ORDER_EXPIRED: {
    message: 'This order expired before it was accepted. Place a new order.',
    recovery: 'Re-order',
  },
  CANNOT_CANCEL: {
    message: 'This order can no longer be cancelled online. Call the business.',
    recovery: 'Call',
  },
  INVALID_TRANSITION: {
    message: "That action isn't available for this order anymore. Refresh.",
    recovery: 'Refresh',
  },
  // The §6.5 table shows "—" (no recovery action). The issue requires a
  // non-empty recovery string for every code, so this states the real one.
  ORDER_TERMINAL: {
    message: 'This order is already closed.',
    recovery: 'No action needed; place a new order if the customer wants to reorder.',
  },
  ORDER_ALREADY_DECIDED: {
    message: 'Someone already updated this order. Refresh the board.',
    recovery: 'Refresh',
  },
  REASON_REQUIRED: {
    message: 'Add a short reason before continuing.',
    recovery: 'Add reason',
  },
  FORBIDDEN: {
    message: "You don't have access to this order.",
    recovery: 'Sign in / contact support',
  },
  UNAUTHORIZED: {
    message: "You don't have access to this order.",
    recovery: 'Sign in / contact support',
  },
  INTERNAL: {
    message: 'Something went wrong. Try again or call the business.',
    recovery: 'Retry',
  },
});

// ---------------------------------------------------------------------------
// Basket validation (spec §6.2.4 caps; §6.5 precedence)
//
// Pure input validation: catalog membership, the caps, and one business per
// order. Availability flags and selection semantics are pricing's job (§6.2.5
// steps 1–2), so this stays a boundary check and the first failure wins in the
// order below.
// ---------------------------------------------------------------------------

export type BasketLineInput = {
  menuItemId: string;
  quantity: number;
  selections?: readonly OrderSelection[];
};

export type BasketValidationInput = {
  lines: readonly BasketLineInput[];
  note?: string;
};

export type CatalogEntry = {
  businessId: string;
  name: string;
  unitPrice?: number; // integer cents; absent => unpriced line
  isAvailable: boolean;
  groupAvailable: boolean;
  groups: OrderCustomizationGroup[];
};

export type Catalog = ReadonlyMap<string, CatalogEntry>;

export type BasketFailure = {
  ok: false;
  code:
    | 'BASKET_EMPTY'
    | 'BASKET_TOO_LARGE'
    | 'QUANTITY_INVALID'
    | 'SELECTION_INVALID'
    | 'NOTE_TOO_LONG'
    | 'ITEM_UNAVAILABLE'
    | 'GROUP_UNAVAILABLE'
    | 'PRICE_UNAVAILABLE'
    | 'PRICE_CHANGED'
    | 'ORDER_VALUE_TOO_HIGH'
    | 'INTERNAL';
  lineIndex?: number;
  actualSubtotal?: number;
};

export type BasketValidation = { ok: true } | BasketFailure;

/**
 * Validates the basket boundary, in the spec's fixed error order: empty,
 * too large, quantity, catalog membership plus one business, selections,
 * note. Duplicate identical lines are permitted.
 */
export function validateBasket(
  input: BasketValidationInput,
  catalog: Catalog
): BasketValidation {
  const lines = input.lines;
  if (lines.length === 0) {
    return { ok: false, code: 'BASKET_EMPTY' };
  }
  if (lines.length > MAX_LINES) {
    return { ok: false, code: 'BASKET_TOO_LARGE' };
  }

  const totalUnits = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (totalUnits > MAX_TOTAL_UNITS) {
    return { ok: false, code: 'BASKET_TOO_LARGE' };
  }

  const invalidQuantityIndex = lines.findIndex(
    (line) =>
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > MAX_QUANTITY_PER_LINE
  );
  if (invalidQuantityIndex !== -1) {
    return { ok: false, code: 'QUANTITY_INVALID', lineIndex: invalidQuantityIndex };
  }

  const missingItemIndex = lines.findIndex((line) => !catalog.has(line.menuItemId));
  if (missingItemIndex !== -1) {
    return { ok: false, code: 'ITEM_UNAVAILABLE', lineIndex: missingItemIndex };
  }

  const businessIds = new Set(lines.map((line) => catalog.get(line.menuItemId)?.businessId));
  if (businessIds.size > 1) {
    return { ok: false, code: 'ITEM_UNAVAILABLE' };
  }

  const tooManySelectionsIndex = lines.findIndex(
    (line) => (line.selections?.length ?? 0) > MAX_SELECTIONS_PER_LINE
  );
  if (tooManySelectionsIndex !== -1) {
    return { ok: false, code: 'SELECTION_INVALID', lineIndex: tooManySelectionsIndex };
  }

  if ((input.note ?? '').trim().length > MAX_NOTE) {
    return { ok: false, code: 'NOTE_TOO_LONG' };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pricing (spec §6.2.5)
//
// The request carries ids, quantities, and selections only — never a price.
// The caller supplies the catalog, so this module stays DB-free. A single
// unpriced line makes the whole subtotal null; a partial sum is never returned.
// ---------------------------------------------------------------------------

export type PricedSelection = {
  optionName: string;
  choiceName: string;
  priceAdjustment?: number;
};

export type PricedLine = {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice?: number;
  lineTotal?: number; // absent when the line is unpriced
  selections: PricedSelection[];
};

export type PriceBasketInput = {
  lines: readonly BasketLineInput[];
  /**
   * The total the customer saw. `null` — or an omitted field — means "the
   * customer stated no total"; a number must equal the server's subtotal
   * exactly. §6.2.5 step 8 pins the explicit-`null` case; the omitted case
   * is not specified by the spec and is resolved the same way, so an order is
   * never committed against a total the customer never confirmed. The S1
   * handler owns the wire-to-policy mapping.
   */
  expectedSubtotal?: number | null;
};

export type PriceBasketResult =
  | { ok: true; items: PricedLine[]; subtotal: number | null }
  | BasketFailure;

type SelectionPricingOutcome =
  | { ok: true; selections: PricedSelection[]; adjustment: number }
  | BasketFailure;

type PricedLineOutcome =
  | { ok: true; line: PricedLine; lineTotal: number | undefined }
  | BasketFailure;

function priceSelections(
  groups: readonly OrderCustomizationGroup[],
  selections: readonly OrderSelection[],
  lineIndex: number
): SelectionPricingOutcome {
  if (validateOrderSelections(groups, selections) !== null) {
    return { ok: false, code: 'SELECTION_INVALID', lineIndex };
  }

  // The group lookup MUST resolve duplicate names the way
  // `validateOrderSelections` resolves them — the LAST group with that name
  // wins. `menuItems.customizationOptions` does not constrain group names to
  // be unique, so a first-match lookup would price an adjustment from a group
  // the validator never accepted (§6.2.5 step 4: the summed adjustment comes
  // from the same option set step 2 validated).
  const groupByName = new Map<string, OrderCustomizationGroup>(
    groups.map((group) => [group.name, group])
  );

  let adjustment = 0;
  const priced: PricedSelection[] = [];
  for (const selection of selections) {
    const group = groupByName.get(selection.optionName);
    const option = group?.options.find(
      (candidate) => candidate.name === selection.choiceName
    );
    if (option === undefined) {
      return { ok: false, code: 'SELECTION_INVALID', lineIndex };
    }

    const pricedSelection: PricedSelection = {
      optionName: selection.optionName,
      choiceName: selection.choiceName,
    };
    if (option.priceAdjustment !== undefined) {
      // A non-integer adjustment is a catalog fault, not customer input.
      if (!Number.isInteger(option.priceAdjustment)) {
        return { ok: false, code: 'INTERNAL' };
      }
      adjustment += option.priceAdjustment;
      pricedSelection.priceAdjustment = option.priceAdjustment;
    }
    priced.push(pricedSelection);
  }

  return { ok: true, selections: priced, adjustment };
}

function priceLine(
  line: BasketLineInput,
  entry: CatalogEntry,
  lineIndex: number,
  orderBusinessId: string
): PricedLineOutcome {
  if (entry.groupAvailable === false) {
    return { ok: false, code: 'GROUP_UNAVAILABLE', lineIndex };
  }
  if (entry.isAvailable === false) {
    return { ok: false, code: 'ITEM_UNAVAILABLE', lineIndex };
  }
  if (entry.businessId !== orderBusinessId) {
    return { ok: false, code: 'ITEM_UNAVAILABLE', lineIndex };
  }

  const selectionPricing = priceSelections(entry.groups, line.selections ?? [], lineIndex);
  if (!selectionPricing.ok) {
    return selectionPricing;
  }

  const unitPrice = entry.unitPrice;
  // A non-integer price is a catalog fault, not customer input.
  if (unitPrice !== undefined && !Number.isInteger(unitPrice)) {
    return { ok: false, code: 'INTERNAL' };
  }

  const base = {
    menuItemId: line.menuItemId,
    name: entry.name,
    quantity: line.quantity,
    selections: selectionPricing.selections,
  };
  if (unitPrice === undefined) {
    return { ok: true, line: base, lineTotal: undefined };
  }

  const lineTotal = (unitPrice + selectionPricing.adjustment) * line.quantity;
  return { ok: true, line: { ...base, unitPrice, lineTotal }, lineTotal };
}

/**
 * The server subtotal (§6.2.5 step 6): `null` when any line is unpriced. A
 * partial sum is never returned.
 */
function resolveSubtotal(priceSum: number, anyUnpriced: boolean): number | null {
  return anyUnpriced ? null : priceSum;
}

function compareExpectedSubtotal(
  expectedSubtotal: number | null | undefined,
  subtotal: number | null
): BasketFailure | null {
  // An omitted `expectedSubtotal` is treated exactly like an explicit `null`:
  // the customer stated no total. §6.2.5 step 8 pins the explicit-`null` case
  // (a null client total against a priced server total is `PRICE_CHANGED`);
  // the omitted case is not specified by the spec and is resolved the same
  // way, so no order is committed against a total the customer never
  // confirmed. The S1 handler owns that wire-to-policy mapping.
  const expected = expectedSubtotal ?? null;
  if (expected === null) {
    if (subtotal === null) {
      return null;
    }
    return { ok: false, code: 'PRICE_CHANGED', actualSubtotal: subtotal };
  }
  if (subtotal === null) {
    return { ok: false, code: 'PRICE_UNAVAILABLE' };
  }
  if (expected !== subtotal) {
    return { ok: false, code: 'PRICE_CHANGED', actualSubtotal: subtotal };
  }
  return null;
}

/**
 * Prices the basket in integer cents. Availability is checked group-first,
 * then item, then selections, then price math — the §6.5 supply precedence.
 *
 * `validateBasket` must be called first: it enforces the §6.2.4 basket caps
 * (line count, total units, selections per line) that this function does
 * not. `priceBasket` covers availability, selection semantics, and price
 * math only.
 */
export function priceBasket(input: PriceBasketInput, catalog: Catalog): PriceBasketResult {
  // An empty basket is rejected here even though the line cap is
  // `validateBasket`'s job: pricing zero lines would otherwise succeed with
  // an empty `items[]` and a `subtotal` of 0 — a zero-value order that no
  // other gate would catch.
  if (input.lines.length === 0) {
    return { ok: false, code: 'BASKET_EMPTY' };
  }

  const items: PricedLine[] = [];
  let orderBusinessId: string | undefined;
  let subtotal = 0;
  let anyUnpriced = false;

  for (let lineIndex = 0; lineIndex < input.lines.length; lineIndex++) {
    const line = input.lines[lineIndex];
    const entry = catalog.get(line.menuItemId);
    if (entry === undefined) {
      return { ok: false, code: 'ITEM_UNAVAILABLE', lineIndex };
    }
    if (orderBusinessId === undefined) {
      orderBusinessId = entry.businessId;
    }

    const priced = priceLine(line, entry, lineIndex, orderBusinessId);
    if (!priced.ok) {
      return priced;
    }

    items.push(priced.line);
    if (priced.lineTotal === undefined) {
      anyUnpriced = true;
    } else {
      subtotal += priced.lineTotal;
    }
  }

  const actualSubtotal = resolveSubtotal(subtotal, anyUnpriced);
  if (actualSubtotal !== null && actualSubtotal > MAX_ORDER_VALUE) {
    return { ok: false, code: 'ORDER_VALUE_TOO_HIGH' };
  }

  const comparison = compareExpectedSubtotal(input.expectedSubtotal, actualSubtotal);
  if (comparison !== null) {
    return comparison;
  }

  return { ok: true, items, subtotal: actualSubtotal };
}

// ---------------------------------------------------------------------------
// Contact parsing and hashing (spec §6.2.4, plan D5)
//
// Async because hashing uses WebCrypto, the only digest available in both the
// Convex default runtime and Node. The hash covers normalized values only, so
// different renderings of one phone number produce one contact key.
// ---------------------------------------------------------------------------

export type ParsedContact = {
  customerName: string;
  phone?: string; // normalized display form, optional leading '+'
  phoneDigits?: string; // digits only, used for validation and hashing
  email?: string; // trimmed, lowercased
};

export type ParseContactResult =
  | { ok: true; contact: ParsedContact; contactHash: string }
  | { ok: false; code: 'CONTACT_INVALID' };

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function normalizeName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1 || name.length > MAX_NAME) {
    return null;
  }
  if (hasControlCharacter(name)) {
    return null;
  }
  return name;
}

function normalizePhone(
  raw: string
): { phone: string; phoneDigits: string } | null | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (hasControlCharacter(trimmed)) {
    return null;
  }

  const hasPlus = trimmed.startsWith('+');
  const withoutPlus = hasPlus ? trimmed.slice(1) : trimmed;
  const phoneDigits = withoutPlus.replace(/[ ().-]/g, '');
  if (phoneDigits.length === 0) {
    // A phone was supplied but holds no digits at all. §6.2.4 rejects
    // obviously incomplete numbers, so this is an invalid phone, not an absent
    // channel: dropping it would silently send the order by email alone and
    // leave the hashed-contact key covering a number the customer never
    // supplied. Empty or whitespace-only input returns `undefined` above.
    return null;
  }
  if (!/^[0-9]+$/.test(phoneDigits)) {
    return null;
  }
  if (phoneDigits.length < MIN_PHONE_DIGITS || phoneDigits.length > MAX_PHONE_DIGITS) {
    return null;
  }

  return { phone: `${hasPlus ? '+' : ''}${phoneDigits}`, phoneDigits };
}

function normalizeEmail(raw: string): string | null | undefined {
  const email = raw.trim().toLowerCase();
  if (email.length === 0) {
    return undefined;
  }
  if (hasControlCharacter(email)) {
    return null;
  }
  if (email.length > MAX_EMAIL || !EMAIL_SHAPE.test(email)) {
    return null;
  }
  return email;
}

/**
 * The contact *identity*: fixed key order, normalized values only, and no
 * customer name — never the raw input.
 *
 * Why the name is excluded (issue #81 research Q3): the name is required, but
 * it is free text the abuser controls, so a name-inclusive key lets a script
 * rename the customer between submissions and reset the per-contact throttle
 * (`contact:<businessId>:<hash>:10m|24h`) to zero. Nothing in the protocol asks
 * the name to participate — §6.6 L1378 hashes the *contact*, and the block hash
 * is explicitly phone/email (`schema.ts` L324).
 *
 * Residual, accepted in v1 and not solved here: adding or rotating a channel
 * changes the identity, so a newly added phone/email escapes a prior block
 * (protocol §6.6 L1375 — "This is residual, not solved"). Per-channel counters
 * would close it at two rows × two windows; instead the throttle keeps one
 * counter and the block list carries one hash per channel
 * (`contactChannelHashes`).
 */
function canonicalContact(contact: ParsedContact): string {
  return JSON.stringify({
    phoneDigits: contact.phoneDigits ?? '',
    email: contact.email ?? '',
  });
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Normalizes a contact and returns its stable identity hash — the name is
 * excluded, see `canonicalContact` — or CONTACT_INVALID when a field fails or
 * neither a phone nor an email survives normalization.
 */
export async function parseContact(input: {
  customerName: string;
  phone?: string;
  email?: string;
}): Promise<ParseContactResult> {
  const customerName = normalizeName(input.customerName);
  if (customerName === null) {
    return { ok: false, code: 'CONTACT_INVALID' };
  }

  const phone = normalizePhone(input.phone ?? '');
  if (phone === null) {
    return { ok: false, code: 'CONTACT_INVALID' };
  }

  const email = normalizeEmail(input.email ?? '');
  if (email === null) {
    return { ok: false, code: 'CONTACT_INVALID' };
  }

  if (phone === undefined && email === undefined) {
    return { ok: false, code: 'CONTACT_INVALID' };
  }

  const contact: ParsedContact = { customerName };
  if (phone !== undefined) {
    contact.phone = phone.phone;
    contact.phoneDigits = phone.phoneDigits;
  }
  if (email !== undefined) {
    contact.email = email;
  }

  const contactHash = await sha256Hex(canonicalContact(contact));
  return { ok: true, contact, contactHash };
}

/**
 * The block-list hashes for a parsed contact: one SHA-256 per *present*
 * channel, domain-separated by channel name.
 *
 * Takes the structural subset `Partial<ParsedContact>` rather than a full
 * `ParsedContact`: the owner block form has no customer name, so the name must
 * not be required here. A complete `ParsedContact` still satisfies it, and a
 * caller may pass the name (it is ignored — only the channel fields are read).
 * `Partial` rather than `Pick<..., 'phoneDigits' | 'email'>` because callers
 * that do include `customerName` in an object literal must keep compiling
 * (excess-property check, TS2353).
 *
 * The block list stores one row per channel (`schema.ts` L324 — "SHA-256 of
 * normalized phone/email"), so a block refuses when either the phone or the
 * email matches: "block blocks both phone and email hashes" (protocol S4
 * L1633). A phone-only contact yields exactly one hash and creates no email
 * row; an email-only contact yields one; a dual-channel contact yields two, in
 * the fixed order phone then email.
 *
 * The `phone:` / `email:` prefixes are load-bearing. Without them a digits
 * string and an email string holding the same characters would hash
 * identically, so a phone block could silently match an unrelated email. They
 * also keep these block keys distinct from the throttle identity hash above.
 */
export async function contactChannelHashes(contact: Partial<ParsedContact>): Promise<string[]> {
  const hashes: string[] = [];
  if (contact.phoneDigits !== undefined) {
    hashes.push(await sha256Hex(`phone:${contact.phoneDigits}`));
  }
  if (contact.email !== undefined) {
    hashes.push(await sha256Hex(`email:${contact.email}`));
  }
  return hashes;
}

/**
 * The block-list hashes for the *raw* phone/email an owner submits (issue #81,
 * T9 / §7.2 S4 L1625–1637; key shape §6.2.2 L1009).
 *
 * The owner block form has no customer name, so normalization and the
 * domain-separated `phone:` / `email:` hashing happen here, in the one module
 * that already owns `normalizePhone` / `normalizeEmail` / `contactChannelHashes`
 * — `orderBlocks.ts` must never re-implement either step, or a second spelling
 * of the hash could drift from the check `assertContactNotBlocked` performs.
 *
 * Returns `null` when a supplied channel is invalid (the catalog's
 * `CONTACT_INVALID` case) or when neither channel is present. Empty / whitespace
 * input counts as absent: the same rule the commit form applies.
 */
export async function contactChannelHashesFromInput(input: {
  phone?: string;
  email?: string;
}): Promise<string[] | null> {
  const phone = normalizePhone(input.phone ?? '');
  if (phone === null) {
    return null;
  }

  const email = normalizeEmail(input.email ?? '');
  if (email === null) {
    return null;
  }

  if (phone === undefined && email === undefined) {
    return null;
  }

  const channels: Partial<ParsedContact> = {};
  if (phone !== undefined) {
    channels.phoneDigits = phone.phoneDigits;
  }
  if (email !== undefined) {
    channels.email = email;
  }
  return contactChannelHashes(channels);
}

// ---------------------------------------------------------------------------
// Canonical args hash (spec §6.2.5, plan D5)
//
// The idempotency key is compared by hashing the arguments it was first used
// with: the same key with different arguments is `IDEMPOTENCY_CONFLICT`. The
// canonical form below is module-private — it is pinned by the tests in
// `scripts/order-commit-policy.test.ts`, not by an external standard.
//
// Rules:
//   (a) recursive key-sorted JSON, no whitespace;
//   (b) basket lines sorted by (menuItemId, canonical selections string), with
//       the quantity as a final tiebreaker so two lines that differ only in
//       quantity still hash the same in either order;
//   (c) per-line selections sorted by (optionName, choiceName);
//   (d) the contact enters NORMALIZED (name trimmed, phone reduced to digits,
//       email lowercased) — never the raw input;
//   (e) the note enters trimmed;
//   (f) `businessId` and the client `idempotencyKey` enter as-is;
//   (g) no price is ever read — the server prices the basket from the catalog.
// ---------------------------------------------------------------------------

export type CanonicalArgsInput = {
  businessId: string;
  lines: readonly BasketLineInput[];
  contact: {
    customerName: string;
    phone?: string;
    email?: string;
  };
  note?: string;
  idempotencyKey: string;
};

type CanonicalSelection = { choiceName: string; optionName: string };

type CanonicalLine = {
  menuItemId: string;
  quantity: number;
  selections: CanonicalSelection[];
};

type CanonicalContact = { email: string; name: string; phoneDigits: string };

type CanonicalArgs = {
  businessId: string;
  contact: CanonicalContact;
  idempotencyKey: string;
  lines: CanonicalLine[];
  note: string;
};

/**
 * Recursive key-sorted JSON with no whitespace. The sort fixes the key order,
 * so two objects that differ only in key order serialize identically.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${parts.join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
}

function compareSelections(left: CanonicalSelection, right: CanonicalSelection): number {
  if (left.optionName !== right.optionName) {
    return left.optionName < right.optionName ? -1 : 1;
  }
  if (left.choiceName !== right.choiceName) {
    return left.choiceName < right.choiceName ? -1 : 1;
  }
  return 0;
}

function canonicalLine(line: BasketLineInput): CanonicalLine {
  const sourceSelections: readonly OrderSelection[] = line.selections ?? [];
  const selections = sourceSelections
    .map((selection) => ({
      choiceName: selection.choiceName,
      optionName: selection.optionName,
    }))
    .sort(compareSelections);
  return { menuItemId: line.menuItemId, quantity: line.quantity, selections };
}

function compareLines(left: CanonicalLine, right: CanonicalLine): number {
  if (left.menuItemId !== right.menuItemId) {
    return left.menuItemId < right.menuItemId ? -1 : 1;
  }
  const leftSelections = canonicalJson(left.selections);
  const rightSelections = canonicalJson(right.selections);
  if (leftSelections !== rightSelections) {
    return leftSelections < rightSelections ? -1 : 1;
  }
  // Final tiebreaker: two lines that differ only in quantity must not depend
  // on the order they arrived in.
  return left.quantity - right.quantity;
}

/**
 * Hashes the canonical form of one order attempt. The same arguments always
 * hash the same, and permutations of key, line, and selection order do not
 * change the hash. Throws when the contact is invalid — the caller validates
 * the contact before hashing it.
 */
export async function canonicalArgsHash(args: CanonicalArgsInput): Promise<string> {
  const parsed = await parseContact(args.contact);
  if (!parsed.ok) {
    throw new Error('canonicalArgsHash requires a valid contact');
  }

  const canonical: CanonicalArgs = {
    businessId: args.businessId,
    contact: {
      email: parsed.contact.email ?? '',
      name: parsed.contact.customerName,
      phoneDigits: parsed.contact.phoneDigits ?? '',
    },
    idempotencyKey: args.idempotencyKey,
    lines: args.lines.map(canonicalLine).sort(compareLines),
    note: (args.note ?? '').trim(),
  };

  return sha256Hex(canonicalJson(canonical));
}

// ---------------------------------------------------------------------------
// Reference minting (spec §6.2.6, plan D2)
//
// Canonical port of `convex/orderAccess.ts`. The DB-adjacent copy stays where
// it is until S1 collapses it onto this one.
//
// The random characters come from `crypto.getRandomValues`. This module makes
// no claim about the provenance or the seeding of those bytes — the runtime's
// RNG story is not verifiable from here (docs/alignment/issue-76.md findings
// 18 and 29).
// ---------------------------------------------------------------------------

export const REFERENCE_COLLISION_RETRIES = 5;

/**
 * `length` characters drawn from the §6.2.4 alphabet. 256 is a multiple of
 * the 32-character alphabet, so the modulo is unbiased.
 */
export function randomReference(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);

  let reference = '';
  for (const byte of bytes) {
    reference += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  }
  return reference;
}

/**
 * Mints a reference that is absent from `existing`. Six characters first; after
 * `REFERENCE_COLLISION_RETRIES` collisions, seven characters. Throws after a
 * bounded number of attempts rather than looping forever.
 *
 * `random` is the injection point for the random characters; the default reads
 * them from `crypto.getRandomValues`.
 */
export function createReference(
  existing: ReadonlySet<string>,
  random: (length: number) => string = randomReference
): string {
  for (let attempt = 0; attempt <= REFERENCE_COLLISION_RETRIES; attempt += 1) {
    const candidate = random(REFERENCE_LENGTH);
    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  for (let attempt = 0; attempt <= REFERENCE_COLLISION_RETRIES; attempt += 1) {
    const candidate = random(REFERENCE_LENGTH + 1);
    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  throw new Error('Could not mint a unique order reference');
}

// ---------------------------------------------------------------------------
// Effective-open predicate (spec §6.5, L1231–L1240)
//
// The predicate is implemented as the spec writes it: approved, not paused, the
// `until` deadline not reached, and — only when hours are configured — open in
// the business's own timezone. `now` is an argument; this module never reads a
// clock.
//
// The hours gate is skipped when no day carries an opening period: an empty
// hours object means "no hours configured", which is open. That is the
// opposite of the raw `openStatusAt({}, clock)`, which reports closed.
// ---------------------------------------------------------------------------

export type EffectiveOpenBusiness = {
  status: string;
  acceptingOrders?: boolean;
  acceptingOrdersUntil?: number;
  hours: BusinessHours;
  /**
   * The business's IANA time-zone id, and a precondition: it must be a valid
   * identifier. `Intl.DateTimeFormat` raises a `RangeError` for an unknown
   * zone and this module does not swallow it — the hours gate is only
   * reached for an approved, unpaused business with configured hours.
   * `businesses.timezone` is written at creation and never patched, so the
   * stored value is server-controlled and valid today; an owner-editable
   * zone must be validated at write time before it can reach this predicate.
   */
  timezone: string;
};

/** The seven day keys of `BusinessHours`; a day is absent when it is closed. */
const HOURS_DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const satisfies readonly (keyof BusinessHours)[];

/** Hours are configured when any day carries at least one opening period. */
function hasAnyOpeningPeriod(hours: BusinessHours): boolean {
  for (const day of HOURS_DAY_KEYS) {
    if ((hours[day] ?? []).length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * The §6.5 effective-open predicate. A business is open when it is approved,
 * not paused, its `acceptingOrdersUntil` deadline has not been reached, and —
 * when hours are configured — its own timezone says it is open.
 */
export function isEffectiveOpen(business: EffectiveOpenBusiness, now: number): boolean {
  const configuredHours = hasAnyOpeningPeriod(business.hours);
  return (
    business.status === 'approved' &&
    (business.acceptingOrders ?? true) &&
    (business.acceptingOrdersUntil === undefined || now < business.acceptingOrdersUntil) &&
    (configuredHours
      ? openStatusAt(
          business.hours,
          businessClock(createBusinessFormatter(business.timezone), now)
        ).isOpen
      : true)
  );
}

// ---------------------------------------------------------------------------
// Effective-open reason split (issue #78, T4 D2)
//
// `isEffectiveOpen` answers yes/no; the S1 handler must also know *why* a
// business is closed to choose between `ORDERING_CLOSED` (`accepting_off`,
// `until_passed`) and `OUTSIDE_HOURS`. The splitter mirrors the predicate's
// `&&` order exactly — approved, not paused, `until` not reached, hours — so
// the two can never disagree. The first failing gate wins.
// ---------------------------------------------------------------------------

/** The four closed/open reasons the S1 handler maps to error codes (D2). */
export type EffectiveOpenReason = 'open' | 'accepting_off' | 'until_passed' | 'outside_hours';

/**
 * Explains the §6.5 effective-open predicate: `'open'` exactly when
 * `isEffectiveOpen(business, now)` is true, otherwise the first failing gate
 * in that predicate's own order.
 *
 * Precedence (documented and test-pinned): a pause (`accepting_off`) beats the
 * `until` deadline (`until_passed`), which beats hours (`outside_hours`). When
 * several gates fail at once, the earliest one in that list is reported.
 *
 * Precondition: the caller has already rejected `status !== 'approved'` — the
 * S1 handler's `BUSINESS_UNAVAILABLE` guard runs first (D6). Unapproved input
 * still returns a deterministic non-`'open'` reason (`'accepting_off'`) rather
 * than adding a fifth union member, so the equivalence
 * `isEffectiveOpen(...) === (effectiveOpenReason(...) === 'open')` holds for
 * every input. The handler never observes that branch, so it cannot misroute
 * `ORDERING_CLOSED` versus `OUTSIDE_HOURS`.
 */
export function effectiveOpenReason(
  business: EffectiveOpenBusiness,
  now: number
): EffectiveOpenReason {
  if (business.status !== 'approved') {
    return 'accepting_off';
  }
  if (!(business.acceptingOrders ?? true)) {
    return 'accepting_off';
  }
  if (business.acceptingOrdersUntil !== undefined && now >= business.acceptingOrdersUntil) {
    return 'until_passed';
  }
  if (hasAnyOpeningPeriod(business.hours)) {
    const status = openStatusAt(
      business.hours,
      businessClock(createBusinessFormatter(business.timezone), now)
    );
    if (!status.isOpen) {
      return 'outside_hours';
    }
  }
  return 'open';
}

// ---------------------------------------------------------------------------
// Contact masking (spec §6.2.6 L1093: `***-0100`, `a***@example.com`)
//
// The receipt projection masks contact; the owner board keeps the full values.
// `parseContact` already normalized the input (digits-only phone with an
// optional leading `+`, trimmed lowercased email), but these rules are total:
// they never throw and never echo the raw value.
// ---------------------------------------------------------------------------

/** Masked contact: the input's optional keys, each masked; `{}` when absent. */
export type MaskedContact = {
  phone?: string;
  email?: string;
};

/** `***-0100` for a value carrying four or more digits; `***` otherwise. */
function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `***-${digits.slice(-4)}` : '***';
}

/** `a***@example.com` for `local@domain`; `***` for anything else. */
function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (at > 0 && local.length > 0 && domain.length > 0) {
    return `${local.charAt(0)}***@${domain}`;
  }
  return '***';
}

/**
 * Masks the normalized contact for the §6.2.6 receipt. Keys that are
 * `undefined` are omitted; `{}` comes back when neither is present.
 *
 * - phone: non-digits stripped; four or more digits keep the last four
 *   (`***-0100`); fewer digits mask to `***`.
 * - email: a non-empty local part and domain around the first `@` keep the
 *   local's first character (`a***@example.com`); anything else masks to `***`.
 *
 * An empty string is a defined value, so it is masked (`***`), not omitted.
 */
export function maskContact(contact: { phone?: string; email?: string }): MaskedContact {
  const masked: MaskedContact = {};
  if (contact.phone !== undefined) {
    masked.phone = maskPhone(contact.phone);
  }
  if (contact.email !== undefined) {
    masked.email = maskEmail(contact.email);
  }
  return masked;
}

// ---------------------------------------------------------------------------
// Transition reason policy (protocol §6.1 L846/L851/L853) — added by T5.
//
// The handler owns the throw; this section owns the vocabulary. Reasons are
// trimmed before they are measured, so padding never pushes a valid reason
// over the limit and a whitespace-only reason counts as blank.
// ---------------------------------------------------------------------------

export const MAX_TRANSITION_REASON_LENGTH = 200;

export type TransitionReasonStatus = 'ok' | 'missing' | 'too_long';

/**
 * Validates a transition reason against §6.1's 200-character limit.
 *
 * The reason is trimmed first: padding never pushes a valid reason over the
 * limit. Blank (missing or whitespace-only) is `'missing'` when required and
 * `'ok'` when optional; otherwise a trimmed length over 200 is `'too_long'`.
 */
export function validateTransitionReason(
  reason: string | undefined,
  required: boolean
): TransitionReasonStatus {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    return required ? 'missing' : 'ok';
  }
  return trimmed.length > MAX_TRANSITION_REASON_LENGTH ? 'too_long' : 'ok';
}

/** Default reason applied at write time when a `noShow` carries none (§6.1 L851). */
export const DEFAULT_NO_SHOW_REASON = 'Not picked up';

/** Reason stamped on a visitor's `cancelOrder` (§6.1 L846). */
export const VISITOR_CANCEL_REASON = 'Cancelled by customer';

/**
 * Reason stamped when the expiry sweep closes a `new` order (§6.1 L853). The
 * "60 minutes" here is the human form of `DEFAULT_TTL_MS` (3_600_000 ms) above;
 * change both together.
 */
export const EXPIRE_REASON = 'Not accepted within 60 minutes';
