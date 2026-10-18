/// <reference types="vite/client" />
/**
 * Handler tests for the owner save leg of the category reassignment (issue #16
 * review follow-up, R2-M2): `api.businesses.mutations.saveDraft` persists a
 * `categoryId` change for the OWNER only. The full delete-blocked -> reassign
 * -> delete-success journey lives in `convex/categories.test.ts`.
 *
 * Run: pnpm exec vitest run convex/businesses/mutations.test.ts
 */
import { expect, test } from 'vitest';
import { convexTest } from 'convex-test';

import schema from '../schema';
import { api } from '../_generated/api';

// `import.meta.glob` keys are relative to THIS file, so files under
// `convex/businesses/` come back as './x.ts' while everything above comes back
// as '../x.ts'. Rebuild every key as convex-root-relative (the shape a
// root-level test's glob produces) so convex-test's single-prefix module
// resolution works.
const modules = Object.fromEntries(
  Object.entries(import.meta.glob('../**/*.ts')).map(([key, load]) => [
    key.startsWith('../') ? `./${key.slice(3)}` : `./businesses/${key.slice(2)}`,
    load,
  ])
);

// `requireSuperAdmin` reads the live env whitelist on every request, so the
// admin's Clerk subject must be in it.
process.env.SUPER_ADMIN_CLERK_IDS = 'user_admin';

const NOW = 1_700_000_000_000;

async function seed(t: ReturnType<typeof convexTest>) {
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
    await ctx.db.insert('users', {
      name: 'Other User',
      externalId: 'user_other',
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

test('saveDraft lets the owner reassign the category', async () => {
  const t = convexTest(schema, modules);
  const { retailId, businessId } = await seed(t);

  await t.withIdentity({ subject: 'user_owner' }).mutation(api.businesses.mutations.saveDraft, {
    businessId,
    patch: { categoryId: retailId },
  });

  const saved = await t.run((ctx) => ctx.db.get(businessId));
  expect(saved?.categoryId).toBe(retailId);
  expect(saved?.status).toBe('draft');
  expect(saved?.lastSavedAt).toBeGreaterThanOrEqual(NOW);
});

test('saveDraft refuses unauthenticated and non-owner callers', async () => {
  const t = convexTest(schema, modules);
  const { retailId, businessId } = await seed(t);

  await expect(
    t.mutation(api.businesses.mutations.saveDraft, {
      businessId,
      patch: { categoryId: retailId },
    })
  ).rejects.toThrow('Unauthorized');

  // A different signed-in user is not the owner of this business.
  await expect(
    t.withIdentity({ subject: 'user_other' }).mutation(api.businesses.mutations.saveDraft, {
      businessId,
      patch: { categoryId: retailId },
    })
  ).rejects.toThrow('Forbidden');

  // Even the Super Admin is refused: ownership is `businesses.ownerId` only.
  await expect(
    t.withIdentity({ subject: 'user_admin' }).mutation(api.businesses.mutations.saveDraft, {
      businessId,
      patch: { categoryId: retailId },
    })
  ).rejects.toThrow('Forbidden');

  // Nothing was persisted by the refused attempts.
  const untouched = await t.run((ctx) => ctx.db.get(businessId));
  expect(untouched?.categoryId).not.toBe(retailId);
});
