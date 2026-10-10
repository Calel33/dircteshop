import type { Doc } from '../_generated/dataModel';

type BusinessDoc = Doc<'businesses'>;
type CategoryDoc = Doc<'categories'>;
type UserDoc = Doc<'users'>;

/**
 * Super Admin approval-queue card projection (B3b / issue #13 todo #2).
 *
 * `listPendingApprovals` joins each `pendingReview` business with its category
 * and owner, then narrows the triple to exactly what the `/admin/approvals`
 * card renders: image source, identity, submission timestamp, address, contact.
 *
 * Deliberately withheld: `ownerId` (an auth identifier), `searchText`/`keywords`
 * (search maintenance), the moderation internals (`moderationReason`,
 * `moderatedAt`), `verification` provenance, and `categoryId` (the card shows
 * the joined category name, not the reference). Missing category/owner joins
 * fall back to `null` labels rather than leaking a dangling reference. Pure by
 * design — no Convex runtime imports — so it is unit-testable under `node --test`
 * (plan §Testing strategy; SPEC §3 "moderates but never directly edits listing
 * content").
 */
export function toPendingApprovalCard(input: {
  business: BusinessDoc;
  category: CategoryDoc | null;
  owner: UserDoc | null;
}) {
  const { business, category, owner } = input;
  return {
    _id: business._id,
    name: business.name,
    categoryName: category?.name ?? null,
    ownerLabel: owner?.name ?? null,
    submittedAt: business.submittedAt,
    imageStorageId: business.photos[0]?.storageId ?? null,
    address: business.address,
    phone: business.phone,
    email: business.email,
  };
}

// ---------------------------------------------------------------------------
// B3c / issue #14 queue filters (Task 1).
//
// Filtered cursor pagination is only stable when every filter dependency is
// passed as an explicit query argument. These pure helpers turn the confirmed
// category/priority/time filters into an inclusive `submittedAt` window that the
// queue query applies as an index range BEFORE `.paginate` — never as
// post-pagination code filtering (which would undershoot the 25-item page).
// The `now` cutoff is a caller-supplied stable value, not recomputed inside the
// query, so a stored cursor is never invalidated by a moving clock.
// Docs: https://docs.convex.dev/database/pagination · convex-backend#505
// ---------------------------------------------------------------------------

/** Confirmed time buckets (SPEC §10; requester clarification 2026-10-10). */
export const QUEUE_TIME_FILTERS = ['all', '24h', '7d', '30d'] as const;
export type QueueTimeFilter = (typeof QUEUE_TIME_FILTERS)[number];

/** Priority is presentation-only (B3b `deriveAgePriority`); `all` = no band. */
export const QUEUE_PRIORITY_FILTERS = ['all', 'high', 'normal'] as const;
export type QueuePriorityFilter = (typeof QUEUE_PRIORITY_FILTERS)[number];

/**
 * Mirrors `app/admin/approvals/approval-priority.ts` `PRIORITY_HIGH_AFTER_HOURS`.
 * Kept as a local constant so the server filter is self-contained and does not
 * import a client module; both must agree on the 48h band.
 */
export const PRIORITY_HIGH_AFTER_HOURS = 48;

/** The confirmed cursor page size. Select-all and bulk counts use the rendered page. */
export const QUEUE_PAGE_SIZE = 25;

const HOUR_MS = 3_600_000;

/** Hours in each time bucket, or `null` for the unbounded `all` filter. */
function timeFilterWindowHours(timeFilter: QueueTimeFilter): number | null {
  switch (timeFilter) {
    case 'all':
      return null;
    case '24h':
      return 24;
    case '7d':
      return 24 * 7;
    case '30d':
      return 24 * 30;
  }
}

/** An inclusive `submittedAt` window; an absent bound is unbounded on that side. */
export interface SubmittedAtRange {
  lowerInclusive?: number;
  upperInclusive?: number;
}

/**
 * Intersects the time and priority filters into one `submittedAt` window.
 *
 * - time: `submittedAt >= now - window` (a future timestamp counts as recent).
 * - priority `high`: `now - submittedAt >= 48h` → `submittedAt <= now - 48h`.
 * - priority `normal`: the complement → `submittedAt >= now - 48h + 1` (ms are
 *   integers, so `+1` expresses the strict lower bound the index needs).
 *
 * Mirrors `deriveAgePriority` so the filter band and the rendered badge agree.
 */
export function resolveSubmittedAtRange(input: {
  timeFilter: QueueTimeFilter;
  priority: QueuePriorityFilter;
  now: number;
}): SubmittedAtRange {
  const { timeFilter, priority, now } = input;
  const windowHours = timeFilterWindowHours(timeFilter);
  const timeLower = windowHours === null ? undefined : now - windowHours * HOUR_MS;
  const cutoff = PRIORITY_HIGH_AFTER_HOURS * HOUR_MS;
  const priorityLower = priority === 'normal' ? now - cutoff + 1 : undefined;
  const priorityUpper = priority === 'high' ? now - cutoff : undefined;

  const lowers = [timeLower, priorityLower].filter((value): value is number => value !== undefined);
  const range: SubmittedAtRange = {};
  if (lowers.length > 0) {
    range.lowerInclusive = Math.max(...lowers);
  }
  if (priorityUpper !== undefined) {
    range.upperInclusive = priorityUpper;
  }
  return range;
}

/** True when the intersected window can contain no rows (e.g. 24h + high). */
export function isSubmittedAtRangeEmpty(range: SubmittedAtRange): boolean {
  return (
    range.lowerInclusive !== undefined &&
    range.upperInclusive !== undefined &&
    range.lowerInclusive > range.upperInclusive
  );
}

/**
 * Super Admin full-details projection for one still-pending submission
 * (SPEC §10 "View Full Details"). Carries the owner-submitted profile, the
 * owner display label and the submission summary, and deliberately withholds
 * auth identifiers (`ownerId`), search maintenance (`searchText`, `keywords`
 * are shown as content but the search column is derivable and omitted), the
 * moderation internals (`verification`, `moderationReason`, `moderatedAt`),
 * and admin-only `isFeatured`. Photos expose alt text/ordering only (no storage
 * ref and no upload behavior — photos are B7). Pure so it is `node --test`-able.
 */
export function toPendingApprovalDetails(input: {
  business: BusinessDoc;
  category: CategoryDoc | null;
  owner: UserDoc | null;
}) {
  const { business, category, owner } = input;
  return {
    _id: business._id,
    status: business.status,
    name: business.name,
    categoryName: category?.name ?? null,
    description: business.description,
    address: business.address,
    phone: business.phone,
    email: business.email,
    website: business.website,
    hours: business.hours,
    tags: business.tags ?? [],
    amenities: business.amenities ?? [],
    services: business.services,
    credentials: business.credentials,
    keywords: business.keywords,
    photos: business.photos.map((photo) => ({
      altText: photo.altText,
      ordering: photo.ordering,
    })),
    photoCount: business.photos.length,
    ownerLabel: owner?.name ?? null,
    submittedAt: business.submittedAt,
    lastSavedAt: business.lastSavedAt,
    lastUpdatedAt: business.lastUpdatedAt,
  };
}
