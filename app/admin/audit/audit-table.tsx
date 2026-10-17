'use client';

import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { AuditLogRow, AUDIT_ACTION_LABELS } from './audit-types';

export function AuditTable({ rows }: { rows: AuditLogRow[] }) {
  if (rows.length === 0) return <div className="p-4 text-center">No logs found.</div>;

  return (
    <div className="rounded-card border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Status Change</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row._id}>
              <TableCell>{new Date(row.at).toLocaleString()}</TableCell>
              <TableCell>{AUDIT_ACTION_LABELS[row.action] ?? row.action}</TableCell>
              <TableCell>{row.actorName ?? 'System'}</TableCell>
              <TableCell>{row.targetName ?? 'Unknown'}</TableCell>
              <TableCell>{row.fromStatus ?? '-'} → {row.toStatus ?? '-'}</TableCell>
              <TableCell>{row.reason ?? '-'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
