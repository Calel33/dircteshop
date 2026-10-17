'use client';

import { AdminDirectoryRow } from './directory-types';
import { AdminBusinessCard } from '@/components/directory/admin-business-card';

export function DirectoryGrid({ 
  rows, 
  selectedId, 
  onSelect 
}: { 
  rows: AdminDirectoryRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
