'use client';

import { useEffect, useState } from 'react';
import { type AdminDirectoryRow, type DirectoryFilters } from './directory-types';
import { DirectoryRail } from './directory-rail';
import { DirectoryTable } from './directory-table';
import { DirectoryInspector } from './directory-inspector';
import { DirectoryBulkBar } from './directory-bulk-bar';
import { DirectoryBulkConfirm } from './directory-bulk-confirm';
import { AddBusinessForm } from './add-business-form';
import { DirectoryGrid } from './directory-grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { exportBusinessesCsv } from '@/app/admin/export-actions';

/**
 * Directory presentation shell (issue #15, Tasks 8-13). Purely presentational
 * state (view mode, selection, open panels) over the wired page result; Grid
 * and Table render the same current page, and switching views preserves the
 * query, filters, cursor position and selected row.
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
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const updateSelectedIds = (updater: (prev: Set<string>) => Set<string>) => {
    setSelectedIds((prev) => updater(new Set(prev)));
  };
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [exportState, setExportState] = useState<{
    isPending: boolean;
    error: string | null;
    status: string | null;
  }>({ isPending: false, error: null, status: null });

  // The Server Action returns the serialized CSV (it cannot set
  // Content-Disposition), so the download is triggered here with a Blob and an
  // object URL. One export at a time: the button disables while pending.
  const handleExport = async () => {
    setExportState({ isPending: true, error: null, status: null });
    try {
      const result = await exportBusinessesCsv();
      if (!result.ok) {
        setExportState({ isPending: false, error: result.error, status: null });
        return;
      }

      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);

      setExportState({
        isPending: false,
        error: null,
        status: `Exported ${result.rowCount} ${
          result.rowCount === 1 ? 'row' : 'rows'
        } → ${result.fileName}`,
      });
    } catch {
      setExportState({ isPending: false, error: 'The export failed. Try again.', status: null });
    }
  };

  // Selection hygiene (contract §G5): whenever the visible page changes
  // identity — filter/search apply, Back/Next, post-mutation reactive refresh
  // — the page-scoped selection and its confirm close.
  useEffect(() => {
    setSelectedIds(new Set());
    setBulkConfirmOpen(false);
  }, [rows]);

  const selectedRow = rows.find((r) => r._id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <DirectoryRail filters={filters} onUpdate={onFiltersChange} categories={categories} shownCount={rows.length} />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Command Bar Area */}
        <header className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="font-bold text-lg">Command Deck / localhub admin</span>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                type="search"
                placeholder="Search businesses…"
                aria-label="Search businesses"
                value={filters.search}
                onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
                className="w-full sm:w-52"
              />
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>+ Add Business</Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={exportState.isPending}
              >
                Export CSV
              </Button>
              <div className="w-8 h-8 rounded-full bg-muted" />
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Dataset Toolbar */}
          <div className="flex justify-between items-center mb-4">
            <div className="flex gap-2">
              <Button size="sm" variant={viewMode === 'grid' ? 'secondary' : 'ghost'} onClick={() => setViewMode('grid')}>
                Grid
              </Button>
              <Button size="sm" variant={viewMode === 'table' ? 'secondary' : 'ghost'} onClick={() => setViewMode('table')}>
                Table
              </Button>
            </div>
            {selectedIds.size > 0 && (
              <DirectoryBulkBar
                selectedCount={selectedIds.size}
                eligibleCount={eligibleCount}
                onRequestConfirm={() => setBulkConfirmOpen(true)}
                isPending={bulkState.isPending}
              />
            )}
          </div>

              {addOpen ? (
                <AddBusinessForm
                  categories={categories}
                  onSubmit={async (d) => {
                    await onSubmitAdd(d);
                    setAddOpen(false);
                  }}
                  onCancel={() => setAddOpen(false)}
                  isPending={addState.isPending}
                  error={addState.error}
                />
              ) : null}

              {error && (
                <div role="alert" className="mb-4 rounded-control border border-destructive/40 p-4 text-sm text-destructive">
                  {error}
                </div>
              )}

              {exportState.error && (
                <div role="alert" className="mb-4 rounded-control border border-destructive/40 p-4 text-sm text-destructive">
                  {exportState.error}
                </div>
              )}

              {exportState.status && (
                <div
                  role="status"
                  className="fixed bottom-4 left-4 z-50 max-w-md rounded-control bg-surface px-3 py-2 text-sm text-surface-foreground shadow-lg"
                >
                  {exportState.status}
                </div>
              )}

          {loading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading directory listings">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full bg-muted-foreground/20" />
              ))}
            </div>
          ) : (
            <>
              {rows.length === 0 ? (
                <div className="rounded-control border border-dashed border-border p-6 text-center text-sm text-card-muted">
                  No listings match these filters. Clear a filter or a search term to see more.
                </div>
              ) : (
                <>
                  {viewMode === 'grid' ? (
                    <DirectoryGrid rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
                  ) : (
                    <DirectoryTable
                      rows={rows}
                      selectedIds={selectedIds}
                      onToggleSelectBulk={updateSelectedIds}
                      onSelect={setSelectedId}
                    />
                  )}
                  {bulkConfirmOpen && (
                    <DirectoryBulkConfirm
                      count={selectedIds.size}
                      onConfirm={() => onApproveSelected(Array.from(selectedIds))}
                      onCancel={() => setBulkConfirmOpen(false)}
                      isPending={bulkState.isPending}
                      error={bulkState.error}
                    />
                  )}
                </>
              )}

              <div className="mt-4 flex items-center gap-2">
                <Button variant="outline" onClick={onPrevious} disabled={!canGoPrevious}>
                  Back
                </Button>
                <Button variant="outline" onClick={onNext} disabled={!canGoNext}>
                  Next
                </Button>
                {splitNotice ? (
                  <span role="status" className="text-sm text-card-muted">
                    {splitNotice}
                  </span>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="w-80 border-l h-full overflow-y-auto">
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
      </div>
    </div>
  );
}
