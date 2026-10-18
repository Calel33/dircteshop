import { ConvexError, v } from 'convex/values';

import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireSuperAdmin } from './authz';
import { countApprovedByCategory } from './businesses/publicProjections';
import {
  buildCategoryAuditLog,
  buildCategorySlug,
  CATEGORY_REFERENCE_LIMIT,
  describeCategoryUpdate,
  formatBusinessCount,
  normalizeCategoryIcon,
  normalizeCategoryName,
  planCategoryReorder,
} from './categoryAdminPolicy';

// Category reads, the idempotent SPEC §10 seed, and the B6b (issue #16, Task
// 5) Super Admin CRUD: create / name+icon update / reorder / guarded delete.
// Public reads stay read-only; every admin write authorizes with
// `requireSuperAdmin` before any read, audits in the same transaction (B6a
// convention), and keeps the taxonomy flat — `parentCategoryId` is neither
// set nor cleared here, and reassigning businesses stays in the owner editor.

const MAX_CATEGORIES = 100;

// The reference read takes one extra row so "exactly at the cap" and "over
// the cap" stay distinguishable; see `countCategoryReferences`.
const REFERENCE_PROBE_COUNT = CATEGORY_REFERENCE_LIMIT + 1;

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

// ---------------------------------------------------------------------------
// B6b Super Admin category management (issue #16, Task 5). Every function
// authorizes with `requireSuperAdmin` before any read or write, throws
// `ConvexError` with a client-safe message (B6a client unwraps it via
// `messageFromError`), and audits successful writes in the same transaction.
// Docs: https://docs.convex.dev/database/writing-data
// ---------------------------------------------------------------------------

/**
 * Referencing-business count for one category, read on the existing
 * `byCategoryId` index and bounded by `CATEGORY_REFERENCE_LIMIT` (+1 probe so
 * "at the cap" and "over the cap" stay distinguishable). The delete guard and
 * the admin list share this exact read, so the count the UI shows and the
 * count the guard enforces can never disagree. Bounded read, never a table
 * scan; Convex throws on a transaction-limit breach instead of returning a
 * wrong number (B4: fail visibly, never a false total).
 */
async function countCategoryReferences(
  ctx: QueryCtx | MutationCtx,
  categoryId: Id<'categories'>
): Promise<{ count: number; isCapped: boolean }> {
  const referencing = await ctx.db
    .query('businesses')
    .withIndex('byCategoryId', (q) => q.eq('categoryId', categoryId))
    .take(REFERENCE_PROBE_COUNT);

  return {
    count: Math.min(referencing.length, CATEGORY_REFERENCE_LIMIT),
    isCapped: referencing.length > CATEGORY_REFERENCE_LIMIT,
  };
}

/**
 * Super Admin category manager read: every category in display order plus its
 * live referencing-business count, so the blocked-delete state is visible
 * before any click. The count is exact up to `CATEGORY_REFERENCE_LIMIT`;
 * beyond it the UI shows "100+" (never a false total).
 */
export const listAdminCategories = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);

    const categories = await ctx.db
      .query('categories')
      .withIndex('byOrdering')
      .take(MAX_CATEGORIES);

    const rows: {
      _id: Id<'categories'>;
      name: string;
      icon: string | null;
      ordering: number;
      referenceCount: number;
      referenceCountCapped: boolean;
    }[] = [];

    for (const category of categories) {
      const references = await countCategoryReferences(ctx, category._id);
      rows.push({
        _id: category._id,
        name: category.name,
        icon: category.icon ?? null,
        ordering: category.ordering,
        referenceCount: references.count,
        referenceCountCapped: references.isCapped,
      });
    }

    return rows;
  },
});

/**
 * Super Admin category create (issue #16, Task 5). The slug is generated from
 * the name (or normalized from an explicit one) and is UNIQUE — `bySlug` has
 * no unique constraint (Convex indexes cannot declare one), so the check runs
 * in this transaction before the insert — and it never changes afterwards,
 * keeping published category URLs stable. The new category lands at the end
 * of the ordering and the flat taxonomy is preserved (`parentCategoryId` is
 * never set). Writes the `createCategory` audit row in the same transaction.
 */
export const createCategory = mutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, { name, slug, icon }) => {
    const admin = await requireSuperAdmin(ctx);

    const normalizedName = normalizeCategoryName(name);
    if (normalizedName === '') {
      throw new ConvexError('Category name is required');
    }

    const normalizedSlug = buildCategorySlug(slug ?? normalizedName);
    if (normalizedSlug === '') {
      throw new ConvexError('Could not derive a slug for this category name');
    }

    const existingBySlug = await ctx.db
      .query('categories')
      .withIndex('bySlug', (q) => q.eq('slug', normalizedSlug))
      .unique();
    if (existingBySlug !== null) {
      throw new ConvexError('A category with this slug already exists');
    }

    const ordered = await ctx.db
      .query('categories')
      .withIndex('byOrdering')
      .take(MAX_CATEGORIES);
    if (ordered.length >= MAX_CATEGORIES) {
      throw new ConvexError(`Category limit reached (${MAX_CATEGORIES})`);
    }

    const ordering = (ordered[ordered.length - 1]?.ordering ?? 0) + 1;

    const categoryId = await ctx.db.insert('categories', {
      name: normalizedName,
      slug: normalizedSlug,
      icon: icon === undefined ? undefined : normalizeCategoryIcon(icon),
      ordering,
    });

    await ctx.db.insert(
      'auditLogs',
      buildCategoryAuditLog({
        actorUserId: admin._id,
        action: 'createCategory',
        targetId: categoryId,
        targetName: normalizedName,
        createdAt: Date.now(),
      })
    );

    return categoryId;
  },
});

/**
 * Super Admin category update (issue #16, Task 5): name and icon only. The
 * slug and ordering are immutable here and `parentCategoryId` is never
 * touched. An absent `icon` keeps the current value; an empty string clears
 * it (`patch` removes a field set to `undefined`). A request that changes
 * nothing is a no-op — no patch and no audit row (the `setFeatured`
 * contract); otherwise the `updateCategory` audit row lands in the same
 * transaction with a reason naming what changed.
 */
export const updateCategory = mutation({
  args: {
    categoryId: v.id('categories'),
    name: v.string(),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, { categoryId, name, icon }) => {
    const admin = await requireSuperAdmin(ctx);

    const category = await ctx.db.get(categoryId);
    if (category === null) {
      throw new ConvexError('Category not found');
    }

    const normalizedName = normalizeCategoryName(name);
    if (normalizedName === '') {
      throw new ConvexError('Category name is required');
    }

    const nextIcon = icon === undefined ? category.icon : normalizeCategoryIcon(icon);
    const reason = describeCategoryUpdate(
      { name: category.name, icon: category.icon },
      { name: normalizedName, icon: nextIcon }
    );
    if (reason === null) {
      return;
    }

    await ctx.db.patch(
      categoryId,
      icon === undefined ? { name: normalizedName } : { name: normalizedName, icon: nextIcon }
    );

    await ctx.db.insert(
      'auditLogs',
      buildCategoryAuditLog({
        actorUserId: admin._id,
        action: 'updateCategory',
        targetId: categoryId,
        targetName: normalizedName,
        reason,
        createdAt: Date.now(),
      })
    );
  },
});

/**
 * Super Admin category delete (issue #16, Task 5). THE REFERENCE GUARD RUNS
 * HERE, inside the mutation's transaction: any business row on the
 * `byCategoryId` index — any status, drafts and rejected listings included —
 * blocks the delete and the error names the live count. The client-side
 * blocked state is presentation only; this check is the security boundary.
 *
 * Reassignment is deliberately NOT an admin flow (no second reassignment
 * surface): owners move their businesses in the owner editor, after which
 * this delete succeeds. An unreferenced category is deleted together with its
 * `deleteCategory` audit row — name snapshot inserted FIRST, mirroring
 * `hardDeleteBusiness`, so the row survives the target.
 */
export const deleteCategory = mutation({
  args: { categoryId: v.id('categories') },
  handler: async (ctx, { categoryId }) => {
    const admin = await requireSuperAdmin(ctx);

    const category = await ctx.db.get(categoryId);
    if (category === null) {
      throw new ConvexError('Category not found');
    }

    const { count, isCapped } = await countCategoryReferences(ctx, categoryId);
    if (count > 0) {
      throw new ConvexError(
        `Cannot delete "${category.name}": still referenced by ${formatBusinessCount(
          count,
          isCapped
        )}. Reassign them in the owner editor, then retry.`
      );
    }

    await ctx.db.insert(
      'auditLogs',
      buildCategoryAuditLog({
        actorUserId: admin._id,
        action: 'deleteCategory',
        targetId: categoryId,
        targetName: category.name,
        createdAt: Date.now(),
      })
    );

    await ctx.db.delete(categoryId);
  },
});

/**
 * Super Admin category reorder (issue #16, Task 5). The request must be the
 * complete, unique id list (policy validates against the live set); the
 * persisted `ordering` is renumbered sequentially 1..n, and only categories
 * whose stored position actually changes are patched and audited — one
 * `reorderCategory` row each with the `ordering from -> to` reason. All in
 * this one transaction, so the new order is what every `byOrdering` read
 * (public and admin) sees on the next load.
 */
export const reorderCategories = mutation({
  args: { orderedIds: v.array(v.id('categories')) },
  handler: async (ctx, { orderedIds }) => {
    const admin = await requireSuperAdmin(ctx);

    const existing = await ctx.db
      .query('categories')
      .withIndex('byOrdering')
      .take(MAX_CATEGORIES);

    const plan = planCategoryReorder(existing, orderedIds);
    if (!plan.ok) {
      throw new ConvexError(plan.message);
    }
    if (plan.changes.length === 0) {
      return;
    }

    const now = Date.now();
    const names = new Map(existing.map((category) => [category._id, category.name] as const));

    for (const change of plan.changes) {
      await ctx.db.patch(change.categoryId, { ordering: change.to });

      await ctx.db.insert(
        'auditLogs',
        buildCategoryAuditLog({
          actorUserId: admin._id,
          action: 'reorderCategory',
          targetId: change.categoryId,
          targetName: names.get(change.categoryId) ?? '',
          reason: `ordering ${change.from} -> ${change.to}`,
          createdAt: now,
        })
      );
    }
  },
});
