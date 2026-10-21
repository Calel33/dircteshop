import {
  ORDER_ACTIONS,
  ORDER_ACTION_TARGET,
  ORDER_DB_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  isLegacyOrderStatus,
  type OrderAction,
} from '../../../../convex/orderPolicy.ts';

// Pure presentation helpers for the owner orders board. The status machine
// itself lives in `convex/orderPolicy.ts`; this module only derives what the
// row renders from it, so an illegal transition can never be offered.

/** Every stored status; derived from the schema's tuple, never redeclared. */
type OrderBoardStatus = (typeof ORDER_DB_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderBoardStatus, string> = {
  new: 'New',
  accepted: 'Accepted',
  ready: 'Ready',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
  no_show: 'No show',
};

export const ORDER_ACTION_LABELS: Record<OrderAction, string> = {
  accept: 'Accept',
  ready: 'Ready',
  complete: 'Complete',
};

const STATUS_PILL_CLASSES: Record<OrderBoardStatus, string> = {
  new: 'bg-warning-soft border-warning-border text-warning-strong',
  accepted: 'bg-info-soft border-info-border text-info-strong',
  ready: 'bg-success-soft border-success-border text-success-strong',
  completed: 'bg-neutral-chip border-border text-neutral-chip-foreground',
  declined: 'bg-danger-soft border-danger-border text-danger-strong',
  cancelled: 'bg-neutral-chip border-border text-neutral-chip-foreground',
  expired: 'bg-warning-soft border-warning-border text-warning-strong',
  no_show: 'bg-danger-soft border-danger-border text-danger-strong',
};

/**
 * The single forward action available from a legacy `status`; terminal and
 * non-legacy statuses (`declined`, `cancelled`, `expired`, `no_show`) have
 * none. TS only has one shape (`orders.status`), so the 4-state matrix is
 * indexed only after the legacy guard.
 */
export function nextActionForStatus(status: OrderBoardStatus): OrderAction | null {
  if (!isLegacyOrderStatus(status)) {
    return null;
  }
  const target = ORDER_STATUS_TRANSITIONS[status];
  if (target === null) {
    return null;
  }
  return ORDER_ACTIONS.find((action) => ORDER_ACTION_TARGET[action] === target) ?? null;
}

/** Token classes for the status pill (fill + border + text, never colour alone). */
export function statusPillClass(status: OrderBoardStatus): string {
  return STATUS_PILL_CLASSES[status];
}

/** Owner-facing creation time in the viewer's locale. */
export function formatOrderTime(createdAt: number): string {
  return new Date(createdAt).toLocaleString();
}
