import {
  ORDER_DB_STATUSES,
  TERMINAL_ORDER_STATUSES,
  type OrderOwnerAction,
} from '../../../../convex/orderPolicy.ts';

// Pure presentation helpers for the owner orders board (issue #82, T7). The
// status machine, action union, and terminal set live in
// `convex/orderPolicy.ts`; this module only derives what the board renders from
// those tuples, so the UI cannot drift from the server policy.

/** Every stored status; derived from the schema's tuple, never redeclared. */
export type OrderBoardStatus = (typeof ORDER_DB_STATUSES)[number];

/** The board's filter vocabulary: every stored status plus `All`. */
export type OrderFilter = OrderBoardStatus | 'all';

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

/** Every owner wire action, keyed by the policy tuple's own union. */
export const ORDER_ACTION_LABELS: Record<OrderOwnerAction, string> = {
  accept: 'Accept',
  decline: 'Decline',
  cancel: 'Cancel',
  ready: 'Ready',
  complete: 'Complete',
  noShow: 'No show',
};

/**
 * The owner's abuse controls (issue #81, T9). Deliberately a UI-local union:
 * these are not protocol transitions, so they must never widen
 * `OrderOwnerAction` or reach the transition mutation.
 */
export const ORDER_CONTACT_ACTIONS = ['block', 'unblock', 'clear_throttle'] as const;

export type OrderContactAction = (typeof ORDER_CONTACT_ACTIONS)[number];

export const ORDER_CONTACT_ACTION_LABELS: Record<OrderContactAction, string> = {
  block: 'Block contact',
  unblock: 'Unblock contact',
  clear_throttle: 'Clear throttle',
};

/**
 * Live-region copy for a completed contact control. `changed` is the mutation's
 * own count (`created` / `removed` / `cleared`), so an idempotent no-op reports
 * that nothing changed instead of claiming a write.
 */
export function contactActionAnnouncement(
  action: OrderContactAction,
  customerName: string,
  changed: number
): string {
  const order = `${customerName}'s order`;
  switch (action) {
    case 'block':
      return changed > 0
        ? `Blocked the contact for ${order}.`
        : `The contact for ${order} was already blocked.`;
    case 'unblock':
      return changed > 0
        ? `Unblocked the contact for ${order}.`
        : `The contact for ${order} was not blocked.`;
    case 'clear_throttle':
      return changed > 0
        ? `Cleared the throttle for ${order}.`
        : `There was no throttle to clear for ${order}.`;
  }
}

/** Fallback copy when a contact control fails without a server message. */
export function contactActionErrorFallback(action: OrderContactAction): string {
  switch (action) {
    case 'block':
      return 'Could not block this contact. Try again.';
    case 'unblock':
      return 'Could not unblock this contact. Try again.';
    case 'clear_throttle':
      return 'Could not clear this throttle. Try again.';
  }
}

/** Token classes for the status pill (fill + border + text, never colour alone). */
export const STATUS_PILL_CLASSES: Record<OrderBoardStatus, string> = {
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
 * The button set the board offers from each status. The authority for every
 * pair is `resolveOwnerDecision` in `convex/orderPolicy.ts`; this table is the
 * narrower operator surface described by §6.8 (e.g. the server matrix also
 * accepts `cancel` from `new`, while the owner workflow only offers cancel
 * after accept). `orders-panel-helpers.test.ts` pins every listed pair as a
 * legal policy `move`, so the table cannot invent server behaviour.
 */
const BOARD_ACTIONS: Record<OrderBoardStatus, readonly OrderOwnerAction[]> = {
  new: ['accept', 'decline'],
  accepted: ['ready', 'cancel'],
  ready: ['complete', 'noShow', 'cancel'],
  completed: [],
  declined: [],
  cancelled: [],
  expired: [],
  no_show: [],
};

/** Every protocol action the current status can act on, in render order. */
export function nextActionForStatus(status: OrderBoardStatus): readonly OrderOwnerAction[] {
  return BOARD_ACTIONS[status];
}

/** True for the five §6.1 terminal statuses (the policy tuple owns the list). */
export function isTerminalStatus(status: OrderBoardStatus): boolean {
  return (TERMINAL_ORDER_STATUSES as readonly OrderBoardStatus[]).includes(status);
}

export const AGE_AMBER_MS = 5 * 60 * 1000;
export const AGE_RED_MS = 15 * 60 * 1000;

/** How often a live row refreshes its minute-granularity waiting clock. */
export const AGE_TICK_MS = 30_000;

export type AgeTone = 'neutral' | 'amber' | 'danger';

/** Token classes for the age badge; the text always carries the value too. */
export const AGE_BADGE_CLASSES: Record<AgeTone, string> = {
  neutral: 'bg-neutral-chip border-border text-neutral-chip-foreground',
  amber: 'bg-warning-soft border-warning-border text-warning-strong',
  danger: 'bg-danger-soft border-danger-border text-danger-strong',
};

/**
 * Age tone for the unwaiting queue: amber from 5 minutes, red from 15. Pure and
 * clock-injected so the row's interval and the tests share one rule.
 */
export function ageClass(createdAt: number, now: number): AgeTone {
  const age = Math.max(0, now - createdAt);
  if (age >= AGE_RED_MS) {
    return 'danger';
  }
  if (age >= AGE_AMBER_MS) {
    return 'amber';
  }
  return 'neutral';
}

/** Compact waiting time: "under a minute", "12 min", "1 h 30 min". */
export function formatAge(createdAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (minutes < 1) {
    return 'under a minute';
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
}

export const NOTE_PREVIEW_LENGTH = 140;

export type NoteSummary = { text: string; truncated: boolean };

/**
 * Single-line note clamp for a board row. Returns `null` when there is nothing
 * to show; `truncated` tells the row whether to render the expand control.
 */
export function summarizeNote(
  note: string | null,
  limit: number = NOTE_PREVIEW_LENGTH
): NoteSummary | null {
  if (note === null) {
    return null;
  }
  const normalized = note.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length <= limit) {
    return { text: normalized, truncated: false };
  }
  return { text: `${normalized.slice(0, limit).trimEnd()}…`, truncated: true };
}

/**
 * The nine filters in the operator order of §6.8. `No-show` follows the spec's
 * hyphenated filter copy; the row pill keeps the status label "No show".
 */
export const ORDER_FILTERS: readonly { value: OrderFilter; label: string }[] = [
  { value: 'new', label: ORDER_STATUS_LABELS.new },
  { value: 'accepted', label: ORDER_STATUS_LABELS.accepted },
  { value: 'ready', label: ORDER_STATUS_LABELS.ready },
  { value: 'completed', label: ORDER_STATUS_LABELS.completed },
  { value: 'declined', label: ORDER_STATUS_LABELS.declined },
  { value: 'cancelled', label: ORDER_STATUS_LABELS.cancelled },
  { value: 'expired', label: ORDER_STATUS_LABELS.expired },
  { value: 'no_show', label: 'No-show' },
  { value: 'all', label: 'All' },
];

export const COUNT_CAP = 100;

/** Count chip copy: the server saturates at 100, so past it show "99+". */
export function countChipLabel(count: number, capped: boolean): string {
  return capped || count >= COUNT_CAP ? '99+' : String(count);
}

/** Token classes for the status pill; kept as a function for call-site parity. */
export function statusPillClass(status: OrderBoardStatus): string {
  return STATUS_PILL_CLASSES[status];
}

/** Owner-facing creation time in the viewer's locale. */
export function formatOrderTime(createdAt: number): string {
  return new Date(createdAt).toLocaleString();
}

/** The only part of a page result the merge reads. */
export type LiveOrderPage<T> = { readonly rows: readonly T[] };

/**
 * Merge the live `new` pages into one list, page order then row order.
 *
 * Every page is its own live subscription, so a row that leaves `new` is
 * absent from its page on the next delivery and therefore absent here; there
 * are no frozen row copies to keep it on screen. A page that has not
 * delivered yet is skipped instead of blanking the list.
 *
 * A duplicate `_id` keeps the first page's position (Map insertion order) and
 * the later page's value (`set` overwrites in place). That is deterministic
 * because all pages are live projections of the same reactive store: a row
 * appears in whichever page its position and status put it, and every page
 * that returns it carries the same current edited document.
 */
export function mergeLiveOrderPages<T extends { readonly _id: string }>(
  firstPage: LiveOrderPage<T>,
  pages: readonly string[],
  pageResults: ReadonlyMap<string, LiveOrderPage<T>>
): T[] {
  const byId = new Map<string, T>();
  for (const row of firstPage.rows) {
    byId.set(row._id, row);
  }
  for (const cursor of pages) {
    const page = pageResults.get(cursor);
    if (page === undefined) {
      continue;
    }
    for (const row of page.rows) {
      byId.set(row._id, row);
    }
  }
  return [...byId.values()];
}

/**
 * `new` alone paginates; the other filters are one capped read, so they never
 * load more. Before a second page exists the empty page has nothing more to
 * fetch; once a page is loaded the visible row count must not hide the
 * control when every visible row has left `new` (C6).
 */
export function canLoadMore(
  filter: OrderFilter,
  rowCount: number,
  lastPage: { readonly isDone: boolean } | undefined,
  loadedPageCount: number
): boolean {
  if (filter !== 'new' || lastPage?.isDone === true) {
    return false;
  }
  return loadedPageCount > 0 || rowCount > 0;
}

/** True while a page just requested has not delivered its first result. */
export function isLoadingMore(pages: readonly string[], lastPage: unknown): boolean {
  return pages.length > 0 && lastPage === undefined;
}
