/**
 * Expiry of unaccepted orders (issue #79, D5/D6).
 *
 * The schedule is a separate `orderExpiry` row, so a legacy `new` order that
 * was never inserted there is structurally invisible to the sweep and can
 * never be converted by it. Only the system actor writes `expired`; the owner
 * and visitor handlers treat a due-but-unswept row as proof, not as a licence
 * to write (D8).
 *
 * Both functions are `internalMutation`: clients cannot call them.
 */
import { v } from 'convex/values';

import { internalMutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { EXPIRE_REASON } from './orderCommitPolicy';

/** Rows per sweep run. Bounded so one run cannot scan the whole table. */
const SWEEP_BATCH = 50;

type ExpiryOutcome = 'expired' | 'stale' | 'not_due' | 'no_schedule';

/**
 * Delete every expiry row for one order. Plain collect + loop, never
 * `.unique()`: a duplicate stale row is exactly what INV-15 must clean up.
 */
async function deleteExpiryRows(ctx: MutationCtx, orderId: Id<'orders'>) {
  const rows = await ctx.db
    .query('orderExpiry')
    .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}

/**
 * The single per-order rule, shared by `expireOrder` and the sweep.
 *
 * - no order: drop any orphan schedule, write nothing.
 * - not `new`: accepted orders never expire; drop the stale schedule only.
 * - `new` with no row: legacy backfill case, never converted.
 * - `new` with no due row: leave the schedule in place.
 * - `new` with any due row: patch, append the system event, drop the schedule.
 */
async function expireOrderAt(
  ctx: MutationCtx,
  orderId: Id<'orders'>,
  now: number
): Promise<ExpiryOutcome> {
  const order = await ctx.db.get(orderId);
  if (order === null) {
    await deleteExpiryRows(ctx, orderId);
    return 'stale';
  }
  if (order.status !== 'new') {
    await deleteExpiryRows(ctx, orderId);
    return 'stale';
  }

  const rows = await ctx.db
    .query('orderExpiry')
    .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
    .collect();
  if (rows.length === 0) {
    return 'no_schedule';
  }
  // Any due row wins: a duplicate future row must not hide a due one.
  if (!rows.some((row) => row.expiresAt <= now)) {
    return 'not_due';
  }

  await ctx.db.patch(orderId, {
    status: 'expired',
    statusReason: EXPIRE_REASON,
    statusUpdatedAt: now,
  });
  await ctx.db.insert('orderEvents', {
    orderId,
    businessId: order.businessId,
    actorType: 'system',
    action: 'expired',
    fromStatus: 'new',
    toStatus: 'expired',
    reason: EXPIRE_REASON,
    createdAt: now,
  });
  await deleteExpiryRows(ctx, orderId);
  return 'expired';
}

/** Expire one order on demand. Safe on a missing order or a non-`new` status. */
export const expireOrder = internalMutation({
  args: { orderId: v.id('orders') },
  handler: async (ctx, { orderId }) => {
    await expireOrderAt(ctx, orderId, Date.now());
  },
});

/** Expire the earliest-due batch. Bounded, ascending, no `.collect()`. */
export const sweepExpiredOrders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query('orderExpiry')
      .withIndex('byExpiresAt', (q) => q.lte('expiresAt', now))
      .order('asc')
      .take(SWEEP_BATCH);

    const summary = { examined: due.length, expired: 0, stale: 0 };
    for (const row of due) {
      const outcome = await expireOrderAt(ctx, row.orderId, now);
      if (outcome === 'expired') {
        summary.expired += 1;
      } else if (outcome === 'stale') {
        summary.stale += 1;
      }
    }
    return summary;
  },
});
