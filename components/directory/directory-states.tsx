import { SearchX, TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// Presentational states for the directory surfaces (SPEC §8): distinct
// loading skeletons, empty state, error state, count line, and the cursor
// "Load more" control. No data hooks live here — `BusinessResults` owns state.

/** Skeleton rows shaped like the dense result card. */
export function ResultRowsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading results">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="bg-card border-border rounded-card flex gap-gap border p-3">
          <Skeleton className="bg-muted size-20 shrink-0 rounded-control" />
          <div className="flex flex-1 flex-col gap-2 py-1">
            <Skeleton className="bg-muted h-3 w-24" />
            <Skeleton className="bg-muted h-4 w-2/3" />
            <Skeleton className="bg-muted h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton grid shaped like the landing mini cards / category cards. */
export function MiniCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading cards">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="bg-muted h-40 rounded-card" />
      ))}
    </div>
  );
}

/** Skeleton for the pill strip (landing categories). */
export function PillsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex flex-wrap gap-2" aria-busy="true" aria-label="Loading categories">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="bg-muted h-8 w-28 rounded-pill" />
      ))}
    </div>
  );
}

/**
 * Error state for a failed query: the directory cannot show data, and — per
 * the exact-count contract — it never substitutes a guessed number. The retry
 * remounts the subtree so the live query re-subscribes instead of replaying
 * the cached error (same pattern as the approvals queue boundary).
 */
export function DirectoryErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div
      role="alert"
      data-testid="directory-error"
      className="border-border bg-card rounded-card flex flex-col items-center gap-3 border border-dashed px-6 py-12 text-center"
    >
      <TriangleAlert aria-hidden className="text-card-muted size-10 stroke-[1.5]" />
      <h3 className="text-base font-semibold">The directory could not be loaded</h3>
      <p className="text-card-muted max-w-sm text-sm">
        Something went wrong while loading businesses. Nothing was changed — try again.
      </p>
      {onRetry ? (
        <Button onClick={onRetry} data-testid="directory-retry">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Standard empty state: message + clear-filters CTA + browse-categories link. */
export function DirectoryEmptyState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <div
      role="status"
      data-testid="directory-empty"
      className="border-border bg-card rounded-card flex flex-col items-center gap-3 border border-dashed px-6 py-12 text-center"
    >
      <SearchX aria-hidden className="text-card-muted size-10 stroke-[1.5]" />
      <h3 className="text-base font-semibold">No businesses found</h3>
      <p className="text-card-muted max-w-sm text-sm">
        Try removing a filter or searching for a different term. New local businesses are added
        every week.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onClearFilters} data-testid="directory-empty-clear">
          Clear filters
        </Button>
        <Button variant="outline" asChild>
          <Link href="/categories">Browse categories</Link>
        </Button>
      </div>
    </div>
  );
}

/** Exact "Showing X of Y" line; `query` echoes the active search term. */
export function DirectoryCountLine({
  total,
  shown,
  query,
  activeFilterCount,
}: {
  total: number;
  shown: number;
  query?: string;
  activeFilterCount: number;
}) {
  return (
    <p role="status" data-testid="directory-count" className="text-card-muted text-sm">
      <b className="text-card-foreground font-semibold">{total}</b>
      {` result${total === 1 ? '' : 's'}`}
      {query ? ` for “${query}”` : ''}
      {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active` : ''}
      {total > 0 ? ` · showing ${shown}` : ''}
    </p>
  );
}

/**
 * Cursor "Load more" control: no page numbers; the exact total comes from the
 * count query, and a fully loaded list states that everything is shown.
 */
export function LoadMoreControl({
  total,
  shown,
  canLoadMore,
  isLoadingMore,
  onLoadMore,
}: {
  total: number;
  shown: number;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (!canLoadMore && !isLoadingMore) {
    return (
      <p className="text-card-muted py-6 text-center text-xs">
        All {total} result{total === 1 ? '' : 's'} shown
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 pt-6">
      <Button
        variant="outline"
        onClick={onLoadMore}
        disabled={isLoadingMore}
        data-testid="directory-load-more"
      >
        {isLoadingMore ? 'Loading…' : 'Load more'}
      </Button>
      <p className="text-card-muted text-xs">
        Showing {shown} of {total}
      </p>
    </div>
  );
}
