'use client';

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AuditTable } from './audit-table';
import { AUDIT_ACTION_LABELS, type AuditLogRow } from './audit-types';

/**
 * Read-only audit feed presentation (issue #15, Tasks 11/15; date range added
 * by B6b, issue #16), shaped as the prototype's audit card: title + read-only
 * sub-line, then a toolbar of action / actor / text / date filters over the
 * current page and the manual Back/Next cursor controls. The date bounds are
 * inclusive start / exclusive next day, so `through` includes its whole local
 * day. There are no write controls here by design — rows reflect committed
 * Convex audit state only.
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
    <div className="grid gap-4 p-5">
      <div className="bg-card border-border rounded-shell shadow-sm grid gap-4 border p-4">
        <div>
          <h2 className="mb-1 text-base font-semibold">Audit log</h2>
          <p className="text-card-muted text-tiny">
            Read-only. Every status change and delete writes a row here via{' '}
            <code className="font-mono">auditLogs</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.action ?? 'all'}
            onValueChange={(val) =>
              onFiltersChange({ ...filters, action: val === 'all' ? undefined : val })
            }
          >
            <SelectTrigger
              size="sm"
              className="rounded-input bg-card text-tiny"
              aria-label="Filter by action"
            >
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {Object.entries(AUDIT_ACTION_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Filter by actor…"
            aria-label="Filter by actor"
            value={filters.actor ?? ''}
            onChange={(event) => onFiltersChange({ ...filters, actor: event.target.value })}
            className="rounded-input bg-card h-8 min-w-40 text-tiny"
          />

          <Input
            placeholder="Search target or reason"
            aria-label="Search audit log"
            value={filters.search ?? ''}
            onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
            className="rounded-input bg-card h-8 min-w-52 text-tiny"
          />

          <Input
            type="date"
            aria-label="From date"
            value={filters.from ?? ''}
            onChange={(event) => onFiltersChange({ ...filters, from: event.target.value })}
            className="rounded-input bg-card h-8 w-40 text-tiny"
          />
          <Input
            type="date"
            aria-label="Through date"
            value={filters.through ?? ''}
            onChange={(event) => onFiltersChange({ ...filters, through: event.target.value })}
            className="rounded-input bg-card h-8 w-40 text-tiny"
          />
        </div>

        {dateError !== undefined ? (
          <div role="alert" className="text-danger text-tiny">
            {dateError}
          </div>
        ) : paginationError !== undefined ? (
          <div role="alert" className="text-danger text-tiny">
            {paginationError}
          </div>
        ) : loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading audit entries">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <AuditTable rows={rows} />
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
