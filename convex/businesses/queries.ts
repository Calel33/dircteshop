import { v } from 'convex/values';

import { query } from '../_generated/server';

// Public discovery reads. Every query in this module is client-callable, so
// public visibility — `status === 'approved'` only (SPEC §5) — is enforced here
// by construction, never by trusting a client-supplied status.
// Docs: https://docs.convex.dev/text-search · https://docs.convex.dev/database/reading-data

const SEARCH_RESULT_LIMIT = 20;

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

    return { business, category };
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
