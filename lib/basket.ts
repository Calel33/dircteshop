// Basket state for the public ordering panel (protocol §6.7 interaction
// rules). Pure module: a reducer plus the versioned localStorage codec. No
// React and no Convex runtime imports, so the caps, arithmetic, and storage
// behavior are unit-testable with `node --test`.
//
// Rules held here:
//   - one basket per business, addressed by `lc:basket:<businessId>:v1`;
//   - line and unit caps mirror the server's §6.2.4 constants;
//   - the persisted payload carries line snapshots and the idempotency key
//     only — never the customer's name, phone, email, or note.

import type { OrderSelection } from '@/convex/orderPolicy';

/** Mirrors `MAX_LINES` in `convex/orderCommitPolicy.ts`. */
export const MAX_BASKET_LINES = 20;
/** Mirrors `MAX_QUANTITY_PER_LINE` in `convex/orderCommitPolicy.ts`. */
export const MAX_LINE_QUANTITY = 20;
/** Mirrors `MAX_TOTAL_UNITS` in `convex/orderCommitPolicy.ts`. */
export const MAX_BASKET_UNITS = 100;
export const BASKET_STORAGE_VERSION = 1;

/** One composed line: the menu item plus this line's own customization. */
export type BasketLine = {
  /** Client-only id; the server never sees it. */
  id: string;
  menuItemId: string;
  name: string;
  /**
   * Base price plus this line's selection adjustments, integer cents. Absent
   * when the menu item has no listed price → the basket total is null.
   */
  unitTotal?: number;
  quantity: number;
  selections: OrderSelection[];
};

export type BasketState = {
  lines: readonly BasketLine[];
  /** True when the first load found a basket in localStorage (§6.7 copy). */
  restored: boolean;
  /** Lines the server rejected as ITEM_UNAVAILABLE / GROUP_UNAVAILABLE. */
  unavailableLineIds: readonly string[];
};

export const EMPTY_BASKET: BasketState = {
  lines: [],
  restored: false,
  unavailableLineIds: [],
};

export type BasketAction =
  | { type: 'hydrate'; lines: readonly BasketLine[] }
  | { type: 'add'; line: BasketLine }
  | { type: 'setQuantity'; lineId: string; quantity: number }
  | { type: 'remove'; lineId: string }
  | { type: 'clear' }
  | { type: 'dismissRestored' }
  | { type: 'markUnavailable'; lineIds: readonly string[] };

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}

export function basketTotalUnits(lines: readonly BasketLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * Client subtotal in integer cents, or null when any line is unpriced. The
 * submitted `expectedSubtotal` comes from here; the server compares it and
 * answers `PRICE_CHANGED` rather than silently charging a new total.
 */
export function basketSubtotal(lines: readonly BasketLine[]): number | null {
  let total = 0;
  for (const line of lines) {
    if (line.unitTotal === undefined) {
      return null;
    }
    total += line.unitTotal * line.quantity;
  }
  return total;
}

function withLines(state: BasketState, lines: readonly BasketLine[]): BasketState {
  const survivingIds = new Set(lines.map((line) => line.id));
  return {
    ...state,
    lines,
    unavailableLineIds: state.unavailableLineIds.filter((id) => survivingIds.has(id)),
  };
}

/** Hydrates from storage while re-applying the caps to untrusted data. */
function hydrate(lines: readonly BasketLine[]): BasketState {
  const accepted: BasketLine[] = [];
  let units = 0;

  for (const line of lines) {
    if (accepted.length >= MAX_BASKET_LINES) {
      break;
    }
    const quantity = clampInteger(line.quantity, 1, MAX_LINE_QUANTITY);
    if (units + quantity > MAX_BASKET_UNITS) {
      break;
    }
    accepted.push({ ...line, quantity });
    units += quantity;
  }

  return { lines: accepted, restored: accepted.length > 0, unavailableLineIds: [] };
}

export function basketReducer(state: BasketState, action: BasketAction): BasketState {
  switch (action.type) {
    case 'hydrate':
      return hydrate(action.lines);

    case 'add': {
      if (state.lines.length >= MAX_BASKET_LINES) {
        return state;
      }
      const remainingUnits = MAX_BASKET_UNITS - basketTotalUnits(state.lines);
      if (remainingUnits < 1) {
        return state;
      }
      const quantity = clampInteger(
        action.line.quantity,
        1,
        Math.min(MAX_LINE_QUANTITY, remainingUnits)
      );
      const line: BasketLine = { ...action.line, quantity };
      return withLines(state, [...state.lines, line]);
    }

    case 'setQuantity': {
      const line = state.lines.find((candidate) => candidate.id === action.lineId);
      if (line === undefined) {
        return state;
      }
      const otherUnits = basketTotalUnits(state.lines) - line.quantity;
      const maxForLine = Math.min(MAX_LINE_QUANTITY, MAX_BASKET_UNITS - otherUnits);
      if (maxForLine < 1) {
        return state;
      }
      const quantity = clampInteger(action.quantity, 1, maxForLine);
      if (quantity === line.quantity) {
        return state;
      }
      return withLines(
        state,
        state.lines.map((candidate) =>
          candidate.id === action.lineId ? { ...candidate, quantity } : candidate
        )
      );
    }

    case 'remove':
      return withLines(
        state,
        state.lines.filter((line) => line.id !== action.lineId)
      );

    case 'clear':
      return EMPTY_BASKET;

    case 'dismissRestored':
      return state.restored ? { ...state, restored: false } : state;

    case 'markUnavailable': {
      const knownIds = new Set(state.lines.map((line) => line.id));
      const marked = action.lineIds.filter((id) => knownIds.has(id));
      if (marked.length === 0) {
        return state;
      }
      return {
        ...state,
        unavailableLineIds: [...new Set([...state.unavailableLineIds, ...marked])],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence: `lc:basket:<businessId>:v1`
// ---------------------------------------------------------------------------

/** The slice of the Storage API this module needs (a fake serves tests). */
export type BasketStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type StoredBasket = {
  lines: BasketLine[];
  submitKey: string | null;
};

type StoredLineV1 = {
  id: string;
  menuItemId: string;
  name: string;
  unitTotal?: number;
  quantity: number;
  selections: OrderSelection[];
};

type StoredBasketV1 = {
  v: typeof BASKET_STORAGE_VERSION;
  lines: StoredLineV1[];
  submitKey: string;
};

export function basketStorageKey(businessId: string): string {
  return `lc:basket:${businessId}:v1`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseLine(value: unknown): BasketLine | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!nonEmptyString(value.id) || !nonEmptyString(value.menuItemId) || !nonEmptyString(value.name)) {
    return null;
  }
  if (typeof value.quantity !== 'number' || !Number.isInteger(value.quantity)) {
    return null;
  }
  if (value.quantity < 1 || value.quantity > MAX_LINE_QUANTITY) {
    return null;
  }
  if (
    value.unitTotal !== undefined &&
    (typeof value.unitTotal !== 'number' ||
      !Number.isInteger(value.unitTotal) ||
      value.unitTotal < 0)
  ) {
    return null;
  }
  if (!Array.isArray(value.selections) || value.selections.length > 32) {
    return null;
  }
  const selections: OrderSelection[] = [];
  for (const selection of value.selections) {
    if (
      !isRecord(selection) ||
      !nonEmptyString(selection.optionName) ||
      !nonEmptyString(selection.choiceName)
    ) {
      return null;
    }
    selections.push({
      optionName: selection.optionName,
      choiceName: selection.choiceName,
    });
  }

  return {
    id: value.id,
    menuItemId: value.menuItemId,
    name: value.name,
    ...(value.unitTotal === undefined ? {} : { unitTotal: value.unitTotal }),
    quantity: value.quantity,
    selections,
  };
}

/**
 * Parses a persisted payload. A version mismatch, malformed JSON, or a payload
 * with no valid line is `null` — the caller starts an empty basket rather than
 * repairing untrusted data into an order.
 */
export function parseStoredBasket(raw: string | null): StoredBasket | null {
  if (raw === null) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    !isRecord(payload) ||
    payload.v !== BASKET_STORAGE_VERSION ||
    !Array.isArray(payload.lines)
  ) {
    return null;
  }

  const lines: BasketLine[] = [];
  let units = 0;
  for (const candidate of payload.lines) {
    if (lines.length >= MAX_BASKET_LINES) {
      break;
    }
    const line = parseLine(candidate);
    if (line === null) {
      continue;
    }
    if (units + line.quantity > MAX_BASKET_UNITS) {
      continue;
    }
    lines.push(line);
    units += line.quantity;
  }

  if (lines.length === 0) {
    return null;
  }

  return {
    lines,
    submitKey: nonEmptyString(payload.submitKey) ? payload.submitKey : null,
  };
}

export function loadBasket(
  storage: BasketStorage | null,
  businessId: string
): StoredBasket | null {
  if (storage === null) {
    return null;
  }
  try {
    return parseStoredBasket(storage.getItem(basketStorageKey(businessId)));
  } catch {
    // Storage can throw (private mode / disabled cookies): memory-only.
    return null;
  }
}

export function saveBasket(
  storage: BasketStorage | null,
  businessId: string,
  lines: readonly BasketLine[],
  submitKey: string
): void {
  if (storage === null) {
    return;
  }
  const payload: StoredBasketV1 = {
    v: BASKET_STORAGE_VERSION,
    lines: lines.map((line) => ({
      id: line.id,
      menuItemId: line.menuItemId,
      name: line.name,
      ...(line.unitTotal === undefined ? {} : { unitTotal: line.unitTotal }),
      quantity: line.quantity,
      selections: line.selections,
    })),
    submitKey,
  };
  try {
    storage.setItem(basketStorageKey(businessId), JSON.stringify(payload));
  } catch {
    // Memory-only fallback: the order is still sendable.
  }
}

export function clearStoredBasket(storage: BasketStorage | null, businessId: string): void {
  if (storage === null) {
    return;
  }
  try {
    storage.removeItem(basketStorageKey(businessId));
  } catch {
    // Nothing to recover; the in-memory basket is cleared by the reducer.
  }
}

/** `window.localStorage`, or null when the browser refuses/omits it. */
export function browserStorage(): BasketStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Line ids and the idempotency key share this collision-resistant format. */
export function createClientId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `lc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
