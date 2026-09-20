import type { Infer } from 'convex/values';

import type { listingStatusValidator } from '../businessTypes';

// Business listing lifecycle types and the SPEC §5 approval state machine.
// Pure data + pure functions: no Convex runtime imports, so this module can be
// checked in isolation.

export type ListingStatus = Infer<typeof listingStatusValidator>;

/**
 * The only transitions the server will ever perform, copied verbatim from
 * SPEC §5 (`allowedTransitions`): current status -> permitted next statuses.
 * Mutations never accept a client status; they resolve one through
 * `resolveTransition` and then check it against this allow-list.
 */
export const STATUS_TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ['pendingReview', 'rejected'],
  pendingReview: ['approved', 'changesRequested', 'rejected'],
  approved: ['pendingReview', 'suspended'],
  changesRequested: ['pendingReview', 'draft', 'rejected'],
  rejected: ['draft', 'pendingReview'],
  suspended: ['approved'],
};

/** Actions a caller may request; the server maps each to a role + status. */
export type TransitionAction =
  | 'submitForReview'
  | 'approve'
  | 'requestChanges'
  | 'reject'
  | 'suspend'
  | 'restore'
  | 'reopenAsDraft';

/** `owner` is ownership-derived (`businesses.ownerId`), not a `users.role` value. */
export type TransitionRole = 'owner' | 'superAdmin';

type TransitionResolution = {
  requiredRole: TransitionRole;
  targetStatus: ListingStatus;
};

/**
 * Action -> (required role, target status). Callers still check the target
 * against `STATUS_TRANSITIONS` for the business's current status, so the
 * allow-list stays the single source of legal transitions.
 */
export const TRANSITION_ACTIONS = {
  submitForReview: { requiredRole: 'owner', targetStatus: 'pendingReview' },
  approve: { requiredRole: 'superAdmin', targetStatus: 'approved' },
  requestChanges: { requiredRole: 'superAdmin', targetStatus: 'changesRequested' },
  reject: { requiredRole: 'superAdmin', targetStatus: 'rejected' },
  suspend: { requiredRole: 'superAdmin', targetStatus: 'suspended' },
  restore: { requiredRole: 'superAdmin', targetStatus: 'approved' },
  reopenAsDraft: { requiredRole: 'owner', targetStatus: 'draft' },
} as const satisfies Record<TransitionAction, TransitionResolution>;

/** Resolves a requested action to the role allowed to perform it and the status it produces. */
export function resolveTransition(action: TransitionAction) {
  return TRANSITION_ACTIONS[action];
}

/**
 * The `searchText` invariant from SPEC §4:
 * `[name, keywords.join(' '), description].join(' ')`. Every business write
 * recomputes this; it is never client-supplied.
 */
export function buildSearchText(
  name: string,
  keywords: readonly string[],
  description: string
): string {
  return [name, keywords.join(' '), description].join(' ');
}
