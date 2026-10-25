'use client';

import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { Check, CircleAlert, Copy, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Component, useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/convex/_generated/api';
import { resolveOrderError, type ResolvedOrderError } from '@/lib/order-errors';
import { formatSubtotal } from '@/lib/order-format';
import { cn } from '@/lib/utils';

/**
 * Durable token receipt (T8, issue #80; protocol §6.7 "Receipt").
 *
 * The server page fetches the receipt by token, so refresh and bookmarking
 * return the same document. This component only adds live status (a
 * subscription, no full-page reload), the copy-link affordance, and the
 * `new`-only cancel dialog.
 */

/**
 * `projectOrderReceipt` omits the business block when the business document is
 * gone, so the inferred return type is a union; the optional intersection keeps
 * both shapes readable here.
 */
export type ReceiptData = NonNullable<
  FunctionReturnType<typeof api.orders.getOrderByToken>
> & {
  business?: { name: string; phone?: string };
};
type ReceiptStatus = ReceiptData['status'];

const STEPS: readonly { status: ReceiptStatus; label: string }[] = [
  { status: 'new', label: 'Order received' },
  { status: 'accepted', label: 'Accepted' },
  { status: 'ready', label: 'Ready for pickup' },
  { status: 'completed', label: 'Completed' },
];

const STATUS_LABEL: Record<ReceiptStatus, string> = {
  new: 'Order received',
  accepted: 'Accepted',
  ready: 'Ready for pickup',
  completed: 'Completed',
  declined: 'Not accepted',
  cancelled: 'Cancelled',
  expired: 'Expired',
  no_show: 'Not picked up',
};

const STATUS_PILL: Record<ReceiptStatus, string> = {
  new: 'border-info-border bg-info-soft text-info-strong',
  accepted: 'border-warning-border bg-warning-soft text-warning-strong',
  ready: 'border-success-border bg-success-soft text-success-strong',
  completed: 'border-border bg-neutral-chip text-neutral-chip-foreground',
  declined: 'border-danger-border bg-danger-soft text-danger-strong',
  cancelled: 'border-border bg-neutral-chip text-neutral-chip-foreground',
  expired: 'border-warning-border bg-warning-soft text-warning-strong',
  no_show: 'border-danger-border bg-danger-soft text-danger-strong',
};

const VISITOR_CANCEL_REASON = 'Cancelled by customer';

/** §6.7 receipt copy per status. `{phone}` is substituted by the caller. */
function statusSentence(receipt: ReceiptData, phone: string | undefined): string {
  const phoneOrBusiness = phone === undefined || phone.length === 0 ? 'the business' : phone;

  switch (receipt.status) {
    case 'new':
      return 'Order received. The business will call you to confirm.';
    case 'accepted':
      return 'Accepted. The kitchen is preparing your order.';
    case 'ready':
      return 'Ready for pickup.';
    case 'completed':
      return 'Completed. Thanks for ordering.';
    case 'declined':
      return receipt.statusReason === null
        ? "The business couldn't accept this order."
        : `The business couldn't accept this order. Reason: ${receipt.statusReason}.`;
    case 'cancelled':
      if (receipt.statusReason === null || receipt.statusReason === VISITOR_CANCEL_REASON) {
        return 'Your order was cancelled.';
      }
      return `The business cancelled this order. Reason: ${receipt.statusReason}.`;
    case 'expired':
      return 'This order expired before the business accepted it. Place a new order.';
    case 'no_show':
      return `This order was marked as not picked up. Call ${phoneOrBusiness} if this is a mistake.`;
  }
}

function StatusStepper({ status }: { status: ReceiptStatus }) {
  const currentIndex = STEPS.findIndex((step) => step.status === status);
  if (currentIndex < 0) {
    return null;
  }

  return (
    <ol
      aria-label="Order status"
      data-testid="receipt-stepper"
      className="grid grid-cols-4 gap-2 @max-[36rem]:grid-cols-2"
    >
      {STEPS.map((step, index) => {
        const reached = currentIndex >= index;
        const current = currentIndex === index;

        return (
          <li
            key={step.status}
            aria-current={current ? 'step' : undefined}
            className="flex flex-col gap-1"
          >
            <span className="flex items-center gap-1">
              {reached ? (
                <Check aria-hidden className="text-primary size-3.5" />
              ) : (
                <span aria-hidden className="border-border size-3 rounded-full border" />
              )}
              <span
                className={cn(
                  'text-micro font-mono tracking-label uppercase',
                  current ? 'text-foreground font-semibold' : 'text-card-muted'
                )}
              >
                {step.label}
              </span>
              {current ? <span className="sr-only">(current step)</span> : null}
            </span>
            <span aria-hidden className={cn('h-1 rounded-pill', reached ? 'bg-primary' : 'bg-border')} />
          </li>
        );
      })}
    </ol>
  );
}


class ReceiptQueryBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function ReceiptView({
  token,
  receipt,
  onRefresh,
}: {
  token: string;
  receipt: ReceiptData;
  onRefresh: () => void;
}) {
  const cancelOrder = useMutation(api.orders.cancelOrder);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState<ResolvedOrderError | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [announcement, setAnnouncement] = useState('');

  const phone = receipt.business?.phone;
  const businessName = receipt.business?.name;
  const canCancel = receipt.status === 'new';

  // An accept can land while the dialog is open; the button disappears with
  // the status, so close the dialog rather than offering a dead action.
  useEffect(() => {
    if (!canCancel && dialogOpen) {
      setDialogOpen(false);
    }
  }, [canCancel, dialogOpen]);

  async function copyLink() {
    try {
      if (navigator.clipboard === undefined) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(window.location.href);
      setCopyState('copied');
      setAnnouncement('Order link copied to the clipboard.');
    } catch {
      setCopyState('failed');
      setAnnouncement('Copy failed. Copy the address from your browser.');
    }
  }

  async function handleCancel() {
    if (cancelPending) {
      return;
    }
    setCancelPending(true);
    setCancelError(null);

    try {
      await cancelOrder({ token });
      setDialogOpen(false);
      setAnnouncement('Your order was cancelled.');
    } catch (caught) {
      setCancelError(
        resolveOrderError(caught, {
          phone,
        })
      );
    } finally {
      setCancelPending(false);
    }
  }

  return (
    <article className="@container mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-micro text-card-muted font-mono tracking-label uppercase">
          LocalConnect
        </Link>
        <h1 className="text-2xl font-semibold" data-testid="receipt-reference">
          Order #{receipt.reference}
        </h1>
        <p className="text-tiny text-card-muted">
          {businessName ?? 'This business'} · Pickup only
        </p>
      </header>

      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <span
          data-testid={`receipt-status-${receipt.status}`}
          className={cn(
            'rounded-pill w-fit border px-2 py-0.5 text-micro font-semibold',
            STATUS_PILL[receipt.status]
          )}
        >
          {STATUS_LABEL[receipt.status]}
        </span>
        <p className="text-tiny" data-testid="receipt-status-sentence">
          {statusSentence(receipt, phone)}
        </p>
      </div>

      <section aria-labelledby="receipt-status-heading" className="flex flex-col gap-2">
        <h2 id="receipt-status-heading" className="text-tiny font-semibold">
          Status
        </h2>
        <StatusStepper status={receipt.status} />
        {canCancel ? (
          <p className="text-micro text-card-muted">
            You can cancel while the business has not accepted yet.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="receipt-items-heading" className="flex flex-col gap-2">
        <h2 id="receipt-items-heading" className="text-tiny font-semibold">
          Items
        </h2>
        <ul role="list" className="border-border divide-border flex flex-col divide-y rounded-control border">
          {receipt.items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="flex flex-col gap-0.5 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-tiny font-semibold">
                  {item.quantity} × {item.name}
                </p>
              </div>
              {item.selections.length === 0 ? null : (
                <p className="text-micro text-card-muted">
                  {item.selections
                    .map((selection) => `${selection.optionName}: ${selection.choiceName}`)
                    .join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
        <dl className="border-border flex items-baseline justify-between gap-2 border-t pt-2 text-tiny">
          <dt className="text-card-muted">{receipt.subtotal === null ? 'Total' : 'Subtotal'}</dt>
          <dd
            className={cn(
              'text-right font-mono font-semibold',
              receipt.subtotal === null ? 'text-card-muted' : ''
            )}
            data-testid="receipt-subtotal"
          >
            {formatSubtotal(receipt.subtotal)}
          </dd>
        </dl>
        {receipt.subtotal === null ? (
          <p className="text-micro text-card-muted">
            This order was placed without item prices. Confirm the total with the business.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="receipt-contact-heading" className="flex flex-col gap-1">
        <h2 id="receipt-contact-heading" className="text-tiny font-semibold">
          Contact
        </h2>
        {receipt.contact.phone === undefined ? null : (
          <p className="text-tiny">{receipt.contact.phone}</p>
        )}
        {receipt.contact.email === undefined ? null : (
          <p className="text-tiny">{receipt.contact.email}</p>
        )}
        {receipt.contact.phone === undefined && receipt.contact.email === undefined ? (
          <p className="text-tiny text-card-muted">No contact details recorded.</p>
        ) : null}
        <p className="text-micro text-card-muted">
          Contact details are masked on this page so the link is safe to share with the business.
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          data-testid="receipt-copy-link"
          onClick={copyLink}
        >
          {copyState === 'copied' ? (
            <CheckCheck aria-hidden className="size-4" />
          ) : (
            <Copy aria-hidden className="size-4" />
          )}
          {copyState === 'copied' ? 'Link copied' : 'Copy order link'}
        </Button>
        {phone === undefined || phone.length === 0 ? null : (
          <Button asChild variant="outline" className="min-h-11">
            <a href={`tel:${phone}`}>Call {businessName ?? 'the business'}</a>
          </Button>
        )}
        {canCancel ? (
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            data-testid="receipt-cancel"
            onClick={() => {
              setCancelError(null);
              setDialogOpen(true);
            }}
          >
            Cancel order
          </Button>
        ) : null}
        {receipt.status === 'new' ? null : (
          <Button asChild variant="ghost" className="min-h-11">
            <Link href="/">Browse businesses</Link>
          </Button>
        )}
      </div>

      {canCancel ? null : (
        <p className="text-micro text-card-muted">
          {receipt.status === 'accepted' || receipt.status === 'ready'
            ? 'This order can no longer be cancelled online. Call the business if you need to change it.'
            : 'This order is closed.'}
        </p>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {copyState === 'failed' ? (
        <p className="text-micro text-danger-strong">
          Copy failed. Select the address bar to copy this page&apos;s link.
        </p>
      ) : null}

      <p className="text-micro text-card-muted">
        Keep this link: it is the receipt for your order. Bookmark it to check the status later.
      </p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this order?</DialogTitle>
            <DialogDescription>
              The kitchen may have started; cancel only if you need to.
            </DialogDescription>
          </DialogHeader>

          {cancelError === null ? null : (
            <div
              role="alert"
              data-testid="receipt-cancel-error"
              className="border-danger-border bg-danger-soft text-danger-strong rounded-control flex flex-col gap-2 border p-3"
            >
              <p className="flex items-start gap-2 text-tiny font-semibold">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {cancelError.copy}
              </p>
              <p className="text-micro">
                <span className="font-semibold">Next:</span> {cancelError.recoveryAction}
              </p>
              {cancelError.recovery === 'refresh' ? (
                <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
                  Refresh
                </Button>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={cancelPending}
              onClick={() => setDialogOpen(false)}
            >
              Keep order
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              disabled={cancelPending}
              onClick={handleCancel}
            >
              {cancelPending ? 'Cancelling…' : 'Cancel order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

export function OrderReceipt({ token, initial }: { token: string; initial: ReceiptData }) {
  const router = useRouter();
  const refresh = () => {
    router.refresh();
  };

  return (
    <ReceiptQueryBoundary
      fallback={<ReceiptView token={token} receipt={initial} onRefresh={refresh} />}
    >
      <ReceiptLive token={token} initial={initial} onRefresh={refresh} />
    </ReceiptQueryBoundary>
  );
}

function ReceiptLive({
  token,
  initial,
  onRefresh,
}: {
  token: string;
  initial: ReceiptData;
  onRefresh: () => void;
}) {
  const live = useQuery(api.orders.getOrderByToken, { token });
  return <ReceiptView token={token} receipt={live ?? initial} onRefresh={onRefresh} />;
}
