'use client';

import { useEffect, useState } from 'react';
import type { FunctionReturnType } from 'convex/server';

import { formatPrice } from '@/components/profile/ordering-panel-helpers';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';

import type { OrderOwnerAction, OrderSelection } from '../../../../convex/orderPolicy.ts';
import {
  AGE_BADGE_CLASSES,
  AGE_TICK_MS,
  ORDER_ACTION_LABELS,
  ORDER_STATUS_LABELS,
  ageClass,
  formatAge,
  formatOrderTime,
  isTerminalStatus,
  nextActionForStatus,
  statusPillClass,
  summarizeNote,
} from './orders-panel-helpers';

type OrdersListResult = FunctionReturnType<typeof api.orders.listOrders>;

/** One projected row from `api.orders.listOrders` (Task 1's envelope). */
export type OrderBoardRow = OrdersListResult['rows'][number];

export type OrderRowFailure = {
  action: OrderOwnerAction;
  message: string;
};

/**
 * One operator row: reference, customer, every line with quantity and
 * selections, the recorded subtotal (or the legacy "Price not recorded"
 * branch), the note with its expand control, a ticking age badge, the status
 * pill, and exactly the actions the status allows (§6.8).
 */
export function OrderRow({
  order,
  pending,
  failure,
  onAction,
}: {
  order: OrderBoardRow;
  pending: boolean;
  failure: OrderRowFailure | null;
  onAction: (order: OrderBoardRow, action: OrderOwnerAction) => void;
}) {
  const actions = nextActionForStatus(order.status);
  const actionContext =
    order.reference === null
      ? order.customerName
      : `${order.customerName} (${order.reference})`;

  return (
    <li
      aria-busy={pending}
      className="border-border bg-card rounded-control border p-card @max-[44rem]:p-4"
    >
      <div className="gap-gap grid grid-cols-[minmax(0,1fr)_auto] items-start @max-[44rem]:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {order.reference === null ? null : <ReferenceChip reference={order.reference} />}
            <h3 className="font-display text-base font-semibold break-words">
              {order.customerName}
            </h3>
            <StatusPill status={order.status} />
            <AgeBadge createdAt={order.createdAt} status={order.status} />
          </div>
          <OrderItems order={order} />
          <OrderPrice order={order} />
          <time
            dateTime={new Date(order.createdAt).toISOString()}
            className="text-card-muted font-label text-micro"
          >
            Placed {formatOrderTime(order.createdAt)}
          </time>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 @max-[44rem]:justify-start">
          {actions.length === 0 ? (
            <p className="text-card-muted text-tiny">No further action required.</p>
          ) : (
            actions.map((action) => (
              <Button
                key={action}
                type="button"
                size="sm"
                className="min-h-11"
                variant={
                  action === 'accept' || action === 'ready' || action === 'complete'
                    ? 'default'
                    : 'outline'
                }
                disabled={pending}
                aria-label={`${ORDER_ACTION_LABELS[action]} order from ${actionContext}`}
                onClick={() => onAction(order, action)}
              >
                {ORDER_ACTION_LABELS[action]}
              </Button>
            ))
          )}
        </div>
      </div>

      <div className="mt-gap gap-gap grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @max-[60rem]:grid-cols-1">
        <ContactLinks order={order} />
        {order.note === null ? null : (
          <OrderNote note={order.note} customerName={order.customerName} />
        )}
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
            className="min-h-11"
            onClick={() => onAction(order, failure.action)}
          >
            Try again
          </Button>
        </div>
      )}
    </li>
  );
}

/** The order's short reference from `orderAccess`; the token never reaches the board. */
function ReferenceChip({ reference }: { reference: string }) {
  return (
    <span className="border-border bg-neutral-chip text-neutral-chip-foreground rounded-pill text-micro inline-flex items-center border px-2 py-0.5 font-mono">
      <span className="sr-only">Order reference </span>
      {reference}
    </span>
  );
}

function StatusPill({ status }: { status: OrderBoardRow['status'] }) {
  return (
    <span
      className={`rounded-pill text-micro inline-flex items-center border px-2 py-0.5 font-semibold ${statusPillClass(status)}`}
    >
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The waiting clock. The interval only runs while the order can still be acted
 * on; terminal rows keep the badge frozen at their last render.
 */
function AgeBadge({
  createdAt,
  status,
}: {
  createdAt: number;
  status: OrderBoardRow['status'];
}) {
  const terminal = isTerminalStatus(status);
  // Start from `createdAt` so SSR and hydration agree; the effect supplies the
  // real clock immediately after mount.
  const [now, setNow] = useState(createdAt);

  useEffect(() => {
    setNow(Date.now());
    if (terminal) {
      return undefined;
    }
    const timer = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [createdAt, terminal]);

  const tone = terminal ? 'neutral' : ageClass(createdAt, now);

  return (
    <span
      className={`rounded-pill text-micro inline-flex items-center border px-2 py-0.5 font-semibold ${AGE_BADGE_CLASSES[tone]}`}
    >
      {terminal ? 'Age' : 'Waiting'} {formatAge(createdAt, now)}
    </span>
  );
}

/** Legacy rows carry one item name; basket rows carry the full line list. */
function OrderItems({ order }: { order: OrderBoardRow }) {
  if (order.items === null) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium break-words">{order.itemName}</p>
        <SelectionChips selections={order.selections} />
      </div>
    );
  }

  return (
    <ul role="list" className="flex flex-col gap-2">
      {order.items.map((line, index) => {
        const linePrice =
          line.lineTotal === null
            ? line.unitPrice === null
              ? null
              : `${formatPrice(line.unitPrice)} each`
            : formatPrice(line.lineTotal);
        return (
          <li key={`${line.name}:${index}`} className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium break-words">{line.name}</span>
              <span className="text-card-muted text-tiny">× {line.quantity}</span>
              {linePrice === null ? null : (
                <span className="text-tiny font-mono font-semibold">{linePrice}</span>
              )}
            </div>
            <SelectionChips selections={line.selections} />
          </li>
        );
      })}
    </ul>
  );
}

function SelectionChips({ selections }: { selections: readonly OrderSelection[] }) {
  if (selections.length === 0) {
    return null;
  }
  return (
    <ul role="list" className="flex flex-wrap gap-1">
      {selections.map((selection) => (
        <li
          key={`${selection.optionName}:${selection.choiceName}`}
          className="border-border bg-muted rounded-pill text-micro max-w-full border px-2 py-0.5 break-words"
        >
          <span className="text-card-muted">{selection.optionName}:</span> {selection.choiceName}
        </li>
      ))}
    </ul>
  );
}

/**
 * Price honesty for one board row: a backfilled legacy order's historical price
 * is unrecoverable (§6.2.9), so it never falls back to the live menu price; an
 * unpriced snapshot row says so; only a known subtotal prints a number.
 */
function OrderPrice({ order }: { order: OrderBoardRow }) {
  if (order.pricingSource === 'legacyUnknown') {
    return <p className="text-card-muted text-tiny">Price not recorded · total at pickup</p>;
  }

  const price = order.subtotal ?? order.itemPrice;

  return (
    <p className="text-tiny flex flex-wrap items-baseline gap-x-1">
      <span className="text-card-muted">{order.items === null ? 'Price' : 'Subtotal'}</span>
      <span
        className={price === null ? 'text-card-muted' : 'text-foreground font-mono font-semibold'}
      >
        {price === null ? 'not listed' : formatPrice(price)}
      </span>
    </p>
  );
}

function ContactLinks({ order }: { order: OrderBoardRow }) {
  if (order.contactPhone === null && order.contactEmail === null) {
    return (
      <p className="text-card-muted text-tiny">No contact details were provided.</p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {order.contactPhone === null ? null : (
        <a
          className="text-primary rounded-control text-sm inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
          href={`tel:${order.contactPhone}`}
          aria-label={`Call ${order.customerName} at ${order.contactPhone}`}
        >
          {order.contactPhone}
        </a>
      )}
      {order.contactEmail === null ? null : (
        <a
          className="text-primary rounded-control text-sm inline-flex min-h-11 items-center break-all underline-offset-4 hover:underline focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
          href={`mailto:${order.contactEmail}`}
          aria-label={`Email ${order.customerName} at ${order.contactEmail}`}
        >
          {order.contactEmail}
        </a>
      )}
    </div>
  );
}

/** One-line note with an explicitly labelled expand/collapse control. */
function OrderNote({ note, customerName }: { note: string; customerName: string }) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeNote(note);

  if (summary === null) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <p className="border-border text-card-muted border-l-2 pl-2 text-sm break-words">
        <span className="font-label text-micro tracking-label uppercase">Note: </span>
        {expanded ? note.trim() : summary.text}
      </p>
      {summary.truncated ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Show less' : 'Show more'} of the note for ${customerName}`}
          onClick={() => setExpanded((current) => !current)}
          className="text-primary rounded-control text-tiny inline-flex min-h-11 items-center px-1 font-semibold underline-offset-4 hover:underline focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}
