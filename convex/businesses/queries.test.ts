/// <reference types="vite/client" />
/**
 * Handler tests for the public profile read (issue #7 slice 3, PR #65 review
 * M1): `getPublic` returns storage URLs keyed by storage id, omits files that
 * no longer exist, and fails closed unless the listing is approved.
 *
 * Run: pnpm exec vitest run convex/businesses/queries.test.ts
 */
import { expect, test } from 'vitest';
import { convexTest } from 'convex-test';

import schema from '../schema';
import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';

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

const NOW = 1_700_000_000_000;

async function storePhotos(t: ReturnType<typeof convexTest>, count: number) {
  return await t.run(async (ctx) => {
    const ids: Id<'_storage'>[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(await ctx.storage.store(new Blob([`photo-${index}`])));
    }
    return ids;
  });
}

async function seedBusiness(
  t: ReturnType<typeof convexTest>,
  options: {
    status?: 'approved' | 'pendingReview';
    photos?: Doc<'businesses'>['photos'];
  } = {}
) {
  return await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert('users', {
      name: 'Maya Owner',
      externalId: 'user_owner',
      role: 'user',
    });
    const categoryId = await ctx.db.insert('categories', {
      name: 'Food & Drink',
      slug: 'food-drink',
      ordering: 1,
    });
    return await ctx.db.insert('businesses', {
      name: 'Blue Harbor Diner',
      categoryId,
      description: '',
      address: { addressLine1: '', city: '', state: '', country: '' },
      timezone: 'America/New_York',
      photos: options.photos ?? [],
      hours: {},
      status: options.status ?? 'approved',
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
  });
}

test('getPublic returns URLs only for photos whose storage file still exists', async () => {
  const t = convexTest(schema, modules);
  const [liveId, deletedId] = await storePhotos(t, 2);
  const businessId = await seedBusiness(t, {
    photos: [
      { storageId: liveId, altText: 'Storefront', ordering: 0 },
      { storageId: deletedId, altText: 'Patio', ordering: 1 },
    ],
  });

  await t.run((ctx) => ctx.storage.delete(deletedId));

  const result = await t.query(api.businesses.queries.getPublic, { id: businessId });
  expect(result).not.toBeNull();
  if (result === null) {
    throw new Error('expected an approved business to be public');
  }

  expect(Object.keys(result.photoUrls)).toEqual([liveId]);
  expect(result.photoUrls[liveId]).toBeTypeOf('string');
  expect(result.photoUrls[deletedId]).toBeUndefined();
});

test('getPublic returns null unless the listing is approved', async () => {
  const t = convexTest(schema, modules);
  const businessId = await seedBusiness(t, { status: 'pendingReview' });

  const result = await t.query(api.businesses.queries.getPublic, { id: businessId });

  expect(result).toBeNull();
});
