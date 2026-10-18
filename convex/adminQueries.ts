import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { query } from './_generated/server';
import { requireSuperAdmin } from './authz';
import {
  assertOverviewWindow,
  assertOwnersPageSize,
  OWNERS_MAXIMUM_ROWS_READ,
  toAnalyticsCounts,
  toOwnerRow,
} from './adminProjections';

// B6b `/admin` reads (issue #16, Tasks 1–3): the overview counters, the
// read-only owners table, and the analytics v1 stub counts.
//
// Every count is exact: each one streams one index range through the query's
// async iterator (no page of results is materialized) and the platform's
// per-function read limits still apply, so a breach throws instead of
// returning an estimate — the B4/B6 "fail visibly, never a false total" rule.
// Deliberately distinct from `./businesses/adminProjections.ts`; this module
// owns the admin count and owners reads only, and every handler guards itself
// (`requireSuperAdmin` runs before any read; the layout check is cosmetic).
//
// Docs: https://docs.convex.dev/database/reading-data/indexes

/**
 * Counts every row an index range yields. The range's own bounds decide what
 * is counted, and the query's async iterator streams it, so the count never
 * holds the rows (the `AsyncIterable` form required over `.collect()`).
 */
async function countRows<T>(rows: AsyncIterable<T>): Promise<number> {
  const iterator = rows[Symbol.asyncIterator]();
  let count = 0;
  while (!(await iterator.next()).done) {
    count += 1;
  }
  return count;
}

/**
 * The `/admin` overview counters (issue #16, Task 1). Super Admin only.
 * `monthStart`/`monthEndExclusive` are the admin's LOCAL month bounds
 * (`localMonthRange`) and are asserted before any read.
 *
 * - `totalBusinesses`: exact count of every business row (a full scan — the
 *   documented v1 tradeoff; an Aggregate component is the scale answer).
 * - `pendingApprovals`: exact `pendingReview` count from `byStatus`.
 * - `verifiedActive`: exact approved + verified count from
 *   `byStatusVerifiedVerifiedAt`, bounded by the status and verification
 *   equalities (the index itself still includes all business rows).
 * - `submissionsThisMonth`: exact `submittedAt` count inside the local month
 *   from `bySubmittedAt`; missing values are indexed as `undefined` and fall
 *   below the month-start bound.
 */
export const overviewStats = query({
  args: {
    monthStart: v.number(),
    monthEndExclusive: v.number(),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    assertOverviewWindow(args);

    const totalBusinesses = await countRows(ctx.db.query('businesses'));

    const pendingApprovals = await countRows(
      ctx.db.query('businesses').withIndex('byStatus', (q) => q.eq('status', 'pendingReview'))
    );

    const verifiedActive = await countRows(
      ctx.db
        .query('businesses')
        .withIndex('byStatusVerifiedVerifiedAt', (q) =>
          q.eq('status', 'approved').eq('verification.isVerified', true)
        )
    );

    const submissionsThisMonth = await countRows(
      ctx.db
        .query('businesses')
        .withIndex('bySubmittedAt', (q) =>
          q.gte('submittedAt', args.monthStart).lt('submittedAt', args.monthEndExclusive)
        )
    );

    return { totalBusinesses, pendingApprovals, verifiedActive, submissionsThisMonth };
  },
});

/**
 * The read-only `/admin/owners` users table (issue #16, Task 2). Super Admin
 * only, cursor-paginated 25 rows per page in creation order.
 *
 * The page reads `users`, so users with ZERO businesses are included by
 * construction. Each row's `businessCount` is the exact number of `businesses`
 * rows owned by that user, streamed through the `byOwnerId` index range — one
 * bounded range per page user (≤25 calls), never a `.collect()`, never an
 * estimate: if a per-function read limit were ever breached the call throws
 * and the admin sees an error instead of a wrong number. Only `toOwnerRow`'s
 * shape crosses the boundary; the Clerk `externalId` never does (users rows
 * carry no email).
 */
export const listOwners = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    assertOwnersPageSize(args.paginationOpts.numItems);

    const page = await ctx.db
      .query('users')
      // Spread first so the client's cursor/endCursor (and split fields)
      // survive; the server-owned read cap always wins over a client value.
      .paginate({ ...args.paginationOpts, maximumRowsRead: OWNERS_MAXIMUM_ROWS_READ });

    const rows = await Promise.all(
      page.page.map(async (user) => {
        const businessCount = await countRows(
          ctx.db.query('businesses').withIndex('byOwnerId', (q) => q.eq('ownerId', user._id))
        );
        return toOwnerRow(user, businessCount);
      })
    );

    return { ...page, page: rows };
  },
});

/**
 * The `/admin/analytics` v1 stub counts (issue #16, Task 3). Super Admin
 * only, zero args. SPEC §13 Open Items: the stub shows counts from existing
 * tables — views TBD, orders/bookings/quotes counts real.
 *
 * Three exact counts, each streamed through its table's async iterator.
 * `orders`, `bookings`, and `quoteRequests` each carry only `byBusinessId`
 * (their per-business index) and nothing that could enumerate the table, so
 * every count is one full-table scan: 3 index ranges, no equality or bounds,
 * and the platform's per-function read limits still apply — a breach throws
 * instead of returning an estimate (the same documented v1 tradeoff as
 * `overviewStats.totalBusinesses`; an Aggregate component is the scale
 * answer).
 *
 * There is no views count: v1 has no view tracking, so none is read and none
 * is approximated — the UI renders `ANALYTICS_VIEWS_PLACEHOLDER` (TBD) where
 * a views metric would appear.
 */
export const analyticsCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);

    const orders = await countRows(ctx.db.query('orders'));
    const bookings = await countRows(ctx.db.query('bookings'));
    const quoteRequests = await countRows(ctx.db.query('quoteRequests'));

    return toAnalyticsCounts(orders, bookings, quoteRequests);
  },
});
