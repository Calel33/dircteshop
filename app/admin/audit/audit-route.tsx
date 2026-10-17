'use client';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AuditTable } from './audit-table';
import { AUDIT_ACTION_LABELS, type AuditLogRow } from './audit-types';

/**
 * Read-only audit feed presentation (issue #15, Tasks 11/15): action/actor/
 * text filters over the current page plus the manual Back/Next cursor
 * controls. There are no write controls here by design — rows reflect
 * committed Convex audit state only.
 */
export function AuditRoute({
  rows,
  loading,
  filters,
  onFiltersChange,
  canGoNext,
  canGoPrevious,
  onNext,
  onPrevious,
}: {
  rows: AuditLogRow[];
  loading: boolean;
  filters: { action?: string; actor?: string; search?: string };
  onFiltersChange: (f: { action?: string; actor?: string; search?: string }) => void;
  canGoNext: boolean;
  canGoPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select
          value={filters.action ?? 'all'}
          onValueChange={(val) => onFiltersChange({ ...filters, action: val === 'all' ? undefined : val })}
        >
          <SelectTrigger className="w-48">
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
          className="w-48"
        />
        <Input
          placeholder="Filter by target..."
          aria-label="Filter by target"
          value={filters.search ?? ''}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="w-48"
        />
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-card-muted py-8">No audit entries.</p>
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
  );
}
