import { ConvexError } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import type { ListingStatus, TransitionAction, TransitionRole } from './businesses/helpers';
import type { ModerationAction } from './businesses/moderationPolicy';

// B5 (issue #5) notification policy and the reusable writer. The policy half is
// pure and importable by `node --test` (only type imports from Convex modules,
// like `businesses/moderationPolicy.ts`); the writer half accepts the Convex
// mutation context as an argument and inserts into `notifications` inside the
// caller's transaction, so a state write and its notices commit or roll back
// together. Recipients, types, messages, reasons, and timestamps are always
// server-derived; no client input reaches this module.
//
// Docs: https://docs.convex.dev/functions/mutation-functions (atomic writes)

/**
 * The exact `notifications.type` strings implemented here (B5 listing
 * lifecycle + B8 orders). `type` stays a persisted string (schema) so later
 * workflow kinds need no migration; this union is the frozen contract for the
 * kinds implemented today.
 */
export const NOTIFICATION_EVENT_TYPES = [
  'listing_submitted',
  'listing_approved',
  'listing_changes_requested',
  'listing_rejected',
  'listing_suspended',
  'new_order',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

/**
 * One lifecycle event addressed to a recipient the caller derived server-side
 * (`businesses.ownerId` for owners, the configured-allowlist join for admins).
 * `reason` is the raw moderation/suspension reason; normalization happens in
 * `buildNotificationContent`.
 */
export type ListingNotificationEvent = {
  type: NotificationEventType;
  businessId: Id<'businesses'>;
  businessName: string;
  reason: string | undefined;
};

/** The persisted record content the writer derives from an event. */
export type NotificationContent = {
  type: NotificationEventType;
  message: string;
  reason: string | undefined;
};

/**
 * Owner/admin-facing message per event kind. Server-owned: the client never
 * supplies notification text. Kept to business name + outcome (plan §Trigger
 * matrix, "Messages are server-owned and simple").
 */
function notificationMessage(type: NotificationEventType, businessName: string): string {
  switch (type) {
    case 'listing_submitted':
      return `"${businessName}" was submitted for review.`;
    case 'listing_approved':
      return `"${businessName}" was approved.`;
    case 'listing_changes_requested':
      return `Changes were requested for "${businessName}".`;
    case 'listing_rejected':
      return `"${businessName}" was rejected.`;
    case 'listing_suspended':
      return `"${businessName}" was suspended.`;
    case 'new_order':
      return `New order for "${businessName}".`;
  }
}

/** Trims a reason and treats a blank one as absent. */
function normalizedReason(reason: string | undefined): string | undefined {
  const trimmed = (reason ?? '').trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Derives the persisted record content for an event. `changesRequested` and
 * `rejected` must carry a non-blank reason — the moderation policy enforces
 * this before any write, and this guard keeps the writer safe for future
 * callers (B8–B10) by throwing instead of persisting an unactionable notice.
 * `submitted` never carries a reason; `approved`/`suspended` normalize a blank
 * reason to `undefined` ("reason only when one exists").
 */
export function buildNotificationContent(input: {
  type: NotificationEventType;
  businessName: string;
  reason: string | undefined;
}): NotificationContent {
  const reason = input.type === 'listing_submitted' ? undefined : normalizedReason(input.reason);

  if (input.type === 'listing_changes_requested' || input.type === 'listing_rejected') {
    if (reason === undefined) {
      throw new ConvexError(`${input.type} requires a reason`);
    }
  }

  return {
    type: input.type,
    message: notificationMessage(input.type, input.businessName),
    reason,
  };
}

/** A candidate admin recipient resolved from the local `users` table. */
export type NotificationRecipientUser = {
  _id: Id<'users'>;
  externalId: string;
};

/**
 * Pure half of the admin recipient resolution: keeps only users whose Clerk
 * external id is in the live allowlist (a stale stamped `superAdmin` role is
 * not enough), drops the acting admin when excluding (admin-origin reopen), and
 * deduplicates. Allowlist ids with no `users` row are simply absent from
 * `users` — the byExternalId join produced no candidate. Order is preserved.
 */
export function selectAdminRecipientUserIds(
  users: readonly NotificationRecipientUser[],
  options: { allowlist: ReadonlySet<string>; excludeUserId?: Id<'users'> | null }
): Id<'users'>[] {
  const excludeUserId = options.excludeUserId ?? null;
  const seen = new Set<Id<'users'>>();
  const recipientIds: Id<'users'>[] = [];

  for (const user of users) {
    if (!options.allowlist.has(user.externalId)) continue;
    if (user._id === excludeUserId) continue;
    if (seen.has(user._id)) continue;
    seen.add(user._id);
    recipientIds.push(user._id);
  }

  return recipientIds;
}

/** Who receives a transition's notice, derived server-side. */
export type TransitionNotificationPlan = {
  audience: 'configuredAdmins' | 'configuredAdminsExcludingActor' | 'owner';
  event: ListingNotificationEvent;
};

/**
 * Pure mapping from a resolved transition to its notification plan. Keyed on
 * the resolved role, never the action name alone: the admin reopen of a
 * rejected listing rides `submitForReview` resolved as `superAdmin`
 * (`businesses/helpers.ts` TRANSITION_ROLE_OVERRIDES), so only that resolution
 * excludes the acting admin. Returns `undefined` when the transition has no
 * B5 notice — including every invalid action/status pair, so a caller that
 * somehow reached this with one inserts nothing.
 */
export function planTransitionNotification(input: {
  action: TransitionAction;
  requiredRole: TransitionRole;
  targetStatus: ListingStatus;
  businessId: Id<'businesses'>;
  businessName: string;
  reason: string | undefined;
}): TransitionNotificationPlan | undefined {
  if (input.action === 'submitForReview' && input.targetStatus === 'pendingReview') {
    return {
      audience:
        input.requiredRole === 'owner' ? 'configuredAdmins' : 'configuredAdminsExcludingActor',
      event: {
        type: 'listing_submitted',
        businessId: input.businessId,
        businessName: input.businessName,
        reason: undefined,
      },
    };
  }

  if (input.action === 'suspend' && input.targetStatus === 'suspended') {
    return {
      audience: 'owner',
      event: {
        type: 'listing_suspended',
        businessId: input.businessId,
        businessName: input.businessName,
        reason: input.reason,
      },
    };
  }

  if (input.action === 'restore' && input.targetStatus === 'approved') {
    return {
      audience: 'owner',
      event: {
        type: 'listing_approved',
        businessId: input.businessId,
        businessName: input.businessName,
        reason: input.reason,
      },
    };
  }

  return undefined;
}

/**
 * Pure mapping from a moderation decision to the owner notice. The action
 * union is closed, so every decision maps; `approve` passes the policy-cleared
 * `undefined` reason through unchanged.
 */
export function moderationNotificationEvent(input: {
  action: ModerationAction;
  businessId: Id<'businesses'>;
  businessName: string;
  reason: string | undefined;
}): ListingNotificationEvent {
  const type: NotificationEventType =
    input.action === 'approve'
      ? 'listing_approved'
      : input.action === 'requestChanges'
        ? 'listing_changes_requested'
        : 'listing_rejected';

  return {
    type,
    businessId: input.businessId,
    businessName: input.businessName,
    reason: input.reason,
  };
}

/**
 * `markAllReadBatch` reads at most 9 unread rows and updates at most 8 per
 * transaction (plan §Data and API design): 9 reads and 8 writes of sub-1-MiB
 * documents keep the payload under Convex's 16 MiB transaction byte limit with
 * headroom. A 9th read row proves more remain, so the client repeats bounded
 * batches until `hasMore` is false.
 */
export const MARK_ALL_READ_SCAN_LIMIT = 9;
export const MARK_ALL_READ_UPDATE_LIMIT = 8;

export type MarkAllReadPlan = {
  toUpdate: Id<'notifications'>[];
  updatedCount: number;
  hasMore: boolean;
};

/**
 * The bounded mark-all batch plan for the rows one scan returned. Updates the
 * first 8 in index order; `hasMore` reports that a 9th read row exists.
 */
export function planMarkAllRead(unreadIds: readonly Id<'notifications'>[]): MarkAllReadPlan {
  const toUpdate = unreadIds.slice(0, MARK_ALL_READ_UPDATE_LIMIT);

  return {
    toUpdate,
    updatedCount: toUpdate.length,
    hasMore: unreadIds.length > MARK_ALL_READ_UPDATE_LIMIT,
  };
}

/**
 * The reusable writer: one `notifications` record for one server-derived
 * recipient, with server timestamps (`createdAt` defaults to the handler's
 * clock; callers pass their transaction's `now` so the notice and the state
 * write share one timestamp). A throw here rejects the caller's whole
 * mutation, so a transition never commits without its notice — and a failed
 * notice can never leave a silent transition.
 */
export async function insertNotification(
  ctx: MutationCtx,
  recipientUserId: Id<'users'>,
  event: ListingNotificationEvent,
  createdAt: number = Date.now()
): Promise<void> {
  const content = buildNotificationContent({
    type: event.type,
    businessName: event.businessName,
    reason: event.reason,
  });

  await ctx.db.insert('notifications', {
    userId: recipientUserId,
    type: content.type,
    businessId: event.businessId,
    message: content.message,
    reason: content.reason,
    createdAt,
  });
}

/**
 * Fans one event out to the currently configured Super Admin users: the live
 * env allowlist joined to local `users` rows through `byExternalId` (an
 * allowlist id with no row yet is skipped), minus `excludeUserId` for the
 * admin-origin reopen (no self-notification; nothing is inserted when the
 * actor is the only configured admin). The allowlist is passed in rather than
 * read here so this module stays importable by `node --test`; callers read
 * `configuredSuperAdminIds()` inside their handler (live per request, not
 * cached). One insert per recipient, all in the caller's transaction.
 */
export async function notifyAdminRecipients(
  ctx: MutationCtx,
  event: ListingNotificationEvent,
  options: {
    allowlist: ReadonlySet<string>;
    excludeUserId?: Id<'users'> | null;
    createdAt: number;
  }
): Promise<void> {
  const users = await Promise.all(
    [...options.allowlist].map((externalId) =>
      ctx.db
        .query('users')
        .withIndex('byExternalId', (q) => q.eq('externalId', externalId))
        .unique()
    )
  );

  const recipientIds = selectAdminRecipientUserIds(
    users.filter((user): user is Doc<'users'> => user !== null),
    { allowlist: options.allowlist, excludeUserId: options.excludeUserId ?? null }
  );

  for (const recipientId of recipientIds) {
    await insertNotification(ctx, recipientId, event, options.createdAt);
  }
}
