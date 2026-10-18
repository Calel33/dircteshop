import { ConvexError } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import { storedDisplayName } from './userName.ts';

// B6b `/admin` projections (issue #16, Tasks 1–2).
//
// Pure helpers behind `api.adminQueries`: the overview's LOCAL calendar month
// window and window assert, the owners table's page bounds and row shape, and
// the review-workload read bound and row shape. Deliberately distinct from
// `./businesses/adminProjections.ts` (the
// B6a directory projection) — this module owns the overview and owners
// surfaces only, imports nothing from the Convex server runtime, and stays
// `node --test`-able.
//
// Docs: https://docs.convex.dev/database/reading-data/indexes

/** The submissions window `overviewStats` counts between (epoch ms). */
export type OverviewWindow = {
  /** Local day 1 00:00:00.000 of the current month (inclusive). */
  monthStart: number;
  /** Local day 1 00:00:00.000 of the next month (exclusive). */
  monthEndExclusive: number;
};

/**
 * The admin's current LOCAL calendar month as an epoch-ms window:
 * start-inclusive (local day 1 00:00) and end-exclusive (next month local day
 * 1 00:00), so an instant exactly on a boundary belongs to the month it
 * starts. The client computes this from its own clock and timezone and passes
 * both bounds to `overviewStats` — Convex queries never read the wall clock.
 */
export function localMonthRange(nowMs: number): OverviewWindow {
  const now = new Date(nowMs);
  return {
    monthStart: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    // Month 12 rolls to January of the next year in the Date constructor.
    monthEndExclusive: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
  };
}

/**
 * The server-side window bound: a non-finite or empty (`end <= start`) window
 * is rejected with a `ConvexError` before any read, so an invalid client month
 * can never produce a silent wrong count. Mirrors `assertAuditPageSize`
 * (`./auditProjections.ts`).
 */
export function assertOverviewWindow(window: OverviewWindow): void {
  if (!Number.isFinite(window.monthStart) || !Number.isFinite(window.monthEndExclusive)) {
    throw new ConvexError('Overview month window bounds must be finite timestamps.');
  }

  if (window.monthEndExclusive <= window.monthStart) {
    throw new ConvexError('Overview month window must end after it starts.');
  }
}

// ---------------------------------------------------------------------------
// B6b `/admin/owners` projections (issue #16, Task 2): the read-only users
// table. Mirrors `./auditProjections.ts` (page cap + scan cap + frozen row).
// ---------------------------------------------------------------------------

/** The frozen owners page size (parity with the audit/directory page caps). */
export const OWNERS_PAGE_SIZE = 25;

/**
 * Server-owned cap on the users one owners page may scan: 4x the page size,
 * the same headroom rule as `AUDIT_MAXIMUM_ROWS_READ`, so a reactive page
 * split never forces the function past a bounded read while the page itself
 * still returns at most `OWNERS_PAGE_SIZE` rows.
 */
export const OWNERS_MAXIMUM_ROWS_READ = OWNERS_PAGE_SIZE * 4;

/**
 * The narrow owners row (issue #16, Task 2). `role` is the raw stamped
 * `users.role` — the UI relabels it, the row never does. `businessCount` is
 * the exact number of `businesses` rows whose `ownerId` is `_id`, including
 * zero for users who own none. The Clerk `externalId` is deliberately absent
 * and `users` rows carry no email, so neither can reach the UI.
 */
export type OwnerRow = {
  _id: Id<'users'>;
  name: string;
  role: Doc<'users'>['role'];
  businessCount: number;
};

/**
 * The server-side page bound: the client's `paginationOpts` is never trusted
 * to stay within the UI page size. Runs before any read. Mirrors
 * `assertAuditPageSize`.
 */
export function assertOwnersPageSize(numItems: number): void {
  if (numItems > OWNERS_PAGE_SIZE) {
    throw new ConvexError(
      `Owners pages are limited to ${OWNERS_PAGE_SIZE} rows; requested ${numItems}.`
    );
  }
}

/**
 * Projects one users doc plus its precomputed exact business count to the
 * frozen row. The count itself is measured by the handler through the
 * `businesses.byOwnerId` index range (see `listOwners` in
 * `./adminQueries.ts`) — this projection only enforces the boundary shape.
 * The name is normalized here so rows written by the old Clerk sync (for
 * example the literal `"null null"`) still render a readable label.
 */
export function toOwnerRow(user: Doc<'users'>, businessCount: number): OwnerRow {
  return {
    _id: user._id,
    name: storedDisplayName(user.name),
    role: user.role,
    businessCount,
  };
}

// ---------------------------------------------------------------------------
// B6b `/admin/analytics` projections (issue #16, Task 3): the v1 counts stub.
// SPEC §13 Open Items: "the stub shows counts from existing tables: views
// TBD, orders/bookings/quotes counts real".
// ---------------------------------------------------------------------------

/**
 * The `/admin/analytics` stub counts: exactly the three REAL table counts the
 * handler streams. `views` (or any other metric) is deliberately absent — v1
 * has no view tracking, so no field exists for the UI to render as if
 * measured; the UI shows `ANALYTICS_VIEWS_PLACEHOLDER` for views instead.
 */
export type AnalyticsCounts = {
  orders: number;
  bookings: number;
  quoteRequests: number;
};

/**
 * What the Views stat shows in v1. There is no view tracking (SPEC §13 Open
 * Items — "views TBD"), so no number can be read and none is fabricated.
 */
export const ANALYTICS_VIEWS_PLACEHOLDER = 'TBD';

/**
 * Projects the handler's three exact table counts to the frozen analytics
 * shape. Mirrors `toOwnerRow`: the handler measures, this projection only
 * enforces the boundary shape, so no estimate or invented metric can reach
 * the UI.
 */
export function toAnalyticsCounts(
  orders: number,
  bookings: number,
  quoteRequests: number
): AnalyticsCounts {
  return { orders, bookings, quoteRequests };
}

// ---------------------------------------------------------------------------
// Variant B `/admin` overview "Review workload" projection (issue #22): one
// exact `pendingReview` count per category, in `byOrdering` read order.
// ---------------------------------------------------------------------------

/**
 * The most categories the review-workload read considers: the same bound
 * every category read takes (`MAX_CATEGORIES` in `./categories.ts`), so the
 * workload never looks at more categories than the taxonomy surfaces expose.
 * The seeded taxonomy is the 8 SPEC §10 categories, well inside the cap.
 */
export const WORKLOAD_CATEGORY_LIMIT = 100;

/**
 * The narrow review-workload row (issue #22): category identity, display
 * name, and the exact `pendingReview` count for that category. `slug`,
 * `icon`, `ordering`, and `parentCategoryId` are deliberately absent — the
 * card needs none of them and this module is the only boundary shape. Zero
 * counts pass through unchanged: the handler measures every category and the
 * card filters for display, so the read never hides or estimates a count.
 */
export type ReviewWorkloadRow = {
  categoryId: Id<'categories'>;
  name: string;
  pendingCount: number;
};

/**
 * Projects one categories doc plus its precomputed exact pending count to the
 * frozen row. The count itself is measured by the handler through the
 * `businesses.byStatusCategorySubmittedAt` range (see `reviewWorkload` in
 * `./adminQueries.ts`) — this projection only enforces the boundary shape,
 * and it maps in place, so the `byOrdering` read order reaches the card
 * unsorted.
 */
export function toReviewWorkloadRow(
  category: Doc<'categories'>,
  pendingCount: number
): ReviewWorkloadRow {
  return {
    categoryId: category._id,
    name: category.name,
    pendingCount,
  };
}
