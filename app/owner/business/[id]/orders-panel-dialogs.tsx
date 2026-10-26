'use client';

import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { formatPrice } from '@/components/profile/ordering-panel-helpers';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  DEFAULT_NO_SHOW_REASON,
  MAX_TRANSITION_REASON_LENGTH,
} from '../../../../convex/orderCommitPolicy.ts';
import type { OrderOwnerAction } from '../../../../convex/orderPolicy.ts';
import type { OrderBoardRow } from './orders-panel-row';

// Owner decision dialogs for the order board (issue #82, Task 3). One controlled
// Radix dialog per reason-bearing action; the board owns the request, the
// mutation, and the pending/error bookkeeping, so every dialog here is a
// presentation of one state (§6.8: "No optimistic status changes; wait for the
// server"). The reason vocabulary and its 1–200 rule come from
// `convex/orderCommitPolicy.ts`, the server's own validator — the client copy is
// a mirror for fast feedback, never the boundary (research Q7).

/** The protocol actions that need a dialog; `ready`/`complete` stay one-tap. */
export type OrdersDialogRequest = {
  order: OrderBoardRow;
  action: OrderOwnerAction;
};

/** Coded decline reasons, in the §6.8 order. The label is stored verbatim. */
const DECLINE_REASONS = ['Sold out', 'Unreachable', 'Too busy', 'Duplicate', 'Other'] as const;

type DeclineReasonCode = (typeof DECLINE_REASONS)[number];

const OTHER_CODE: DeclineReasonCode = 'Other';

const LINK_CLASS =
  'text-primary rounded-control text-sm inline-flex min-h-11 items-center break-all underline-offset-4 hover:underline focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none';

/**
 * The client mirror of `validateTransitionReason`: missing when trimmed length
 * is 0, too long past the server's cap. Returns the inline message so the
 * field's help text and the confirm button share one rule.
 */
function reasonIssue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Enter a reason before continuing.';
  }
  if (trimmed.length > MAX_TRANSITION_REASON_LENGTH) {
    return `Keep the reason to ${MAX_TRANSITION_REASON_LENGTH} characters or fewer.`;
  }
  return null;
}

/** Empty reasons are omitted from the mutation, never sent as an empty string. */
function reasonForSubmit(value: string): string | undefined {
  return value.trim().length === 0 ? undefined : value;
}

/**
 * `Accept verified` copy (§6.8). The phone-less variant keeps the same
 * instruction — reach them, confirm the items and pickup time, and do not
 * accept otherwise — without printing a dangling "at .".
 */
function verificationCopy(order: OrderBoardRow): string {
  if (order.contactPhone !== null) {
    return `Call ${order.customerName} at ${order.contactPhone}. Confirm the items and pickup time. Only accept if you reach them.`;
  }
  return `No phone number on file for ${order.customerName}. Confirm the items and pickup time with them before you accept. Only accept if you reach them.`;
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

/**
 * The dialog frame every action shares: Radix focus trap, Escape/outside-click
 * close (both blocked while the mutation is in flight, per the approval-dialog
 * house pattern), a labelled title/description, and a footer.
 */
function DialogShell({
  order,
  title,
  description,
  pending,
  onClose,
  children,
  footer,
}: {
  order: OrderBoardRow;
  title: string;
  description: string;
  pending: boolean;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) {
          onClose();
        }
      }}
    >
      <DialogContent
        aria-busy={pending}
        // The primitive's icon-only X is below the minimum target size and would
        // duplicate this frame's footer Close; every dialog closes through the
        // labelled footer button, Escape, or the overlay, all guarded while a
        // mutation is in flight.
        showCloseButton={false}
        className="flex max-h-[90vh] flex-col gap-gap overflow-y-auto"
        onEscapeKeyDown={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {order.reference === null ? null : (
            <p className="text-card-muted font-label text-micro">
              Order reference{' '}
              <span className="text-foreground font-mono font-semibold">{order.reference}</span>
            </p>
          )}
        </DialogHeader>
        {children}
        <DialogFooter>{footer}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Server error for this dialog, with the house alert + retry affordance. */
function DialogError({
  message,
  pending,
  onRetry,
}: {
  message: string | null;
  pending: boolean;
  onRetry: () => void;
}) {
  if (message === null) {
    return null;
  }

  return (
    <div
      role="alert"
      className="border-danger-border bg-danger-soft rounded-control flex flex-wrap items-center gap-2 border p-3"
    >
      <p className="text-danger-strong text-sm">{message}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-11"
        disabled={pending}
        onClick={onRetry}
      >
        Try again
      </Button>
    </div>
  );
}

/** A required/optional reason field with its inline rule and character count. */
function ReasonField({
  id,
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const issue = reasonIssue(value);
  const count = value.trim().length;
  const over = count > MAX_TRANSITION_REASON_LENGTH;
  const helpId = `${id}-help`;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={over}
        aria-describedby={helpId}
        className="min-h-11"
      />
      <p
        id={helpId}
        className={cn('text-tiny', over ? 'text-danger-strong' : 'text-card-muted')}
        role={over ? 'alert' : undefined}
      >
        {over
          ? issue
          : `${count}/${MAX_TRANSITION_REASON_LENGTH} characters.`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order digest (read-only summary shared by the accept + decline dialogs)
// ---------------------------------------------------------------------------

function SelectionList({
  selections,
}: {
  selections: readonly { optionName: string; choiceName: string }[];
}) {
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

function ContactDetails({ order }: { order: OrderBoardRow }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-card-muted font-label text-micro tracking-label uppercase">Contact</h3>
      <p className="text-sm font-semibold break-words">{order.customerName}</p>
      {order.contactPhone === null && order.contactEmail === null ? (
        <p className="text-card-muted text-tiny">No contact details were provided.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {order.contactPhone === null ? null : (
            <a
              className={LINK_CLASS}
              href={`tel:${order.contactPhone}`}
              aria-label={`Call ${order.customerName} at ${order.contactPhone}`}
            >
              Call {order.contactPhone}
            </a>
          )}
          {order.contactEmail === null ? null : (
            <a
              className={LINK_CLASS}
              href={`mailto:${order.contactEmail}`}
              aria-label={`Email ${order.customerName} at ${order.contactEmail}`}
            >
              {order.contactEmail}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function OrderDigest({ order }: { order: OrderBoardRow }) {
  const price = order.subtotal ?? order.itemPrice;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-card-muted font-label text-micro tracking-label uppercase">Items</h3>
      {order.items === null ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium break-words">
            {order.itemName}
            <span className="text-card-muted text-tiny"> × 1</span>
          </p>
          <SelectionList selections={order.selections} />
        </div>
      ) : (
        <ul role="list" className="flex flex-col gap-2">
          {order.items.map((line, index) => (
            <li key={`${line.name}:${index}`} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium break-words">{line.name}</span>
                <span className="text-card-muted text-tiny">× {line.quantity}</span>
                {line.lineTotal === null ? null : (
                  <span className="text-tiny font-mono font-semibold">
                    {formatPrice(line.lineTotal)}
                  </span>
                )}
              </div>
              <SelectionList selections={line.selections} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-tiny flex flex-wrap items-baseline gap-x-1">
        <span className="text-card-muted">{order.items === null ? 'Price' : 'Subtotal'}</span>
        {order.pricingSource === 'legacyUnknown' ? (
          <span className="text-card-muted">not recorded · total at pickup</span>
        ) : (
          <span
            className={
              price === null ? 'text-card-muted' : 'text-foreground font-mono font-semibold'
            }
          >
            {price === null ? 'not listed' : formatPrice(price)}
          </span>
        )}
      </p>

      {order.note === null ? null : (
        <p className="border-border text-card-muted border-l-2 pl-2 text-sm break-words">
          <span className="font-label text-micro tracking-label uppercase">Note: </span>
          {order.note.trim()}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

function AcceptDialog({
  order,
  pending,
  error,
  onClose,
  onSubmit,
  onSwitchAction,
}: {
  order: OrderBoardRow;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (action: OrderOwnerAction, reason: string | undefined) => void;
  onSwitchAction: (action: OrderOwnerAction) => void;
}) {
  return (
    <DialogShell
      order={order}
      title={`Accept order from ${order.customerName}`}
      description="Accepting tells the customer the order is confirmed. There is no checkbox — this action is the confirmation."
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={pending}
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={() => onSwitchAction('decline')}
          >
            Decline
          </Button>
          <Button
            type="button"
            className="min-h-11"
            disabled={pending}
            aria-busy={pending}
            onClick={() => onSubmit('accept', undefined)}
          >
            {pending ? 'Accepting…' : 'Accept verified'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-gap">
        <ContactDetails order={order} />
        <OrderDigest order={order} />
        <p className="border-warning-border bg-warning-soft text-warning-strong rounded-control border p-3 text-sm">
          {verificationCopy(order)}
        </p>
        <DialogError message={error} pending={pending} onRetry={() => onSubmit('accept', undefined)} />
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Decline
// ---------------------------------------------------------------------------

function DeclineDialog({
  order,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  order: OrderBoardRow;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (action: OrderOwnerAction, reason: string | undefined) => void;
}) {
  const [code, setCode] = useState<DeclineReasonCode | ''>('');
  const [other, setOther] = useState('');
  const selectId = useId();
  const otherId = useId();

  const isOther = code === OTHER_CODE;
  const reason = isOther ? other : code;
  const blocked = code === '' || reasonIssue(reason) !== null;

  function handleSubmit() {
    if (blocked) {
      return;
    }
    onSubmit('decline', reasonForSubmit(reason));
  }

  return (
    <DialogShell
      order={order}
      title={`Decline order from ${order.customerName}`}
      description="The customer sees this reason on their receipt. Decline only when you cannot take the order."
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={blocked || pending}
            aria-busy={pending}
            onClick={handleSubmit}
          >
            {pending ? 'Declining…' : 'Decline order'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-gap">
        <OrderDigest order={order} />

        <div className="flex flex-col gap-2">
          <Label id={`${selectId}-label`} htmlFor={selectId}>
            Reason
          </Label>
          <Select
            value={code}
            disabled={pending}
            onValueChange={(value) => {
              const next = DECLINE_REASONS.find((candidate) => candidate === value);
              setCode(next ?? '');
            }}
          >
            <SelectTrigger
              id={selectId}
              aria-labelledby={`${selectId}-label`}
              className="min-h-11 w-full"
            >
              <SelectValue placeholder="Choose a reason" />
            </SelectTrigger>
            <SelectContent>
              {DECLINE_REASONS.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {candidate}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isOther ? (
          <ReasonField
            id={otherId}
            label="Explain the reason"
            placeholder="Tell the customer why this order was declined…"
            value={other}
            disabled={pending}
            onChange={setOther}
          />
        ) : null}

        <DialogError message={error} pending={pending} onRetry={handleSubmit} />
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Cancel (after accept)
// ---------------------------------------------------------------------------

function CancelDialog({
  order,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  order: OrderBoardRow;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (action: OrderOwnerAction, reason: string | undefined) => void;
}) {
  const [reason, setReason] = useState('');
  const reasonId = useId();

  const blocked = reasonIssue(reason) !== null;

  function handleSubmit() {
    if (blocked) {
      return;
    }
    onSubmit('cancel', reasonForSubmit(reason));
  }

  return (
    <DialogShell
      order={order}
      title={`Cancel order from ${order.customerName}`}
      description="The kitchen may have started this order. Cancel only if you need to — the customer sees your reason on their receipt."
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={onClose}
          >
            Keep order
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={blocked || pending}
            aria-busy={pending}
            onClick={handleSubmit}
          >
            {pending ? 'Cancelling…' : 'Cancel order'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-gap">
        <OrderDigest order={order} />
        <ReasonField
          id={reasonId}
          label="Reason for cancelling"
          placeholder="Why is this order being cancelled?"
          value={reason}
          disabled={pending}
          onChange={setReason}
        />
        <DialogError message={error} pending={pending} onRetry={handleSubmit} />
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// No-show
// ---------------------------------------------------------------------------

function NoShowDialog({
  order,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  order: OrderBoardRow;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (action: OrderOwnerAction, reason: string | undefined) => void;
}) {
  const [reason, setReason] = useState(DEFAULT_NO_SHOW_REASON);
  const reasonId = useId();

  // The reason is optional for `noShow`; only an over-long value blocks.
  const tooLong = reason.trim().length > MAX_TRANSITION_REASON_LENGTH;

  function handleSubmit() {
    if (tooLong) {
      return;
    }
    onSubmit('noShow', reasonForSubmit(reason));
  }

  return (
    <DialogShell
      order={order}
      title={`Mark order from ${order.customerName} as not picked up`}
      description="Use this only after the pickup window has passed. The customer's receipt shows the order was not picked up."
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={pending}
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={tooLong || pending}
            aria-busy={pending}
            onClick={handleSubmit}
          >
            {pending ? 'Saving…' : 'Mark no-show'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-gap">
        <OrderDigest order={order} />
        <ReasonField
          id={reasonId}
          label="Reason (optional)"
          placeholder={DEFAULT_NO_SHOW_REASON}
          value={reason}
          disabled={pending}
          onChange={setReason}
        />
        <DialogError message={error} pending={pending} onRetry={handleSubmit} />
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Renders the dialog for the board's pending request. `ready` and `complete`
 * never reach this component (they are one-tap), so an unexpected action
 * renders nothing rather than inventing a confirmation.
 *
 * The inner dialog is keyed by order + action so switching Accept → Decline
 * remounts the form and resets its fields instead of carrying a half-typed
 * reason across actions.
 */
export function OrdersDialogs({
  request,
  pending,
  error,
  onSubmit,
  onSwitchAction,
  onClose,
}: {
  request: OrdersDialogRequest | null;
  pending: boolean;
  error: string | null;
  onSubmit: (action: OrderOwnerAction, reason: string | undefined) => void;
  onSwitchAction: (action: OrderOwnerAction) => void;
  onClose: () => void;
}) {
  if (request === null) {
    return null;
  }

  const { order, action } = request;
  const key = `${order._id}:${action}`;

  switch (action) {
    case 'accept':
      return (
        <AcceptDialog
          key={key}
          order={order}
          pending={pending}
          error={error}
          onClose={onClose}
          onSubmit={onSubmit}
          onSwitchAction={onSwitchAction}
        />
      );
    case 'decline':
      return (
        <DeclineDialog
          key={key}
          order={order}
          pending={pending}
          error={error}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      );
    case 'cancel':
      return (
        <CancelDialog
          key={key}
          order={order}
          pending={pending}
          error={error}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      );
    case 'noShow':
      return (
        <NoShowDialog
          key={key}
          order={order}
          pending={pending}
          error={error}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      );
    default:
      return null;
  }
}
