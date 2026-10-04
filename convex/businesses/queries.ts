import { v } from 'convex/values';

import { query } from '../_generated/server';
import { requireSuperAdmin } from '../authz';
import { getCurrentUser } from '../users';
import { toPendingApprovalCard } from './moderationProjections';
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

/**
 * Pending approvals queue: every `pendingReview` business, oldest submission
 * first, projected to the card fields the `/admin/approvals` route renders.
 *
 * Ordering is the `byStatusSubmittedAt` composite index (`status`, then
 * `submittedAt`; Convex appends `_creationTime` as the final tiebreak), so the
 * oldest submission is always reviewed first. The queue is intentionally
 * unpaginated — B3c owns filters/bulk/pagination.
 *
 * Category and owner joins use `db.get`; a missing join yields `null` labels
 * rather than failing the whole queue (a dangling reference must not hide the
 * rest of the backlog). Both joins per card run in parallel.
 */
export const listPendingApprovals = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);

    const pending = await ctx.db
      .query('businesses')
      .withIndex('byStatusSubmittedAt', (q) => q.eq('status', 'pendingReview'))
      .collect();

    return await Promise.all(
      pending.map(async (business) => {
        const [category, owner] = await Promise.all([
          ctx.db.get('categories', business.categoryId),
          ctx.db.get('users', business.ownerId),
        ]);
        return toPendingApprovalCard({ business, category, owner });
      }),
    );
  },
});
