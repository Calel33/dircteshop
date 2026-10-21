// B8 (issue #8) order policy: the forward-only status machine and the
// server-side validation for the anonymous order form. Pure module — no runtime
// imports (not even generated ones), so `node --test` can import it directly,
// like `businesses/helpers.ts` and `businesses/photoPolicy.ts`.
//
// Selector semantics mirror what the schema can express: `customizationOptions`
// has only `required` (no multiSelect), and the accepted prototype maps
// required → single-select (exactly one choice) and optional → multi-select
// (zero or more). Unknown, duplicate, and out-of-list selections are rejected
// before any write, because `submitOrder` is a public anonymous surface.

export const ORDER_STATUSES = ['new', 'accepted', 'ready', 'completed'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Every status the expanded `orders.status` column accepts (protocol §6.2.2).
 * The transition matrix below stays the 4-state legacy machine until T3 adds
 * the actions that reach the new states.
 */
export const ORDER_DB_STATUSES = [
  'new',
  'accepted',
  'ready',
  'completed',
  'declined',
  'cancelled',
  'expired',
  'no_show',
] as const;

/** Narrows a stored status to the legacy transition machine's vocabulary. */
export function isLegacyOrderStatus(status: string): status is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(status);
}

export const ORDER_ACTIONS = ['accept', 'ready', 'complete'] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

/** The status each owner action advances to. A client never sends a status. */
export const ORDER_ACTION_TARGET: Record<OrderAction, OrderStatus> = {
  accept: 'accepted',
  ready: 'ready',
  complete: 'completed',
};

/** Forward-only chain; `completed` is terminal. */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus | null> = {
  new: 'accepted',
  accepted: 'ready',
  ready: 'completed',
  completed: null,
};

/** The status reached by `action` from `status`, or `null` when illegal. */
export function nextOrderStatus(status: OrderStatus, action: OrderAction): OrderStatus | null {
  const target = ORDER_ACTION_TARGET[action];
  return ORDER_STATUS_TRANSITIONS[status] === target ? target : null;
}

export type OrderSelection = { optionName: string; choiceName: string };

export type OrderCustomizationGroup = {
  name: string;
  required: boolean;
  options: { name: string; priceAdjustment?: number }[];
};

/**
 * Validates one selection against its group and records the selection count.
 * Returns the user-facing error, or `null` after recording a valid selection.
 */
function validateOneSelection(
  groupByName: ReadonlyMap<string, OrderCustomizationGroup>,
  selection: OrderSelection,
  seen: Set<string>,
  countByGroup: Map<string, number>
): string | null {
  const group = groupByName.get(selection.optionName);
  if (group === undefined) {
    return `Unknown option "${selection.optionName}".`;
  }

  if (!group.options.some((option) => option.name === selection.choiceName)) {
    return `"${selection.choiceName}" is not a valid choice for "${selection.optionName}".`;
  }

  const key = `${selection.optionName}\u0000${selection.choiceName}`;
  if (seen.has(key)) {
    return `"${selection.choiceName}" was selected more than once for "${selection.optionName}".`;
  }
  seen.add(key);

  countByGroup.set(selection.optionName, (countByGroup.get(selection.optionName) ?? 0) + 1);
  return null;
}

/**
 * Validates a submitted selection list against the item's customization
 * groups. Returns the first user-facing error, or `null` when valid.
 *
 * Rules: every selection names a known group and a choice that group offers; an
 * identical option/choice pair may appear once; a required (single-select)
 * group takes exactly one choice; an optional (multi-select) group takes zero
 * or more.
 */
export function validateOrderSelections(
  groups: readonly OrderCustomizationGroup[],
  selections: readonly OrderSelection[]
): string | null {
  const groupByName = new Map(groups.map((group) => [group.name, group]));
  const countByGroup = new Map<string, number>();
  const seen = new Set<string>();

  for (const selection of selections) {
    const error = validateOneSelection(groupByName, selection, seen, countByGroup);
    if (error !== null) {
      return error;
    }
  }

  for (const group of groups) {
    if (!group.required) {
      continue;
    }
    const count = countByGroup.get(group.name) ?? 0;
    if (count === 0) {
      return `Choose a "${group.name}" option.`;
    }
    if (count > 1) {
      return `Choose only one "${group.name}" option.`;
    }
  }

  return null;
}

const MAX_CUSTOMER_NAME_LENGTH = 120;
const MAX_CONTACT_LENGTH = 200;

/**
 * Validates the anonymous contact block. Returns the first user-facing error,
 * or `null` when valid. At least one of phone/email must carry a value; the
 * name is required. Email shape is intentionally not enforced in v1 — the
 * business contacts the visitor by the channel they supplied.
 */
export function validateOrderContact(input: {
  customerName: string;
  contactPhone?: string;
  contactEmail?: string;
}): string | null {
  const customerName = input.customerName.trim();
  if (customerName.length === 0) {
    return 'Enter your name.';
  }
  if (customerName.length > MAX_CUSTOMER_NAME_LENGTH) {
    return `Name must be ${MAX_CUSTOMER_NAME_LENGTH} characters or fewer.`;
  }

  const contactPhone = (input.contactPhone ?? '').trim();
  const contactEmail = (input.contactEmail ?? '').trim();

  if (contactPhone.length === 0 && contactEmail.length === 0) {
    return 'Enter a phone number or email so the business can reach you.';
  }
  if (contactPhone.length > MAX_CONTACT_LENGTH) {
    return `Phone must be ${MAX_CONTACT_LENGTH} characters or fewer.`;
  }
  if (contactEmail.length > MAX_CONTACT_LENGTH) {
    return `Email must be ${MAX_CONTACT_LENGTH} characters or fewer.`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Protocol machine (order protocol §6.1) — added by T3 (issue #75).
//
// The legacy 4-state machine above stays frozen for `submitOrder`, the owner
// board, and `scripts/order-policy.test.ts`. This section is the 8-state
// protocol vocabulary: the wire actions, the terminal set, and the one pure
// resolver the S1 commit handler will call. `reuse` is §7.3 documentation
// vocabulary expressed by the `reused` resolution — it is NOT a wire action.
// ---------------------------------------------------------------------------

/** Every status the protocol machine can be asked to transition from. */
export type OrderDbStatus = (typeof ORDER_DB_STATUSES)[number];

export const ORDER_PROTOCOL_ACTIONS = [
  'submit',
  'accept',
  'decline',
  'cancel',
  'ready',
  'complete',
  'noShow',
  'expire',
] as const;
export type OrderProtocolAction = (typeof ORDER_PROTOCOL_ACTIONS)[number];

/** §6.1 terminal states: every action on one of these is `ORDER_TERMINAL`. */
export const TERMINAL_ORDER_STATUSES = [
  'completed',
  'declined',
  'cancelled',
  'expired',
  'no_show',
] as const;
export type TerminalOrderStatus = (typeof TERMINAL_ORDER_STATUSES)[number];

/**
 * What one protocol action does from the current status:
 * - `move`   — patch the status to `to`;
 * - `reused` — the action's target already holds (double-click / OCC retry):
 *              success with no new event;
 * - `error`  — reject with the typed protocol code.
 */
export type OrderActionResolution =
  | { kind: 'move'; to: OrderDbStatus }
  | { kind: 'reused' }
  | { kind: 'error'; code: 'INVALID_TRANSITION' | 'ORDER_TERMINAL' };

/**
 * §6.1 mutation rows. A row whose target equals its source encodes the
 * idempotent repeat (`accept` on `accepted`, `ready` on `ready`), which the
 * resolver returns as `reused` rather than a no-op `move`.
 */
const PROTOCOL_TRANSITIONS: Record<
  OrderDbStatus,
  Partial<Record<OrderProtocolAction, OrderDbStatus>>
> = {
  new: { accept: 'accepted', decline: 'declined', cancel: 'cancelled', expire: 'expired' },
  accepted: { accept: 'accepted', ready: 'ready', cancel: 'cancelled' },
  ready: { ready: 'ready', complete: 'completed', noShow: 'no_show', cancel: 'cancelled' },
  completed: {},
  declined: {},
  cancelled: {},
  expired: {},
  no_show: {},
};

/**
 * Resolves a protocol action from the order's current status (spec §6.1).
 *
 * Terminal statuses reject every action with `ORDER_TERMINAL`, checked before
 * anything else. `submit` is `placeOrder`'s create step, never a transition,
 * so it is `INVALID_TRANSITION` from every non-terminal status. Repeating the
 * action that produced the current status resolves to `{ kind: 'reused' }`;
 * every pair outside the §6.1 table is `INVALID_TRANSITION`.
 */
export function resolveOrderAction(
  status: OrderDbStatus,
  action: OrderProtocolAction
): OrderActionResolution {
  if ((TERMINAL_ORDER_STATUSES as readonly OrderDbStatus[]).includes(status)) {
    return { kind: 'error', code: 'ORDER_TERMINAL' };
  }

  if (action === 'submit') {
    return { kind: 'error', code: 'INVALID_TRANSITION' };
  }

  const target = PROTOCOL_TRANSITIONS[status][action];
  if (target === undefined) {
    return { kind: 'error', code: 'INVALID_TRANSITION' };
  }
  if (target === status) {
    return { kind: 'reused' };
  }

  return { kind: 'move', to: target };
}
