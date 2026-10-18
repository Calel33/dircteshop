'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { AUDIT_ACTION_LABELS, type AuditLogRow } from './audit-types';

const HEAD_CELL =
  'bg-panel text-muted-foreground border-border text-micro tracking-label h-auto px-3 py-2 font-semibold uppercase';
const CELL = 'border-border border-b px-3 py-2 text-tiny';

/**
 * Read-only audit rows (prototype `auditRows`): When (mono), Actor, Action
 * (bold), Target, Change (`from → to`, mono, em dash when empty), and Reason
 * (muted, em dash when empty).
 */
export function AuditTable({ rows }: { rows: AuditLogRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="border-border-strong text-muted-foreground rounded-menu border border-dashed p-6 text-center text-sm">
        No audit entries match those filters. Clear a filter or a search term to see more.
      </div>
    );
  }

  return (
    <div className="rounded-menu border-border overflow-x-auto border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD_CELL}>When</TableHead>
            <TableHead className={HEAD_CELL}>Actor</TableHead>
            <TableHead className={HEAD_CELL}>Action</TableHead>
            <TableHead className={HEAD_CELL}>Target</TableHead>
            <TableHead className={HEAD_CELL}>Change</TableHead>
            <TableHead className={HEAD_CELL}>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_tr:last-child>td]:border-b-0">
          {rows.map((row) => {
            const change =
              row.fromStatus === null && row.toStatus === null
                ? '—'
                : `${row.fromStatus ?? '—'} → ${row.toStatus ?? '—'}`;

            return (
              <TableRow key={row._id}>
                <TableCell className={cn(CELL, 'text-muted-foreground font-mono text-xs')}>
                  {new Date(row.at).toLocaleString()}
                </TableCell>
                <TableCell className={CELL}>{row.actorName ?? 'System'}</TableCell>
                <TableCell className={cn(CELL, 'font-semibold')}>
                  {AUDIT_ACTION_LABELS[row.action] ?? row.action}
                </TableCell>
                <TableCell className={CELL}>{row.targetName ?? 'Unknown'}</TableCell>
                <TableCell className={cn(CELL, 'font-mono text-xs')}>{change}</TableCell>
                <TableCell className={cn(CELL, 'text-muted-foreground text-xs')}>
                  {row.reason === null || row.reason === '' ? '—' : row.reason}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
