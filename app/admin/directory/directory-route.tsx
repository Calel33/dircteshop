'use client';

import { useEffect, useState } from 'react';
import { type AdminDirectoryRow, type DirectoryFilters } from './directory-types';
import { DirectoryRail } from './directory-rail';
import { DirectoryTable } from './directory-table';
import { DirectoryInspector } from './directory-inspector';
import { DirectoryBulkBar } from './directory-bulk-bar';
import { DirectoryBulkConfirm } from './directory-bulk-confirm';
import { DirectoryFilters as DirectoryFilterControls } from './directory-filters';
import { AddBusinessForm } from './add-business-form';
import { DirectoryGrid } from './directory-grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** One button inside the prototype `.seg` control. */
function SegButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'px-3 py-1 text-tiny transition-colors',
        active
          ? 'bg-primary text-primary-foreground font-semibold'
          : 'text-muted-foreground hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      {children}
    </button>
  );
}

/** Dataset toolbar: search, narrow-width filters, view switch, bulk + add. */
function DatasetToolbar({
  filters,
  onFiltersChange,
  categories,
  viewMode,
  onChangeView,
  pendingCount,
  onApprovePending,
  onAddBusiness,
}: {
  filters: DirectoryFilters;
  onFiltersChange: (f: DirectoryFilters) => void;
  categories: { _id: string; name: string }[];
  viewMode: 'grid' | 'table';
  onChangeView: (view: 'grid' | 'table') => void;
  pendingCount: number;
  onApprovePending: () => void;
  onAddBusiness: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        placeholder="Search businesses…"
        aria-label="Search businesses"
        value={filters.search ?? ''}
        onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
        className="rounded-input bg-card h-8 min-w-52 text-tiny"
      />
      <div className="deck:hidden flex flex-wrap items-center gap-2">
        <DirectoryFilterControls filters={filters} onUpdate={onFiltersChange} categories={categories} />
      </div>

      <div className="border-border-strong bg-card rounded-menu inline-flex overflow-hidden border">
        <SegButton active={viewMode === 'grid'} onClick={() => onChangeView('grid')}>
          Grid
        </SegButton>
        <SegButton active={viewMode === 'table'} onClick={() => onChangeView('table')}>
          Table
        </SegButton>
        <SegButton disabled>Map · soon</SegButton>
      </div>

      <span className="flex-1" />

      {pendingCount === 0 ? null : (
        <Button size="sm" className="rounded-input" onClick={onApprovePending}>
          Approve {pendingCount} pending
        </Button>
      )}
      <Button size="sm" variant="outline" className="rounded-input" onClick={onAddBusiness}>
        Add business
      </Button>
    </div>
  );
}

/**
 * Directory presentation shell (issue #15, Tasks 8-13), shaped as the accepted
 * prototype's Variant B `.deck`: a 14rem filter rail, a fluid dataset column,
 * and a persistent 20rem inspector. Grid and Table render the same current
 * page, and switching views preserves the query, filters, cursor position and
 * selected row.
 *
 * Pagination is a manual cursor stack (Back/Next), never accumulated
 * load-more: the server rejects `numItems > 25`, so a growing client window
 * is not an option (contract §G1).
 */
export function DirectoryRoute({
  rows,
  loading,
  error,
  filters,
  onFiltersChange,
  categories,
  canGoNext,
  canGoPrevious,
  onNext,
  onPrevious,
  eligibleCount,
  onApproveSelected,
  onSubmitAdd,
  addState,
  actionState,
  onAction,
  bulkState,
  isMobile = false,
  splitNotice = null,
}: {
  rows: AdminDirectoryRow[];
  loading: boolean;
  error: string | null;
  filters: DirectoryFilters;
  onFiltersChange: (f: DirectoryFilters) => void;
  categories: { _id: string; name: string }[];
  canGoNext: boolean;
  canGoPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  eligibleCount: number;
  onApproveSelected: (ids: string[]) => void;
  onSubmitAdd: (d: { name: string; categoryId: string; ownerEmail: string }) => Promise<void>;
  addState: { isPending: boolean; error: string | null };
  actionState: { isPending: boolean; error: string | null };
  onAction: (
    businessId: string,
    action: string,
    options?: { reason?: string; confirmName?: string }
  ) => Promise<void>;
  bulkState: { isPending: boolean; error: string | null };
  isMobile?: boolean;
  splitNotice?: string | null;
}) {
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const updateSelectedIds = (updater: (prev: Set<string>) => Set<string>) => {
    setSelectedIds((prev) => updater(new Set(prev)));
  };
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Selection hygiene (contract §G5): whenever the visible page changes
  // identity — filter/search apply, Back/Next, post-mutation reactive refresh
  // — the page-scoped selection and its confirm close.
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkConfirmOpen(false);
  }, [rows]);

  const selectedRow = rows.find((row) => row._id === selectedId) ?? null;
  const pendingOnPage = rows.filter((row) => row.status === 'pendingReview');

  // Prototype `bulk-open-visible`: one control selects every pending listing
  // on the visible page and opens the inline bulk confirm.
  const approveAllPending = () => {
    updateSelectedIds(() => new Set(pendingOnPage.map((row) => row._id)));
    setBulkConfirmOpen(true);
  };

  return (
    <div className="bg-card border-border rounded-shell shadow-sm grid deck:grid-cols-(--grid-admin-deck) md:grid-cols-(--grid-admin-deck-tablet) min-h-(--min-height-admin-deck) grid-cols-1 overflow-hidden border">
      <DirectoryRail
        filters={filters}
        onUpdate={onFiltersChange}
        categories={categories}
        shownCount={rows.length}
      />

      <section className="flex min-w-0 flex-col">
        <div className="grid content-start gap-4 p-5">
          <DatasetToolbar
            filters={filters}
            onFiltersChange={onFiltersChange}
            categories={categories}
            viewMode={viewMode}
            onChangeView={setViewMode}
            pendingCount={pendingOnPage.length}
            onApprovePending={approveAllPending}
            onAddBusiness={() => setAddOpen(true)}
          />

          {addOpen ? (
            <AddBusinessForm
              categories={categories}
              onSubmit={async (d) => {
                try {
                  await onSubmitAdd(d);
                  setAddOpen(false);
                } catch {
                  // `onSubmitAdd` stores the failure in `addState.error` and
                  // rethrows; swallow it here so the form stays open with the
                  // error visible and the rejection is never unhandled.
                }
              }}
              onCancel={() => setAddOpen(false)}
              isPending={addState.isPending}
              error={addState.error}
            />
          ) : null}

          {bulkConfirmOpen ? (
            <DirectoryBulkConfirm
              count={selectedIds.size}
              onConfirm={() => onApproveSelected(Array.from(selectedIds))}
              onCancel={() => setBulkConfirmOpen(false)}
              isPending={bulkState.isPending}
              error={bulkState.error}
            />
          ) : null}

          {error === null ? null : (
            <div
              role="alert"
              className="border-danger-border bg-danger-soft text-danger-strong rounded-menu border p-3 text-tiny"
            >
              {error}
            </div>
          )}

          {loading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading directory listings">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <>
              <span className="text-muted-foreground text-tiny" role="status">
                {rows.length} {rows.length === 1 ? 'listing' : 'listings'}
              </span>

              {rows.length === 0 ? (
                <div className="border-border-strong text-muted-foreground rounded-menu border border-dashed p-6 text-center text-sm">
                  No listings match those filters. Clear a filter or search term to see more.
                </div>
              ) : viewMode === 'grid' ? (
                <DirectoryGrid rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
              ) : (
                <DirectoryTable
                  rows={rows}
                  selectedIds={selectedIds}
                  onToggleSelectBulk={updateSelectedIds}
                  onSelect={setSelectedId}
                />
              )}

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-input"
                  onClick={onPrevious}
                  disabled={!canGoPrevious}
                >
                  Back
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-input"
                  onClick={onNext}
                  disabled={!canGoNext}
                >
                  Next
                </Button>
                {splitNotice === null ? null : (
                  <span role="status" className="text-muted-foreground text-xs">
                    {splitNotice}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <aside className="border-border bg-card hidden flex-col border-l md:flex">
        <DirectoryInspector
          row={selectedRow}
          onClose={() => setSelectedId(null)}
          onAction={(action, options) =>
            selectedRow ? onAction(selectedRow._id, action, options) : Promise.resolve()
          }
          isPending={actionState.isPending}
          error={actionState.error}
          isMobile={isMobile}
        />
      </aside>

      {selectedIds.size === 0 ? null : (
        <DirectoryBulkBar
          selectedCount={selectedIds.size}
          eligibleCount={eligibleCount}
          onRequestConfirm={() => setBulkConfirmOpen(true)}
          isPending={bulkState.isPending}
        />
      )}
    </div>
  );
}
