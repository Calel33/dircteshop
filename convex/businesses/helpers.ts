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

/** Actions a caller may request; the server resolves each against the current status. */
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
 * Action -> default (required role, target status). The default role assumes
 * the acting role is uniform per action; transitions where the actor differs
 * are listed in `TRANSITION_ROLE_OVERRIDES` and applied by `resolveTransition`.
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

/**
 * Per-transition role overrides where the acting role differs from the action
 * default. The authoritative actor table
 * (`screens/wayfinder/research/convex-domain-model.md` L184-196) assigns
 * `rejected -> pendingReview` to Super Admin (the admin reopen path), while
 * every other `-> pendingReview` row belongs to the owner.
 */
const TRANSITION_ROLE_OVERRIDES: readonly {
  from: ListingStatus;
  to: ListingStatus;
  requiredRole: TransitionRole;
}[] = [{ from: 'rejected', to: 'pendingReview', requiredRole: 'superAdmin' }];

/**
 * Resolves a requested action against the business's current status. Returns
 * the role allowed to perform it and the status it produces, or `undefined`
 * when the action's target is not a legal transition from `currentStatus`.
 * Callers must reject `undefined`. The role is transition-aware, so the
 * Super-Admin-only `rejected -> pendingReview` reopen cannot be fired by an
 * owner.
 */
export function resolveTransition(
  currentStatus: ListingStatus,
  action: TransitionAction
): TransitionResolution | undefined {
  const { targetStatus } = TRANSITION_ACTIONS[action];
  if (!STATUS_TRANSITIONS[currentStatus].includes(targetStatus)) {
    return undefined;
  }

  const override = TRANSITION_ROLE_OVERRIDES.find(
    (candidate) => candidate.from === currentStatus && candidate.to === targetStatus
  );

  return {
    requiredRole: override?.requiredRole ?? TRANSITION_ACTIONS[action].requiredRole,
    targetStatus,
  };
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
