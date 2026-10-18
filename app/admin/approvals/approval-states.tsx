'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/** Loading state: skeleton cards sized like a real pending card. */
export function ApprovalQueueLoading() {
  return (
    <div
      className="grid grid-cols-1 gap-gap lg:grid-cols-2"
      aria-busy="true"
      aria-label="Loading pending approvals"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="rounded-shell h-44" />
      ))}
    </div>
  );
}

/** Prototype `.empty`: dashed, centred, muted. */
const EMPTY_CLASS =
  'border-border-strong text-muted-foreground rounded-menu border border-dashed p-6 text-center text-sm';

/** Empty state: no pendingReview listings to review. */
export function ApprovalQueueEmpty() {
  return (
    <div role="status" className={EMPTY_CLASS}>
      No pending approvals. Every submitted listing has been reviewed; new submissions appear here
      automatically.
    </div>
  );
}

/** Error state: the queue failed to load; `onRetry` re-runs the query. */
export function ApprovalQueueError({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className={`${EMPTY_CLASS} grid justify-items-center gap-3`}>
      <p>
        {message ??
          'Couldn’t load pending approvals. Try again, and if the problem continues, reload the page.'}
      </p>
      {onRetry ? (
        <Button type="button" size="sm" className="rounded-input" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
