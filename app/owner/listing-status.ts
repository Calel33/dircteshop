import type { ListingStatus } from '@/convex/businesses/helpers';

/**
 * The Badge variants available in `components/ui/badge.tsx`. Kept as a local
 * union so this pure module does not import a React component.
 */
export type StatusChipVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export interface StatusChip {
  label: string;
  variant: StatusChipVariant;
  /** Longer explanation surfaced as the chip's `title`. */
  description: string;
}

/**
 * Owner-facing vocabulary for the six listing states (SPEC §5). Labels carry
 * the meaning on their own — colour is never the only signal.
 */
const STATUS_CHIPS: Record<ListingStatus, StatusChip> = {
  draft: {
    label: 'Draft',
    variant: 'outline',
    description: 'Not submitted for review yet.',
  },
  pendingReview: {
    label: 'Pending review',
    variant: 'secondary',
    description: 'Submitted and waiting for a moderator.',
  },
  approved: {
    label: 'Approved',
    variant: 'default',
    description: 'Live and visible to the public.',
  },
  changesRequested: {
    label: 'Changes requested',
    variant: 'secondary',
    description: 'A moderator asked for changes before approval.',
  },
  rejected: {
    label: 'Rejected',
    variant: 'destructive',
    description: 'Not approved. Revise the listing and resubmit.',
  },
  suspended: {
    label: 'Suspended',
    variant: 'destructive',
    description: 'Hidden from the public by a moderator.',
  },
};

/** Resolves the display chip for a listing status. */
export function getStatusChip(status: ListingStatus): StatusChip {
  return STATUS_CHIPS[status];
}
