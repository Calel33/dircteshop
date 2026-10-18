'use client';

import { Component, Fragment, type ReactNode } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AUDIT_ACTION_LABELS } from './audit/audit-types';

interface OverviewPanelsLoadBoundaryProps {
  children: ReactNode;
}

interface OverviewPanelsLoadBoundaryState {
  hasError: boolean;
  /** Bumping this remounts the subtree so a retry re-runs the queries. */
  resetKey: number;
}

/**
 * Catches render-time failures in the connected overview panels (same minimal
 * class pattern as `OverviewLoadBoundary`): `useQuery` throws during render
 * when a guarded Convex function returns an error (e.g. a revoked Super
 * Admin), and the retry remounts the subtree so the live queries are
 * re-subscribed instead of replaying the cached error.
 */
class OverviewPanelsLoadBoundary extends Component<
  OverviewPanelsLoadBoundaryProps,
  OverviewPanelsLoadBoundaryState
> {
  state: OverviewPanelsLoadBoundaryState = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<OverviewPanelsLoadBoundaryState> {
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
            Could not load the overview panels. An admin session may be required.
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

/** The prototype `.card` shell, same surface as the stat cards above. */
const PANEL_CARD = 'bg-card border-border rounded-shell shadow-sm border p-4';

/** One prototype `.list-row`: hairline-separated, first row unbordered. */
const LIST_ROW = 'border-border flex items-center gap-2 border-t py-2 text-sm first:border-t-0';

/**
 * First-page cursor options for the shared audit feed: the newest 5 rows,
 * exactly what the prototype's `recentList()` slices. `AUDIT_PAGE_SIZE` (25)
 * is the server cap and 5 sits inside it, so no bound is loosened.
 */
const RECENT_AUDIT_PAGINATION = { numItems: 5, cursor: null } as const;

/** Truthful loading state: one card-shaped skeleton in the panel's grid slot. */
function PanelSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
      <Skeleton className="rounded-shell h-52" />
    </div>
  );
}

/**
 * The "Recent audit activity" card (prototype Variant B overview): the newest
 * five rows of the guarded `listAuditLogs` feed — mono `when` gutter plus
 * `{action} · {target}`, exactly the prototype's `recentList()`. The When
 * formatter is the audit table's own (`new Date(row.at).toLocaleString()`),
 * so no second date format exists in the admin surface.
 */
function RecentAuditCard() {
  const { isAuthenticated } = useConvexAuth();
  const result = useQuery(
    api.auditLogs.listAuditLogs,
    isAuthenticated ? { paginationOpts: RECENT_AUDIT_PAGINATION } : 'skip'
  );

  if (result === undefined) {
    return <PanelSkeleton label="Loading recent audit activity" />;
  }

  // The audit page treats a split page as incomplete; the overview surfaces
  // the same failure instead of showing a partial feed as if it were whole.
  const splitIncomplete = result.pageStatus === 'SplitRequired';

  return (
    <div className={PANEL_CARD}>
      <h2 className="mb-1 text-base font-semibold">Recent audit activity</h2>
      <p className="text-card-muted mb-3 text-tiny">
        Global feed — the full log lives in the Audit tab.
      </p>
      {splitIncomplete ? (
        <p role="alert" className="text-danger text-tiny">
          This feed exceeded the database read budget; no partial rows are shown.
        </p>
      ) : result.page.length === 0 ? (
        <p className="text-muted-foreground text-tiny">
          No audit activity yet. Every status change lands here as it happens.
        </p>
      ) : (
        <div>
          {result.page.map((row) => (
            <div key={row._id} className={LIST_ROW}>
              <span className="text-muted-foreground min-w-34 shrink-0 font-mono text-xs whitespace-nowrap">
                {new Date(row.at).toLocaleString()}
              </span>
              <span>
                {AUDIT_ACTION_LABELS[row.action] ?? row.action} · {row.targetName ?? 'Unknown'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The "Review workload" card (prototype Variant B overview): pending counts
 * per category from the guarded `reviewWorkload` read, already in display
 * order. The projection measures every category exactly; the card — like the
 * prototype — renders only positive rows, and with none pending it shows the
 * muted empty-hint treatment instead of an empty box (a deliberate divergence
 * from the prototype, which would render nothing under its sub-line).
 */
function ReviewWorkloadCard() {
  const { isAuthenticated } = useConvexAuth();
  const rows = useQuery(api.adminQueries.reviewWorkload, isAuthenticated ? {} : 'skip');

  if (rows === undefined) {
    return <PanelSkeleton label="Loading review workload" />;
  }

  const pending = rows.filter((row) => row.pendingCount > 0);

  return (
    <div className={PANEL_CARD}>
      <h2 className="mb-1 text-base font-semibold">Review workload</h2>
      <p className="text-card-muted mb-3 text-tiny">Pending by category.</p>
      {pending.length === 0 ? (
        <p className="text-muted-foreground text-tiny">
          Nothing is pending review right now. New submissions appear here by category.
        </p>
      ) : (
        <div>
          {pending.map((row) => (
            <div key={row.categoryId} className={LIST_ROW}>
              <span>{row.name}</span>
              <span className="flex-1" />
              <span className="font-mono text-tiny">{row.pendingCount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Variant B overview body below the stat grid (issue #22): the `split-2`
 * pair — "Recent audit activity" and "Review workload" — each fed by its own
 * guarded query with its own loading and empty treatment, collapsing to one
 * column below the deck breakpoint like the prototype's media query.
 */
export function AdminOverviewPanels() {
  return (
    <OverviewPanelsLoadBoundary>
      <div className="deck:grid-cols-2 grid grid-cols-1 items-start gap-4">
        <RecentAuditCard />
        <ReviewWorkloadCard />
      </div>
    </OverviewPanelsLoadBoundary>
  );
}
