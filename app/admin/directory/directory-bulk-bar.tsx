'use client';

import { Button } from '@/components/ui/button';

/**
 * The prototype's `.bulkbar`: a fixed, bottom-centred pill shown only while
 * rows are selected. It states the selection count and offers the single bulk
 * action the server supports (approve).
 */
export function DirectoryBulkBar({
  selectedCount,
  eligibleCount,
  onRequestConfirm,
  isPending,
}: {
  selectedCount: number;
  eligibleCount: number;
  onRequestConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="bg-card border-border-strong shadow-lg fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border px-3 py-2 text-tiny"
    >
      <span role="status">
        <b>{selectedCount}</b> of {eligibleCount} selected
      </span>
      <Button
        type="button"
        size="sm"
        className="rounded-input"
        onClick={onRequestConfirm}
        disabled={selectedCount === 0 || isPending}
      >
        Approve selected
      </Button>
    </div>
  );
}
