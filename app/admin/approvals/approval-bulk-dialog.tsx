'use client';

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

/**
 * Bulk-approve action bar (issue #14 / B3c Task 5). Rendered by the route only
 * while at least one current-page item is selected, so it stays hidden
 * otherwise. Only Approve is offered (SPEC §10: "bulk approve only").
 */
export function ApprovalBulkBar({
  count,
  disabled,
  onApprove,
}: {
  count: number;
  disabled: boolean;
  onApprove: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="bg-muted flex flex-wrap items-center justify-between gap-2 rounded-control px-card py-3"
    >
      <span className="text-sm" role="status">
        {count} selected
      </span>
      <Button type="button" onClick={onApprove} disabled={disabled}>
        Approve selected
      </Button>
    </div>
  );
}

/**
 * Count-confirmed bulk-approve modal (issue #14 / B3c Task 5). Controlled by the
 * route: it names the exact selected count, offers only Approve, disables every
 * close path and the confirm button while a request is in flight (so a duplicate
 * submission is impossible), and surfaces an actionable error without reporting
 * false success. The single atomic `approveSelected` mutation either approves
 * every selected listing or none; the route clears the selection only after the
 * server commit.
 */
export function ApprovalBulkDialog({
  open,
  count,
  isSubmitting,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  isSubmitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const noun = count === 1 ? 'submission' : 'submissions';

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
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
          <DialogTitle>
            Approve {count} {noun}?
          </DialogTitle>
          <DialogDescription>
            This publishes every selected listing and adds a verification stamp to each. One audit row
            is recorded per listing. If any listing is no longer pending review, none are approved.
          </DialogDescription>
        </DialogHeader>

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
          <Button type="button" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? 'Approving…' : `Approve ${count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
