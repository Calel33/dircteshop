import type { ListingStatus } from '@/convex/businesses/helpers';

/**
 * Owner-facing status vocabulary for the six listing states (SPEC §5). Labels
 * carry the meaning on their own — colour is never the only signal. The colour
 * classes map the throwaway prototype's status tints (owner-workspace.html
 * L96–101) onto the app's palette; the prototype's CSS itself is not ported.
 */
export interface StatusChip {
  label: string;
  /** Colour classes applied to the Badge; the label remains the primary signal. */
  className: string;
  /** Longer explanation surfaced as the chip's `title`. */
  description: string;
  /** Status-dependent owner CTA on the home card (prototype L825–837). */
  actionLabel: string;
}

const STATUS_CHIPS: Record<ListingStatus, StatusChip> = {
  draft: {
    label: 'Draft',
    className: 'bg-muted text-muted-foreground',
    description: 'Not submitted for review yet.',
    actionLabel: 'Continue editing',
  },
  pendingReview: {
    label: 'Pending Review',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    description: 'Submitted and waiting for a moderator.',
    actionLabel: 'View (read-only)',
  },
  approved: {
    label: 'Approved',
    className: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
    description: 'Live and visible to the public.',
    actionLabel: 'Edit listing',
  },
  changesRequested: {
    label: 'Changes Requested',
    className: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
    description: 'A moderator asked for changes before approval.',
    actionLabel: 'Fix & resubmit',
  },
  rejected: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
    description: 'Not approved. Revise the listing and resubmit.',
    actionLabel: 'Revise & resubmit',
  },
  suspended: {
    label: 'Suspended',
    className: 'bg-muted text-muted-foreground',
    description: 'Hidden from the public by a moderator.',
    actionLabel: 'View listing',
  },
};

/** Resolves the display chip for a listing status. */
export function getStatusChip(status: ListingStatus): StatusChip {
  return STATUS_CHIPS[status];
}
