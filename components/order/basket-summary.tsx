'use client';

import { CircleAlert, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  MAX_BASKET_UNITS,
  MAX_LINE_QUANTITY,
  basketTotalUnits,
  type BasketLine,
} from '@/lib/basket';
import { formatPrice, formatSubtotal } from '@/lib/order-format';
import { cn } from '@/lib/utils';

import { QuantityStepper } from './basket-controls';

/** §6.7 "Basket restored" copy, exact. */
export function RestoredBasketNote({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="status"
      data-testid="basket-restored"
      className="border-info-border bg-info-soft text-info-strong rounded-control flex items-start justify-between gap-2 border p-3"
    >
      <p className="text-tiny">We restored your basket from this device.</p>
      <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

export function BasketLines({
  lines,
  unavailableLineIds,
  disabled,
  onQuantity,
  onRemove,
}: {
  lines: readonly BasketLine[];
  unavailableLineIds: readonly string[];
  disabled: boolean;
  onQuantity: (lineId: string, quantity: number) => void;
  onRemove: (lineId: string) => void;
}) {
  if (lines.length === 0) {
    return (
      <p className="border-border bg-muted text-card-muted rounded-control border p-3 text-tiny">
        Your basket is empty. Add something from the menu below.
      </p>
    );
  }

  const unavailable = new Set(unavailableLineIds);
  const totalUnits = basketTotalUnits(lines);

  return (
    <ul role="list" aria-label="Your basket" className="flex flex-col gap-2">
      {lines.map((line, index) => {
        const isUnavailable = unavailable.has(line.id);
        const lineTotal = line.unitTotal === undefined ? null : line.unitTotal * line.quantity;
        // The server's unit cap is shared across lines; the stepper should stop
        // where the reducer would clamp, not silently ignore the click.
        const maxQuantity = Math.min(
          MAX_LINE_QUANTITY,
          MAX_BASKET_UNITS - (totalUnits - line.quantity)
        );

        return (
          <li
            key={line.id}
            data-testid={`basket-line-${index}`}
            className={cn(
              'rounded-control flex flex-col gap-2 border p-3',
              isUnavailable ? 'border-danger-border bg-danger-soft' : 'border-border'
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-tiny font-semibold">{line.name}</p>
                {line.selections.length === 0 ? null : (
                  <p className="text-micro text-card-muted">
                    {line.selections
                      .map((selection) => `${selection.optionName}: ${selection.choiceName}`)
                      .join(' · ')}
                  </p>
                )}
                <p className="text-micro text-card-muted">
                  {line.unitTotal === undefined
                    ? 'Price at pickup'
                    : `${formatPrice(line.unitTotal)} each`}
                </p>
              </div>
              <p className="text-tiny font-mono font-semibold">
                {lineTotal === null ? '—' : formatPrice(lineTotal)}
              </p>
            </div>

            {isUnavailable ? (
              <p className="text-micro text-danger-strong flex items-start gap-1.5 font-semibold">
                <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                Sold out or unavailable. Remove this line and send again.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <QuantityStepper
                value={line.quantity}
                label={line.name}
                disabled={disabled}
                max={maxQuantity}
                onChange={(quantity) => onQuantity(line.id, quantity)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11"
                disabled={disabled}
                aria-label={`Remove ${line.name} from basket`}
                onClick={() => onRemove(line.id)}
              >
                <Trash2 aria-hidden className="size-4" />
                Remove
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function BasketTotals({
  lines,
  subtotal,
  disabled,
  onClear,
}: {
  lines: readonly BasketLine[];
  subtotal: number | null;
  disabled: boolean;
  onClear: () => void;
}) {
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="border-border bg-muted rounded-control flex flex-col gap-2 border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="text-micro text-card-muted font-mono tracking-label uppercase">Your order</p>
          <p className="text-tiny font-semibold" aria-live="polite">
            {subtotal === null ? 'Total at pickup' : formatPrice(subtotal)}
          </p>
          <p className="text-micro text-card-muted">
            {lines.length} {lines.length === 1 ? 'item' : 'items'} · {units}{' '}
            {units === 1 ? 'unit' : 'units'}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={disabled || lines.length === 0} onClick={onClear}>
          Clear basket
        </Button>
      </div>
      {subtotal === null ? (
        <p className="text-micro text-card-muted">
          One or more items have no listed price. The business will confirm the total at pickup.
        </p>
      ) : null}
      <p className="text-micro text-card-muted">Pickup only. No account needed.</p>
    </div>
  );
}

/** Sticky mobile bar with the running total and a jump to the details form. */
export function MobileBasketBar({
  subtotal,
  itemCount,
  onReview,
}: {
  subtotal: number | null;
  itemCount: number;
  onReview: () => void;
}) {
  return (
    <div
      data-testid="mobile-basket-bar"
      className="bg-card/95 sticky bottom-0 z-10 -mx-card mt-gap flex items-center justify-between gap-2 border-t px-card py-3 backdrop-blur md:hidden"
    >
      <div className="flex flex-col">
        <span className="text-micro text-card-muted">
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </span>
        <span className="text-tiny font-semibold">{formatSubtotal(subtotal)}</span>
      </div>
      <Button type="button" className="min-h-11" onClick={onReview}>
        Review order
      </Button>
    </div>
  );
}
