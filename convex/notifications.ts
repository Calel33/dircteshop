import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import { mutation, query } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { getCurrentUser, getCurrentUserOrThrow } from './users';
import { MARK_ALL_READ_SCAN_LIMIT, planMarkAllRead } from './notificationHelpers';

// B5 (issue #5) in-app notifications: user-scoped reads and read controls.
// Every handler derives the user from the Convex auth context — no function
// accepts a `userId`, so cross-user reads or writes are impossible by shape
// (the frozen UI contract; tasks/issue-5-plan.md §Data and API design).
// Docs: https://docs.convex.dev/auth/functions-auth · https://docs.convex.dev/database/pagination
//       https://docs.convex.dev/database/types#working-with-undefined

/**
 * The explicit presentation projection (frozen UI contract): exactly the
 * fields the notification menu renders — `_id`, `type`, `message`,
 * `businessId?`, `reason?`, `createdAt`, `readAt?` — never the raw document
 * (`userId` stays server-side).
 */
function toNotificationItem(notification: Doc<'notifications'>) {
  return {
    _id: notification._id,
    type: notification.type,
    message: notification.message,
    businessId: notification.businessId,
    reason: notification.reason,
    createdAt: notification.createdAt,
    readAt: notification.readAt,
  };
}

/**
 * Newest-first, cursor-paginated notifications for the signed-in user only,
 * read from the `byUserIdAndCreatedAt` index in descending order. Anonymous
 * (no identity, or identity without a `users` row) receives an empty finished
 * page, mirroring `businesses.queries.listMine` — the query never throws for
 * anonymous callers so a subscription can mount before auth resolves, and it
 * never leaks another user's records.
 */
export const listMine = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (user === null) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const page = await ctx.db
      .query('notifications')
      .withIndex('byUserIdAndCreatedAt', (q) => q.eq('userId', user._id))
      .order('desc')
      .paginate(args.paginationOpts);

    return { ...page, page: page.page.map(toNotificationItem) };
  },
});

/**
 * Exact unread count for the signed-in user, read from the unread index range
 * (`readAt === undefined` matches rows without the field; docs above).
 * Anonymous → `0`. The scan is proportional to the unread set — the plan's
 * documented pressure point; an aggregate/counter is a separate decision if
 * measured use approaches the Convex read limits.
 */
export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) {
      return 0;
    }

    const unread = await ctx.db
      .query('notifications')
      .withIndex('byUserIdAndReadAt', (q) => q.eq('userId', user._id).eq('readAt', undefined))
      .collect();

    return unread.length;
  },
});

/**
 * Marks one of the current user's notifications read. Idempotent — an
 * already-read record is a no-op success. A missing record and another user's
 * record throw the same not-found error, so the mutation cannot probe for
 * other users' notification ids. `readAt` is always server time.
 */
export const markRead = mutation({
  args: { notificationId: v.id('notifications') },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);

    const notification = await ctx.db.get(args.notificationId);
    if (notification === null || notification.userId !== user._id) {
      throw new ConvexError('Notification not found');
    }

    if (notification.readAt !== undefined) {
      return null;
    }

    await ctx.db.patch(args.notificationId, { readAt: Date.now() });
    return null;
  },
});

/**
 * One bounded mark-all-read transaction: reads at most 9 unread rows for the
 * current user from the unread index and updates at most 8 of them
 * (`planMarkAllRead`), returning `{ updatedCount, hasMore }`. The client
 * repeats batches until `hasMore` is false; bounded reads/writes keep the
 * document payload well under Convex's 16 MiB transaction byte limit even for
 * near-limit records. No user id argument — the client cannot target another
 * user's notifications.
 */
export const markAllReadBatch = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrThrow(ctx);

    const unread = await ctx.db
      .query('notifications')
      .withIndex('byUserIdAndReadAt', (q) => q.eq('userId', user._id).eq('readAt', undefined))
      .take(MARK_ALL_READ_SCAN_LIMIT);

    const plan = planMarkAllRead(unread.map((notification) => notification._id));
    const now = Date.now();

    for (const notificationId of plan.toUpdate) {
      await ctx.db.patch(notificationId, { readAt: now });
    }

    return { updatedCount: plan.updatedCount, hasMore: plan.hasMore };
  },
});
