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
