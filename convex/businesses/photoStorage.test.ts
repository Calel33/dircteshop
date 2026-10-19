/// <reference types="vite/client" />
/**
 * Handler tests for B7 (issue #7) photo storage and uploads: the ownership
 * registry gates attach and delete, the authenticated upload action is the only
 * path that mints an attachable id, and delete-on-remove touches only ids the
 * listing owns.
 *
 * Run: pnpm exec vitest run convex/businesses/photoStorage.test.ts
 */
import { expect, test } from 'vitest';
import { convexTest } from 'convex-test';

import schema from '../schema';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';

// Rebuild `import.meta.glob` keys as convex-root-relative, the shape a
// root-level test's glob produces (see mutations.test.ts).
const modules = Object.fromEntries(
  Object.entries(import.meta.glob('../**/*.ts')).map(([key, load]) => [
    key.startsWith('../') ? `./${key.slice(3)}` : `./businesses/${key.slice(2)}`,
    load,
  ])
);

const NOW = 1_700_000_000_000;
const UPLOAD_PATH = '/photos/upload';

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const ownerA = await ctx.db.insert('users', {
      name: 'Owner A',
      externalId: 'user_a',
      role: 'user',
    });
    const ownerB = await ctx.db.insert('users', {
      name: 'Owner B',
      externalId: 'user_b',
      role: 'user',
    });
    const categoryId = await ctx.db.insert('categories', {
      name: 'Food & Drink',
      slug: 'food-drink',
      ordering: 1,
    });

    const businessA = await ctx.db.insert('businesses', {
      name: 'Alpha Cafe',
      categoryId,
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
      searchText: 'Alpha Cafe  ',
      ownerId: ownerA,
      lastUpdatedAt: NOW,
      isFeatured: false,
      lastSavedAt: NOW,
    });
    const businessB = await ctx.db.insert('businesses', {
      name: 'Beta Bakery',
      categoryId,
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
      searchText: 'Beta Bakery  ',
      ownerId: ownerB,
      lastUpdatedAt: NOW,
      isFeatured: false,
      lastSavedAt: NOW,
    });

    return { ownerA, ownerB, categoryId, businessA, businessB };
  });
}

function photo(storageId: Id<'_storage'>, ordering = 0) {
  return { storageId, ordering };
}

/**
 * Stores a fixture file. With `businessId`, also writes the registry row the
 * authenticated upload action writes; without it, the id is unregistered.
 */
async function storeFile(
  t: ReturnType<typeof convexTest>,
  options: {
    businessId?: Id<'businesses'>;
    contentType?: string;
    body?: string;
  } = {}
): Promise<Id<'_storage'>> {
  const contentType = options.contentType ?? 'image/png';
  const body = options.body ?? 'photo';

  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([body], { type: contentType }));
    // convex-test 0.0.62 records only size/sha256 on the `_storage` system doc;
    // mirror the real backend's Content-Type (see mutations.test.ts).
    await (
      ctx.db as unknown as {
        patch(
          table: string,
          id: Id<'_storage'>,
          value: { contentType: string }
        ): Promise<void>;
      }
    ).patch('_storage', storageId, { contentType });

    if (options.businessId !== undefined) {
      const business = await ctx.db.get(options.businessId);
      if (business === null) {
        throw new Error('fixture business is missing');
      }
      await ctx.db.insert('storageUploads', {
        storageId,
        ownerId: business.ownerId,
        businessId: options.businessId,
        createdAt: Date.now(),
      });
    }

    return storageId;
  });
}

async function fileExists(t: ReturnType<typeof convexTest>, storageId: Id<'_storage'>) {
  return await t.run(async (ctx) => (await ctx.db.system.get('_storage', storageId)) !== null);
}

test('the authenticated upload action registers the id to the listing', async () => {
  const t = convexTest(schema, modules);
  const { ownerA, businessA } = await seed(t);

  const response = await t
    .withIdentity({ subject: 'user_a' })
    .fetch(`${UPLOAD_PATH}?businessId=${businessA}`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Blob(['new photo'], { type: 'image/png' }),
    });

  expect(response.status).toBe(200);
  const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };

  // The real backend records the upload's Content-Type on the `_storage` doc;
  // convex-test 0.0.62 records only size/sha256. Mirror it so the attach gate
  // sees the same metadata production sees.
  await t.run(async (ctx) => {
    await (
      ctx.db as unknown as {
        patch(
          table: string,
          id: Id<'_storage'>,
          value: { contentType: string }
        ): Promise<void>;
      }
    ).patch('_storage', storageId, { contentType: 'image/png' });
  });

  const upload = await t.run((ctx) =>
    ctx.db
      .query('storageUploads')
      .withIndex('byStorageId', (q) => q.eq('storageId', storageId))
      .unique()
  );
  expect(upload?.businessId).toBe(businessA);
  expect(upload?.ownerId).toBe(ownerA);

  // A registered upload is attachable and passes the type/size gate.
  await t.withIdentity({ subject: 'user_a' }).mutation(api.businesses.mutations.saveDraft, {
    businessId: businessA,
    patch: { photos: [photo(storageId)] },
  });
  const saved = await t.run((ctx) => ctx.db.get(businessA));
  expect(saved?.photos.map((stored) => stored.storageId)).toEqual([storageId]);
});

test('another tenant cannot attach a registered id, and the file survives', async () => {
  const t = convexTest(schema, modules);
  const { businessA, businessB } = await seed(t);
  const foreignId = await storeFile(t, { businessId: businessA });

  await expect(
    t.withIdentity({ subject: 'user_b' }).mutation(api.businesses.mutations.saveDraft, {
      businessId: businessB,
      patch: { photos: [photo(foreignId)] },
    })
  ).rejects.toThrow('was not uploaded for this listing');

  expect(await fileExists(t, foreignId)).toBe(true);
  const untouched = await t.run((ctx) => ctx.db.get(businessB));
  expect(untouched?.photos).toEqual([]);
});

test('clearing a partially persisted foreign id never deletes it', async () => {
  const t = convexTest(schema, modules);
  const { businessA, businessB } = await seed(t);
  const foreignId = await storeFile(t, { businessId: businessA });

  // Simulate a pre-registry/partial state that bypassed the attach gate.
  await t.run((ctx) => ctx.db.patch(businessB, { photos: [photo(foreignId)] }));

  await t.withIdentity({ subject: 'user_b' }).mutation(api.businesses.mutations.saveDraft, {
    businessId: businessB,
    patch: { photos: [] },
  });

  expect(await fileExists(t, foreignId)).toBe(true);
  const cleared = await t.run((ctx) => ctx.db.get(businessB));
  expect(cleared?.photos).toEqual([]);
});

test('an unregistered id is rejected and never deleted', async () => {
  const t = convexTest(schema, modules);
  const { businessA } = await seed(t);
  const unregisteredId = await storeFile(t);

  await expect(
    t.withIdentity({ subject: 'user_a' }).mutation(api.businesses.mutations.saveDraft, {
      businessId: businessA,
      patch: { photos: [photo(unregisteredId)] },
    })
  ).rejects.toThrow('was not uploaded for this listing');

  expect(await fileExists(t, unregisteredId)).toBe(true);
  const untouched = await t.run((ctx) => ctx.db.get(businessA));
  expect(untouched?.photos).toEqual([]);
});

test('photoUrls resolves only ids registered to the queried listing', async () => {
  const t = convexTest(schema, modules);
  const { businessA, businessB } = await seed(t);

  const ownUnsavedId = await storeFile(t, { businessId: businessA });
  const persistedId = await storeFile(t, { businessId: businessA });
  const foreignId = await storeFile(t, { businessId: businessB });

  await t.withIdentity({ subject: 'user_a' }).mutation(api.businesses.mutations.saveDraft, {
    businessId: businessA,
    patch: { photos: [photo(persistedId)] },
  });

  const urls = await t
    .withIdentity({ subject: 'user_a' })
    .query(api.businesses.photoStorage.photoUrls, {
      businessId: businessA,
      storageIds: [ownUnsavedId, persistedId, foreignId],
    });

  expect(urls[ownUnsavedId]).toMatch(/^https:\/\//);
  expect(urls[persistedId]).toMatch(/^https:\/\//);
  expect(urls[foreignId]).toBeNull();
});

test('a foreign id that fails type validation is not deleted', async () => {
  const t = convexTest(schema, modules);
  const { businessA, businessB } = await seed(t);
  const foreignId = await storeFile(t, {
    businessId: businessA,
    contentType: 'text/plain',
  });

  await expect(
    t.withIdentity({ subject: 'user_b' }).mutation(api.businesses.mutations.saveDraft, {
      businessId: businessB,
      patch: { photos: [photo(foreignId)] },
    })
  ).rejects.toThrow('was not uploaded for this listing');

  expect(await fileExists(t, foreignId)).toBe(true);
});
