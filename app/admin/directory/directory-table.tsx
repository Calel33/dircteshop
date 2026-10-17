'use client';

import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AdminDirectoryRow, DIRECTORY_STATUS_LABELS } from './directory-types';

export function DirectoryTable({ 
  rows, 
  selectedIds, 
  onToggleSelect, 
  onSelect 
}: { 
  rows: AdminDirectoryRow[]; 
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="rounded-card border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <Checkbox 
                checked={rows.length > 0 && Array.from(selectedIds).filter(id => rows.find(r => r._id === id)?.status === 'pendingReview').length === rows.filter(r => r.status === 'pendingReview').length}
                indeterminate={Array.from(selectedIds).filter(id => rows.find(r => r._id === id)?.status === 'pendingReview').length > 0 && Array.from(selectedIds).filter(id => rows.find(r => r._id === id)?.status === 'pendingReview').length < rows.filter(r => r.status === 'pendingReview').length}
                onCheckedChange={(checked) => {
                  const eligibleIds = rows.filter(r => r.status === 'pendingReview').map(r => r._id);
                  if (checked) {
                    const next = new Set(selectedIds);
                    eligibleIds.forEach(id => next.add(id));
                    onToggleSelect(Array.from(next).join(',')); // This is a bit awkward, maybe update API?
                  } else {
                    const next = new Set(selectedIds);
                    eligibleIds.forEach(id => next.delete(id));
                    onToggleSelect(Array.from(next).join(','));
                  }
                }}
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Verified</TableHead>
            <TableHead>Featured</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow 
              key={row._id} 
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onSelect(row._id)}
            >
              <TableCell onClick={(e) => { e.stopPropagation(); onToggleSelect(row._id); }}>
                <Checkbox 
                  checked={selectedIds.has(row._id)} 
                  disabled={row.status !== 'pendingReview'}
                />
              </TableCell>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell>{row.categoryName ?? 'Uncategorized'}</TableCell>
              <TableCell>{row.ownerName ?? 'Unknown'}</TableCell>
              <TableCell>{row.address.city}, {row.address.state}</TableCell>
              <TableCell><Badge variant="outline">{DIRECTORY_STATUS_LABELS[row.status]}</Badge></TableCell>
              <TableCell>{row.isVerified ? 'Yes' : 'No'}</TableCell>
              <TableCell>{row.isFeatured ? 'Yes' : 'No'}</TableCell>
              <TableCell>{new Date(row.lastUpdatedAt).toLocaleDateString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
