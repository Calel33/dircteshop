import type { Id } from '@/convex/_generated/dataModel';

export type DirectoryListingStatus = 'draft'|'pendingReview'|'approved'|'changesRequested'|'rejected'|'suspended';

export type AdminDirectoryRow = {
  _id: Id<'businesses'>;
  name: string;
  description: string;
  status: DirectoryListingStatus;
  isFeatured: boolean;
  isVerified: boolean;
  categoryName: string | null;
  ownerName: string | null;
  email: string | null; // listing contact email (admin projection)
  createdAt: number;
  address: { addressLine1: string; city: string; state: string };
  phone: string | null;
  website: string | null;
  rating: number;
  ratingCount: number;
  lastUpdatedAt: number;
  submittedAt: number | null;
};

export type DirectoryViewMode = 'grid' | 'table';

export const DIRECTORY_PAGE_SIZE = 25;

export type DirectoryFilters = {
  search?: string;
  categoryId?: string;
  status?: DirectoryListingStatus;
  isVerified?: boolean;
  featuredOnly?: boolean;
};

export const DIRECTORY_STATUS_LABELS: Record<DirectoryListingStatus, string> = {
  draft: 'Draft',
  pendingReview: 'Pending review',
  approved: 'Approved',
  changesRequested: 'Changes requested',
  rejected: 'Rejected',
  suspended: 'Suspended',
};
