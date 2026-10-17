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
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

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
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-6">
              <span className="font-bold text-lg">Command Deck / localhub admin</span>
              <nav className="flex gap-2">
                {['Overview', 'Directory', 'Owners', 'Audit', 'Categories'].map(tab => (
                  <Button 
                    key={tab} 
                    variant={tab === 'Directory' ? 'default' : 'ghost'} 
                    size="sm"
                    disabled={!['Directory'].includes(tab)}
                  >
                    {tab}
                  </Button>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <input 
                type="search" 
                placeholder="Search..." 
                className="border rounded-md px-3 py-1 text-sm"
                value={filters.search}
                onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
              />
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>+ Add Business</Button>
              <Button variant="outline" size="sm" disabled>Export CSV</Button>
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
                  isPending={addState.isPending}
                  error={addState.error}
                />
              ) : null}

              {error && (
                <div role="alert" className="text-destructive p-4 border rounded mb-4">
                  {error}
                </div>
              )}

          {loading ? (
            <div>Loading...</div>
          ) : (
            <>
              {rows.length === 0 ? (
                <p className="text-card-muted py-8">No listings match these filters.</p>
              ) : (
                <>
                  {viewMode === 'grid' ? (
                    <DirectoryGrid rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
                  ) : (
                    <DirectoryTable
                      rows={rows}
                      selectedIds={selectedIds}
                      onToggleSelect={(id) => {
                        const next = new Set(selectedIds);
                        if (next.has(id)) {
                          next.delete(id);
                        } else {
                          next.add(id);
                        }
                        setSelectedIds(next);
                      }}
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
