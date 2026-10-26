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
import { OrdersDialogs, type OrdersDialogRequest } from './orders-panel-dialogs';
import { OrdersFilterBar } from './orders-panel-filter-bar';
import {
  ORDER_FILTERS,
  ORDER_STATUS_LABELS,
  canLoadMore,
  isLoadingMore,
  mergeLiveOrderPages,
  type OrderFilter,
} from './orders-panel-helpers';
import { OrdersPauseControl } from './orders-panel-pause';
import { OrderRow, type OrderBoardRow } from './orders-panel-row';
import { messageForError } from './photos-panel-helpers';

/** `new` pages at 50 (§7.3 test 30); every other filter is capped server-side. */
const PAGE_SIZE = 50;

/** One live page from `api.orders.listOrders` (rows + cursor envelope). */
type OrdersListResult = FunctionReturnType<typeof api.orders.listOrders>;

type RowFailure = {
  orderId: Id<'orders'>;
  action: OrderOwnerAction;
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
  if (failure === null || request === null) {
    return null;
  }
  if (failure.orderId !== request.order._id || failure.action !== request.action) {
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
  showLoadMore,
  loadingMore,
  onLoadMore,
  capped,
}: {
  rows: readonly OrderBoardRow[];
  pendingIds: ReadonlySet<Id<'orders'>>;
  failure: RowFailure | null;
  onAction: (order: OrderBoardRow, action: OrderOwnerAction) => void;
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
      showLoadMore={showLoadMore}
      loadingMore={loadingMore}
      onLoadMore={onLoadMore}
      capped={filter !== 'new' && firstPageCapped === true}
    />
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
  const [announcement, setAnnouncement] = useState('');

  const counts = useQuery(api.orders.listOrderCounts, { businessId });
  const firstPage = useQuery(api.orders.listOrders, {
    businessId,
    status: filter,
    ...(filter === 'new' ? { cursor: null, numItems: PAGE_SIZE } : {}),
  });

  const transitionOrderStatus = useMutation(api.orders.transitionOrderStatus);

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
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
      />

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
