'use client';

import { AdminDirectoryRow, DIRECTORY_STATUS_LABELS } from '../../app/admin/directory/directory-types';
import { Badge } from '@/components/ui/badge';

export function AdminBusinessCard({ 
  row, 
  onSelect,
  selected
}: { 
  row: AdminDirectoryRow;
  onSelect: () => void;
  selected?: boolean;
}) {
  return (
    <div 
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={`p-4 border rounded-card bg-card cursor-pointer transition-all ${selected ? 'ring-2 ring-primary ring-offset-2' : 'hover:bg-muted'}`}
    >
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-semibold text-lg">{row.name}</h3>
        {row.isVerified && <Badge variant="secondary">Verified</Badge>}
      </div>
      
      <div className="text-sm text-muted-foreground space-y-1">
        <p>{row.description}</p>
        <p><strong>Category:</strong> {row.categoryName ?? 'Uncategorized'}</p>
        <p><strong>Owner:</strong> {row.ownerName ?? 'Unknown'}</p>
        <p><strong>Location:</strong> {row.address.city}, {row.address.state}</p>
        <p><strong>Status:</strong> <Badge variant="outline">{DIRECTORY_STATUS_LABELS[row.status]}</Badge></p>
        {row.isFeatured && <Badge variant="outline">Featured</Badge>}
      </div>
    </div>
  );
}
