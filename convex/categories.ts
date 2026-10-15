import { v } from 'convex/values';

import { internalMutation, query } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { countApprovedByCategory } from './businesses/publicProjections';

// Category reads plus the idempotent SPEC §10 seed. Categories are the taxonomy
// every business references; admin CRUD lands in B6, so the client surface here
// is read-only.

const MAX_CATEGORIES = 100;

// SPEC §10 mockup taxonomy: slug, display name, lucide icon name, display order.
// `icon` stores a lucide-react icon name that the UI maps to a component (B4).
const CATEGORY_SEED = [
  { slug: 'restaurants', name: 'Restaurants', icon: 'utensils', ordering: 1 },
  { slug: 'automotive', name: 'Automotive', icon: 'car', ordering: 2 },
  { slug: 'healthcare', name: 'Healthcare', icon: 'heart-pulse', ordering: 3 },
  { slug: 'legal-services', name: 'Legal Services', icon: 'scale', ordering: 4 },
  { slug: 'beauty-wellness', name: 'Beauty & Wellness', icon: 'sparkles', ordering: 5 },
  { slug: 'food-drink', name: 'Food & Drink', icon: 'coffee', ordering: 6 },
  { slug: 'retail', name: 'Retail', icon: 'shopping-bag', ordering: 7 },
  { slug: 'professional-services', name: 'Professional Services', icon: 'briefcase', ordering: 8 },
] as const;

/** Public category index, ordered for the landing / category surfaces (SPEC §8). */
export const listOrdered = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('categories').withIndex('byOrdering').take(MAX_CATEGORIES);
  },
});

/** Resolves one category by its URL slug, or `null` when the slug is unknown. */
export const bySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query('categories')
      .withIndex('bySlug', (q) => q.eq('slug', slug))
      .unique();
  },
});

/**
 * Public category index for the B4 directory surfaces (SPEC §8): ordered
 * categories with their approved business counts, plus the total approved
 * count for the results sidebar's "All businesses" link.
 *
 * One approved scan (`byStatus`) feeds every count, so the read cost does not
 * scale with the category count. Both reads are bounded by Convex's
 * transaction limits and throw on breach — an inexact count is never returned
 * (B4: fail visibly, never a false total).
 */
export const listWithCounts = query({
  args: {},
  handler: async (ctx) => {
    const categories = await ctx.db
      .query('categories')
      .withIndex('byOrdering')
      .take(MAX_CATEGORIES);

    const approved = await ctx.db
      .query('businesses')
      .withIndex('byStatus', (q) => q.eq('status', 'approved'))
      .collect();

    const counts = countApprovedByCategory(approved);

    return {
      categories: categories.map((category) => ({
        _id: category._id,
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        approvedCount: counts.get(category._id) ?? 0,
      })),
      totalApproved: approved.length,
    };
  },
});

/**
 * Idempotent seed for the 8 SPEC §10 categories. Upserts by slug, so re-running
 * is safe and keeps name/icon/ordering aligned with the table above.
 *
 * `internalMutation` (not client-callable) because seeding is an operator action;
 * it remains runnable from the CLI: `npx convex run categories:seedCategories`.
 * Docs: https://docs.convex.dev/functions/internal-functions
 * Returns the seeded slugs + ids on stdout for the seed script (T7).
 */
export const seedCategories = internalMutation({
  args: {},
  handler: async (ctx) => {
    const seeded: { slug: string; categoryId: Id<'categories'> }[] = [];

    for (const category of CATEGORY_SEED) {
      const existing = await ctx.db
        .query('categories')
        .withIndex('bySlug', (q) => q.eq('slug', category.slug))
        .unique();

      if (existing === null) {
        const categoryId = await ctx.db.insert('categories', {
          name: category.name,
          slug: category.slug,
          icon: category.icon,
          ordering: category.ordering,
        });
        seeded.push({ slug: category.slug, categoryId });
      } else {
        await ctx.db.patch(existing._id, {
          name: category.name,
          icon: category.icon,
          ordering: category.ordering,
        });
        seeded.push({ slug: category.slug, categoryId: existing._id });
      }
    }

    return seeded;
  },
});
