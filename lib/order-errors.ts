// Customer-facing error mapping for the basket and receipt surfaces
// (protocol §6.5). The map is the only source of user-visible error copy: a
// Convex `message` field, a framework error, or an unknown code never reaches
// the DOM. Callers switch on `code` for the recovery behavior and render
// `copy` + `recoveryAction`.

import { ConvexError } from 'convex/values';

import type { OrderErrorCode } from '@/convex/orderCommitPolicy';

/** Stable recovery kinds the panels can switch on. */
export type OrderErrorRecovery =
  | 'back-to-directory'
  | 'call'
  | 'refresh-menu'
  | 'add-item'
  | 'fix-quantity'
  | 're-select'
  | 'fix-contact'
  | 'shorten'
  | 'reconfirm'
  | 'retry'
  | 'reorder'
  | 'refresh'
  | 'wait'
  | 'none';

export type OrderErrorCopy = {
  /** §6.5 customer message; `{phone}` / `{item}` / `{n}` are substituted. */
  copy: string;
  /** The §6.5 recovery column, shown beside the copy. */
  recoveryAction: string;
  recovery: OrderErrorRecovery;
};

/**
 * §6.5 table, code for code. The copy is copied verbatim (the table's own
 * heading is "Customer message (exact)"); placeholders are filled by
 * `resolveOrderError` from server data, never from raw error text.
 */
export const ORDER_ERROR_COPY: Record<OrderErrorCode, OrderErrorCopy> = {
  BUSINESS_UNAVAILABLE: {
    copy: "This business isn't available right now.",
    recoveryAction: 'Back to directory',
    recovery: 'back-to-directory',
  },
  MENU_UNAVAILABLE: {
    copy: "This business hasn't published a menu yet.",
    recoveryAction: 'Call the business',
    recovery: 'call',
  },
  MENU_EMPTY: {
    copy: "There's nothing available to order right now.",
    recoveryAction: 'Call the business',
    recovery: 'call',
  },
  ORDERING_CLOSED: {
    copy: "This business isn't accepting orders right now. Call {phone}.",
    recoveryAction: 'Call; retry later',
    recovery: 'call',
  },
  OUTSIDE_HOURS: {
    copy: 'This business is closed right now. Call {phone} or check its hours.',
    recoveryAction: 'Call; retry when open',
    recovery: 'call',
  },
  GROUP_UNAVAILABLE: {
    copy: 'One of the menu sections you picked is unavailable. Refresh the menu.',
    recoveryAction: 'Refresh; remove section',
    recovery: 'refresh-menu',
  },
  ITEM_UNAVAILABLE: {
    copy: 'One of the items you picked is sold out. Refresh the menu.',
    recoveryAction: 'Refresh; remove line',
    recovery: 'refresh-menu',
  },
  BASKET_EMPTY: {
    copy: 'Add at least one item before sending your order.',
    recoveryAction: 'Add item',
    recovery: 'add-item',
  },
  BASKET_TOO_LARGE: {
    copy: 'This order is too large to send here. Call the business.',
    recoveryAction: 'Call',
    recovery: 'call',
  },
  QUANTITY_INVALID: {
    copy: 'Choose a quantity between 1 and 20.',
    recoveryAction: 'Fix quantity',
    recovery: 'fix-quantity',
  },
  SELECTION_INVALID: {
    copy: 'Check the options for {item}; one is missing or no longer available.',
    recoveryAction: 'Re-select',
    recovery: 're-select',
  },
  CONTACT_INVALID: {
    copy: 'Add a name and a phone or email so the business can reach you.',
    recoveryAction: 'Fix contact',
    recovery: 'fix-contact',
  },
  NOTE_TOO_LONG: {
    copy: 'Keep the note under 500 characters.',
    recoveryAction: 'Shorten',
    recovery: 'shorten',
  },
  PRICE_CHANGED: {
    copy: 'Prices changed while you were ordering. Review the new total and send again.',
    recoveryAction: 'Show old/new; re-confirm',
    recovery: 'reconfirm',
  },
  PRICE_UNAVAILABLE: {
    copy: 'One item has no price listed. Confirm the total with the business.',
    recoveryAction: 'Call / remove',
    recovery: 'call',
  },
  ORDER_VALUE_TOO_HIGH: {
    copy: 'This order is too large to send online. Call the business.',
    recoveryAction: 'Call',
    recovery: 'call',
  },
  IDEMPOTENCY_CONFLICT: {
    copy: 'This order was already sent with different details. Refresh your order.',
    recoveryAction: 'Refresh',
    recovery: 'refresh',
  },
  TOO_MANY_REQUESTS: {
    copy: 'Too many order attempts. Try again in {n} minutes or call the business.',
    recoveryAction: 'Wait / call',
    recovery: 'wait',
  },
  ORDER_NOT_ACCEPTED: {
    copy: "We can't accept this order online. Please call the business.",
    recoveryAction: 'Call',
    recovery: 'call',
  },
  ORDER_NOT_FOUND: {
    copy: "We couldn't find that order. Check the link or call the business.",
    recoveryAction: 'Call',
    recovery: 'call',
  },
  ORDER_EXPIRED: {
    copy: 'This order expired before it was accepted. Place a new order.',
    recoveryAction: 'Re-order',
    recovery: 'reorder',
  },
  CANNOT_CANCEL: {
    copy: 'This order can no longer be cancelled online. Call the business.',
    recoveryAction: 'Call',
    recovery: 'call',
  },
  INVALID_TRANSITION: {
    copy: "That action isn't available for this order anymore. Refresh.",
    recoveryAction: 'Refresh',
    recovery: 'refresh',
  },
  ORDER_TERMINAL: {
    copy: 'This order is already closed.',
    recoveryAction: 'No action needed; place a new order if the customer wants to reorder.',
    recovery: 'none',
  },
  ORDER_ALREADY_DECIDED: {
    copy: 'Someone already updated this order. Refresh the board.',
    recoveryAction: 'Refresh',
    recovery: 'refresh',
  },
  REASON_REQUIRED: {
    copy: 'Add a short reason before continuing.',
    recoveryAction: 'Add reason',
    recovery: 'none',
  },
  FORBIDDEN: {
    copy: "You don't have access to this order.",
    recoveryAction: 'Sign in / contact support',
    recovery: 'none',
  },
  UNAUTHORIZED: {
    copy: "You don't have access to this order.",
    recoveryAction: 'Sign in / contact support',
    recovery: 'none',
  },
  INTERNAL: {
    copy: 'Something went wrong. Try again or call the business.',
    recoveryAction: 'Retry',
    recovery: 'retry',
  },
};

/** §6.7 "Network error": the mutation/query never reached the server. */
export const NETWORK_ERROR: OrderErrorCopy = {
  copy: "We couldn't send your order. Check your connection and try again.",
  recoveryAction: 'Retry',
  recovery: 'retry',
};

const ORDER_ERROR_CODE_SET: ReadonlySet<string> = new Set(Object.keys(ORDER_ERROR_COPY));

export function isOrderErrorCode(value: string): value is OrderErrorCode {
  return ORDER_ERROR_CODE_SET.has(value);
}

export type ResolvedOrderError = {
  /** `NETWORK` is client-only and never sent by Convex. */
  code: OrderErrorCode | 'NETWORK';
  copy: string;
  recoveryAction: string;
  recovery: OrderErrorRecovery;
  /** `PRICE_CHANGED` only: the server's recomputed total, integer cents. */
  actualSubtotal?: number;
  /** Supply errors only: the submitted line the server rejected. */
  lineIndex?: number;
  /** `TOO_MANY_REQUESTS` only: the throttle's remaining wait. */
  retryAfterMs?: number;
};

export type OrderErrorContext = {
  /** Business phone for the §6.5 `{phone}` placeholder. */
  phone?: string;
  /** Item name for the `SELECTION_INVALID` `{item}` placeholder. */
  itemName?: string;
};

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function interpolate(copy: string, context: OrderErrorContext, retryAfterMs?: number): string {
  const phone = context.phone?.trim();
  const item = context.itemName?.trim();
  const minutes =
    retryAfterMs === undefined ? 'a few' : String(Math.max(1, Math.ceil(retryAfterMs / 60_000)));

  return copy
    .replaceAll('{phone}', phone === undefined || phone.length === 0 ? 'the business' : phone)
    .replaceAll('{item}', item === undefined || item.length === 0 ? 'this item' : item)
    .replaceAll('{n}', minutes);
}

function resolved(
  code: OrderErrorCode | 'NETWORK',
  context: OrderErrorContext,
  extras: { actualSubtotal?: number; lineIndex?: number; retryAfterMs?: number }
): ResolvedOrderError {
  const entry = code === 'NETWORK' ? NETWORK_ERROR : ORDER_ERROR_COPY[code];
  return {
    code,
    copy: interpolate(entry.copy, context, extras.retryAfterMs),
    recoveryAction: entry.recoveryAction,
    recovery: entry.recovery,
    ...(extras.actualSubtotal === undefined ? {} : { actualSubtotal: extras.actualSubtotal }),
    ...(extras.lineIndex === undefined ? {} : { lineIndex: extras.lineIndex }),
    ...(extras.retryAfterMs === undefined ? {} : { retryAfterMs: extras.retryAfterMs }),
  };
}

/**
 * Reads the §6.5 object envelope `{ code, message?, actualSubtotal?, lineIndex?,
 * retryAfterMs? }`. A string payload (the legacy `submitOrder` form), an
 * unknown code, a non-Convex error, and a malformed object all resolve to a
 * mapped code — `error.message` and `data.message` are never read.
 */
export function resolveOrderError(
  error: unknown,
  context: OrderErrorContext = {}
): ResolvedOrderError {
  if (!(error instanceof ConvexError)) {
    return resolved('NETWORK', context, {});
  }
  if (!isRecord(error.data)) {
    // The legacy string envelope carries raw server text; keep it mapped.
    return resolved('INTERNAL', context, {});
  }

  const candidate = error.data.code;
  if (typeof candidate !== 'string' || !isOrderErrorCode(candidate)) {
    return resolved('INTERNAL', context, {});
  }

  return resolved(candidate, context, {
    actualSubtotal: numeric(error.data.actualSubtotal),
    lineIndex: numeric(error.data.lineIndex),
    retryAfterMs: numeric(error.data.retryAfterMs),
  });
}
