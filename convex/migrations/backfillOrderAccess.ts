import { paginationOptsValidator, type PaginationOptions } from 'convex/server';
import { v } from 'convex/values';

import { internalMutation, internalQuery } from '../_generated/server';
import { hasOrderAccess, insertOrderAccess } from '../orderAccess';

// Issue #76, T2 — protocol §6.2.9 step 2 (expand/backfill, never contract).
// Legacy orders get one `orderAccess` row (token + per-business reference) and,
// only when they have no `items[]` yet, a one-line snapshot derived from the
// legacy fields. Prices are NEVER fabricated: `unitPrice`, `lineTotal`, and
// `subtotal` are omitted (absent keys, not `undefined`/`null`), and
// `pricingSource` is `'legacyUnknown'`. `status`, `expiresAt`, and
// `orderExpiry` are never touched — retroactively expiring legacy `new` orders
// would change behaviour, and a legacy `completed` order stays terminal.
//
// Both entry points are internal: not client-callable, runnable from the CLI:
//
//   npx convex run migrations/backfillOrderAccess:backfillStatus '{"table":"orders","paginationOpts":{"numItems":500,"cursor":null}}'
//   npx convex run migrations/backfillOrderAccess:backfillBatch '{"paginationOpts":{"numItems":50,"cursor":null},"dryRun":true}'
//
// Convex allows exactly ONE `.paginate()` per function execution (queries and
// mutations alike), and `.collect().length` is forbidden, so the count gate is
// per-table/per-page: the operator loops `backfillStatus` and sums. The batch
// is repeated until `isDone`; there is deliberately no fabricated `remaining`.

const MAX_STATUS_PAGE = 500;
const MAX_BATCH_SIZE = 50;

/**
 * Count gate: ONE page of one table per call. Returns the page size, whether the
 * table is exhausted, and the cursor for the next page. The caller loops each
 * table and sums `count`; `isDone: true` means that page was the last one.
 */
export const backfillStatus = internalQuery({
  args: {
    table: v.union(v.literal('orders'), v.literal('orderAccess')),
    paginationOpts: paginationOptsValidator,
    // Optional convenience clamp (the old CLI ergonomics); never reconstructed
    // into a second options object.
    maxNumItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Guard the convenience clamp only: the validated options object itself is
    // passed through unchanged (`paginationOptsValidator` keeps optional native
    // fields like `maximumRowsRead` intact — do not reconstruct it).
    const clampedNumItems = Math.max(1, Math.min(Math.floor(args.maxNumItems ?? MAX_STATUS_PAGE), MAX_STATUS_PAGE));
    const paginationOpts: PaginationOptions =
      clampedNumItems < args.paginationOpts.numItems
        ? { ...args.paginationOpts, numItems: clampedNumItems }
        : args.paginationOpts;

    // The branch still executes a single `.paginate()`: Convex supports one per
    // invocation, and only one arm runs.
    const result =
      args.table === 'orders'
        ? await ctx.db.query('orders').order('asc').paginate(paginationOpts)
        : await ctx.db.query('orderAccess').order('asc').paginate(paginationOpts);

    return {
      table: args.table,
      count: result.page.length,
      isDone: result.isDone,
      nextCursor: result.continueCursor,
    };
  },
});

/**
 * Backfills one page of `orders` (ascending `_creationTime`). Idempotent: an
 * order that already has an `orderAccess` row is skipped without any write.
 * `dryRun` reports the same would-do counts and writes nothing; the cursor still
 * advances so a dry run can walk the whole table. Repeat with `nextCursor`
 * until `isDone`. `paginationOpts` is validated and passed through unchanged so
 * the native read-budget options (`maximumRowsRead` / `maximumBytesRead`) stay
 * available.
 */
export const backfillBatch = internalMutation({
  args: {
    paginationOpts: paginationOptsValidator,
    dryRun: v.optional(v.boolean()),
    maxBatchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Same pattern as `backfillStatus`: validated options passed through, with
    // an optional upper clamp so a runaway `numItems` cannot bypass the 50-row
    // transaction budget.
    const clampedNumItems = Math.max(1, Math.min(Math.floor(args.maxBatchSize ?? MAX_BATCH_SIZE), MAX_BATCH_SIZE));
    const paginationOpts: PaginationOptions =
      clampedNumItems < args.paginationOpts.numItems
        ? { ...args.paginationOpts, numItems: clampedNumItems }
        : args.paginationOpts;
    const dryRun = args.dryRun ?? false;

    const { page, isDone, continueCursor } = await ctx.db
      .query('orders')
      .order('asc')
      .paginate(paginationOpts);

    let inserted = 0;
    let skipped = 0;
    let patched = 0;
    let unpatchable = 0;

    for (const order of page) {
      if (await hasOrderAccess(ctx, order._id)) {
        skipped += 1;
        continue;
      }

      // A line requires `menuItemId` (it is non-optional inside `items[]`). An
      // order with neither legacy id nor snapshot cannot form one; it still gets
      // access (so its receipt works) and is counted separately — never invent
      // an id. Rows that already carry `items[]` need no patch.
      const needsLine = order.items === undefined;
      const line =
        needsLine && order.menuItemId !== undefined
          ? {
              menuItemId: order.menuItemId,
              // Name only — never the current menu price (R11). A removed item
              // degrades to the protocol placeholder.
              name: (await ctx.db.get('menuItems', order.menuItemId))?.name ?? '(item removed)',
              quantity: 1,
              // `unitPrice` / `lineTotal` are omitted on purpose: absent = unpriced.
              selections: (order.selections ?? []).map((selection) => ({
                optionName: selection.optionName,
                choiceName: selection.choiceName,
              })),
            }
          : null;

      // In `dryRun` these counters are the would-do counts; no write follows.
      inserted += 1;
      if (line !== null) {
        patched += 1;
      } else if (needsLine) {
        unpatchable += 1;
      }

      if (dryRun) {
        continue;
      }

      await insertOrderAccess(ctx, { orderId: order._id, businessId: order.businessId });
      if (line !== null) {
        // Omit `subtotal` entirely; never write a price or touch `status`.
        await ctx.db.patch('orders', order._id, {
          items: [line],
          pricingSource: 'legacyUnknown',
        });
      }
    }

    const result = {
      processed: page.length,
      inserted,
      skipped,
      patched,
      unpatchable,
      dryRun,
      isDone,
      nextCursor: continueCursor,
    };

    // Counts only — never customer data.
    console.log(`[backfillOrderAccess] ${JSON.stringify(result)}`);
    return result;
  },
});
