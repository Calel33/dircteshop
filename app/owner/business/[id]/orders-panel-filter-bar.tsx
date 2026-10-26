'use client';

import type { FunctionReturnType } from 'convex/server';

import { api } from '@/convex/_generated/api';

import { ORDER_FILTERS, countChipLabel, type OrderFilter } from './orders-panel-helpers';

type OrderCounts = FunctionReturnType<typeof api.orders.listOrderCounts>;

const FILTER_BUTTON_CLASS =
  'rounded-pill text-micro font-label inline-flex min-h-11 items-center gap-2 border px-3 py-1 font-semibold transition-colors focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none';
const ACTIVE_CLASS = 'border-primary bg-primary text-primary-foreground';
const IDLE_CLASS = 'border-border bg-card text-card-muted hover:bg-muted hover:text-foreground';

/**
 * The nine §6.8 filters with their live count chips. Toggle buttons (not a
 * tablist) keep every filter directly reachable by Tab; `aria-pressed` carries
 * the active state, and the count is decorative with a screen-reader suffix.
 */
export function OrdersFilterBar({
  selected,
  counts,
  onChange,
}: {
  selected: OrderFilter;
  counts: OrderCounts | undefined;
  onChange: (filter: OrderFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter orders by status"
      aria-busy={counts === undefined}
      className="flex flex-wrap gap-2"
    >
      {ORDER_FILTERS.map((entry) => {
        const active = selected === entry.value;
        const count = counts?.[entry.value];
        return (
          <button
            key={entry.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(entry.value)}
            className={`${FILTER_BUTTON_CLASS} ${active ? ACTIVE_CLASS : IDLE_CLASS}`}
          >
            <span>{entry.label}</span>
            {count === undefined ? null : (
              <span
                aria-hidden="true"
                className={`rounded-pill text-micro px-2 py-0.5 font-mono ${
                  active
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-neutral-chip text-neutral-chip-foreground'
                }`}
              >
                {countChipLabel(count.count, count.capped)}
              </span>
            )}
            {count === undefined ? null : (
              <span className="sr-only">
                {count.capped ? ', more than 100 orders' : `, ${count.count} orders`}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
