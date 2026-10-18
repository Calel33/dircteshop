'use client';

import { Component, Fragment, type ReactNode } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { ANALYTICS_VIEWS_PLACEHOLDER } from '@/convex/adminProjections';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface AnalyticsLoadBoundaryProps {
  children: ReactNode;
}

interface AnalyticsLoadBoundaryState {
  hasError: boolean;
  /** Bumping this remounts the subtree so a retry re-runs the query. */
  resetKey: number;
}

/**
 * Catches render-time failures in the connected analytics summary (same
 * minimal class pattern as `OverviewLoadBoundary`): `useQuery` throws during
 * render when a guarded Convex function returns an error (e.g. a revoked
 * Super Admin), and the retry remounts the subtree so the live query is
 * re-subscribed instead of replaying the cached error.
 */
class AnalyticsLoadBoundary extends Component<
  AnalyticsLoadBoundaryProps,
  AnalyticsLoadBoundaryState
> {
  state: AnalyticsLoadBoundaryState = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<AnalyticsLoadBoundaryState> {
    return { hasError: true };
  }

  reset = () => {
    this.setState((previous) => ({ hasError: false, resetKey: previous.resetKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-3">
          <div role="alert" className="text-destructive">
            Could not load the analytics counts. An admin session may be required.
          </div>
          <Button variant="outline" onClick={this.reset}>
            Retry
          </Button>
        </div>
      );
    }

    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="bg-card border-border rounded-shell shadow-sm border p-4">
      <div className="text-card-muted text-micro font-mono tracking-label uppercase">{label}</div>
      <div className="text-stat mt-1 font-bold tabular-nums">{value}</div>
      {hint === undefined ? null : <div className="text-card-muted text-xs">{hint}</div>}
    </div>
  );
}

/** Truthful loading state: the same card grid, filled with skeletons. */
function AnalyticsSkeleton() {
  return (
    <div
      className="deck-sm:grid-cols-2 deck:grid-cols-4 grid grid-cols-1 gap-3"
      aria-busy="true"
      aria-label="Loading analytics counts"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="rounded-shell h-28" />
      ))}
    </div>
  );
}

/**
 * `/admin/analytics` v1 stub (issue #16, Task 3). Runs the guarded
 * `analyticsCounts` query and renders the four stat cards: the three REAL
 * table counts — Orders, Bookings, Quote requests — then Views, whose only v1
 * treatment is TBD: v1 has no view tracking, so the card shows the placeholder
 * instead of a fabricated number (SPEC §13 Open Items).
 */
export function AnalyticsSummary() {
  return (
    <AnalyticsLoadBoundary>
      <AnalyticsSummaryContent />
    </AnalyticsLoadBoundary>
  );
}

function AnalyticsSummaryContent() {
  const { isAuthenticated } = useConvexAuth();
  const counts = useQuery(api.adminQueries.analyticsCounts, isAuthenticated ? {} : 'skip');

  if (counts === undefined) {
    return <AnalyticsSkeleton />;
  }

  return (
    <div className="deck-sm:grid-cols-2 deck:grid-cols-4 grid grid-cols-1 gap-3">
      <StatCard label="Orders" value={counts.orders} />
      <StatCard label="Bookings" value={counts.bookings} />
      <StatCard label="Quote requests" value={counts.quoteRequests} />
      <StatCard label="Views" value={ANALYTICS_VIEWS_PLACEHOLDER} hint="No view tracking in v1" />
    </div>
  );
}
