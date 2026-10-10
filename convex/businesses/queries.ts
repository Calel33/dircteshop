import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { query } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { requireSuperAdmin } from '../authz';
import { getCurrentUser } from '../users';
import {
  isSubmittedAtRangeEmpty,
  resolveSubmittedAtRange,
  toPendingApprovalCard,
  toPendingApprovalDetails,
} from './moderationProjections';
import { toOwnerEditorDocument, toOwnerSummary } from './ownerProjections';

// Public discovery reads. Every public query in this module is client-callable,
// so public visibility — `status === 'approved'` only (SPEC §5) — is enforced
// here by construction, never by trusting a client-supplied status.
// Docs: https://docs.convex.dev/text-search · https://docs.convex.dev/database/reading-data

const SEARCH_RESULT_LIMIT = 20;

// TODO(#4): narrow the public read shape — getPublic/searchPublic currently return
// full business docs (ownerId, searchText, moderation fields). B4 defines the
// public projection via the shared BusinessCard/BusinessResults contract.
/**
 * Public profile read for `/business/[id]`: the business plus its category, or
 * `null` unless the listing is `approved`.
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
    // only `isVerified`.
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
      },
      category,
    };
  },
});

/**
 * Approved-only full-text search for `/search` and `/categories/[slug]`.
 *
 * The search filter chain is positional, so the optional category scope needs a
 * separate query branch — `.eq` cannot be conditionally skipped. Results are
 * post-filtered in JS as defense-in-depth: public visibility is a correctness
 * boundary, so it stays enforced in code even if the index filter regresses.
 * Docs: https://docs.convex.dev/text-search
 */
export const searchPublic = query({
  args: { q: v.string(), categoryId: v.optional(v.id('categories')) },
  handler: async (ctx, { q, categoryId }) => {
    const term = q.trim();
    if (term.length === 0) {
      return [];
    }

    const results =
      categoryId !== undefined
        ? await ctx.db
            .query('businesses')
            .withSearchIndex('searchText', (s) =>
              s.search('searchText', term).eq('status', 'approved').eq('categoryId', categoryId)
            )
            .take(SEARCH_RESULT_LIMIT)
        : await ctx.db
            .query('businesses')
            .withSearchIndex('searchText', (s) =>
              s.search('searchText', term).eq('status', 'approved')
            )
            .take(SEARCH_RESULT_LIMIT);

    return results.filter((business) => business.status === 'approved');
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

    return toOwnerEditorDocument(business);
  },
});

// ---------------------------------------------------------------------------
// Super Admin approval queue (B3b, issue #13 / todo #2).
//
// Super Admin only: identity comes from the Convex auth context via
// `requireSuperAdmin` (which also enforces the live env whitelist) — never a
// client-supplied actor or owner id. Returns a narrow card projection, not raw
// docs. Public visibility is unchanged: `getPublic`/`searchPublic` stay
// approved-only.
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
          if (range.lowerInclusive === undefined) {
            return range.upperInclusive === undefined
              ? scoped
              : scoped.lte('submittedAt', range.upperInclusive);
          }
          return range.upperInclusive === undefined
            ? scoped.gte('submittedAt', range.lowerInclusive)
            : scoped.gte('submittedAt', range.lowerInclusive).lte('submittedAt', range.upperInclusive);
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
