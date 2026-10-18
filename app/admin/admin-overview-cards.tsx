'use client';

import { Component, Fragment, useMemo, type ReactNode } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import Link from 'next/link';

import { api } from '@/convex/_generated/api';
import { localMonthRange } from '@/convex/adminProjections';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface OverviewLoadBoundaryProps {
  children: ReactNode;
}

interface OverviewLoadBoundaryState {
  hasError: boolean;
  /** Bumping this remounts the subtree so a retry re-runs the query. */
  resetKey: number;
}

/**
 * Catches render-time failures in the connected overview (same minimal class
 * pattern as `ApprovalsLoadBoundary`): `useQuery` throws during render when a
 * guarded Convex function returns an error (e.g. a revoked Super Admin), and
 * the retry remounts the subtree so the live query is re-subscribed instead
 * of replaying the cached error.
 */
class OverviewLoadBoundary extends Component<OverviewLoadBoundaryProps, OverviewLoadBoundaryState> {
  state: OverviewLoadBoundaryState = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<OverviewLoadBoundaryState> {
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
            Could not load the overview counts. An admin session may be required.
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

/** Prototype `.stat`: mono micro label, 2rem tabular value, faint hint line. */
const STAT_CLASS = 'bg-card border-border rounded-shell shadow-sm border p-4 text-left';

function StatLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-card-muted text-micro font-mono tracking-label uppercase">{children}</div>
  );
}

function StatValue({ children }: { children: ReactNode }) {
  return <div className="text-stat mt-1 font-bold tabular-nums">{children}</div>;
}

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className={STAT_CLASS}>
      <StatLabel>{label}</StatLabel>
      <StatValue>{value}</StatValue>
      {hint === undefined ? null : <div className="text-card-muted text-xs">{hint}</div>}
    </div>
  );
}

/**
 * The "Pending approval" card (prototype `.stat.clickable`): the whole card is
 * the link to the approvals queue, with the prototype's hint line.
 */
function PendingApprovalsCard({ count }: { count: number }) {
  return (
    <Link
      href="/admin/approvals"
      className={`${STAT_CLASS} hover:border-brand-border hover:bg-brand-soft focus-visible:ring-ring transition-colors focus-visible:ring-2 focus-visible:outline-none`}
    >
      <StatLabel>Pending approval</StatLabel>
      <StatValue>{count}</StatValue>
      <div className="text-card-muted text-xs">Open the queue →</div>
    </Link>
  );
}

/** Truthful loading state: the same card grid, filled with skeletons. */
function OverviewSkeleton() {
  return (
    <div
      className="deck-sm:grid-cols-2 deck:grid-cols-4 grid grid-cols-1 gap-3"
      aria-busy="true"
      aria-label="Loading overview counts"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="rounded-shell h-28" />
      ))}
    </div>
  );
}

/**
 * `/admin` overview count cards (issue #16, Task 1). Runs the guarded
 * `overviewStats` query with the admin's LOCAL month window; the four cards
 * follow the accepted prototype's stat grid order exactly — "Total
 * businesses", "Pending approval" (linking to `/admin/approvals`), "Verified
 * active", "Submissions this month" — and the prototype deliberately has no
 * revenue card (billing is deferred).
 */
export function AdminOverviewCards() {
  return (
    <OverviewLoadBoundary>
      <OverviewCardsContent />
    </OverviewLoadBoundary>
  );
}

function OverviewCardsContent() {
  const { isAuthenticated } = useConvexAuth();
  // Local month bounds are computed once per mount from the admin's clock —
  // Convex queries never read the wall clock themselves.
  const monthWindow = useMemo(() => localMonthRange(Date.now()), []);
  const stats = useQuery(api.adminQueries.overviewStats, isAuthenticated ? monthWindow : 'skip');

  if (stats === undefined) {
    return <OverviewSkeleton />;
  }

  return (
    <div className="deck-sm:grid-cols-2 deck:grid-cols-4 grid grid-cols-1 gap-3">
      <StatCard label="Total businesses" value={stats.totalBusinesses} />
      <PendingApprovalsCard count={stats.pendingApprovals} />
      <StatCard label="Verified active" value={stats.verifiedActive} />
      <StatCard
        label="Submissions this month"
        value={stats.submissionsThisMonth}
        hint="No revenue card (billing deferred)"
      />
    </div>
  );
}
