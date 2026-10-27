/**
 * Order retention (issue #84, T10 / plan D5; protocol E74 :282, INV-30 :326,
 * §7.2 S5 :1647).
 *
 * Deletes order data once it has outlived its retention window. This is a
 * product retention policy, not repository cleanup: an order in a terminal
 * state is removed together with every row that exists only to serve that
 * order, in the same transaction (§6.1 INV-30 requires the order and its
 * dependent rows to live and die together).
 *
 * Windows (decided values, `orderCommitPolicy.ts`):
 * - `declined` / `cancelled` / `expired` / `no_show` — 90 days;
 * - `completed` — 365 days;
 * - every other status (`new`, `accepted`, `ready`) — never deleted, at any age.
 *
 * Age is measured from `statusUpdatedAt`, falling back to `createdAt` on legacy
 * rows that predate the stamp. `Date.now() - age >= window` is in scope.
 *
 * Companions deleted with the order: `orderEvents`, `orderFlags`, `orderAccess`,
 * `orderIdempotency`, `orderExpiry`. Deliberately NOT companions:
 * - `notifications` — research OQ-7: the table has no `orderId` field. Notices
 *   are business/user-keyed history, retained independently; adding them here
 *   would delete unrelated notices (actively wrong).
 * - `orderThrottle` / `orderBlocks` — throttle counters and owner-managed block
 *   state have their own lifecycle, not the order's.
 * - `orderMetricCounters` — per-business aggregate counters, not per-order rows.
 * - `auditLogs` — immutable admin/business audit trail, keyed by actor/target.
 * - `businesses` / `menuItems` — catalog data the order referenced, not owned.
 *
 * The scan mirrors `orderThrottleCleanup.ts:26-47`: a bounded `.take()` over the
 * implicit `by_creation_time` order (oldest first) and no new index. `.collect()`
 * is never used on `orders`; a backlog larger than the batch drains across daily
 * runs. Companion reads are per-order index reads, the same shape as
 * `orderExpiry.deleteExpiryRows`.
 *
 * `dryRun` defaults to `true` so a manual `npx convex run` inspects first; the
 * daily cron passes `{ dryRun: false }` explicitly.
 */
import { v } from 'convex/values';

import { internalMutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import {
  RETENTION_BATCH,
  RETENTION_COMPLETED_DAYS_MS,
  RETENTION_TERMINAL_DAYS_MS,
} from './orderCommitPolicy';
import type { OrderDbStatus } from './orderCommitPolicy';

/**
 * Retention window per stored status, in milliseconds. `null` means "never in
 * scope". The record is exhaustive over `ORDER_DB_STATUSES`, so adding a status
 * to the protocol fails type-checking here until its retention is decided.
 */
const RETENTION_WINDOW_MS: Record<OrderDbStatus, number | null> = {
  new: null,
  accepted: null,
  ready: null,
  completed: RETENTION_COMPLETED_DAYS_MS,
  declined: RETENTION_TERMINAL_DAYS_MS,
  cancelled: RETENTION_TERMINAL_DAYS_MS,
  expired: RETENTION_TERMINAL_DAYS_MS,
  no_show: RETENTION_TERMINAL_DAYS_MS,
};

interface CompanionCounts {
  orderEvents: number;
  orderFlags: number;
  orderAccess: number;
  orderIdempotency: number;
  orderExpiry: number;
}

/** Deletes every event of one order and returns the count. */
async function deleteEventRows(ctx: MutationCtx, orderId: Id<'orders'>): Promise<number> {
  const rows = await ctx.db
    .query('orderEvents')
    .withIndex('byOrderIdCreatedAt', (q) => q.eq('orderId', orderId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return rows.length;
}

/** Deletes every flag of one order and returns the count. */
async function deleteFlagRows(ctx: MutationCtx, orderId: Id<'orders'>): Promise<number> {
  const rows = await ctx.db
    .query('orderFlags')
    .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return rows.length;
}

/** Deletes every access row of one order and returns the count. */
async function deleteAccessRows(ctx: MutationCtx, orderId: Id<'orders'>): Promise<number> {
  const rows = await ctx.db
    .query('orderAccess')
    .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return rows.length;
}

/** Deletes every expiry schedule of one order and returns the count. */
async function deleteExpiryRows(ctx: MutationCtx, orderId: Id<'orders'>): Promise<number> {
  const rows = await ctx.db
    .query('orderExpiry')
    .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return rows.length;
}

/**
 * `orderIdempotency` has no `byOrderId` index (schema.ts:272-280): rows are keyed
 * by `(businessId, key)` and merely carry `orderId` as a field. A schema index
 * is out of scope for this task, so the read is business-scoped through the
 * existing index and filtered by order — the same shape as
 * `devProof.cleanupProbe` (convex/devProof.ts:566-573). It never scans another
 * business's keys.
 */
async function deleteIdempotencyRows(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  orderId: Id<'orders'>
): Promise<number> {
  const rows = await ctx.db
    .query('orderIdempotency')
    .withIndex('byBusinessIdKey', (q) => q.eq('businessId', businessId))
    .collect();
  let deleted = 0;
  for (const row of rows) {
    if (row.orderId !== orderId) {
      continue;
    }
    await ctx.db.delete(row._id);
    deleted += 1;
  }
  return deleted;
}

/**
 * Bounded retention pass over the oldest `RETENTION_BATCH` orders.
 *
 * Returns `{ dryRun, scanned, eligible, deleted, companions }`:
 * - `scanned` — rows examined (at most `RETENTION_BATCH`);
 * - `eligible` — examined rows whose status and age put them in scope;
 * - `deleted` — orders actually deleted (always `0` on a dry run);
 * - `companions` — rows deleted per companion table, so a table with no rows for
 *   the order is visibly reported as `0` rather than silently skipped. A dry run
 *   reads no companion table, so every count is `0`.
 */
export const purgeRetainedOrders = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const now = Date.now();
    const orders = await ctx.db.query('orders').take(RETENTION_BATCH);

    const companions: CompanionCounts = {
      orderEvents: 0,
      orderFlags: 0,
      orderAccess: 0,
      orderIdempotency: 0,
      orderExpiry: 0,
    };
    let eligible = 0;
    let deleted = 0;

    for (const order of orders) {
      const windowMs = RETENTION_WINDOW_MS[order.status];
      if (windowMs === null) {
        continue;
      }
      // Legacy rows predate `statusUpdatedAt`; `createdAt` is the documented
      // fall-back (schema.ts:235).
      const ageFrom = order.statusUpdatedAt ?? order.createdAt;
      if (now - ageFrom < windowMs) {
        continue;
      }

      eligible += 1;
      if (dryRun) {
        continue;
      }

      companions.orderEvents += await deleteEventRows(ctx, order._id);
      companions.orderFlags += await deleteFlagRows(ctx, order._id);
      companions.orderAccess += await deleteAccessRows(ctx, order._id);
      companions.orderIdempotency += await deleteIdempotencyRows(ctx, order.businessId, order._id);
      companions.orderExpiry += await deleteExpiryRows(ctx, order._id);
      await ctx.db.delete(order._id);
      deleted += 1;
    }

    return { dryRun, scanned: orders.length, eligible, deleted, companions };
  },
});
