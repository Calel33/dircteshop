'use client';

import { CircleAlert, Minus, Plus } from 'lucide-react';
import Link from 'next/link';
import type { RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { formatPrice, formatSubtotal } from '@/lib/order-format';
import type { ResolvedOrderError } from '@/lib/order-errors';

/** 44×44 targets and text labels, per §6.7 mobile rules. */
export function QuantityStepper({
  value,
  label,
  disabled = false,
  max = 20,
  onChange,
}: {
  value: number;
  label: string;
  disabled?: boolean;
  max?: number;
  onChange: (quantity: number) => void;
}) {
  return (
    <div role="group" aria-label={`Quantity for ${label}`} className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        className="size-11 rounded-control"
        disabled={disabled || value <= 1}
        aria-label={`Decrease quantity for ${label}`}
        onClick={() => onChange(value - 1)}
      >
        <Minus aria-hidden className="size-4" />
      </Button>
      <span className="min-w-8 text-center text-tiny font-semibold tabular-nums">
        <span className="sr-only">Quantity: </span>
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        className="size-11 rounded-control"
        disabled={disabled || value >= max}
        aria-label={`Increase quantity for ${label}`}
        onClick={() => onChange(value + 1)}
      >
        <Plus aria-hidden className="size-4" />
      </Button>
    </div>
  );
}

export function PriceChangeNotice({
  previousSubtotal,
  actualSubtotal,
  isSubmitting,
  onReconfirm,
}: {
  previousSubtotal: number | null;
  actualSubtotal: number;
  isSubmitting: boolean;
  onReconfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-tiny font-semibold">Prices changed while you were ordering.</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-tiny">
        <dt className="text-card-muted">Previous total</dt>
        <dd className="text-right font-mono">{formatSubtotal(previousSubtotal)}</dd>
        <dt className="text-card-muted">New total</dt>
        <dd className="text-right font-mono font-semibold">{formatPrice(actualSubtotal)}</dd>
      </dl>
      <p className="text-micro text-card-muted">
        Nothing has been sent. Review the new total and send again.
      </p>
      <Button type="button" size="sm" className="min-h-11 self-start" disabled={isSubmitting} onClick={onReconfirm}>
        {isSubmitting ? 'Sending…' : 'Review and send again'}
      </Button>
    </div>
  );
}

/**
 * Inline, persistent, focused error (§6.7). The copy and the recovery line come
 * from the client error map, never from a raw server message.
 */
export function OrderErrorSummary({
  error,
  businessName,
  phone,
  summaryRef,
  isSubmitting,
  priceChange,
  onReconfirm,
  onRefresh,
}: {
  error: ResolvedOrderError;
  businessName: string;
  phone?: string;
  summaryRef: RefObject<HTMLDivElement | null>;
  isSubmitting: boolean;
  priceChange: { previousSubtotal: number | null; actualSubtotal: number } | null;
  onReconfirm: () => void;
  onRefresh: () => void;
}) {
  return (
    <div
      ref={summaryRef}
      tabIndex={-1}
      role="alert"
      data-testid="basket-error-summary"
      className="border-danger-border bg-danger-soft text-danger-strong rounded-control flex flex-col gap-2 border p-3 outline-none"
    >
      <p className="flex items-start gap-2 text-tiny font-semibold">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {error.copy}
      </p>
      <p className="text-micro">
        <span className="font-semibold">Next:</span> {error.recoveryAction}
      </p>
      {phone !== undefined && phone.length > 0 && error.recovery === 'call' ? (
        <a className="text-micro underline underline-offset-2" href={`tel:${phone}`}>
          Call {businessName}
        </a>
      ) : null}
      {error.recovery === 'refresh' ? (
        <Button type="button" size="sm" variant="outline" className="min-h-11 self-start" onClick={onRefresh}>
          Refresh
        </Button>
      ) : null}
      {error.recovery === 'back-to-directory' ? (
        <Button asChild size="sm" variant="outline" className="min-h-11 self-start">
          <Link href="/">Browse businesses</Link>
        </Button>
      ) : null}
      {priceChange === null ? null : (
        <PriceChangeNotice
          previousSubtotal={priceChange.previousSubtotal}
          actualSubtotal={priceChange.actualSubtotal}
          isSubmitting={isSubmitting}
          onReconfirm={onReconfirm}
        />
      )}
    </div>
  );
}

/** Browse-only state: the menu stays readable, ordering is disabled. */
export function OrderingPausedBanner({
  copy,
  businessName,
  phone,
}: {
  copy: string;
  businessName: string;
  phone?: string;
}) {
  return (
    <div
      role="status"
      data-testid="ordering-paused-banner"
      className="border-warning-border bg-warning-soft text-warning-strong rounded-control flex flex-col gap-1 border p-3"
    >
      <p className="text-tiny font-semibold">{copy}</p>
      <p className="text-micro">You can browse the menu, but ordering is paused.</p>
      {phone === undefined || phone.length === 0 ? null : (
        <a className="text-micro underline underline-offset-2" href={`tel:${phone}`}>
          Call {businessName}
        </a>
      )}
    </div>
  );
}
