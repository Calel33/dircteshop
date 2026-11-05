import {
  ORDER_ACTIONS,
  ORDER_ACTION_TARGET,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_PILL_CLASSES,
  ORDER_STATUS_TRANSITIONS,
  type OrderAction,
  type OrderStatus,
} from '../../../../convex/orderPolicy.ts';

// Pure presentation helpers for the owner orders board. The status machine
// itself lives in `convex/orderPolicy.ts`; this module only derives what the
// row renders from it, so an illegal transition can never be offered.

export { ORDER_STATUS_LABELS };

export const ORDER_ACTION_LABELS: Record<OrderAction, string> = {
  accept: 'Accept',
  ready: 'Ready',
  complete: 'Complete',
};

/** The single forward action available from `status`; `completed` has none. */
export function nextActionForStatus(status: OrderStatus): OrderAction | null {
  const target = ORDER_STATUS_TRANSITIONS[status];
  if (target === null) {
    return null;
  }
  return ORDER_ACTIONS.find((action) => ORDER_ACTION_TARGET[action] === target) ?? null;
}

/** Token classes for the status pill — the shared map, re-exported for the board. */
export function statusPillClass(status: OrderStatus): string {
  return ORDER_STATUS_PILL_CLASSES[status];
}

/** Owner-facing creation time in the viewer's locale. */
export function formatOrderTime(createdAt: number): string {
  return new Date(createdAt).toLocaleString();
}
