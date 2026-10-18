'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DirectoryListingStatus, type DirectoryFilters } from './directory-types';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'draft', label: 'Draft' },
  { value: 'pendingReview', label: 'Pending review' },
  { value: 'approved', label: 'Approved' },
  { value: 'changesRequested', label: 'Changes requested' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
];

/**
 * The prototype's `filterBar` selects, shown only below the deck breakpoint
 * where the rail (and its radio groups) is hidden. The search field lives in
 * the dataset toolbar at every width, so it is not repeated here.
 */
export function DirectoryFilters({
  filters,
  onUpdate,
  categories,
}: {
  filters: DirectoryFilters;
  onUpdate: (f: DirectoryFilters) => void;
  categories: { _id: string; name: string }[];
}) {
  return (
    <>
      <Select
        value={filters.categoryId ?? 'all'}
        onValueChange={(val: string) =>
          onUpdate({ ...filters, categoryId: val === 'all' ? undefined : val })
        }
      >
        <SelectTrigger
          size="sm"
          className="rounded-input bg-card text-tiny"
          aria-label="Filter by category"
        >
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          {categories.map((category) => (
            <SelectItem key={category._id} value={category._id}>
              {category.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.status ?? 'all'}
        onValueChange={(val: string) =>
          onUpdate({
            ...filters,
            status: val === 'all' ? undefined : (val as DirectoryListingStatus),
          })
        }
      >
        <SelectTrigger
          size="sm"
          className="rounded-input bg-card text-tiny"
          aria-label="Filter by status"
        >
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.isVerified === undefined ? 'all' : String(filters.isVerified)}
        onValueChange={(val: string) =>
          onUpdate({ ...filters, isVerified: val === 'all' ? undefined : val === 'true' })
        }
      >
        <SelectTrigger
          size="sm"
          className="rounded-input bg-card text-tiny"
          aria-label="Filter by verification"
        >
          <SelectValue placeholder="Verification" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any verification</SelectItem>
          <SelectItem value="true">Verified</SelectItem>
          <SelectItem value="false">Unverified</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
