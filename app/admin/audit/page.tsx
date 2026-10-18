'use client';

import { Component, Fragment, useEffect, useState, type ReactNode } from 'react';
import { useConvexAuth, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '@/convex/_generated/api';
import { resolveAuditCreatedAtBounds, type AuditCreatedAtBounds } from '@/convex/auditProjections';
import { Button } from '@/components/ui/button';
import { AuditRoute } from './audit-route';

/**
 * Resolves the local date inputs to the query's `createdAt` window. An invalid
 * range (from after through, or a missing calendar day) returns the reason
 * instead of bounds, so the route shows it and the query is skipped rather
 * than silently running unfiltered.
 */
function resolveAuditDateBounds(dates: { from: string; through: string }): {
  bounds: AuditCreatedAtBounds;
  error?: string;
} {
  try {
    return { bounds: resolveAuditCreatedAtBounds({ from: dates.from, through: dates.through }) };
  } catch (error) {
    if (error instanceof ConvexError && typeof error.data === 'string') {
      return { bounds: {}, error: error.data };
    }
    return { bounds: {}, error: 'Choose a valid audit date range.' };
  }
}

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
 * usable); every applied filter change starts a fresh traversal.
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
  // `filters` holds the applied values the query runs with; the text inputs
  // render from the draft state below so keystrokes stay responsive.
  const [filters, setFilters] = useState<{ action?: string; actor?: string; search?: string }>({});
  const [dates, setDates] = useState({ from: '', through: '' });
  const [actorInput, setActorInput] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1];
  const { bounds: dateBounds, error: dateError } = resolveAuditDateBounds(dates);

  const result = useQuery(
    api.auditLogs.listAuditLogs,
    isAuthenticated && dateError === undefined
      ? { paginationOpts: { numItems: 25, cursor }, ...filters, ...dateBounds }
      : 'skip'
  );
  const pageIncomplete = result?.pageStatus === 'SplitRequired';

  // The actor/target inputs stay responsive through the draft state while the
  // query arguments follow 300ms after the last keystroke; applying a changed
  // value starts a fresh traversal. Cleanup cancels the pending timer on
  // unmount/next keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      const nextActor = actorInput.trim() === '' ? undefined : actorInput;
      if (nextActor !== filters.actor) {
        setFilters((current) => ({ ...current, actor: nextActor }));
        setCursorStack([null]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [actorInput, filters.actor]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const nextSearch = searchInput.trim() === '' ? undefined : searchInput;
      if (nextSearch !== filters.search) {
        setFilters((current) => ({ ...current, search: nextSearch }));
        setCursorStack([null]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, filters.search]);

  function handleFiltersChange(next: {
    action?: string;
    actor?: string;
    search?: string;
    from?: string;
    through?: string;
  }) {
    // The text fields are debounced separately; real action and date changes
    // apply immediately and restart the cursor traversal.
    const nextActor = next.actor ?? '';
    if (nextActor !== actorInput) {
      setActorInput(nextActor);
    }
    const nextSearch = next.search ?? '';
    if (nextSearch !== searchInput) {
      setSearchInput(nextSearch);
    }

    const nextFrom = next.from ?? '';
    const nextThrough = next.through ?? '';
    if (nextFrom !== dates.from || nextThrough !== dates.through) {
      setDates({ from: nextFrom, through: nextThrough });
      setCursorStack([null]);
    }

    if (next.action !== filters.action) {
      setFilters((current) => ({ ...current, action: next.action }));
      setCursorStack([null]);
    }
  }

  return (
    <AuditRoute
      rows={pageIncomplete ? [] : (result?.page ?? [])}
      loading={result === undefined}
      filters={{
        action: filters.action,
        actor: actorInput,
        search: searchInput,
        from: dates.from,
        through: dates.through,
      }}
      dateError={dateError}
      paginationError={
        pageIncomplete
          ? 'This audit page exceeded the database read budget. Narrow the date range or filters; no partial rows are shown.'
          : undefined
      }
      onFiltersChange={handleFiltersChange}
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
