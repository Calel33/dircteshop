'use client';

import { useEffect, useState } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { StarRating, StatusChip, VerificationChip } from '@/app/admin/status-chip';
import { AdminDirectoryRow } from './directory-types';
import { actionsForStatus, ACTION_LABELS } from './directory-actions-policy';
import { DirectoryInlineConfirm } from './directory-inline-confirm';

/** One `.detail-list` row: 6rem key column, fluid value column. */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid-cols-(--grid-detail) grid gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** The prototype's `.detail-list`: the eight inspector facts, in order. */
function DetailList({ row }: { row: AdminDirectoryRow }) {
  const location = [row.address.city, row.address.state].filter(Boolean).join(', ');

  return (
    <div className="grid gap-2 text-tiny">
      <DetailRow label="Owner">{row.ownerName ?? 'Unknown'}</DetailRow>
      <DetailRow label="Email">
        <span className="font-mono text-xs">{row.email ?? '—'}</span>
      </DetailRow>
      <DetailRow label="Category">{row.categoryName ?? 'Uncategorized'}</DetailRow>
      <DetailRow label="Location">{location || '—'}</DetailRow>
      <DetailRow label="Verification">
        <VerificationChip verified={row.isVerified} />
      </DetailRow>
      <DetailRow label="Rating">
        <StarRating rating={row.rating} />
      </DetailRow>
      <DetailRow label="Submitted">
        {row.submittedAt === null ? '—' : new Date(row.submittedAt).toLocaleDateString()}
      </DetailRow>
      <DetailRow label="Created">
        <span className="font-mono text-xs">{new Date(row.createdAt).toLocaleDateString()}</span>
      </DetailRow>
    </div>
  );
}

/**
 * The prototype's persistent inspector (Variant B `.insp`): a 20rem column
 * whose head carries the listing name and status chip, whose body is a
 * `.detail-list`, and whose footer is either the stacked action buttons for
 * the current status or an inline `.insp-step` confirmation. Below the deck
 * breakpoint the route hides the column and this renders as the prototype's
 * bottom sheet instead.
 */
export function DirectoryInspector({
  row,
  onClose,
  onAction,
  isPending,
  error,
  isMobile,
}: {
  row: AdminDirectoryRow | null;
  onClose: () => void;
  onAction: (action: string, options?: { reason?: string; confirmName?: string }) => Promise<void>;
  isPending: boolean;
  error: string | null;
  isMobile?: boolean;
}) {
  const [activeAction, setActiveAction] = useState<string | null>(null);

  useEffect(() => {
    setActiveAction(null);
  }, [row?._id]);

  const handleAction = async (action: string, options?: { reason?: string; confirmName?: string }) => {
    try {
      await onAction(action, options);
      setActiveAction(null);
    } catch {
      // Error is handled via props
    }
  };

  if (!row) {
    return (
      <div className="p-4">
        <p className="text-muted-foreground text-tiny">
          Select a listing to inspect. Actions and their confirmations happen here, in place.
        </p>
      </div>
    );
  }

  const actions = actionsForStatus(row.status);
  const isDangerAction =
    activeAction === 'delete' || activeAction === 'reject' || activeAction === 'suspend';

  const content = (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <b className="text-sm font-semibold">{row.name}</b>
        <span className="flex-1" />
        <StatusChip status={row.status} />
      </div>

      <div className="grid content-start gap-4 p-4">
        <DetailList row={row} />

        {activeAction === null ? (
          <div className="grid gap-2">
            {actions.map((action) => (
              <Button
                key={action}
                type="button"
                size="sm"
                variant={
                  action === 'delete' || action === 'reject'
                    ? 'destructive'
                    : action === 'approve'
                      ? 'default'
                      : 'outline'
                }
                className="rounded-input w-full"
                onClick={() => setActiveAction(action)}
              >
                {ACTION_LABELS[action]}
              </Button>
            ))}
          </div>
        ) : (
          <div
            className={cn(
              'rounded-menu grid gap-3 border p-3',
              isDangerAction ? 'border-danger-border bg-danger-soft' : 'border-border'
            )}
          >
            <b className="text-sm font-semibold">{ACTION_LABELS[activeAction as keyof typeof ACTION_LABELS]}</b>
            <DirectoryInlineConfirm
              action={activeAction}
              targetName={row.name}
              onConfirm={(input) => handleAction(activeAction, input)}
              onCancel={() => setActiveAction(null)}
              isPending={isPending}
              error={error}
            />
          </div>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={row !== null} onOpenChange={() => onClose()}>
        <SheetContent
          side="bottom"
          className="rounded-t-shell max-h-(--max-height-admin-sheet) w-full max-w-(--width-admin-sheet) overflow-auto p-0"
        >
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return content;
}
