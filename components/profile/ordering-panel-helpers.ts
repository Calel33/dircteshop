import { ConvexError } from 'convex/values';

import type { Id } from '@/convex/_generated/dataModel';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import {
  ORDER_DB_STATUSES,
  isLegacyOrderStatus,
  validateOrderContact,
  validateOrderSelections,
  type OrderCustomizationGroup,
  type OrderSelection,
  type OrderStatus,
} from '@/convex/orderPolicy';

// Pure state helpers for the public ordering panel (T5). No React imports, so
// the selection model, price derivation, hash contract, and form validation can
// be exercised without rendering. Server validation is reused from
// `convex/orderPolicy.ts` so the client cannot drift from `submitOrder`.

/** One item of the public menu payload; the panel never sees the owner shape. */
export type OrderingItem = NonNullable<
  FunctionReturnType<typeof api.menus.listForBusiness>
>['items'][number];

/**
 * Selections keyed by customization-group name (the persisted key on
 * `orders.selections[].optionName`). Values are the chosen option names.
 *
 * The schema has only `required`, so the accepted prototype maps
 * required → single-select (radio) and optional → multi-select (checkbox).
 */
export type SelectionModel = Record<string, string[]>;

export type OrderFormValues = {
  customerName: string;
  contactPhone: string;
  contactEmail: string;
  note: string;
};

/** Snapshot held by the confirmation view after a successful submit. */
export type Confirmation = {
  orderId: Id<'orders'>;
  itemName: string;
  selections: OrderSelection[];
  total: number | null;
};

/** Mirrors `convex/orders.ts` `MAX_ORDER_NOTE_LENGTH` (not exported there). */
export const MAX_NOTE_LENGTH = 500;

/**
 * Mirrors `convex/orders.ts` `MAX_ORDER_SELECTIONS` (not exported there). Real
 * orders are far below this; the cap exists to bound the anonymous endpoint.
 */
export const MAX_SELECTIONS = 32;

/** Mirrors `convex/orderPolicy.ts` name/contact caps (not exported there). */
export const MAX_CUSTOMER_NAME_LENGTH = 120;
export const MAX_CONTACT_LENGTH = 200;

const PRICE_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function formatPrice(price: number): string {
  // Prices are stored as integer cents (MONEY = 'integer-cents'); display
  // divides by 100.
  return PRICE_FORMATTER.format(price / 100);
}

/** Statuses outside the 4-step legacy chain: no stepper progress to show. */
type NonStepStatus = Exclude<(typeof ORDER_DB_STATUSES)[number], OrderStatus>;

const NON_STEP_STATUS_NOTES: Record<NonStepStatus, string> = {
  declined: 'The business could not accept this order.',
  cancelled: 'This order was cancelled.',
  expired: 'This order expired before it was accepted.',
  no_show: 'The order was not picked up.',
};

/**
 * One honest sentence for a receipt status the 4-step stepper cannot show.
 * Returns an empty string for a legacy step, which the stepper renders.
 */
export function nonStepStatusNote(status: (typeof ORDER_DB_STATUSES)[number] | null): string {
  if (status === null || isLegacyOrderStatus(status)) {
    return '';
  }
  return NON_STEP_STATUS_NOTES[status];
}

/** `#order-<id>` opens an item, `#order` opens the default builder, else idle. */
type HashResolution =
  | { kind: 'open'; item: OrderingItem }
  | { kind: 'unavailable' }
  | { kind: 'idle' };

function parseOrderHash(
  hash: string
): { kind: 'item'; itemId: string } | { kind: 'default' } | { kind: 'none' } {
  if (hash === '#order') {
    return { kind: 'default' };
  }

  const prefix = '#order-';
  if (!hash.startsWith(prefix) || hash.length === prefix.length) {
    return { kind: 'none' };
  }

  return { kind: 'item', itemId: hash.slice(prefix.length) };
}

/**
 * `#order` prefers the first available item that has customization groups (the
 * prototype's "Build Your Bowl" builder), then the first available item.
 */
function defaultOrderItem(items: readonly OrderingItem[]): OrderingItem | null {
  const available = items.filter((item) => item.isAvailable);
  return available.find((item) => item.customizationOptions.length > 0) ?? available[0] ?? null;
}

/**
 * Resolves a hash against this business's menu. Unknown ids and unknown hashes
 * fall back to the idle list; a known-but-unavailable item is reported so the
 * panel can explain why it did not open.
 */
export function resolveOrderHash(items: readonly OrderingItem[], hash: string): HashResolution {
  const parsed = parseOrderHash(hash);

  if (parsed.kind === 'none') {
    return { kind: 'idle' };
  }

  if (parsed.kind === 'default') {
    const item = defaultOrderItem(items);
    return item === null ? { kind: 'idle' } : { kind: 'open', item };
  }

  const item = items.find((candidate) => candidate._id === parsed.itemId);
  if (item === undefined) {
    return { kind: 'idle' };
  }

  return item.isAvailable ? { kind: 'open', item } : { kind: 'unavailable' };
}

/** Sum of the selected options' `priceAdjustment` (absent means 0). */
export function adjustmentTotal(item: OrderingItem, model: SelectionModel): number {
  let total = 0;

  for (const group of item.customizationOptions) {
    const selected = model[group.name] ?? [];
    for (const option of group.options) {
      if (selected.includes(option.name)) {
        total += option.priceAdjustment ?? 0;
      }
    }
  }

  return total;
}

/** Base price + adjustments, or `null` when the item has no listed base price. */
export function totalForSelection(item: OrderingItem, model: SelectionModel): number | null {
  return item.price === undefined ? null : item.price + adjustmentTotal(item, model);
}

/**
 * Required groups replace their choice (single-select); optional groups toggle
 * membership. Returns a new model so React sees a changed reference.
 */
export function toggleSelection(
  model: SelectionModel,
  group: OrderCustomizationGroup,
  choiceName: string
): SelectionModel {
  if (group.required) {
    return { ...model, [group.name]: [choiceName] };
  }

  const current = model[group.name] ?? [];
  const next = current.includes(choiceName)
    ? current.filter((name) => name !== choiceName)
    : [...current, choiceName];

  return { ...model, [group.name]: next };
}

/** Flattens the model into the submitted shape, in menu/option order. */
export function toSelections(
  groups: readonly OrderCustomizationGroup[],
  model: SelectionModel
): OrderSelection[] {
  const selections: OrderSelection[] = [];

  for (const group of groups) {
    const selected = model[group.name] ?? [];
    for (const option of group.options) {
      if (selected.includes(option.name)) {
        selections.push({ optionName: group.name, choiceName: option.name });
      }
    }
  }

  return selections;
}

/**
 * Client mirror of `submitOrder`'s validation: name/contact via the shared
 * policy (trimmed name, at least one contact channel, length caps), note length
 * mirrored locally, and the selection rules via the server's own validator.
 */
export function validateOrderForm(
  item: OrderingItem,
  model: SelectionModel,
  values: OrderFormValues
): string | null {
  const contactError = validateOrderContact({
    customerName: values.customerName,
    contactPhone: values.contactPhone,
    contactEmail: values.contactEmail,
  });
  if (contactError !== null) {
    return contactError;
  }

  if (values.note.trim().length > MAX_NOTE_LENGTH) {
    return `Note must be ${MAX_NOTE_LENGTH} characters or fewer.`;
  }

  return validateOrderSelections(
    item.customizationOptions,
    toSelections(item.customizationOptions, model)
  );
}

/**
 * Unwraps the `ConvexError` payload `submitOrder` sends. Mirrors
 * `app/owner/business/[id]/photos-panel-helpers.ts`; kept local so a public
 * component never imports from the owner route tree.
 */
export function messageForError(error: unknown, fallback: string): string {
  if (
    error instanceof ConvexError &&
    typeof error.data === 'string' &&
    error.data.trim().length > 0
  ) {
    return error.data;
  }

  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

/** Short human code: the last 6 characters of the order id, uppercased. */
export function orderCode(orderId: string): string {
  return orderId.slice(-6).toUpperCase();
}
