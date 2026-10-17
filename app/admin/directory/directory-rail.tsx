'use client';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type DirectoryFilters, type DirectoryListingStatus } from './directory-types';

const STATUSES: { value: string; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'draft', label: 'Draft' },
  { value: 'pendingReview', label: 'Pending review' },
  { value: 'approved', label: 'Approved' },
  { value: 'changesRequested', label: 'Changes requested' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
];

export function DirectoryRail({
  filters,
  onUpdate,
  categories,
  shownCount,
}: {
  filters: DirectoryFilters;
  onUpdate: (f: DirectoryFilters) => void;
  categories: { _id: string; name: string }[];
  shownCount: number;
}) {
  const activeView = filters.featuredOnly === true ? 'featured' : filters.status ?? 'all';

  const pickView = (view: string) => {
    if (view === 'all') {
      onUpdate({ ...filters, status: undefined, featuredOnly: undefined });
    } else if (view === 'featured') {
      onUpdate({ ...filters, status: undefined, featuredOnly: true });
    } else {
      onUpdate({ ...filters, status: view as DirectoryListingStatus, featuredOnly: undefined });
    }
  };

  return (
    <aside className="w-full shrink-0 border-b p-4 flex flex-row flex-wrap gap-6 lg:w-64 lg:flex-col lg:flex-nowrap lg:border-b-0 lg:border-r">
      <div className="min-w-40">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Saved views</h3>
        <ToggleGroup
          type="single"
          value={activeView}
          onValueChange={(val: string) => {
            if (val) pickView(val);
          }}
          className="flex-col items-start"
        >
          <ToggleGroupItem value="all" aria-label="All listings">All listings</ToggleGroupItem>
          <ToggleGroupItem value="pendingReview" aria-label="Needs review">Needs review</ToggleGroupItem>
          <ToggleGroupItem value="featured" aria-label="Featured">Featured</ToggleGroupItem>
          <ToggleGroupItem value="suspended" aria-label="Suspended">Suspended</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="min-w-40">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Category</h3>
        <div className="grid gap-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="rail-category"
              checked={filters.categoryId === undefined}
              onChange={() => onUpdate({ ...filters, categoryId: undefined })}
            />
            All categories
          </label>
          {categories.map((c) => (
            <label key={c._id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="rail-category"
                checked={filters.categoryId === c._id}
                onChange={() => onUpdate({ ...filters, categoryId: c._id })}
              />
              {c.name}
            </label>
          ))}
        </div>
      </div>

      <div className="min-w-40">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Status</h3>
        <div className="grid gap-1">
          {STATUSES.map((s) => (
            <label key={s.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="rail-status"
                checked={(filters.status ?? 'all') === s.value}
                onChange={() =>
                  onUpdate({
                    ...filters,
                    status: s.value === 'all' ? undefined : (s.value as DirectoryListingStatus),
                  })
                }
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div className="min-w-40">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Verification</h3>
        <ToggleGroup
          type="single"
          value={filters.isVerified === undefined ? 'all' : filters.isVerified.toString()}
          onValueChange={(val: string) => {
            if (val) onUpdate({ ...filters, isVerified: val === 'all' ? undefined : val === 'true' });
          }}
          className="flex-col items-start"
        >
          <ToggleGroupItem value="all" aria-label="Any">Any</ToggleGroupItem>
          <ToggleGroupItem value="true" aria-label="Verified">Verified</ToggleGroupItem>
          <ToggleGroupItem value="false" aria-label="Unverified">Unverified</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <p className="text-xs text-muted-foreground w-full" role="status">
        {shownCount} listings shown.
      </p>
    </aside>
  );
}
