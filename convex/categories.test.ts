/// <reference types="vite/client" />
/**
 * Handler tests for the B6b Super Admin category management (issue #16 review
 * follow-up, R2-M2): the server-side delete guard, the owner reassignment leg
 * (`saveDraft`), and reorder persistence + audit. These drive the REAL
 * `api.categories` handlers against the `convex-test` mock backend; the pure
 * policy functions stay pinned by `scripts/admin-category-policy.test.ts`.
 *
 * Run: pnpm exec vitest run convex/categories.test.ts
 */
import { expect, test } from 'vitest';
import { convexTest } from 'convex-test';
import type { TestConvex } from 'convex-test';

import schema from './schema';
import { api } from './_generated/api';
import type { Doc } from './_generated/dataModel';

const modules = import.meta.glob('./**/*.ts');

// `requireSuperAdmin` reads the live env whitelist on every request, so the
// admin's Clerk subject must be in it.
process.env.SUPER_ADMIN_CLERK_IDS = 'user_admin';

const NOW = 1_700_000_000_000;

async function seedBase(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert('users', {
      name: 'Ada Admin',
      externalId: 'user_admin',
      role: 'superAdmin',
    });
    const ownerId = await ctx.db.insert('users', {
      name: 'Maya Owner',
      externalId: 'user_owner',
      role: 'user',
    });
    const foodId = await ctx.db.insert('categories', {
      name: 'Food & Drink',
      slug: 'food-drink',
      ordering: 1,
    });
    const retailId = await ctx.db.insert('categories', {
      name: 'Retail',
      slug: 'retail',
      ordering: 2,
    });
    const businessId = await ctx.db.insert('businesses', {
      name: 'Blue Harbor Diner',
      categoryId: foodId,
      description: '',
      address: { addressLine1: '', city: '', state: '', country: '' },
      timezone: 'America/New_York',
      photos: [],
      hours: {},
      status: 'draft',
      verification: { isVerified: false },
      rating: 0,
      ratingCount: 0,
      services: [],
      credentials: [],
      keywords: [],
      searchText: 'Blue Harbor Diner  ',
      ownerId,
      lastUpdatedAt: NOW,
      isFeatured: false,
      lastSavedAt: NOW,
    });
    return { ownerId, foodId, retailId, businessId };
  });
}

function reorderAudits(audits: Doc<'auditLogs'>[]) {
  return audits.filter((row) => row.action === 'reorderCategory');
}

test('delete is blocked while referenced, then succeeds after the owner reassigns', async () => {
  const t = convexTest(schema, modules);
  const { foodId, retailId, businessId } = await seedBase(t);

  await expect(t.mutation(api.categories.deleteCategory, { categoryId: foodId })).rejects.toThrow(
    'Unauthorized'
  );
  await expect(
    t
      .withIdentity({ subject: 'user_owner' })
      .mutation(api.categories.deleteCategory, { categoryId: foodId })
  ).rejects.toThrow('Forbidden');

  await expect(
    t
      .withIdentity({ subject: 'user_admin' })
      .mutation(api.categories.deleteCategory, { categoryId: foodId })
  ).rejects.toThrow('still referenced by 1 business');

  // The blocked delete left the category (and wrote no audit row) intact.
  expect(await t.run((ctx) => ctx.db.get(foodId))).not.toBeNull();

  // The owner moves the business in the owner editor — the ONLY reassignment
  // surface — after which the delete succeeds.
  await t.withIdentity({ subject: 'user_owner' }).mutation(api.businesses.mutations.saveDraft, {
    businessId,
    patch: { categoryId: retailId },
  });
  const reassigned = await t.run((ctx) => ctx.db.get(businessId));
  expect(reassigned?.categoryId).toBe(retailId);

  await t
    .withIdentity({ subject: 'user_admin' })
    .mutation(api.categories.deleteCategory, { categoryId: foodId });

  expect(await t.run((ctx) => ctx.db.get(foodId))).toBeNull();
  const audits = await t.run((ctx) => ctx.db.query('auditLogs').collect());
  expect(audits.filter((row) => row.action === 'deleteCategory')).toHaveLength(1);
});

test('reorder persists the new order and audits only changed categories', async () => {
  const t = convexTest(schema, modules);
  const { foodId, retailId } = await seedBase(t);
  const autoId = await t.run((ctx) =>
    ctx.db.insert('categories', { name: 'Automotive', slug: 'automotive', ordering: 3 })
  );

  await expect(
    t.withIdentity({ subject: 'user_owner' }).mutation(api.categories.reorderCategories, {
      orderedIds: [autoId, foodId, retailId],
    })
  ).rejects.toThrow('Forbidden');

  await expect(
    t.withIdentity({ subject: 'user_admin' }).mutation(api.categories.reorderCategories, {
      orderedIds: [retailId, foodId],
    })
  ).rejects.toThrow('every category exactly once');

  await t.withIdentity({ subject: 'user_admin' }).mutation(api.categories.reorderCategories, {
    orderedIds: [autoId, foodId, retailId],
  });

  const ordered = await t.query(api.categories.listOrdered);
  expect(ordered.map((category) => category.name)).toEqual([
    'Automotive',
    'Food & Drink',
    'Retail',
  ]);

  // All three categories moved, so all three are patched and audited.
  let audits = await t.run((ctx) => ctx.db.query('auditLogs').collect());
  expect(reorderAudits(audits)).toHaveLength(3);
  expect(reorderAudits(audits).map((row) => row.reason)).toContain('ordering 3 -> 1');

  // Re-sending the same order changes nothing: no patch, no audit row.
  await t.withIdentity({ subject: 'user_admin' }).mutation(api.categories.reorderCategories, {
    orderedIds: [autoId, foodId, retailId],
  });
  audits = await t.run((ctx) => ctx.db.query('auditLogs').collect());
  expect(reorderAudits(audits)).toHaveLength(3);
});
