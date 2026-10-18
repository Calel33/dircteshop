'use client';

import { Component, Fragment, useState, type ReactNode } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { OWNERS_PAGE_SIZE } from '@/convex/adminProjections';
import { Button } from '@/components/ui/button';
import { OwnersTable } from './owners-table';

interface OwnersLoadBoundaryProps {
  children: ReactNode;
}

interface OwnersLoadBoundaryState {
  hasError: boolean;
  /** Bumping this remounts the subtree so a retry re-runs the query. */
  resetKey: number;
}

/**
 * Catches render-time failures in the connected owners table (same minimal
 * class pattern as `AuditLoadBoundary`): `useQuery` throws during render when
 * a guarded Convex function returns an error (e.g. a revoked Super Admin), and
 * the retry remounts the subtree so the live query is re-subscribed instead
 * of replaying the cached error.
 */
class OwnersLoadBoundary extends Component<OwnersLoadBoundaryProps, OwnersLoadBoundaryState> {
  state: OwnersLoadBoundaryState = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<OwnersLoadBoundaryState> {
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
            Could not load the owners table. An admin session may be required.
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
 * Connected `/admin/owners` route (issue #16, Task 2). Read-only: the manual
 * cursor stack pages the guarded `listOwners` query 25 rows at a time (the
 * server rejects `numItems > 25`, so load-more is not usable).
 */
export default function OwnersPage() {
  return (
    <OwnersLoadBoundary>
      <OwnersPageContent />
    </OwnersLoadBoundary>
  );
}

function OwnersPageContent() {
  const { isAuthenticated } = useConvexAuth();
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1];

  const result = useQuery(
    api.adminQueries.listOwners,
    isAuthenticated ? { paginationOpts: { numItems: OWNERS_PAGE_SIZE, cursor } } : 'skip'
  );
  const pageIncomplete = result?.pageStatus === 'SplitRequired';

  return (
    <OwnersTable
      rows={pageIncomplete ? [] : (result?.page ?? [])}
      loading={result === undefined}
      error={
        pageIncomplete
          ? 'This owners page exceeded the database read budget. No partial rows are shown.'
          : null
      }
      canGoNext={!pageIncomplete && result?.isDone === false}
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
