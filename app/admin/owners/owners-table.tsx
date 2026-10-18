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

/**
 * Prototype `.chip` for the role column: Super Admin reads as brand blue,
 * every other account as the neutral slate chip.
 */
const ROLE_CHIP_CLASSES: Record<OwnerRow['role'], string> = {
  user: 'bg-neutral-chip text-neutral-chip-foreground border-border-strong',
  superAdmin: 'bg-brand-soft text-brand-strong border-brand-border',
};

const HEAD_CELL =
  'bg-panel text-muted-foreground border-border text-micro tracking-label h-auto px-3 py-2 font-semibold uppercase';
const CELL = 'border-border border-b px-3 py-2 text-tiny';

function RoleChip({ role }: { role: OwnerRow['role'] }) {
  return (
    <span
      className={cn(
        'rounded-pill inline-flex items-center border px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        ROLE_CHIP_CLASSES[role]
      )}
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
 * Read-only `/admin/owners` panel (issue #16, Task 2), matching the
 * prototype's card: title, read-only sub-line, and a bordered table of Name /
 * Businesses (right, tabular) / Role chip. Presentation only: the route
 * (`page.tsx`) owns the guarded query and the cursor stack.
 *
 * The prototype's Email column is absent because the guarded projection
 * intentionally returns no address (privacy rule), and a column the server
 * does not send cannot be rendered without changing the query contract.
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
    <div className="grid gap-4 p-5">
      <div className="bg-card border-border rounded-shell shadow-sm border p-4">
        <h2 className="mb-1 text-base font-semibold">Business owners</h2>
        <p className="text-card-muted mb-3 text-tiny">
          Read-only in v1 — no account suspension or ownership reassignment.
        </p>

        {loading ? (
          <OwnersTableSkeleton />
        ) : error !== null ? (
          <p role="alert" className="text-destructive text-tiny">
            {error}
          </p>
        ) : rows.length === 0 ? (
          <div className="border-border-strong text-muted-foreground rounded-menu border border-dashed p-6 text-center text-sm">
            No users found.
          </div>
        ) : (
          <div className="rounded-menu border-border overflow-x-auto border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className={HEAD_CELL}>Name</TableHead>
                  <TableHead className={cn(HEAD_CELL, 'text-right')}>Businesses</TableHead>
                  <TableHead className={HEAD_CELL}>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr:last-child>td]:border-b-0">
                {rows.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell className={cn(CELL, 'font-semibold')}>{row.name}</TableCell>
                    <TableCell className={cn(CELL, 'text-right tabular-nums')}>
                      {row.businessCount}
                    </TableCell>
                    <TableCell className={CELL}>
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
      )}
    </div>
  );
}
