'use client';

import { Button } from '@/components/ui/button';

/**
 * Bulk-approve confirmation, inline in the dataset column (prototype
 * `bulkConfirmForm` inside `.inline-confirm`) rather than in a centred modal.
 */
export function DirectoryBulkConfirm({
  count,
  onConfirm,
  onCancel,
  isPending,
  error,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <div className="border-border-strong bg-card rounded-menu grid gap-3 border p-3">
      <div className="border-border bg-panel text-muted-foreground rounded-menu border p-3 text-tiny">
        Approve <b>{count}</b> selected listings in one action? Each listing writes its own{' '}
        <code className="font-mono">auditLogs</code> row.
      </div>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-input"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="rounded-input"
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? 'Approving…' : `Approve ${count}`}
        </Button>
      </div>
    </div>
  );
}
