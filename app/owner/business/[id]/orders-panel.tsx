'use client';

import { Component, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { EVENT_FOR_ACTION, type OrderOwnerAction } from '../../../../convex/orderPolicy.ts';
import { ORDERS_SECTION } from './editor-sections';
import {
  BlockContactDialog,
  FlagOrderDialog,
  OrdersDialogs,
  type FlagReasonCode,
  type OrdersDialogRequest,
} from './orders-panel-dialogs';
import { OrdersFilterBar } from './orders-panel-filter-bar';
import {
  ORDER_FILTERS,
  ORDER_STATUS_LABELS,
  canLoadMore,
  contactActionAnnouncement,
  contactActionErrorFallback,
  formatOrderTime,
  isLoadingMore,
  mergeLiveOrderPages,
  type OrderContactAction,
  type OrderFilter,
} from './orders-panel-helpers';
import { OrdersPauseControl } from './orders-panel-pause';
import { OrderRow, type OrderBoardRow } from './orders-panel-row';
import { messageForError } from './photos-panel-helpers';

/** `new` pages at 50 (§7.3 test 30); every other filter is capped server-side. */
const PAGE_SIZE = 50;

/** One live page from `api.orders.listOrders` (rows + cursor envelope). */
type OrdersListResult = FunctionReturnType<typeof api.orders.listOrders>;

/** One projected row from `api.orderBlocks.listBlocked` (reason + date only). */
type BlockedListRow = FunctionReturnType<typeof api.orderBlocks.listBlocked>[number];

/**
 * A row-scoped failure. `kind` keeps the retry honest: a protocol transition
 * and a contact control are separate mutations, so a failed contact action can
 * never be retried through `transitionOrderStatus` (or the other way round).
 */
type RowFailure =
  | {
      orderId: Id<'orders'>;
      kind: 'transition';
      action: OrderOwnerAction;
      message: string;
    }
  | {
      orderId: Id<'orders'>;
      kind: 'contact';
      action: OrderContactAction;
      message: string;
    };

/**
 * `accept`, `decline`, `cancel`, and `noShow` need the verification-call copy or
 * an owner-supplied reason, so the board holds the request here instead of
 * calling the mutation; `OrdersDialogs` renders it and reports the owner's
 * decision back through `runTransition`.
 */
type PendingAction = OrdersDialogRequest;

/**
 * A flag failure belongs to the open flag dialog, and nowhere else. Flagging is
 * not a status transition, so it never joins `RowFailure` (whose kinds decide
 * which handler a row's "Try again" calls).
 */
type FlagFailure = { orderId: Id<'orders'>; message: string };

/**
 * `useQuery` throws during render when the owner-gated read rejects, so the
 * board needs a render boundary. The parent remounts it through `retryKey`,
 * which resubscribes the query instead of leaving a dead error card.
 */
class OrdersListBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  state: { hasError: boolean } = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <OrdersErrorState onRetry={this.props.onRetry} />;
    }
    return this.props.children;
  }
}

function OrdersErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="border-danger-border bg-danger-soft rounded-control flex flex-col items-start gap-2 border p-card"
    >
      <p className="text-danger-strong text-sm font-semibold">Couldn&apos;t load orders.</p>
      <p className="text-danger-strong text-sm">The board didn&apos;t refresh. Try again.</p>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function OrdersSkeleton() {
  return (
    <ul role="list" aria-busy="true" aria-label="Loading orders" className="flex flex-col gap-gap">
      {[0, 1, 2].map((key) => (
        <li key={key} className="border-border rounded-control border p-card">
          <div className="bg-muted rounded-control h-4 w-1/3 animate-pulse" />
          <div className="bg-muted rounded-control mt-2 h-3 w-1/2 animate-pulse" />
          <div className="bg-muted rounded-control mt-2 h-3 w-2/3 animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

function OrdersEmpty({ filter }: { filter: OrderFilter }) {
  const label = labelForFilter(filter);

  return (
    <div
      role="status"
      className="border-border bg-muted rounded-control flex flex-col items-center gap-1 border p-card text-center"
    >
      <p className="font-display text-base font-semibold">
        {filter === 'all' ? 'No orders yet' : `No ${label.toLowerCase()} orders`}
      </p>
      <p className="text-card-muted text-sm">
        Orders appear here in realtime as they are placed and as their status changes.
      </p>
    </div>
  );
}

/** Filter label for the status line and the empty state. */
function labelForFilter(filter: OrderFilter): string {
  return ORDER_FILTERS.find((entry) => entry.value === filter)?.label ?? 'All';
}

/** The polite live-region copy for the current filter. */
function boardStatusLine(announcement: string, label: string, visibleCount: number): string {
  if (announcement.length > 0) {
    return announcement;
  }
  return `${label} filter — ${visibleCount} ${visibleCount === 1 ? 'order' : 'orders'} shown.`;
}

/**
 * The failure that belongs inside the open dialog. A failure for any other row
 * or action stays on its row, so a stale error can never appear under a dialog
 * that is not about it.
 */
function dialogFailure(failure: RowFailure | null, request: PendingAction | null): string | null {
  if (failure === null || request === null || failure.kind !== 'transition') {
    return null;
  }
  if (failure.orderId !== request.order._id || failure.action !== request.action) {
    return null;
  }
  return failure.message;
}

/** The failure that belongs inside the block-contact dialog, and nowhere else. */
function blockDialogFailure(
  failure: RowFailure | null,
  order: OrderBoardRow | null
): string | null {
  if (failure === null || order === null) {
    return null;
  }
  if (failure.kind !== 'contact' || failure.action !== 'block') {
    return null;
  }
  if (failure.orderId !== order._id) {
    return null;
  }
  return failure.message;
}

/** The failure that belongs inside the flag dialog, and nowhere else. */
function flagDialogFailure(
  failure: FlagFailure | null,
  order: OrderBoardRow | null
): string | null {
  if (failure === null || order === null || failure.orderId !== order._id) {
    return null;
  }
  return failure.message;
}

/** True while the mutation for the request on screen is in flight. */
function isRequestPending(
  request: PendingAction | null,
  pendingIds: ReadonlySet<Id<'orders'>>
): boolean {
  return request !== null && pendingIds.has(request.order._id);
}

function OrdersQueue({
  rows,
  pendingIds,
  failure,
  onAction,
  onContactAction,
  onFlagAction,
  showLoadMore,
  loadingMore,
  onLoadMore,
  capped,
}: {
  rows: readonly OrderBoardRow[];
  pendingIds: ReadonlySet<Id<'orders'>>;
  failure: RowFailure | null;
  onAction: (order: OrderBoardRow, action: OrderOwnerAction) => void;
  onContactAction: (order: OrderBoardRow, action: OrderContactAction) => void;
  onFlagAction: (order: OrderBoardRow) => void;
  showLoadMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  capped: boolean;
}) {
  return (
    <>
      <ul role="list" className="flex flex-col gap-gap">
        {rows.map((order) => {
          const rowFailure =
            failure !== null && failure.orderId === order._id ? failure : null;
          return (
            <OrderRow
              key={order._id}
              order={order}
              pending={pendingIds.has(order._id)}
              failure={rowFailure}
              onAction={onAction}
              onContactAction={onContactAction}
              onFlagAction={onFlagAction}
            />
          );
        })}
      </ul>

      {showLoadMore ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={loadingMore}
            aria-busy={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? 'Loading more…' : 'Load more'}
          </Button>
        </div>
      ) : null}

      {capped ? (
        <p className="text-card-muted text-tiny">
          Showing the first 100 orders in this filter. Narrow the filter to see a smaller queue.
        </p>
      ) : null}
    </>
  );
}

/**
 * Pick what the board shows below the status line. The queue still renders
 * when every visible row has left the filter but the live last page has more
 * (C6), so the empty state only wins when there is nothing left to load.
 */
function OrdersBoardList({
  filter,
  rows,
  showLoadMore,
  firstPageCapped,
  pendingIds,
  failure,
  onAction,
  onContactAction,
  onFlagAction,
  loadingMore,
  onLoadMore,
}: {
  filter: OrderFilter;
  rows: readonly OrderBoardRow[] | null;
  showLoadMore: boolean;
  firstPageCapped: boolean | undefined;
  pendingIds: ReadonlySet<Id<'orders'>>;
  failure: RowFailure | null;
  onAction: (order: OrderBoardRow, action: OrderOwnerAction) => void;
  onContactAction: (order: OrderBoardRow, action: OrderContactAction) => void;
  onFlagAction: (order: OrderBoardRow) => void;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (rows === null) {
    return <OrdersSkeleton />;
  }
  if (rows.length === 0 && !showLoadMore) {
    return <OrdersEmpty filter={filter} />;
  }
  return (
    <OrdersQueue
      rows={rows}
      pendingIds={pendingIds}
      failure={failure}
      onAction={onAction}
      onContactAction={onContactAction}
      onFlagAction={onFlagAction}
      showLoadMore={showLoadMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
      capped={filter !== 'new' && firstPageCapped === true}
    />
  );
}

/**
 * The owner's block list (issue #81, T9). The server returns the reason and
 * creation time only — no contact and no hash — so this section is
 * informational; unblocking happens from the contact shown on an order row.
 */
function BlockedContactList({ blocked }: { blocked: readonly BlockedListRow[] | undefined }) {
  if (blocked === undefined) {
    return (
      <p role="status" className="text-card-muted text-tiny">
        Loading blocked contacts…
      </p>
    );
  }
  if (blocked.length === 0) {
    return <p className="text-card-muted text-tiny">No contacts are blocked.</p>;
  }
  return (
    <ul role="list" className="flex flex-col gap-1">
      {blocked.map((entry) => (
        <li
          key={entry._id}
          className="border-border flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-1 last:border-b-0 last:pb-0"
        >
          <span className="text-sm break-words">
            {entry.reason === undefined || entry.reason.trim().length === 0
              ? 'No reason given'
              : entry.reason}
          </span>
          <time
            dateTime={new Date(entry.createdAt).toISOString()}
            className="text-card-muted font-label text-micro"
          >
            {formatOrderTime(entry.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}

function BlockedContacts({ businessId }: { businessId: Id<'businesses'> }) {
  const [open, setOpen] = useState(false);
  const blocked = useQuery(api.orderBlocks.listBlocked, { businessId });

  return (
    <section
      aria-label="Blocked contacts"
      className="border-border rounded-control flex flex-col gap-2 border p-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          Blocked contacts{blocked === undefined ? '' : ` (${blocked.length})`}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? 'Hide blocked contacts' : 'Show blocked contacts'}
        </Button>
      </div>
      {open ? <BlockedContactList blocked={blocked} /> : null}
    </section>
  );
}

/**
 * One live page of the `new` queue, mounted with `key={cursor}` for as long as
 * the page is shown. It renders nothing; `useQuery` owns the subscription and
 * the effect lifts the whole result (rows, `continueCursor`, `isDone`) so the
 * parent never has to copy rows out of a page that is being left.
 */
function OrdersPageSubscription({
  businessId,
  cursor,
  onResult,
}: {
  businessId: Id<'businesses'>;
  cursor: string;
  onResult: (cursor: string, result: OrdersListResult) => void;
}) {
  const result = useQuery(api.orders.listOrders, {
    businessId,
    status: 'new',
    cursor,
    numItems: PAGE_SIZE,
  });

  useEffect(() => {
    if (result !== undefined) {
      onResult(cursor, result);
    }
  }, [cursor, result, onResult]);

  return null;
}

function OrdersBoard({ businessId }: { businessId: Id<'businesses'> }) {
  const [filter, setFilter] = useState<OrderFilter>('new');
  // `new` pages with an opaque cursor. `pages` holds the cursors of pages
  // 2..n; each one keeps its own live subscription (OrdersPageSubscription)
  // and `pageResults` holds what those subscriptions last delivered. No rows
  // are copied out of a page, so every page that is shown stays live.
  const [pages, setPages] = useState<readonly string[]>([]);
  const [pageResults, setPageResults] = useState<ReadonlyMap<string, OrdersListResult>>(
    () => new Map()
  );
  const [pendingIds, setPendingIds] = useState<ReadonlySet<Id<'orders'>>>(() => new Set());
  const [failure, setFailure] = useState<RowFailure | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [blockRequest, setBlockRequest] = useState<OrderBoardRow | null>(null);
  const [flagRequest, setFlagRequest] = useState<OrderBoardRow | null>(null);
  const [flagFailure, setFlagFailure] = useState<FlagFailure | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const counts = useQuery(api.orders.listOrderCounts, { businessId });
  const firstPage = useQuery(api.orders.listOrders, {
    businessId,
    status: filter,
    ...(filter === 'new' ? { cursor: null, numItems: PAGE_SIZE } : {}),
  });

  const transitionOrderStatus = useMutation(api.orders.transitionOrderStatus);
  const blockContact = useMutation(api.orderBlocks.blockContact);
  const unblockContact = useMutation(api.orderBlocks.unblockContact);
  const clearContactThrottle = useMutation(api.orderBlocks.clearContactThrottle);
  const flagOrder = useMutation(api.orderFlags.flagOrder);

  // Stable identity: every page effect depends on it, so a fresh callback per
  // render would re-run them all. The functional updater plus the reference
  // guard make an effect re-run a no-op (same state reference) rather than a
  // loop, independent of Convex's result caching.
  const handlePageResult = useCallback((cursor: string, result: OrdersListResult) => {
    setPageResults((current) => {
      if (current.get(cursor) === result) {
        return current;
      }
      return new Map(current).set(cursor, result);
    });
  }, []);

  // Page 1 is the direct query above; pages 2..n are their own live
  // subscriptions, merged in order. A page that has not delivered yet is
  // skipped instead of blanking the queue, and a row no live page returns
  // disappears from the list.
  const rows = useMemo(() => {
    if (firstPage === undefined) {
      return null;
    }
    return mergeLiveOrderPages(firstPage, pages, pageResults);
  }, [firstPage, pages, pageResults]);

  const lastPageCursor = pages.length === 0 ? null : pages[pages.length - 1];
  const lastPage = lastPageCursor === null ? firstPage : pageResults.get(lastPageCursor);

  const rowCount = rows === null ? 0 : rows.length;
  const loadingMore = isLoadingMore(pages, lastPage);
  const showLoadMore = canLoadMore(filter, rowCount, lastPage, pages.length);

  const label = labelForFilter(filter);
  const statusLine = boardStatusLine(announcement, label, rowCount);

  function handleFilterChange(next: OrderFilter) {
    setFilter(next);
    // Dropping the cursors unmounts those pages' subscriptions; `useQuery`
    // unsubscribes on unmount, so there is nothing to tear down by hand.
    setPages([]);
    setPageResults(new Map());
    setFailure(null);
    setPendingAction(null);
    setBlockRequest(null);
    setFlagRequest(null);
    setFlagFailure(null);
    setAnnouncement('');
  }

  function handleLoadMore() {
    const page = lastPage;
    if (page === undefined || page.isDone) {
      return;
    }
    const nextCursor = page.continueCursor;
    setPages((current) =>
      // A second click before the page arrives must not append its cursor
      // twice; pages are keyed by cursor.
      current[current.length - 1] === nextCursor ? current : [...current, nextCursor]
    );
    setAnnouncement('');
  }

  async function runTransition(
    order: OrderBoardRow,
    action: OrderOwnerAction,
    reason?: string
  ) {
    setFailure(null);
    setPendingIds((current) => new Set(current).add(order._id));

    try {
      await transitionOrderStatus({
        businessId,
        orderId: order._id,
        action,
        // Omitted entirely for the actions that need no reason (ready, complete,
        // and a cleared no-show field) — never sent as an empty string.
        ...(reason === undefined ? {} : { reason }),
      });
      const statusLabel = ORDER_STATUS_LABELS[EVENT_FOR_ACTION[action]].toLowerCase();
      setAnnouncement(`${order.customerName}'s order is now ${statusLabel}.`);
      // Deterministic close rule: a dialog closes when the mutation resolves,
      // not when the realtime row happens to change. The row still updates from
      // the subscription; a changed `new` row leaving the filter can never leave
      // a dialog stranded open.
      setPendingAction(null);
    } catch (error) {
      setFailure({
        orderId: order._id,
        kind: 'transition',
        action,
        message: messageForError(error, 'Could not update this order. Try again.'),
      });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(order._id);
        return next;
      });
    }
  }

  function handleAction(order: OrderBoardRow, action: OrderOwnerAction) {
    setFailure(null);
    // Ready and complete are one-tap; the protocol needs no reason for them.
    if (action === 'ready' || action === 'complete') {
      void runTransition(order, action);
      return;
    }
    setPendingAction({ order, action });
  }

  /**
   * The three owner abuse controls (issue #81, T9). They share `pendingIds` with
   * protocol transitions, so a row stays disabled while either kind of mutation
   * is in flight, and a failure lands in the same row/dialog error path.
   */
  async function runContactAction(
    order: OrderBoardRow,
    action: OrderContactAction,
    reason?: string
  ) {
    setFailure(null);
    setPendingIds((current) => new Set(current).add(order._id));

    try {
      if (action === 'clear_throttle') {
        const { cleared } = await clearContactThrottle({ businessId, orderId: order._id });
        setAnnouncement(contactActionAnnouncement(action, order.customerName, cleared));
      } else {
        // The row carries the owner-visible contact; the mutation hashes it
        // server-side. Absent channels are omitted, never sent as null.
        const contact = {
          businessId,
          ...(order.contactPhone === null ? {} : { phone: order.contactPhone }),
          ...(order.contactEmail === null ? {} : { email: order.contactEmail }),
        };
        const changed =
          action === 'block'
            ? (
                await blockContact({
                  ...contact,
                  ...(reason === undefined ? {} : { reason }),
                })
              ).created
            : (await unblockContact(contact)).removed;
        setAnnouncement(contactActionAnnouncement(action, order.customerName, changed));
      }
      setBlockRequest(null);
    } catch (error) {
      setFailure({
        orderId: order._id,
        kind: 'contact',
        action,
        message: messageForError(error, contactActionErrorFallback(action)),
      });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(order._id);
        return next;
      });
    }
  }

  function handleContactAction(order: OrderBoardRow, action: OrderContactAction) {
    setFailure(null);
    // Blocking is the destructive control, so it confirms (and accepts an
    // optional reason) through the shared dialog shell. The restorative
    // controls are one-tap.
    if (action === 'block') {
      setBlockRequest(order);
      return;
    }
    void runContactAction(order, action);
  }

  /**
   * The owner's fake-order flag (issue #84, T10). It mirrors `runContactAction`:
   * one row id in `pendingIds` gates every control on the row, a server error
   * lands in the dialog that raised it, and success is announced through the
   * board's existing live region. Nothing to refetch or invalidate — the board
   * reads `listOrders`, which carries no flag state, and a flag changes no
   * order row.
   */
  async function runFlagAction(order: OrderBoardRow, reason: FlagReasonCode) {
    setFailure(null);
    setFlagFailure(null);
    setPendingIds((current) => new Set(current).add(order._id));

    try {
      const { changed } = await flagOrder({ businessId, orderId: order._id, reason });
      setAnnouncement(
        changed
          ? `Flagged ${order.customerName}'s order as fake.`
          : `${order.customerName}'s order was already flagged.`
      );
      // Closed on success only, so a failure keeps the dialog and its reason.
      setFlagRequest(null);
    } catch (error) {
      setFlagFailure({
        orderId: order._id,
        message: messageForError(error, 'Could not flag this order. Try again.'),
      });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(order._id);
        return next;
      });
    }
  }

  function handleFlagAction(order: OrderBoardRow) {
    setFailure(null);
    setFlagFailure(null);
    setFlagRequest(order);
  }

  return (
    <div className="@container flex flex-col gap-gap">
      <OrdersPauseControl businessId={businessId} />
      <OrdersFilterBar selected={filter} counts={counts} onChange={handleFilterChange} />

      <p role="status" aria-live="polite" className="text-card-muted font-label text-micro">
        {statusLine}
      </p>

      {filter === 'new'
        ? pages.map((pageCursor) => (
            <OrdersPageSubscription
              key={pageCursor}
              businessId={businessId}
              cursor={pageCursor}
              onResult={handlePageResult}
            />
          ))
        : null}

      <OrdersBoardList
        filter={filter}
        rows={rows}
        showLoadMore={showLoadMore}
        firstPageCapped={firstPage?.capped}
        pendingIds={pendingIds}
        failure={failure}
        onAction={handleAction}
        onContactAction={handleContactAction}
        onFlagAction={handleFlagAction}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
      />

      <BlockedContacts businessId={businessId} />

      <OrdersDialogs
        request={pendingAction}
        pending={isRequestPending(pendingAction, pendingIds)}
        // Only a failure for the request that is open belongs inside the
        // dialog; any other failure stays on its row.
        error={dialogFailure(failure, pendingAction)}
        onSubmit={(action, reason) => {
          if (pendingAction === null) {
            return;
          }
          void runTransition(pendingAction.order, action, reason);
        }}
        onSwitchAction={(action) => {
          // Accept → Decline keeps the same order and swaps the dialog.
          setPendingAction((current) =>
            current === null ? null : { order: current.order, action }
          );
        }}
        onClose={() => setPendingAction(null)}
      />

      {blockRequest === null ? null : (
        <BlockContactDialog
          key={blockRequest._id}
          order={blockRequest}
          pending={pendingIds.has(blockRequest._id)}
          error={blockDialogFailure(failure, blockRequest)}
          onSubmit={(reason) => void runContactAction(blockRequest, 'block', reason)}
          onClose={() => setBlockRequest(null)}
        />
      )}

      {flagRequest === null ? null : (
        <FlagOrderDialog
          key={flagRequest._id}
          order={flagRequest}
          pending={pendingIds.has(flagRequest._id)}
          error={flagDialogFailure(flagFailure, flagRequest)}
          onSubmit={(reason) => void runFlagAction(flagRequest, reason)}
          onClose={() => {
            setFlagRequest(null);
            setFlagFailure(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Owner orders board (B8, issue #82): a filtered, oldest-first queue. `new`
 * alone cursor-paginates (50/page); every other filter is one capped read with
 * a visible capped notice. Realtime status changes come from the subscription —
 * no protocol action is written optimistically (§6.8).
 */
export function OrdersPanel({ businessId }: { businessId: Id<'businesses'> }) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <Card id={`orders-panel-${businessId}`} className="rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-lg">{ORDERS_SECTION.label}</CardTitle>
        <CardDescription>{ORDERS_SECTION.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <OrdersListBoundary key={retryKey} onRetry={() => setRetryKey((current) => current + 1)}>
          <OrdersBoard businessId={businessId} />
        </OrdersListBoundary>
      </CardContent>
    </Card>
  );
}
