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
import type { Id } from '../_generated/dataModel';

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

/**
 * Stores one fixture file the way the real backend sees an upload: bytes plus
 * the POST's Content-Type.
 *
 * convex-test 0.0.62's `storage/storeBlob` mock records only `{ size, sha256 }`
 * in the `_storage` system doc, while the real backend also records the
 * Content-Type. The attach gate reads `metadata.contentType`, so a fixture that
 * only sets `Blob.type` still looks like an upload sent without a Content-Type
 * and is correctly rejected. Patch the mock's system doc to match the real
 * backend; `_storage` is not schema-validated, so the write is allowed.
 */
async function storePhotoFile(
  t: ReturnType<typeof convexTest>,
  businessId: Id<'businesses'>,
  body: string,
  contentType = 'image/png'
): Promise<Id<'_storage'>> {
  return await t.run(async (ctx) => {
    const business = await ctx.db.get(businessId);
    if (business === null) {
      throw new Error('fixture business is missing');
    }

    const storageId = await ctx.storage.store(new Blob([body], { type: contentType }));
    await (
      ctx.db as unknown as {
        patch(
          table: string,
          id: Id<'_storage'>,
          value: { contentType: string }
        ): Promise<void>;
      }
    ).patch('_storage', storageId, { contentType });
    // Mirror the authenticated upload action: the new id is registered to the
    // listing that uploaded it.
    await ctx.db.insert('storageUploads', {
      storageId,
      ownerId: business.ownerId,
      businessId,
      createdAt: Date.now(),
    });
    return storageId;
  });
}

async function storePhotos(
  t: ReturnType<typeof convexTest>,
  businessId: Id<'businesses'>,
  count: number
) {
  const ids: Id<'_storage'>[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await storePhotoFile(t, businessId, `photo-${index}`));
  }
  return ids;
}

function photo(storageId: Id<'_storage'>, altText?: string, ordering = 0) {
  return { storageId, ...(altText === undefined ? {} : { altText }), ordering };
}

test('saveDraft rejects more than twelve unique photos and persists nothing', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  const ids = await storePhotos(t, businessId, 13);

  await expect(
    t.withIdentity({ subject: 'user_owner' }).mutation(api.businesses.mutations.saveDraft, {
      businessId,
      patch: { photos: ids.map((storageId) => photo(storageId)) },
    })
  ).rejects.toThrow('Listings can have up to 12 photos');

  const untouched = await t.run((ctx) => ctx.db.get(businessId));
  expect(untouched?.photos).toEqual([]);
});

test('saveDraft normalizes before counting: 13 raw entries with a duplicate persist 12', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  const ids = await storePhotos(t, businessId, 12);
  const patch = [...ids.map((storageId) => photo(storageId, undefined, 9)), photo(ids[0], 'Duplicate')];

  await t.withIdentity({ subject: 'user_owner' }).mutation(api.businesses.mutations.saveDraft, {
    businessId,
    patch: { photos: patch },
  });

  const saved = await t.run((ctx) => ctx.db.get(businessId));
  expect(saved?.photos.map((stored) => stored.storageId)).toEqual(ids);
  expect(saved?.photos.map((stored) => stored.ordering)).toEqual(ids.map((_, index) => index));
});

test('saveDraft caps alt text, re-stamps ordering, and dedupes storage ids', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  const [first, second] = await storePhotos(t, businessId, 2);

  await t.withIdentity({ subject: 'user_owner' }).mutation(api.businesses.mutations.saveDraft, {
    businessId,
    patch: {
      photos: [
        photo(second, '  Entrance  ', 7),
        photo(first, 'a'.repeat(250), 3),
        photo(second, 'Duplicate', 4),
      ],
    },
  });

  const saved = await t.run((ctx) => ctx.db.get(businessId));
  expect(saved?.photos).toEqual([
    { storageId: second, altText: 'Entrance', ordering: 0 },
    { storageId: first, altText: 'a'.repeat(200), ordering: 1 },
  ]);
});

test('a later save that omits photos leaves the persisted list untouched', async () => {
  const t = convexTest(schema, modules);
  const { businessId, retailId } = await seed(t);
  const [first] = await storePhotos(t, businessId, 1);

  await t.withIdentity({ subject: 'user_owner' }).mutation(api.businesses.mutations.saveDraft, {
    businessId,
    patch: { photos: [photo(first, 'Storefront')] },
  });
  await t.withIdentity({ subject: 'user_owner' }).mutation(api.businesses.mutations.saveDraft, {
    businessId,
    patch: { categoryId: retailId },
  });

  const saved = await t.run((ctx) => ctx.db.get(businessId));
  expect(saved?.categoryId).toBe(retailId);
  expect(saved?.photos).toEqual([{ storageId: first, altText: 'Storefront', ordering: 0 }]);
});

test('saveAndResubmit rejects more than twelve unique photos and persists nothing', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  await t.run((ctx) => ctx.db.patch(businessId, { status: 'approved' }));
  const ids = await storePhotos(t, businessId, 13);

  await expect(
    t.withIdentity({ subject: 'user_owner' }).mutation(api.businesses.mutations.saveAndResubmit, {
      businessId,
      patch: {
        description: 'Updated description',
        photos: ids.map((storageId) => photo(storageId)),
      },
    })
  ).rejects.toThrow('Listings can have up to 12 photos');

  const untouched = await t.run((ctx) => ctx.db.get(businessId));
  expect(untouched?.status).toBe('approved');
  expect(untouched?.description).toBe('');
  expect(untouched?.photos).toEqual([]);
});

test('saveAndResubmit normalizes and counts through the same photo policy', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  await t.run((ctx) => ctx.db.patch(businessId, { status: 'approved' }));
  const ids = await storePhotos(t, businessId, 12);
  const photos = [
    ...ids.map((storageId) => photo(storageId, undefined, 9)),
    photo(ids[0], 'Duplicate'),
  ];

  await t.withIdentity({ subject: 'user_owner' }).mutation(
    api.businesses.mutations.saveAndResubmit,
    {
      businessId,
      patch: { description: 'Updated description', photos },
    }
  );

  const saved = await t.run((ctx) => ctx.db.get(businessId));
  expect(saved?.status).toBe('pendingReview');
  expect(saved?.photos.map((stored) => stored.storageId)).toEqual(ids);
  expect(saved?.photos.map((stored) => stored.ordering)).toEqual(ids.map((_, index) => index));
});
