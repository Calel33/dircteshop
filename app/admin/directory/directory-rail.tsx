'use client';

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

const VERIFICATIONS = [
  { value: 'all', label: 'Any' },
  { value: 'true', label: 'Verified' },
  { value: 'false', label: 'Unverified' },
];

const SAVED_VIEWS = [
  { value: 'all', label: 'All listings' },
  { value: 'pendingReview', label: 'Needs review' },
  { value: 'featured', label: 'Featured' },
  { value: 'suspended', label: 'Suspended' },
];

/** Prototype `.opt`: one aligned radio row. */
function OptRow({
  name,
  checked,
  label,
  onChange,
}: {
  name: string;
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-2 text-tiny">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

/**
 * The prototype's `.rail` (Variant B): 14rem, `bg-panel`, hairline right
 * border. Saved views are left-aligned `.nav-btn` rows (active = brand-soft
 * fill + brand-strong semibold); category, status and verification are
 * `.opt` radio rows rather than pill toggles. Hidden below the deck
 * breakpoint, where the dataset toolbar carries the same filters.
 */
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
  const activeView = filters.featuredOnly === true ? 'featured' : (filters.status ?? 'all');

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
    <aside className="bg-panel border-border deck:grid hidden border-r p-4 content-start gap-4">
      <div className="grid gap-2">
        <h3 className="text-micro text-muted-foreground tracking-label uppercase">Saved views</h3>
        <div className="grid gap-2">
          {SAVED_VIEWS.map((view) => {
            const isActive = activeView === view.value;
            return (
              <button
                key={view.value}
                type="button"
                onClick={() => pickView(view.value)}
                aria-pressed={isActive}
                className={
                  isActive
                    ? 'bg-brand-soft text-brand-strong rounded-menu px-3 py-2 text-left text-sm font-semibold'
                    : 'text-foreground hover:bg-brand-soft/60 rounded-menu px-3 py-2 text-left text-sm transition-colors'
                }
              >
                {view.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-2">
        <h3 className="text-micro text-muted-foreground tracking-label uppercase">Category</h3>
        <div className="grid gap-2">
          <OptRow
            name="rail-category"
            checked={filters.categoryId === undefined}
            label="All categories"
            onChange={() => onUpdate({ ...filters, categoryId: undefined })}
          />
          {categories.map((category) => (
            <OptRow
              key={category._id}
              name="rail-category"
              checked={filters.categoryId === category._id}
              label={category.name}
              onChange={() => onUpdate({ ...filters, categoryId: category._id })}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <h3 className="text-micro text-muted-foreground tracking-label uppercase">Status</h3>
        <div className="grid gap-2">
          {STATUSES.map((status) => (
            <OptRow
              key={status.value}
              name="rail-status"
              checked={(filters.status ?? 'all') === status.value}
              label={status.label}
              onChange={() =>
                onUpdate({
                  ...filters,
                  status: status.value === 'all' ? undefined : (status.value as DirectoryListingStatus),
                })
              }
            />
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <h3 className="text-micro text-muted-foreground tracking-label uppercase">Verification</h3>
        <div className="grid gap-2">
          {VERIFICATIONS.map((option) => (
            <OptRow
              key={option.value}
              name="rail-verification"
              checked={(filters.isVerified === undefined ? 'all' : String(filters.isVerified)) === option.value}
              label={option.label}
              onChange={() =>
                onUpdate({
                  ...filters,
                  isVerified: option.value === 'all' ? undefined : option.value === 'true',
                })
              }
            />
          ))}
        </div>
      </div>

      {/*
        The prototype reads "{n} of {m} listings match." The `m` total is not
        in the paginated projection, and the page cannot invent one without a
        new query contract, so the rail states the matched count only.
      */}
      <p className="text-muted-foreground text-tiny" role="status">
        {shownCount} listings match.
      </p>
    </aside>
  );
}
