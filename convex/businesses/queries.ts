import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { requireSuperAdmin } from '../authz';
import { listingStatusValidator } from '../businessTypes';
import { getCurrentUser } from '../users';
import {
  assertAdminDirectoryPageSize,
  matchesAdminDirectoryFilters,
  resolveAdminDirectoryIndexPlan,
  toAdminDirectoryRow,
  type AdminDirectoryFilters,
  type AdminDirectoryIndexPlan,
} from './adminProjections';
import {
  directoryMode,
  directorySearchTerm,
  matchesDirectoryFilters,
  type DirectoryFilterState,
} from './directoryQuery';
import {
  isSubmittedAtRangeEmpty,
  resolveSubmittedAtRange,
  toPendingApprovalCard,
  toPendingApprovalDetails,
} from './moderationProjections';
import { toOwnerEditorDocument, toOwnerSummary } from './ownerProjections';
import { resolvePhotoUrls } from './photoStorage';
import { createOpenNowEvaluator, type OpenStatus } from './publicHours';
import { toPublicDirectoryCard, type PublicDirectoryResult } from './publicProjections';

// Public discovery reads. Every public query in this module is client-callable,
// so public visibility — `status === 'approved'` only (SPEC §5) — is enforced
// here by construction, never by trusting a client-supplied status.
// Docs: https://docs.convex.dev/text-search · https://docs.convex.dev/database/reading-data
/**
 * Public profile read for `/business/[id]`: the business, its category, and a
 * storageId -> URL map for its photos, or `null` unless the listing is
 * `approved`.
 *
 * `id` is `v.string()` on purpose. A malformed URL segment must yield `null`
 * (which the route renders as a 404), not an argument-validation error.
 * `ctx.db.normalizeId` returns `null` for ids of the wrong shape or table.
 * Docs: https://docs.convex.dev/database/reading-data
 */
export const getPublic = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const businessId = ctx.db.normalizeId('businesses', id);
    if (businessId === null) {
      return null;
    }

    const business = await ctx.db.get(businessId);
    if (business === null || business.status !== 'approved') {
      return null;
    }

    // categoryId is required by the schema; the guard keeps the public contract
    // non-null and fails closed on a dangling reference.
    const category = await ctx.db.get(business.categoryId);
    if (category === null) {
      return null;
    }

    // Project to a public shape: the raw doc carries `ownerId`, moderation
    // internals (`verification.verifiedBy`, `moderationReason`, `moderatedAt`)
    // and search-maintenance fields (`searchText`, `keywords`) that must not
    // reach a client. Public visibility is defined by `status` (SPEC §5), not by
    // exposing them. `verifiedBy`/`verifiedAt` are admin-only; the badge keeps
    // only `isVerified`. `photoUrls` sits beside `business` so the frozen
    // `PublicBusiness` shape stays unchanged.
    const photoUrls = await resolvePhotoUrls(ctx, business.photos);

    return {
      business: {
        _id: business._id,
        name: business.name,
        description: business.description,
        address: business.address,
        phone: business.phone,
        email: business.email,
        website: business.website,
        photos: business.photos,
        hours: business.hours,
        verification: { isVerified: business.verification.isVerified },
        rating: business.rating,
        ratingCount: business.ratingCount,
        services: business.services,
        credentials: business.credentials,
        lastUpdatedAt: business.lastUpdatedAt,
        // Ordering flag and pause state (§6.2.2). Missing/unknown is 'legacy'
        // by contract, so the page can switch the UI on this one value.
        orderProtocol: business.orderProtocol ?? 'legacy',
        acceptingOrders: business.acceptingOrders ?? true,
        acceptingOrdersUntil: business.acceptingOrdersUntil,
      },
      category,
      photoUrls,
    };
  },
});

/**
 * Directory page scan budget (B4), in `numItems`-sized chunks. Open Now and
 * Highly Rated are computed predicates (hours and ratings cannot be
 * search-index equality fields), so when either chip is active a single
 * paginated query scans one window of `numItems * MAX_DIRECTORY_PAGE_CHUNKS`
 * rows and the predicate filters in-function — a function execution may run at
 * most one paginated query, so the budget cannot be spent across several
 * `.paginate` calls (query_impl.ts). The cap bounds reads per request; the
 * backend's `isDone`/`continueCursor` always describe the scanned window, so no
 * record is ever skipped or duplicated. A chip-active page returns every match
 * from its window — 0 through `numItems * MAX_DIRECTORY_PAGE_CHUNKS` results —
 * so a batch can be shorter than `numItems`, longer than `numItems`, or an
 * empty-but-continuable page when the window holds no match.
 */
const MAX_DIRECTORY_PAGE_CHUNKS = 5;

type DirectoryQueryArgs = {
  q: string;
  categoryId?: Id<'categories'>;
  openNow: boolean;
  highlyRated: boolean;
  now: number;
};

/**
 * The shared branch behind both `listDirectory` and `countDirectory`, so the
 * page and its exact total always read the same rows:
 *
 * - nonempty trimmed term → the B2 text search index (status + optional
 *   category filter fields, Convex relevance order);
 * - empty term → the approved indexed browse path, newest `submittedAt` first
 *   (undated rows sort last under `.order('desc')`).
 *
 * The optional category scope is applied in the index/search filter chain,
 * which is positional, so each path needs its own branch (`.eq` cannot be
 * conditionally skipped). Docs: https://docs.convex.dev/text-search
 *
 * The returned query object is single-use: Convex consumes it on the first
 * `.paginate` / `.collect`, and any reuse throws "A query can only be chained
 * once and can't be chained after iteration begins." (query_impl.ts). Every
 * read calls this helper again for its own object; none is ever held across
 * reads.
 */
function directoryBaseQuery(ctx: QueryCtx, args: DirectoryQueryArgs, term: string) {
  const categoryId = args.categoryId;

  if (directoryMode(term) === 'search') {
    return categoryId === undefined
      ? ctx.db
          .query('businesses')
          .withSearchIndex('searchText', (s) =>
            s.search('searchText', term).eq('status', 'approved')
          )
      : ctx.db
          .query('businesses')
          .withSearchIndex('searchText', (s) =>
            s.search('searchText', term).eq('status', 'approved').eq('categoryId', categoryId)
          );
  }

  return categoryId === undefined
    ? ctx.db
        .query('businesses')
        .withIndex('byStatusSubmittedAt', (q) => q.eq('status', 'approved'))
        .order('desc')
    : ctx.db
        .query('businesses')
        .withIndex('byStatusCategorySubmittedAt', (q) =>
          q.eq('status', 'approved').eq('categoryId', categoryId)
        )
        .order('desc');
}

/** Projects one scanned row to the public card plus its stable-`now` open status. */
function toDirectoryResult(
  business: Doc<'businesses'>,
  openStatus: OpenStatus
): PublicDirectoryResult {
  return { ...toPublicDirectoryCard(business), openStatus };
}

/**
 * Approved-only directory results for `/search?q=`, `/categories`, and
 * `/categories/[slug]` (SPEC §8). Cursor-paginated via `usePaginatedQuery` on
 * the client; every filter dependency — trimmed `q`, `categoryId`, both chip
 * flags, and the stable `now` — is an explicit argument, so a long-lived
 * cursor is never invalidated by a moving clock or a reactive filter change
 * (convex-backend issue 505).
 *
 * With both chips off this is one `.paginate` of exactly `paginationOpts`.
 * With a chip active it is still one `.paginate`: the runtime serves a
 * paginated query with a single `1.0/queryPage` syscall and rejects a second
 * one in the same invocation ("This query or mutation function ran multiple
 * paginated queries", query_impl.ts), so the refill budget is one scan window
 * of `numItems * MAX_DIRECTORY_PAGE_CHUNKS` rows and the shared predicate
 * (`matchesDirectoryFilters`) filters the returned page in-function. That page
 * holds every match in the window — 0 through
 * `numItems * MAX_DIRECTORY_PAGE_CHUNKS` results — so `paginationOpts.numItems`
 * sets the scan budget, not a cap on the returned batch: the client's
 * `initialNumItems` / `loadMore` sizes work the same way. The backend's
 * `isDone`/`continueCursor` pass through unchanged, so a window with few or no
 * matches returns a shorter or empty-but-continuable page while the cursor
 * keeps advancing over the scanned window (page sizes may legitimately change —
 * PaginationOptions docs) and no record is ever skipped or duplicated. The
 * 1,024-document search scan limit is the hard bound for text searches.
 * Docs: https://docs.convex.dev/database/pagination
 */
export const listDirectory = query({
  args: {
    paginationOpts: paginationOptsValidator,
    q: v.string(),
    categoryId: v.optional(v.id('categories')),
    openNow: v.boolean(),
    highlyRated: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const term = directorySearchTerm(args.q);
    const evaluator = createOpenNowEvaluator(args.now);
    const filters: DirectoryFilterState = { openNow: args.openNow, highlyRated: args.highlyRated };

    if (!args.openNow && !args.highlyRated) {
      const page = await directoryBaseQuery(ctx, args, term).paginate(args.paginationOpts);
      return {
        page: page.page.map((business) =>
          toDirectoryResult(business, evaluator.status(business.hours, business.timezone))
        ),
        isDone: page.isDone,
        continueCursor: page.continueCursor,
      };
    }

    // One `.paginate` per invocation is the runtime's hard limit, so the whole
    // refill budget is one window of `numItems * MAX_DIRECTORY_PAGE_CHUNKS`
    // scanned rows; the chip predicate filters the returned page in-function,
    // so the batch is every window match — 0 through the full window size.
    const result = await directoryBaseQuery(ctx, args, term).paginate({
      ...args.paginationOpts,
      numItems: args.paginationOpts.numItems * MAX_DIRECTORY_PAGE_CHUNKS,
    });

    const matched: { business: Doc<'businesses'>; openStatus: OpenStatus }[] = [];
    for (const business of result.page) {
      const openStatus = evaluator.status(business.hours, business.timezone);
      if (matchesDirectoryFilters(business, filters, openStatus.isOpen)) {
        matched.push({ business, openStatus });
      }
    }

    return {
      page: matched.map(({ business, openStatus }) => toDirectoryResult(business, openStatus)),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * Exact "Showing X of Y" total for the same criteria as `listDirectory`: the
 * same branch (search index / approved browse), the same category scope, the
 * same chip predicate, and the same stable `now` — so the total can never
 * describe a different result set than the page.
 *
 * Convex has no public count API, so the total is a bounded `.collect().length`
 * over exactly those constraints. Beyond the documented limits (32,000
 * documents scanned / 16 MiB per transaction; a 1,024-document search result
 * set for text searches) the read throws and the client renders the error
 * state — the surface never falls back to a loaded count or a guessed number
 * (B4: fail visibly). Revisit with an aggregate component before the
 * directory approaches those limits.
 * Docs: https://docs.convex.dev/production/state/limits
 */
export const countDirectory = query({
  args: {
    q: v.string(),
    categoryId: v.optional(v.id('categories')),
    openNow: v.boolean(),
    highlyRated: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const term = directorySearchTerm(args.q);
    const rows = await directoryBaseQuery(ctx, args, term).collect();

    if (!args.openNow && !args.highlyRated) {
      return { total: rows.length };
    }

    const evaluator = createOpenNowEvaluator(args.now);
    const filters: DirectoryFilterState = { openNow: args.openNow, highlyRated: args.highlyRated };

    return {
      total: rows.filter((business) =>
        matchesDirectoryFilters(business, filters, evaluator.isOpen(business.hours, business.timezone))
      ).length,
    };
  },
});

// ---------------------------------------------------------------------------
// Landing feeds (B4 task 8, SPEC §8). Bounded approved-only arrays for
// `/`: Trending This Week (featured by `lastUpdatedAt`), New to LocalConnect
// (newest `submittedAt`), and Recently Verified (`verification.verifiedAt`).
// Each feed takes the same chip arguments as the directory flow, so the
// landing's in-place chips filter every section with the same predicate; a
// feed that resolves empty lets its section hide entirely.
// Docs: https://docs.convex.dev/database/reading-data/indexes
// ---------------------------------------------------------------------------

const LANDING_TRENDING_LIMIT = 6;
const LANDING_NEWEST_LIMIT = 4;
const LANDING_VERIFIED_LIMIT = 6;

/**
 * With a computed chip active the feed scans deeper than its slice, so the
 * bounded array still fills when leading rows are filtered out. The scan is a
 * single bounded `.take`; section hiding does not depend on it.
 */
const LANDING_FILTER_SCAN_LIMIT = 48;

type LandingFeedArgs = {
  openNow: boolean;
  highlyRated: boolean;
  now: number;
};

const landingFeedArgs = {
  openNow: v.boolean(),
  highlyRated: v.boolean(),
  now: v.number(),
};

function landingScanLimit(args: LandingFeedArgs, limit: number): number {
  return args.openNow || args.highlyRated ? LANDING_FILTER_SCAN_LIMIT : limit;
}

/** Applies the shared chip predicate and projects the first `limit` matches. */
function projectLandingFeed(
  rows: Doc<'businesses'>[],
  args: LandingFeedArgs,
  limit: number
): PublicDirectoryResult[] {
  const evaluator = createOpenNowEvaluator(args.now);
  const filters: DirectoryFilterState = { openNow: args.openNow, highlyRated: args.highlyRated };
  const projected: PublicDirectoryResult[] = [];

  for (const business of rows) {
    const openStatus = evaluator.status(business.hours, business.timezone);
    if (!matchesDirectoryFilters(business, filters, openStatus.isOpen)) {
      continue;
    }

    projected.push(toDirectoryResult(business, openStatus));
    if (projected.length >= limit) {
      break;
    }
  }

  return projected;
}

/** Trending This Week: approved featured listings, most recently updated first. */
export const featuredForLanding = query({
  args: landingFeedArgs,
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('businesses')
      .withIndex('byStatusFeaturedUpdatedAt', (q) =>
        q.eq('status', 'approved').eq('isFeatured', true)
      )
      .order('desc')
      .take(landingScanLimit(args, LANDING_TRENDING_LIMIT));

    return projectLandingFeed(rows, args, LANDING_TRENDING_LIMIT);
  },
});

/** New to LocalConnect: the newest approved submissions. */
export const newestForLanding = query({
  args: landingFeedArgs,
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('businesses')
      .withIndex('byStatusSubmittedAt', (q) => q.eq('status', 'approved'))
      .order('desc')
      .take(landingScanLimit(args, LANDING_NEWEST_LIMIT));

    return projectLandingFeed(rows, args, LANDING_NEWEST_LIMIT);
  },
});

/** Recently Verified: approved verified listings, latest verification first. */
export const verifiedForLanding = query({
  args: landingFeedArgs,
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('businesses')
      .withIndex('byStatusVerifiedVerifiedAt', (q) =>
        q.eq('status', 'approved').eq('verification.isVerified', true)
      )
      .order('desc')
      .take(landingScanLimit(args, LANDING_VERIFIED_LIMIT));

    return projectLandingFeed(rows, args, LANDING_VERIFIED_LIMIT);
  },
});

// ---------------------------------------------------------------------------
// Authenticated owner reads (B3a, issue #12 / todo #3).
//
// Separate from the public approved-only reads above: identity comes from the
// Convex auth context — never a client-supplied owner id — and each handler
// returns only the current user's own records. Both fail closed: anonymous
// callers receive no private data (`[]` / `null`).
// Contract: tasks/issue-12-contract.md §4.1.
// Docs: https://docs.convex.dev/auth/functions-auth
// ---------------------------------------------------------------------------

/**
 * Owner home list: the signed-in user's owned listings, summarized for the
 * owner cards. Anonymous (no identity, or no matching `users` row) → `[]`.
 * Never accepts an owner id, so a caller cannot request someone else's list.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) {
      return [];
    }

    const owned = await ctx.db
      .query('businesses')
      .withIndex('byOwnerId', (q) => q.eq('ownerId', user._id))
      .collect();

    return owned.map((business) => toOwnerSummary(business));
  },
});

/**
 * Owned editor detail: the editor projection of a business the signed-in user
 * owns, or `null` for anonymous, missing, or foreign-owned requests — one
 * not-found shape that leaks nothing about whether an id exists.
 *
 * Ownership is checked inline against the same `businesses.ownerId` relation as
 * `requireBusinessOwner`, rather than via that helper: the helper throws
 * `Forbidden`, while this read must return the uniform `null`.
 *
 * `businessId` is `v.id('businesses')` per contract §4.1, so a malformed id is
 * rejected by Convex argument validation before the handler runs. That is a
 * client programming error rather than a user-reachable path, and it fails
 * closed on the same no-data boundary.
 */
export const getMine = query({
  args: { businessId: v.id('businesses') },
  handler: async (ctx, { businessId }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) {
      return null;
    }

    const business = await ctx.db.get(businessId);
    if (business === null || business.ownerId !== user._id) {
      return null;
    }

    return {
      ...toOwnerEditorDocument(business),
      photoUrls: await resolvePhotoUrls(ctx, business.photos),
    };
  },
});

// ---------------------------------------------------------------------------
// Super Admin approval queue (B3b, issue #13 / todo #2).
//
// Super Admin only: identity comes from the Convex auth context via
// `requireSuperAdmin` (which also enforces the live env whitelist) — never a
// client-supplied actor or owner id. Returns a narrow card projection, not raw
// docs. Public visibility is unchanged: `getPublic`/`listDirectory`/
// `countDirectory` stay approved-only.
// Contract: tasks/issue-13-plan.md Task 2; SPEC §3/§5/§10.
// Docs: https://docs.convex.dev/auth/functions-auth · https://docs.convex.dev/database/reading-data/indexes
// ---------------------------------------------------------------------------

const queueTimeFilterValidator = v.union(
  v.literal('all'),
  v.literal('24h'),
  v.literal('7d'),
  v.literal('30d')
);
const queuePriorityFilterValidator = v.union(v.literal('all'), v.literal('high'), v.literal('normal'));

/**
 * Maps a raw page of `pendingReview` businesses to the narrow card projection.
 * Category and owner joins use `db.get`; a missing join yields `null` labels
 * rather than failing the whole queue (a dangling reference must not hide the
 * rest of the backlog). Both joins per card run in parallel.
 */
async function projectPendingCards(ctx: QueryCtx, page: Doc<'businesses'>[]) {
  return await Promise.all(
    page.map(async (business) => {
      const [category, owner] = await Promise.all([
        ctx.db.get('categories', business.categoryId),
        ctx.db.get('users', business.ownerId),
      ]);
      return toPendingApprovalCard({ business, category, owner });
    }),
  );
}

/**
 * Pending approvals queue (B3b + B3c): a bounded, cursor-paginated page of
 * `pendingReview` businesses, oldest submission first, projected to the card
 * fields the `/admin/approvals` route renders.
 *
 * Ordering uses the `byStatusSubmittedAt` index for the all-category path and
 * `byStatusCategorySubmittedAt` when a category is supplied — both step fields
 * in index order so a filtered page bounds its `submittedAt` range BEFORE
 * `.paginate` (never a post-pagination code filter that would undershoot the
 * page). Every filter dependency — category, priority, time, and the stable
 * `now` cutoff — is an explicit query argument, so a long-lived cursor is not
 * invalidated by a moving clock (convex-backend#505). `now` defaults to the
 * server clock only when the caller omits it.
 *
 * Categories/priority/time narrow the read; the 25-item page is bounded by
 * `paginationOpts`. Convex may pin page endpoints and vary the rendered page
 * length, so callers drive select-all and bulk counts off the returned page.
 * A listing with no `submittedAt` has an Undated badge and, because a single
 * index range cannot express the undated prefix plus the dated Normal suffix,
 * appears under "All priorities" only — the High and Normal bands exclude it.
 * Docs: https://docs.convex.dev/database/pagination
 */
export const listPendingApprovals = query({
  args: {
    paginationOpts: paginationOptsValidator,
    categoryId: v.optional(v.id('categories')),
    priority: v.optional(queuePriorityFilterValidator),
    time: v.optional(queueTimeFilterValidator),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    const range = resolveSubmittedAtRange({
      timeFilter: args.time ?? 'all',
      priority: args.priority ?? 'all',
      now: args.now ?? Date.now(),
    });

    if (isSubmittedAtRangeEmpty(range)) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const categoryId = args.categoryId;
    const page = await ctx.db
      .query('businesses')
      .withIndex(
        categoryId === undefined ? 'byStatusSubmittedAt' : 'byStatusCategorySubmittedAt',
        (q) => {
          const byStatus = q.eq('status', 'pendingReview');
          const scoped = categoryId === undefined ? byStatus : byStatus.eq('categoryId', categoryId);

          // Step `submittedAt` with at most one lower and one upper bound. A
          // numeric lower bound already excludes undated rows; otherwise the
          // High band's `requireDated` floor is the documented "has the field"
          // bound (https://docs.convex.dev/database/types#working-with-undefined)
          // so its lone upper bound cannot admit the undated prefix.
          const bounded =
            range.lowerInclusive !== undefined
              ? scoped.gte('submittedAt', range.lowerInclusive)
              : range.requireDated
                ? scoped.gt('submittedAt', undefined)
                : scoped;

          return range.upperInclusive === undefined
            ? bounded
            : bounded.lte('submittedAt', range.upperInclusive);
        }
      )
      .order('asc')
      .paginate(args.paginationOpts);

    return { ...page, page: await projectPendingCards(ctx, page.page) };
  },
});

/**
 * Full-details read for one still-pending submission ("View Full Details",
 * SPEC §10). Super Admin only; returns `null` unless the listing is still
 * `pendingReview`, so an already-decided row cannot be re-opened as pending.
 * Returns the confirmed owner-submitted profile projection only — no auth ids,
 * storage refs, or moderation internals (`toPendingApprovalDetails`).
 */
export const getPendingApprovalDetails = query({
  args: { businessId: v.id('businesses') },
  handler: async (ctx, { businessId }) => {
    await requireSuperAdmin(ctx);

    const business = await ctx.db.get(businessId);
    if (business === null || business.status !== 'pendingReview') {
      return null;
    }

    const [category, owner] = await Promise.all([
      ctx.db.get('categories', business.categoryId),
      ctx.db.get('users', business.ownerId),
    ]);

    return toPendingApprovalDetails({ business, category, owner });
  },
});

// ---------------------------------------------------------------------------
// Super Admin directory (B6a, issue #15 / todo task 1).
//
// Same admin boundary as the approval queue: `requireSuperAdmin` runs before
// any read, the page is bounded server-side (≤ 25), and the returned rows are
// the frozen admin projection (`./adminProjections.ts`) — never raw documents
// and never owner identity. Public directory queries above are unchanged.
// Contract: tasks/issue-15-contracts.md §B1/§B2.
// Docs: https://docs.convex.dev/database/pagination · https://docs.convex.dev/database/reading-data/indexes
// ---------------------------------------------------------------------------

/**
 * Builds the single-use index query the planner prescribes. The returned
 * query object is consumed by exactly one `.paginate` in the handler (the
 * runtime allows one paginated query per invocation) and is never reused —
 * chaining after iteration begins throws (query_impl.ts).
 */
function adminDirectoryBaseQuery(ctx: QueryCtx, plan: AdminDirectoryIndexPlan) {
  switch (plan.indexName) {
    case 'byStatusCategorySubmittedAt':
      return ctx.db
        .query('businesses')
        .withIndex('byStatusCategorySubmittedAt', (q) =>
          q.eq('status', plan.status).eq('categoryId', plan.categoryId)
        );
    case 'byStatusVerifiedVerifiedAt':
      return ctx.db
        .query('businesses')
        .withIndex('byStatusVerifiedVerifiedAt', (q) =>
          q.eq('status', plan.status).eq('verification.isVerified', plan.isVerified)
        );
    case 'byStatusFeaturedUpdatedAt':
      return ctx.db
        .query('businesses')
        .withIndex('byStatusFeaturedUpdatedAt', (q) =>
          q.eq('status', plan.status).eq('isFeatured', plan.isFeatured)
        );
    case 'byStatusSubmittedAt':
      return ctx.db
        .query('businesses')
        .withIndex('byStatusSubmittedAt', (q) => q.eq('status', plan.status));
    case 'byCategoryId':
      return ctx.db
        .query('businesses')
        .withIndex('byCategoryId', (q) => q.eq('categoryId', plan.categoryId));
    case null:
      return ctx.db.query('businesses');
  }
}

/**
 * Super Admin directory (B6a): a cursor-paginated page of at most 25
 * businesses across every status, with name / owner-name / location search and
 * exact category/status/verification/featured filters over the full dataset.
 *
 * The read is one `.paginate` on the index the planner prescribes for the
 * active filters — filters constrain the scan range BEFORE pagination, never a
 * post-pagination drop. The matcher then rechecks every scanned row (search
 * plus all filters); the returned page is every match from the scanned window,
 * so sparse matches shorten the page while `continueCursor` still advances
 * past the whole window — no record is ever skipped or silently dropped, and a
 * short-but-continued page is legitimate (the same explicit contract as the
 * chip-filtered `listDirectory`; plan §Data and API design). The page length
 * can never exceed `paginationOpts.numItems`, which is capped at 25 server
 * side. `splitCursor`/`pageStatus` pass through from the runtime so a split
 * stays explicit.
 */
export const listAdminDirectory = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    categoryId: v.optional(v.id('categories')),
    status: v.optional(listingStatusValidator),
    isVerified: v.optional(v.boolean()),
    isFeatured: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    assertAdminDirectoryPageSize(args.paginationOpts.numItems);

    const filters: AdminDirectoryFilters = {
      search: args.search,
      categoryId: args.categoryId,
      status: args.status,
      isVerified: args.isVerified,
      isFeatured: args.isFeatured,
    };

    const page = await adminDirectoryBaseQuery(ctx, resolveAdminDirectoryIndexPlan(filters))
      .order('desc')
      .paginate(args.paginationOpts);

    // Join each scanned row's category and owner once (they feed both the
    // owner-name search and the row projection); the joins run in parallel.
    const enriched = await Promise.all(
      page.page.map(async (business) => {
        const [category, owner] = await Promise.all([
          ctx.db.get('categories', business.categoryId),
          ctx.db.get('users', business.ownerId),
        ]);
        return { business, category, owner };
      })
    );

    const rows = enriched
      .filter(({ business, owner }) =>
        matchesAdminDirectoryFilters(
          {
            name: business.name,
            ownerName: owner?.name ?? null,
            addressLine1: business.address.addressLine1,
            city: business.address.city,
            state: business.address.state,
            status: business.status,
            categoryId: business.categoryId,
            isVerified: business.verification.isVerified,
            isFeatured: business.isFeatured,
          },
          filters
        )
      )
      .map(({ business, category, owner }) => toAdminDirectoryRow({ business, category, owner }));

    return { ...page, page: rows };
  },
});
