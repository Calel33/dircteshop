'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { DirectoryListingStatus, type DirectoryFilters } from './directory-types';

export function DirectoryFilters({ 
  filters, 
  onUpdate, 
  categories 
}: { 
  filters: DirectoryFilters, 
  onUpdate: (f: DirectoryFilters) => void,
  categories: { _id: string, name: string }[]
}) {
  return (
    <div className="flex flex-col sm:flex-row flex-wrap gap-2 mb-6">
      <Input
        placeholder="Search..."
        value={filters.search ?? ''}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate({ ...filters, search: e.target.value })}
        className="w-full sm:max-w-xs"
      />
      <div className="flex flex-wrap gap-2">
        <Select 
          value={filters.categoryId ?? 'all'} 
          onValueChange={(val: string) => onUpdate({ ...filters, categoryId: val === 'all' ? undefined : val })}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(c => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select 
          value={filters.status ?? 'all'} 
          onValueChange={(val: string) => onUpdate({ ...filters, status: val === 'all' ? undefined : val as DirectoryListingStatus })}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pendingReview">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="changesRequested">Changes Requested</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
