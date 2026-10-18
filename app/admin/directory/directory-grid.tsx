'use client';

import { AdminDirectoryRow } from './directory-types';
import { AdminBusinessCard } from '@/components/directory/admin-business-card';

/** Prototype `.grid-cards`: auto-fill columns, 0.75rem gutter. */
export function DirectoryGrid({
  rows,
  selectedId,
  onSelect,
}: {
  rows: AdminDirectoryRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid-cols-(--grid-admin-cards) grid gap-3">
      {rows.map((row) => (
        <AdminBusinessCard
          key={row._id}
          row={row}
          selected={selectedId === row._id}
          onSelect={() => onSelect(row._id)}
        />
      ))}
    </div>
  );
}
