'use client';

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AuditTable } from './audit-table';
import { AUDIT_ACTION_LABELS, type AuditLogRow } from './audit-types';

/**
 * Read-only audit feed presentation (issue #15, Tasks 11/15; date range added
 * by B6b, issue #16): action/actor/text/date filters over the current page
 * plus the manual Back/Next cursor controls. The date bounds are inclusive
 * start / exclusive next day, so `through` includes its whole local day. There
 * are no write controls here by design — rows reflect committed Convex audit
 * state only.
 */
export function AuditRoute({
  rows,
  loading,
  filters,
  dateError,
  paginationError,
  onFiltersChange,
  canGoNext,
  canGoPrevious,
  onNext,
  onPrevious,
}: {
  rows: AuditLogRow[];
  loading: boolean;
  filters: { action?: string; actor?: string; search?: string; from?: string; through?: string };
  dateError?: string;
  paginationError?: string;
  onFiltersChange: (f: {
    action?: string;
    actor?: string;
    search?: string;
    from?: string;
    through?: string;
  }) => void;
  canGoNext: boolean;
  canGoPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <div className="p-6 space-y-4">
      <div className="rounded-card border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-base font-medium">Audit log</h2>
          <p className="text-sm text-card-muted">
            Read-only. Every admin action writes a row here.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select
            value={filters.action ?? 'all'}
            onValueChange={(val) => onFiltersChange({ ...filters, action: val === 'all' ? undefined : val })}
          >
            <SelectTrigger className="w-full sm:w-48" aria-label="Filter by action">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {Object.entries(AUDIT_ACTION_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Filter by actor..."
            aria-label="Filter by actor"
            value={filters.actor ?? ''}
            onChange={(e) => onFiltersChange({ ...filters, actor: e.target.value })}
            className="w-full sm:w-48"
          />
          <Input
            placeholder="Filter by target..."
            aria-label="Filter by target"
            value={filters.search ?? ''}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            className="w-full sm:w-48"
          />
          <Input
            type="date"
            aria-label="From date"
            value={filters.from ?? ''}
            onChange={(e) => onFiltersChange({ ...filters, from: e.target.value })}
            className="w-full sm:w-48"
          />
          <Input
            type="date"
            aria-label="Through date"
            value={filters.through ?? ''}
            onChange={(e) => onFiltersChange({ ...filters, through: e.target.value })}
            className="w-full sm:w-48"
          />
        </div>

        {dateError !== undefined ? (
          <div role="alert" className="text-sm text-destructive">
            {dateError}
          </div>
        ) : paginationError !== undefined ? (
          <div role="alert" className="text-sm text-destructive">
            {paginationError}
          </div>
        ) : loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading audit entries">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full bg-muted-foreground/20" />
            ))}
          </div>
        ) : (
          <>
            {rows.length === 0 ? (
              <div className="rounded-control border border-dashed border-border p-6 text-center text-sm text-card-muted">
                No audit entries match those filters. Clear a filter or a search term to see more.
              </div>
            ) : (
              <AuditTable rows={rows} />
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onPrevious} disabled={!canGoPrevious}>
                Back
              </Button>
              <Button variant="outline" onClick={onNext} disabled={!canGoNext}>
                Next
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
