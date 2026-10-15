'use client';

import { useQuery } from 'convex/react';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { api } from '@/convex/_generated/api';
import type { DirectoryFilterState } from '@/convex/businesses/directoryQuery';
import type { PublicDirectoryResult } from '@/convex/businesses/publicProjections';

import { BusinessCard, type BusinessCardCategory } from './business-card';
import { CategoryPills, type CategoryPillData } from './category-pills';
import {
  DirectoryEmptyState,
  MiniCardsSkeleton,
  PillsSkeleton,
  ResultRowsSkeleton,
} from './directory-states';
import { FilterChips } from './filter-chips';

// Variant B landing composition (SPEC §8): compact lead, approved category
// pills, Trending rows, in-place chips, four newest minis, and Recently
// Verified rows. Data sections hide entirely when they resolve empty and show
// skeletons while loading; the chips filter every section in place through the
// same shared predicate the results flow uses.

const OFF_FILTERS: DirectoryFilterState = { openNow: false, highlyRated: false };

function SectionHead({
  id,
  title,
  sub,
  action,
}: {
  id: string;
  title: string;
  sub: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-card-muted mt-0.5 text-xs">{sub}</p>
      </div>
      {action ? (
        <Link
          href={action.href}
          className="text-primary focus-visible:ring-ring/50 flex shrink-0 items-center gap-1 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
        >
          {action.label}
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

/** One bounded feed section, hidden entirely when it has no records. */
function FeedSection({
  headingId,
  title,
  sub,
  businesses,
  categoriesById,
  density,
  columnsClassName,
  action,
}: {
  headingId: string;
  title: string;
  sub: string;
  businesses: readonly PublicDirectoryResult[];
  categoriesById: Map<string, BusinessCardCategory>;
  density: 'row' | 'mini';
  columnsClassName: string;
  action?: { href: string; label: string };
}) {
  if (businesses.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={headingId}>
      <SectionHead id={headingId} title={title} sub={sub} action={action} />
      <ul className={`grid gap-3 ${columnsClassName}`}>
        {businesses.map((business) => (
          <li key={business._id}>
            <BusinessCard
              business={business}
              category={categoriesById.get(business.categoryId)}
              density={density}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CategoryStrip({ categories }: { categories: readonly CategoryPillData[] | undefined }) {
  if (categories === undefined) {
    return <PillsSkeleton />;
  }

  if (categories.length === 0) {
    return null;
  }

  return <CategoryPills categories={categories} />;
}

function LandingSkeletonSections() {
  return (
    <>
      <section aria-busy="true" aria-label="Loading trending businesses">
        <ResultRowsSkeleton count={2} />
      </section>
      <section aria-busy="true" aria-label="Loading new businesses">
        <MiniCardsSkeleton count={4} />
      </section>
    </>
  );
}

/** The resolved feeds, the in-place chips, and the filtered-empty state. */
function LandingFeeds({
  trending,
  newest,
  verified,
  categoriesById,
  filters,
  onFiltersChange,
}: {
  trending: readonly PublicDirectoryResult[];
  newest: readonly PublicDirectoryResult[];
  verified: readonly PublicDirectoryResult[];
  categoriesById: Map<string, BusinessCardCategory>;
  filters: DirectoryFilterState;
  onFiltersChange: (filters: DirectoryFilterState) => void;
}) {
  const filtersActive = filters.openNow || filters.highlyRated;
  const allFeedsEmpty =
    trending.length === 0 && newest.length === 0 && verified.length === 0;

  return (
    <>
      <FeedSection
        headingId="landing-trending-heading"
        title="Trending This Week"
        sub="Featured by the LocalConnect team"
        businesses={trending}
        categoriesById={categoriesById}
        density="row"
        columnsClassName="grid-cols-1 lg:grid-cols-2"
        action={{ href: '/search', label: 'View all' }}
      />

      <section aria-label="Filter businesses">
        <FilterChips filters={filters} onChange={onFiltersChange} />
      </section>

      <FeedSection
        headingId="landing-newest-heading"
        title="New to LocalConnect"
        sub="Recently joined businesses"
        businesses={newest}
        categoriesById={categoriesById}
        density="mini"
        columnsClassName="grid-cols-2 lg:grid-cols-4"
      />

      <FeedSection
        headingId="landing-verified-heading"
        title="Recently Verified"
        sub="Independently checked listings"
        businesses={verified}
        categoriesById={categoriesById}
        density="row"
        columnsClassName="grid-cols-1 lg:grid-cols-2"
      />

      {allFeedsEmpty && filtersActive ? (
        <DirectoryEmptyState onClearFilters={() => onFiltersChange(OFF_FILTERS)} />
      ) : null}
    </>
  );
}

export function LandingDiscovery() {
  const [filters, setFilters] = useState<DirectoryFilterState>(OFF_FILTERS);

  // Stable per chip session; recomputed only when a chip changes.
  const now = useMemo(() => Date.now(), [filters.openNow, filters.highlyRated]);

  const feedArgs = { openNow: filters.openNow, highlyRated: filters.highlyRated, now };
  const categoriesResult = useQuery(api.categories.listWithCounts);
  const trending = useQuery(api.businesses.queries.featuredForLanding, feedArgs);
  const newest = useQuery(api.businesses.queries.newestForLanding, feedArgs);
  const verified = useQuery(api.businesses.queries.verifiedForLanding, feedArgs);

  const categoriesById = useMemo(() => {
    const map = new Map<string, BusinessCardCategory>();
    for (const category of categoriesResult?.categories ?? []) {
      map.set(category._id, category);
    }
    return map;
  }, [categoriesResult]);

  const feedsResolved =
    trending !== undefined && newest !== undefined && verified !== undefined;

  return (
    <div className="gap-section flex flex-col">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">LocalConnect Directory</h1>
        <p className="text-card-muted mt-2 text-sm">
          {categoriesResult === undefined
            ? 'Approved local businesses, updated weekly.'
            : `${categoriesResult.totalApproved} approved local businesses · ${categoriesResult.categories.length} categories · updated weekly`}
        </p>
      </div>

      <section aria-labelledby="landing-categories-heading">
        <h2 id="landing-categories-heading" className="sr-only">
          Explore by Category
        </h2>
        <CategoryStrip categories={categoriesResult?.categories} />
      </section>

      {feedsResolved ? (
        <LandingFeeds
          trending={trending}
          newest={newest}
          verified={verified}
          categoriesById={categoriesById}
          filters={filters}
          onFiltersChange={setFilters}
        />
      ) : (
        <LandingSkeletonSections />
      )}
    </div>
  );
}
