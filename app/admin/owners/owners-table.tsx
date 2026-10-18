'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { OwnerRow } from '@/convex/adminProjections';

/** Human labels for the stamped `users.role` values (the row stays raw). */
const ROLE_LABELS: Record<OwnerRow['role'], string> = {
  user: 'User',
  superAdmin: 'Super Admin',
};

/** The prototype's `.chip`: pill, hairline border, one size. */
const ROLE_CHIP_CLASSES: Record<OwnerRow['role'], string> = {
  user: 'bg-muted text-muted-foreground border-border',
  superAdmin: 'bg-secondary text-secondary-foreground border-border',
};

function RoleChip({ role }: { role: OwnerRow['role'] }) {
  return (
    <span
      className={cn('rounded-pill border px-2 py-0.5 text-xs font-semibold', ROLE_CHIP_CLASSES[role])}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

/** Truthful loading state: table-shaped skeleton rows inside the card. */
function OwnersTableSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading owners">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

/**
 * Read-only `/admin/owners` table (issue #16, Task 2). Presentation only: the
 * route (`page.tsx`) owns the guarded query and the cursor stack, so this
 * component renders state and never writes. The prototype's panel is matched
 * column for column — Name, Businesses (right aligned), Role chip — minus its
 * Email column: the issue's privacy rule forbids returning one, and `users`
 * rows carry no email anyway. Zero-business users render like any other row.
 */
export function OwnersTable({
  rows,
  loading,
  error,
  canGoNext,
  canGoPrevious,
  onNext,
  onPrevious,
}: {
  rows: OwnerRow[];
  loading: boolean;
  error: string | null;
  canGoNext: boolean;
  canGoPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <div className="p-[1.5rem] space-y-[1.5rem]">
      <div className="rounded-[1rem] border border-border bg-card p-[1.5rem] shadow-sm">
        <h2 className="font-display text-[1rem] font-[600]">Business owners</h2>
        <p className="text-card-muted mt-[0.25rem] mb-[1.5rem] text-[0.8125rem]">
          Read-only in v1 — no account suspension or ownership reassignment.
        </p>

        {loading ? (
          <OwnersTableSkeleton />
        ) : error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-card-muted py-[2rem]">No users found.</p>
        ) : (
          <div className="rounded-[0.5rem] border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-card-muted text-[0.6875rem] uppercase tracking-[0.05em]">
                    Name
                  </TableHead>
                  <TableHead className="text-card-muted text-right text-[0.6875rem] uppercase tracking-[0.05em]">
                    Businesses
                  </TableHead>
                  <TableHead className="text-card-muted text-[0.6875rem] uppercase tracking-[0.05em]">
                    Role
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className="font-[600]">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.businessCount}
                    </TableCell>
                    <TableCell>
                      <RoleChip role={row.role} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {loading ? null : (
        <div className="flex items-center gap-[0.5rem]">
          <Button variant="outline" onClick={onPrevious} disabled={!canGoPrevious}>
            Back
          </Button>
          <Button variant="outline" onClick={onNext} disabled={!canGoNext}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
