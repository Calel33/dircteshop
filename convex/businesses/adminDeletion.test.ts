/// <reference types="vite/client" />
/**
 * Handler tests for the hard-delete order-history guard (issue #84, Task 13;
 * plan D6 · order commitment protocol INV-30/E68): `hardDeleteBusiness`
 * refuses a business that has any order, deleting nothing and leaving no
 * audit row behind — the audit insert that precedes the cascade rolls back
 * with the refusal. A business with no orders still cascades exactly as
 * before.
 *
 * Run: pnpm exec vitest run convex/businesses/adminDeletion.test.ts
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ConvexError } from 'convex/values';
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

// `requireSuperAdmin` reads the live env whitelist on every request, so the
// admin's Clerk subject must be in it.
process.env.SUPER_ADMIN_CLERK_IDS = 'user_admin';

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type TestBackend = ReturnType<typeof convexTest>;

async function seed(t: TestBackend) {
  return await t.run(async (ctx) => {
    const adminId = await ctx.db.insert('users', {
      name: 'Ada Admin',
      externalId: 'user_admin',
      role: 'superAdmin',
    });
    const ownerId = await ctx.db.insert('users', {
      name: 'Maya Owner',
      externalId: 'user_owner',
      role: 'user',
    });
    const categoryId = await ctx.db.insert('categories', {
      name: 'Restaurants',
      slug: 'restaurants',
      ordering: 1,
    });
    const baseBusiness: Omit<Doc<'businesses'>, '_id' | '_creationTime'> = {
      name: 'Blue Harbor Diner',
      categoryId,
      description: 'Diner',
      address: { addressLine1: '', city: '', state: '', country: '' },
      timezone: 'America/New_York',
      photos: [],
      hours: {},
      status: 'approved',
      verification: { isVerified: false },
      rating: 0,
      ratingCount: 0,
      services: [],
      credentials: [],
      keywords: [],
      searchText: 'Blue Harbor Diner',
      ownerId,
      lastUpdatedAt: NOW,
      isFeatured: false,
      lastSavedAt: NOW,
    };
    const businessId = await ctx.db.insert('businesses', baseBusiness);
    const groupId = await ctx.db.insert('menuGroups', {
      businessId,
      name: 'Bowls',
      ordering: 0,
    });
    const itemId = await ctx.db.insert('menuItems', {
      businessId,
      groupId,
      name: 'Grain Bowl',
      price: 1200,
      customizationOptions: [],
      ordering: 0,
      isAvailable: true,
    });
    return { adminId, ownerId, businessId, groupId, itemId };
  });
}

async function insertOrder(t: TestBackend, businessId: Id<'businesses'>) {
  return await t.run((ctx) =>
    ctx.db.insert('orders', {
      businessId,
      customerName: 'Casey Customer',
      contactEmail: 'casey@example.com',
      status: 'new',
      createdAt: NOW,
    })
  );
}

async function auditRows(t: TestBackend) {
  return await t.run((ctx) => ctx.db.query('auditLogs').collect());
}

function asAdmin(t: TestBackend) {
  return t.withIdentity({ subject: 'user_admin' });
}

test('hardDeleteBusiness refuses a business with order history and deletes nothing', async () => {
  const t = convexTest(schema, modules);
  const { businessId, groupId, itemId } = await seed(t);
  const orderId = await insertOrder(t, businessId);

  expect(await auditRows(t)).toHaveLength(0);

  const thrown = await asAdmin(t)
    .mutation(api.businesses.adminMutations.hardDeleteBusiness, {
      businessId,
      confirmName: 'Blue Harbor Diner',
    })
    .then(
      () => {
        throw new Error('Expected the hard delete to refuse, but it succeeded');
      },
      (error: unknown) => error
    );

  expect(thrown).toBeInstanceOf(ConvexError);
  expect((thrown as ConvexError<{ code: string }>).data.code).toBe('HAS_ORDERS');

  // Transaction rollback: the delete audit row inserted before the cascade is
  // not left behind as an orphan, and nothing the cascade would have removed
  // is gone — least of all the order history (INV-30/E68).
  expect(await auditRows(t)).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.get(businessId))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get(orderId))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get(groupId))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get(itemId))).not.toBeNull();
});

test('hardDeleteBusiness still cascades a business with no orders', async () => {
  const t = convexTest(schema, modules);
  const { businessId, groupId, itemId } = await seed(t);

  await asAdmin(t).mutation(api.businesses.adminMutations.hardDeleteBusiness, {
    businessId,
    confirmName: 'Blue Harbor Diner',
  });

  expect(await t.run((ctx) => ctx.db.get(businessId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(groupId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(itemId))).toBeNull();

  const rows = await auditRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: 'delete',
    targetType: 'business',
    targetId: businessId,
    targetName: 'Blue Harbor Diner',
  });
});
