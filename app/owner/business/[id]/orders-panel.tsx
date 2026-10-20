'use client';

import { Component, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import {
  ORDER_ACTION_TARGET,
  nextOrderStatus,
  type OrderAction,
} from '../../../../convex/orderPolicy.ts';
import { ORDERS_SECTION } from './editor-sections';
import {
  ORDER_ACTION_LABELS,
  ORDER_STATUS_LABELS,
  formatOrderTime,
  nextActionForStatus,
  statusPillClass,
} from './orders-panel-helpers';
import { messageForError } from './photos-panel-helpers';

type OrdersBoardRow = FunctionReturnType<typeof api.orders.listOrders>[number];

type RowFailure = {
  orderId: Id<'orders'>;
  action: OrderAction;
  message: string;
};

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

function StatusPill({ status }: { status: OrdersBoardRow['status'] }) {
  return (
    <span
      className={`rounded-pill text-micro inline-flex items-center border px-2 py-0.5 font-semibold ${statusPillClass(status)}`}
    >
      {ORDER_STATUS_LABELS[status]}
    </span>
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

function OrdersEmpty() {
  return (
    <div className="border-border bg-muted rounded-control flex flex-col items-center gap-1 border p-card text-center">
      <p className="font-display text-base font-semibold">No orders yet</p>
      <p className="text-card-muted text-sm">
        Orders from customers appear here as soon as they are placed.
      </p>
    </div>
  );
}

function OrderRow({
  order,
  pending,
  failure,
  onTransition,
}: {
  order: OrdersBoardRow;
  pending: boolean;
  failure: { action: OrderAction; message: string } | null;
  onTransition: (orderId: Id<'orders'>, action: OrderAction) => void;
}) {
  // Derived from the shared forward-only chain: completed rows never render a
  // button, and every other row offers exactly its one legal next step.
  const action = nextActionForStatus(order.status);

  return (
    <li
      aria-busy={pending}
      className="border-border bg-card rounded-control border p-card @max-[44rem]:p-4"
    >
      <div className="gap-gap grid grid-cols-[minmax(0,1fr)_auto] items-start @max-[44rem]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-semibold break-words">
              {order.customerName}
            </h3>
            <StatusPill status={order.status} />
          </div>
          <p className="text-sm font-medium break-words">{order.itemName}</p>
          <time
            dateTime={new Date(order.createdAt).toISOString()}
            className="text-card-muted font-label text-micro"
          >
            {formatOrderTime(order.createdAt)}
          </time>
        </div>
        <div className="flex flex-col items-end gap-2 @max-[44rem]:items-start">
          {action === null ? (
            <p className="text-card-muted text-tiny">No further action required.</p>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              aria-label={`${ORDER_ACTION_LABELS[action]} order from ${order.customerName} for ${order.itemName}`}
              onClick={() => onTransition(order._id, action)}
            >
              {pending ? 'Saving…' : ORDER_ACTION_LABELS[action]}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-gap gap-gap grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @max-[60rem]:grid-cols-1">
        {order.selections.length === 0 ? null : (
          <ul role="list" className="flex flex-wrap gap-1">
            {order.selections.map((selection) => (
              <li
                key={`${selection.optionName}:${selection.choiceName}`}
                className="border-border bg-muted rounded-pill text-micro max-w-full border px-2 py-0.5 break-words"
              >
                <span className="text-card-muted">{selection.optionName}:</span>{' '}
                {selection.choiceName}
              </li>
            ))}
          </ul>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {order.contactPhone === null ? null : (
              <a
                className="text-primary underline-offset-4 hover:underline"
                href={`tel:${order.contactPhone}`}
              >
                {order.contactPhone}
              </a>
            )}
            {order.contactEmail === null ? null : (
              <a
                className="text-primary break-all underline-offset-4 hover:underline"
                href={`mailto:${order.contactEmail}`}
              >
                {order.contactEmail}
              </a>
            )}
          </div>
          {order.note === null ? null : (
            <p className="border-border text-card-muted border-l-2 pl-2 text-sm break-words">
              <span className="font-label text-micro tracking-label uppercase">Note: </span>
              {order.note}
            </p>
          )}
        </div>
      </div>

      {failure === null ? null : (
        <div
          role="alert"
          className="border-danger-border bg-danger-soft mt-gap rounded-control flex flex-wrap items-center gap-2 border p-3"
        >
          <p className="text-danger-strong text-sm">{failure.message}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onTransition(order._id, failure.action)}
          >
            Try again
          </Button>
        </div>
      )}
    </li>
  );
}

function OrdersBoard({ businessId }: { businessId: Id<'businesses'> }) {
  const orders = useQuery(api.orders.listOrders, { businessId });

  // Convex runs this on mutation start and rolls it back automatically when the
  // mutation rejects (docs: /client/react/optimistic-updates). Build a new
  // array/object — mutating the store in place corrupts it.
  const transitionOrderStatus = useMutation(api.orders.transitionOrderStatus).withOptimisticUpdate(
    (localStore, args) => {
      const current = localStore.getQuery(api.orders.listOrders, {
        businessId: args.businessId,
      });
      if (current === undefined) {
        return;
      }

      const order = current.find((candidate) => candidate._id === args.orderId);
      if (order === undefined) {
        return;
      }

      const target = nextOrderStatus(order.status, args.action);
      if (target === null) {
        return;
      }

      localStore.setQuery(
        api.orders.listOrders,
        { businessId: args.businessId },
        current.map((candidate) =>
          candidate._id === args.orderId ? { ...candidate, status: target } : candidate
        )
      );
    }
  );

  const [pendingIds, setPendingIds] = useState<ReadonlySet<Id<'orders'>>>(() => new Set());
  const [failure, setFailure] = useState<RowFailure | null>(null);
  const [announcement, setAnnouncement] = useState('');

  async function handleTransition(orderId: Id<'orders'>, action: OrderAction) {
    setFailure(null);
    setPendingIds((current) => new Set(current).add(orderId));

    try {
      await transitionOrderStatus({ businessId, orderId, action });
      const customerName = orders?.find((order) => order._id === orderId)?.customerName;
      const statusLabel = ORDER_STATUS_LABELS[ORDER_ACTION_TARGET[action]].toLowerCase();
      setAnnouncement(
        customerName === undefined
          ? `Order is now ${statusLabel}.`
          : `${customerName}'s order is now ${statusLabel}.`
      );
    } catch (error) {
      setFailure({
        orderId,
        action,
        message: messageForError(error, 'Could not update this order. Try again.'),
      });
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(orderId);
        return next;
      });
    }
  }

  return (
    <div className="@container flex flex-col gap-gap">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {orders === undefined ? (
        <OrdersSkeleton />
      ) : orders.length === 0 ? (
        <OrdersEmpty />
      ) : (
        <ul role="list" className="flex flex-col gap-gap">
          {orders.map((order) => {
            const rowFailure =
              failure !== null && failure.orderId === order._id ? failure : null;
            return (
              <OrderRow
                key={order._id}
                order={order}
                pending={pendingIds.has(order._id)}
                failure={rowFailure}
                onTransition={handleTransition}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Owner orders board (B8, issue #8): newest-first rows with one forward-only
 * transition each (`new → accepted → ready → completed`). The list order is the
 * server's; the client never re-sorts. Rejections roll the optimistic row back
 * automatically and render the ConvexError text inline with a retry.
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
        <OrdersListBoundary
          key={retryKey}
          onRetry={() => setRetryKey((current) => current + 1)}
        >
          <OrdersBoard businessId={businessId} />
        </OrdersListBoundary>
      </CardContent>
    </Card>
  );
}
