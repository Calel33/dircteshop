'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { StarRating, StatusChip } from '@/app/admin/status-chip';
import { AdminDirectoryRow } from './directory-types';

const HEAD_CELL =
  'bg-panel text-muted-foreground border-border text-micro tracking-label h-auto px-3 py-2 font-semibold uppercase';
const CELL = 'px-3 py-2 text-tiny';

/**
 * Table view of the current directory page (prototype `directoryBodyB` table
 * branch): Business (name + location), Category, Status, Owner, Rating, and an
 * Inspect button. The leading checkbox column is retained from the app's
 * existing page-scoped selection model so bulk approve keeps working.
 */
export function DirectoryTable({
  rows,
  selectedIds,
  onToggleSelectBulk,
  onSelect,
}: {
  rows: AdminDirectoryRow[];
  selectedIds: Set<string>;
  onToggleSelectBulk: (updater: (prev: Set<string>) => Set<string>) => void;
  onSelect: (id: string) => void;
}) {
  const eligibleRows = rows.filter((row) => row.status === 'pendingReview');
  const allSelected = eligibleRows.length > 0 && eligibleRows.every((row) => selectedIds.has(row._id));
  const someSelected = eligibleRows.some((row) => selectedIds.has(row._id));

  return (
    <div className="rounded-menu border-border overflow-x-auto border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD_CELL, 'w-12')}>
              <Checkbox
                aria-label="Select all pending listings on this page"
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={(checked) => {
                  onToggleSelectBulk((prev) => {
                    const next = new Set(prev);
                    eligibleRows.forEach((row) => {
                      if (checked) next.add(row._id);
                      else next.delete(row._id);
                    });
                    return next;
                  });
                }}
              />
            </TableHead>
            <TableHead className={HEAD_CELL}>Business</TableHead>
            <TableHead className={HEAD_CELL}>Category</TableHead>
            <TableHead className={HEAD_CELL}>Status</TableHead>
            <TableHead className={HEAD_CELL}>Owner</TableHead>
            <TableHead className={cn(HEAD_CELL, 'text-right')}>Rating</TableHead>
            <TableHead className={cn(HEAD_CELL, 'text-right')}>
              <span className="sr-only">Inspect</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const selected = selectedIds.has(row._id);
            const location = [row.address.city, row.address.state].filter(Boolean).join(', ');
            return (
              <TableRow
                key={row._id}
                className={cn('cursor-pointer', selected && 'bg-brand-soft hover:bg-brand-soft')}
                onClick={() => onSelect(row._id)}
              >
                <TableCell
                  className={CELL}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (row.status !== 'pendingReview') return;
                    onToggleSelectBulk((prev) => {
                      const next = new Set(prev);
                      if (next.has(row._id)) next.delete(row._id);
                      else next.add(row._id);
                      return next;
                    });
                  }}
                >
                  <Checkbox
                    checked={selected}
                    disabled={row.status !== 'pendingReview'}
                    aria-label={`Select ${row.name}`}
                  />
                </TableCell>
                <TableCell className={CELL}>
                  <div className="font-semibold">{row.name}</div>
                  <div className="text-muted-foreground text-xs">{location}</div>
                </TableCell>
                <TableCell className={CELL}>{row.categoryName ?? 'Uncategorized'}</TableCell>
                <TableCell className={CELL}>
                  <StatusChip status={row.status} />
                </TableCell>
                <TableCell className={CELL}>{row.ownerName ?? 'Unknown'}</TableCell>
                <TableCell className={cn(CELL, 'text-right tabular-nums')}>
                  <StarRating rating={row.rating} />
                </TableCell>
                <TableCell className={cn(CELL, 'text-right')}>
                  <button
                    type="button"
                    className="border-border-strong rounded-input hover:bg-panel border px-2 py-1 text-xs font-semibold"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(row._id);
                    }}
                  >
                    Inspect
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
