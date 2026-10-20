import {
  ORDER_ACTIONS,
  ORDER_ACTION_TARGET,
  ORDER_STATUS_TRANSITIONS,
  type OrderAction,
  type OrderStatus,
} from '../../../../convex/orderPolicy.ts';

// Pure presentation helpers for the owner orders board. The status machine
// itself lives in `convex/orderPolicy.ts`; this module only derives what the
// row renders from it, so an illegal transition can never be offered.

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New',
  accepted: 'Accepted',
  ready: 'Ready',
  completed: 'Completed',
};

export const ORDER_ACTION_LABELS: Record<OrderAction, string> = {
  accept: 'Accept',
  ready: 'Ready',
  complete: 'Complete',
};

const STATUS_PILL_CLASSES: Record<OrderStatus, string> = {
  new: 'bg-warning-soft border-warning-border text-warning-strong',
  accepted: 'bg-info-soft border-info-border text-info-strong',
  ready: 'bg-success-soft border-success-border text-success-strong',
  completed: 'bg-neutral-chip border-border text-neutral-chip-foreground',
};

/** The single forward action available from `status`; `completed` has none. */
export function nextActionForStatus(status: OrderStatus): OrderAction | null {
  const target = ORDER_STATUS_TRANSITIONS[status];
  if (target === null) {
    return null;
  }
  return ORDER_ACTIONS.find((action) => ORDER_ACTION_TARGET[action] === target) ?? null;
}

/** Token classes for the status pill (fill + border + text, never colour alone). */
export function statusPillClass(status: OrderStatus): string {
  return STATUS_PILL_CLASSES[status];
}

/** Owner-facing creation time in the viewer's locale. */
export function formatOrderTime(createdAt: number): string {
  return new Date(createdAt).toLocaleString();
}
