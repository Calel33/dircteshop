'use client';

import { usePaginatedQuery, useQuery } from 'convex/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { DirectoryFilterState } from '@/convex/businesses/directoryQuery';
import { cn } from '@/lib/utils';

import { BusinessCard, type BusinessCardCategory } from './business-card';
import { CategoryIcon } from './category-icon';
import {
  DirectoryCountLine,
  DirectoryEmptyState,
  DirectoryLoadBoundary,
  LoadMoreControl,
  ResultRowsSkeleton,
} from './directory-states';
import { FilterChips } from './filter-chips';

// The one shared results flow behind `/search?q=` and `/categories/[slug]`
// (SPEC §8): category sidebar with approved counts, real chips, cursor
// pagination with the exact "Showing X of Y" total, and distinct loading /
// empty / error / load-more states.
//
// `usePaginatedQuery` resets to the first page whenever the query reference or
// arguments change, so the trimmed query, category, both chip flags, and the
// stable `now` are the complete argument set that owns the cursor chain.

const DIRECTORY_PAGE_SIZE = 6;

const OFF_FILTERS: DirectoryFilterState = { openNow: false, highlyRated: false };

const SIDEBAR_LINK =
  'flex w-full items-center justify-between gap-2 rounded-control px-3 py-2 text-sm font-semibold text-card-muted transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

type CategoryListItem = {
  _id: string;
  name: string;
  slug: string;
  icon?: string;
  approvedCount: number;
};

export type BusinessResultsProps = {
  /** Raw `q` from the URL; trimmed server-side. */
  q: string;
  /** Server-validated category scope for `/categories/[slug]`. */
  category?: { _id: Id<'categories'>; name: string; slug: string };
  /** Where the empty state's clear-filters CTA returns to (drops `q`). */
  resetPath: string;
};

/** Category links + approved counts and the real chips (the results sidebar). */
function ResultsSidebar({
  categories,
  totalApproved,
  category,
  filters,
  onFiltersChange,
}: {
  categories: readonly CategoryListItem[];
  totalApproved: number | undefined;
  category: BusinessResultsProps['category'];
  filters: DirectoryFilterState;
  onFiltersChange: (filters: DirectoryFilterState) => void;
}) {
  return (
    <aside
      aria-label="Directory filters"
      className="bg-card text-card-foreground border-border rounded-card flex flex-col gap-4 border p-4"
    >
      <section>
        <h2 className="text-card-muted font-label text-xs font-semibold tracking-wide uppercase">
          Categories
        </h2>
        <ul className="mt-2 flex flex-col gap-1">
          <li>
            <Link href="/search" className={SIDEBAR_LINK}>
              <span>All businesses</span>
              <span className="text-card-muted">{totalApproved ?? '…'}</span>
            </Link>
          </li>
          {categories.map((item) => {
            const isCurrent = category?._id === item._id;
            return (
              <li key={item._id}>
                <Link
                  href={`/categories/${item.slug}`}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={cn(SIDEBAR_LINK, isCurrent && 'bg-muted text-foreground')}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <CategoryIcon name={item.icon} className="size-4 shrink-0" />
                    <span className="truncate">{item.name}</span>
                  </span>
                  <span className="text-card-muted">{item.approvedCount}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h2 className="text-card-muted font-label text-xs font-semibold tracking-wide uppercase">
          Filters
        </h2>
        <div className="mt-2">
          <FilterChips filters={filters} onChange={onFiltersChange} />
        </div>
      </section>
    </aside>
  );
}

/** Count line, result rows, and the cursor load-more control. */
function ResultsRegion({
  results,
  status,
  total,
  query,
  activeFilterCount,
  categoriesById,
  onClearFilters,
  onLoadMore,
}: {
  results: ReturnType<typeof usePaginatedQuery>['results'];
  status: ReturnType<typeof usePaginatedQuery>['status'];
  total: number | undefined;
  query?: string;
  activeFilterCount: number;
  categoriesById: Map<string, BusinessCardCategory>;
  onClearFilters: () => void;
  onLoadMore: () => void;
}) {
  if (status === 'LoadingFirstPage') {
    return (
      <div className="flex flex-col gap-gap" role="status">
        <span className="sr-only">Loading…</span>
        <Skeleton className="bg-muted h-4 w-40" />
        <ResultRowsSkeleton />
      </div>
    );
  }

  if (total === 0) {
    return <DirectoryEmptyState onClearFilters={onClearFilters} />;
  }

  return (
    <>
      {total === undefined ? (
        <Skeleton className="bg-muted h-4 w-40" />
      ) : (
        <DirectoryCountLine
          total={total}
          shown={results.length}
          query={query}
          activeFilterCount={activeFilterCount}
        />
      )}

      {results.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {results.map((business) => (
            <li key={business._id}>
              <BusinessCard
                business={business}
                category={categoriesById.get(business.categoryId)}
                density="row"
              />
            </li>
          ))}
        </ul>
      ) : null}

      {total === undefined ? (
        <Skeleton className="bg-muted mx-auto h-8 w-36 rounded-control" />
      ) : (
        <LoadMoreControl
          total={total}
          shown={results.length}
          canLoadMore={status === 'CanLoadMore'}
          isLoadingMore={status === 'LoadingMore'}
          onLoadMore={onLoadMore}
        />
      )}
    </>
  );
}

function ConnectedBusinessResults({ q, category, resetPath }: BusinessResultsProps) {
  const router = useRouter();
  const [filters, setFilters] = useState<DirectoryFilterState>(OFF_FILTERS);

  // One stable `now` per cursor session: it only changes together with the
  // query or a filter, which also restarts pagination — a moving clock never
  // invalidates a live cursor (convex-backend issue 505).
  const now = useMemo(() => Date.now(), [q, category?._id, filters.openNow, filters.highlyRated]);

  const directoryArgs = {
    q,
    categoryId: category?._id,
    openNow: filters.openNow,
    highlyRated: filters.highlyRated,
    now,
  };

  // `initialNumItems` / `loadMore` sizes do not cap the returned batch: with a
  // chip active `listDirectory` returns every match from its scan window
  // (`numItems * MAX_DIRECTORY_PAGE_CHUNKS`, 5), so a batch can be smaller than
  // `DIRECTORY_PAGE_SIZE`, up to 5x larger, or an empty-but-continuable page.
  // Counts render from `results.length`.
  const { results, status, loadMore } = usePaginatedQuery(
    api.businesses.queries.listDirectory,
    directoryArgs,
    { initialNumItems: DIRECTORY_PAGE_SIZE }
  );
  const countResult = useQuery(api.businesses.queries.countDirectory, directoryArgs);
  const categoriesResult = useQuery(api.categories.listWithCounts);

  const categoriesById = useMemo(() => {
    const map = new Map<string, BusinessCardCategory>();
    for (const item of categoriesResult?.categories ?? []) {
      map.set(item._id, item);
    }
    return map;
  }, [categoriesResult]);

  /** Empty-state CTA: drop chips and any search term, back to the full list. */
  function clearAll() {
    setFilters(OFF_FILTERS);
    if (q.trim().length > 0) {
      router.replace(resetPath);
    }
  }

  return (
    <div className="grid items-start gap-gap lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
      <ResultsSidebar
        categories={categoriesResult?.categories ?? []}
        totalApproved={categoriesResult?.totalApproved}
        category={category}
        filters={filters}
        onFiltersChange={setFilters}
      />
      <div className="flex min-w-0 flex-col gap-gap">
        <ResultsRegion
          results={results}
          status={status}
          total={countResult?.total}
          query={q.trim().length > 0 ? q.trim() : undefined}
          activeFilterCount={(filters.openNow ? 1 : 0) + (filters.highlyRated ? 1 : 0)}
          categoriesById={categoriesById}
          onClearFilters={clearAll}
          onLoadMore={() => loadMore(DIRECTORY_PAGE_SIZE)}
        />
      </div>
    </div>
  );
}

/** Public entry: the results flow wrapped in its own error boundary. */
export function BusinessResults(props: BusinessResultsProps) {
  return (
    <DirectoryLoadBoundary>
      <ConnectedBusinessResults {...props} />
    </DirectoryLoadBoundary>
  );
}
