'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
        <Skeleton key={index} className="h-44 rounded-card" />
      ))}
    </div>
  );
}

/** Empty state: no pendingReview listings to review. */
export function ApprovalQueueEmpty() {
  return (
    <Card role="status" className="rounded-card py-card text-center">
      <CardHeader>
        <CardTitle className="font-display text-lg">No pending approvals</CardTitle>
        <CardDescription>
          Every submitted listing has been reviewed. New submissions appear here automatically.
        </CardDescription>
      </CardHeader>
    </Card>
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
    <Card role="alert" className="rounded-card py-card text-center">
      <CardHeader>
        <CardTitle className="font-display text-lg">
          Couldn&apos;t load pending approvals
        </CardTitle>
        <CardDescription>
          {message ??
            'The queue failed to load. Try again, and if the problem continues, reload the page.'}
        </CardDescription>
      </CardHeader>
      {onRetry ? (
        <CardContent className="flex justify-center">
          <Button type="button" onClick={onRetry}>
            Try again
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}
