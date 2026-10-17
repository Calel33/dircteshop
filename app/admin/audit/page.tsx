'use client';

import { Component, Fragment, useState, type ReactNode } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { AuditRoute } from './audit-route';

interface AuditLoadBoundaryProps {
  children: ReactNode;
}

interface AuditLoadBoundaryState {
  hasError: boolean;
  /** Bumping this remounts the subtree so a retry re-runs the query. */
  resetKey: number;
}

/**
 * Catches render-time failures in the connected audit feed (same minimal class
 * pattern as `ApprovalsLoadBoundary`): `useQuery` throws during render when a
 * guarded Convex function returns an error (e.g. a revoked Super Admin), and
 * the retry remounts the subtree so the live query is re-subscribed instead
 * of replaying the cached error.
 */
class AuditLoadBoundary extends Component<AuditLoadBoundaryProps, AuditLoadBoundaryState> {
  state: AuditLoadBoundaryState = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<AuditLoadBoundaryState> {
    return { hasError: true };
  }

  reset = () => {
    this.setState((previous) => ({ hasError: false, resetKey: previous.resetKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 space-y-3">
          <div role="alert" className="text-destructive">
            Could not load the audit feed. An admin session may be required.
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

/**
 * Connected `/admin/audit` route (issue #15, Task 15). Read-only: the manual
 * cursor stack pages the guarded `listAuditLogs` query 25 rows at a time
 * (contract §G1/§G6 — the server rejects `numItems > 25`, so load-more is not
 * usable); every filter change starts a fresh traversal.
 */
export default function AuditPage() {
  return (
    <AuditLoadBoundary>
      <AuditPageContent />
    </AuditLoadBoundary>
  );
}

function AuditPageContent() {
  const { isAuthenticated } = useConvexAuth();
  const [filters, setFilters] = useState<{ action?: string; actor?: string; search?: string }>({});
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1];

  const result = useQuery(
    api.auditLogs.listAuditLogs,
    isAuthenticated ? { paginationOpts: { numItems: 25, cursor }, ...filters } : 'skip'
  );

  return (
    <AuditRoute
      rows={result?.page ?? []}
      loading={result === undefined}
      filters={filters}
      onFiltersChange={(f) => {
        setFilters(f);
        setCursorStack([null]);
      }}
      canGoNext={result?.isDone === false}
      canGoPrevious={cursorStack.length > 1}
      onNext={() => {
        const page = result;
        if (page && !page.isDone) {
          setCursorStack([...cursorStack, page.continueCursor]);
        }
      }}
      onPrevious={() => {
        if (cursorStack.length > 1) {
          setCursorStack(cursorStack.slice(0, -1));
        }
      }}
    />
  );
}
