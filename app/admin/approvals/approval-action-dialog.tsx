'use client';

import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  actionRequiresReason,
  canSubmitDecision,
  type ApprovalAction,
} from './approval-actions-policy';
import type { ApprovalCard } from './approval-types';

interface ActionCopy {
  title: (name: string) => string;
  description: string;
  confirmLabel: string;
  busyLabel: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonHelp?: string;
}

/**
 * The explicit consequence copy shown before each decision (SPEC §10). Approve
 * has no reason; Changes/Reject require one. Reject is the only destructive
 * confirm.
 */
const ACTION_COPY: Record<ApprovalAction, ActionCopy> = {
  approve: {
    title: (name) => `Approve ${name}?`,
    description:
      'This publishes the listing and adds a verification stamp. It becomes visible to the public immediately.',
    confirmLabel: 'Approve listing',
    busyLabel: 'Approving…',
  },
  requestChanges: {
    title: (name) => `Request changes to ${name}`,
    description:
      'The owner sees your reason and can revise and resubmit. The listing stays private until it is approved.',
    confirmLabel: 'Request changes',
    busyLabel: 'Sending…',
    reasonLabel: 'Reason for changes',
    reasonPlaceholder: 'Explain what the owner needs to change…',
    reasonHelp: 'Sent to the owner and recorded in the audit log.',
  },
  reject: {
    title: (name) => `Reject ${name}`,
    description:
      'The owner sees your reason. The listing is rejected and stays hidden from the public.',
    confirmLabel: 'Reject listing',
    busyLabel: 'Rejecting…',
    reasonLabel: 'Reason for rejection',
    reasonPlaceholder: 'Explain why this listing is rejected…',
    reasonHelp: 'Sent to the owner and recorded in the audit log.',
  },
};

/**
 * The required reason field for Changes/Reject. It is the first focusable
 * element in the dialog, so Radix focuses it on open (per its documented
 * auto-focus behavior). Whitespace-only input is flagged inline and keeps the
 * dialog's confirm button disabled.
 */
function ReasonField({
  id,
  label,
  placeholder,
  help,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  help: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const invalid = value.length > 0 && value.trim().length === 0;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required
        aria-invalid={invalid}
        aria-describedby={`${id}-help`}
      />
      <p
        id={`${id}-help`}
        className={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}
        role={invalid ? 'alert' : undefined}
      >
        {invalid ? 'A reason is required before submitting.' : help}
      </p>
    </div>
  );
}

/**
 * Confirmation / required-reason modal for one pending card decision
 * (issue #13 / B3b todo #5). Mounted per open decision and unmounted on close.
 * It is a controlled Radix dialog: Esc, Cancel, the close button, and
 * outside-click all close without mutating (Radix calls `onOpenChange(false)`).
 * While a decision is in flight every close path is guarded and the buttons are
 * disabled, so a decision can never be submitted twice.
 *
 * `onConfirm` receives the raw textarea value; the route trims it via
 * `normalizeReason` and the server re-validates.
 */
export function ApprovalActionDialog({
  card,
  action,
  isSubmitting,
  error,
  onCancel,
  onConfirm,
}: {
  card: ApprovalCard;
  action: ApprovalAction;
  isSubmitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const copy = ACTION_COPY[action];
  const requiresReason = actionRequiresReason(action);
  const [reason, setReason] = useState('');
  const reasonId = useId();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <DialogContent
        showCloseButton={!isSubmitting}
        onEscapeKeyDown={(event) => {
          if (isSubmitting) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{copy.title(card.name)}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        {requiresReason ? (
          <ReasonField
            id={reasonId}
            label={copy.reasonLabel ?? ''}
            placeholder={copy.reasonPlaceholder ?? ''}
            help={copy.reasonHelp ?? ''}
            value={reason}
            disabled={isSubmitting}
            onChange={setReason}
          />
        ) : null}

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={isSubmitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant={action === 'reject' ? 'destructive' : 'default'}
            onClick={() => onConfirm(reason)}
            disabled={!canSubmitDecision(action, reason) || isSubmitting}
          >
            {isSubmitting ? copy.busyLabel : copy.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
