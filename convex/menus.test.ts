/// <reference types="vite/client" />
/**
 * Handler tests for the owner menu supply switches (issue #77, order
 * commitment protocol §6.2.8 + §6.5): `setGroupAvailability` writes exactly one
 * `auditLogs` row per real change and the row survives the target's hard
 * delete through its `targetName` snapshot; the existing `updateItem` audits
 * only a REAL availability change, never the field the owner editor sends on
 * every save.
 *
 * Run: pnpm exec vitest run convex/menus.test.ts
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';

import schema from './schema';
import { api } from './_generated/api';
import type { Doc } from './_generated/dataModel';

const modules = import.meta.glob('./**/*.ts');

// `requireSuperAdmin` reads the live env whitelist on every request, so the
// admin's Clerk subject must be in it (the hard-delete survival case).
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
    const otherOwnerId = await ctx.db.insert('users', {
      name: 'Other Owner',
      externalId: 'user_other_owner',
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
    const otherBusinessId = await ctx.db.insert('businesses', {
      ...baseBusiness,
      name: 'Other Diner',
      ownerId: otherOwnerId,
      searchText: 'Other Diner',
    });
    const pendingBusinessId = await ctx.db.insert('businesses', {
      ...baseBusiness,
      name: 'Pending Diner',
      status: 'pendingReview',
      searchText: 'Pending Diner',
    });
    const groupId = await ctx.db.insert('menuGroups', {
      businessId,
      name: 'Bowls',
      ordering: 0,
    });
    await ctx.db.insert('menuGroups', {
      businessId: pendingBusinessId,
      name: 'Trial Bowls',
      ordering: 0,
    });
    const otherGroupId = await ctx.db.insert('menuGroups', {
      businessId: otherBusinessId,
      name: 'Other Bowls',
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
    return {
      adminId,
      ownerId,
      otherOwnerId,
      businessId,
      otherBusinessId,
      pendingBusinessId,
      groupId,
      otherGroupId,
      itemId,
    };
  });
}

function asOwner(t: TestBackend) {
  return t.withIdentity({ subject: 'user_owner' });
}

async function auditRows(t: TestBackend) {
  return await t.run((ctx) => ctx.db.query('auditLogs').collect());
}

test('setGroupAvailability hides a group and writes one spec-exact audit row', async () => {
  const t = convexTest(schema, modules);
  const { businessId, groupId, ownerId } = await seed(t);

  await asOwner(t).mutation(api.menus.setGroupAvailability, {
    businessId,
    groupId,
    isAvailable: false,
  });

  // §6.2.2 public projection: the group stays visible, marked unavailable.
  const menu = await t.query(api.menus.listForBusiness, { businessId });
  expect(menu?.groups.find((group) => group._id === groupId)?.isAvailable).toBe(false);

  const rows = await auditRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actorUserId: ownerId,
    action: 'orders.groupAvailability.toggled',
    targetType: 'menuGroup',
    targetId: groupId,
    targetName: 'Bowls',
    createdAt: NOW,
  });
  expect(rows[0]?.reason).toBeUndefined();
  expect(rows[0]?.fromStatus).toBeUndefined();
  expect(rows[0]?.toStatus).toBeUndefined();
});

test('an identical group toggle repeat writes no second row', async () => {
  const t = convexTest(schema, modules);
  const { businessId, groupId } = await seed(t);

  await asOwner(t).mutation(api.menus.setGroupAvailability, {
    businessId,
    groupId,
    isAvailable: false,
  });
  await asOwner(t).mutation(api.menus.setGroupAvailability, {
    businessId,
    groupId,
    isAvailable: false,
  });

  expect(await auditRows(t)).toHaveLength(1);
});

test('setGroupAvailability refuses anonymous, other-owner, and admin callers', async () => {
  const t = convexTest(schema, modules);
  const { businessId, groupId } = await seed(t);
  const toggle = { businessId, groupId, isAvailable: false } as const;

  await expect(t.mutation(api.menus.setGroupAvailability, toggle)).rejects.toThrow(
    'Unauthorized'
  );
  await expect(
    t.withIdentity({ subject: 'user_other_owner' }).mutation(api.menus.setGroupAvailability, toggle)
  ).rejects.toThrow('Forbidden');
  await expect(
    t.withIdentity({ subject: 'user_admin' }).mutation(api.menus.setGroupAvailability, toggle)
  ).rejects.toThrow('Forbidden');

  expect(await auditRows(t)).toHaveLength(0);
  const menu = await t.query(api.menus.listForBusiness, { businessId });
  expect(menu?.groups.find((group) => group._id === groupId)?.isAvailable).toBe(true);
});

test('setGroupAvailability is read-only while the listing is in review', async () => {
  const t = convexTest(schema, modules);
  const { pendingBusinessId } = await seed(t);
  const group = await t.run((ctx) =>
    ctx.db
      .query('menuGroups')
      .withIndex('byBusinessId', (q) => q.eq('businessId', pendingBusinessId))
      .first()
  );
  if (group === null) {
    throw new Error('seed pending group is missing');
  }

  // Same `assertMenuWritable` rule as every other menu mutation.
  await expect(
    asOwner(t).mutation(api.menus.setGroupAvailability, {
      businessId: pendingBusinessId,
      groupId: group._id,
      isAvailable: false,
    })
  ).rejects.toThrow('read-only');

  expect(await auditRows(t)).toHaveLength(0);
});

test('updateItem audits one row when the item availability actually changes', async () => {
  const t = convexTest(schema, modules);
  const { businessId, itemId, ownerId } = await seed(t);

  await asOwner(t).mutation(api.menus.updateItem, {
    businessId,
    itemId,
    patch: { isAvailable: false },
  });

  const item = await t.run((ctx) => ctx.db.get(itemId));
  expect(item?.isAvailable).toBe(false);

  const rows = await auditRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actorUserId: ownerId,
    action: 'orders.itemAvailability.toggled',
    targetType: 'menuItem',
    targetId: itemId,
    targetName: 'Grain Bowl',
    createdAt: NOW,
  });
  expect(rows[0]?.reason).toBeUndefined();
  expect(rows[0]?.fromStatus).toBeUndefined();
  expect(rows[0]?.toStatus).toBeUndefined();
});

test('updateItem writes no row when isAvailable is re-sent unchanged', async () => {
  const t = convexTest(schema, modules);
  const { businessId, itemId } = await seed(t);

  // `buildItemPatch` sends the field on EVERY editor save, so this is the
  // common case: an unchanged availability must not manufacture a row.
  await asOwner(t).mutation(api.menus.updateItem, {
    businessId,
    itemId,
    patch: { isAvailable: true, name: 'Grain Bowl Deluxe' },
  });

  expect(await auditRows(t)).toHaveLength(0);
});

test('updateItem writes no row when the patch omits isAvailable (reorder path)', async () => {
  const t = convexTest(schema, modules);
  const { businessId, itemId } = await seed(t);

  await asOwner(t).mutation(api.menus.updateItem, {
    businessId,
    itemId,
    patch: { ordering: 3 },
  });

  expect(await auditRows(t)).toHaveLength(0);
});

test('updateItem writes no row for a name-only edit', async () => {
  const t = convexTest(schema, modules);
  const { businessId, itemId } = await seed(t);

  await asOwner(t).mutation(api.menus.updateItem, {
    businessId,
    itemId,
    patch: { name: 'Grain Bowl Deluxe' },
  });

  expect(await auditRows(t)).toHaveLength(0);
});

test('updateItem refuses anonymous, other-owner, and admin callers', async () => {
  const t = convexTest(schema, modules);
  const { businessId, itemId } = await seed(t);
  const update = { businessId, itemId, patch: { isAvailable: false } } as const;

  await expect(t.mutation(api.menus.updateItem, update)).rejects.toThrow('Unauthorized');
  await expect(
    t.withIdentity({ subject: 'user_other_owner' }).mutation(api.menus.updateItem, update)
  ).rejects.toThrow('Forbidden');
  await expect(
    t.withIdentity({ subject: 'user_admin' }).mutation(api.menus.updateItem, update)
  ).rejects.toThrow('Forbidden');

  expect(await auditRows(t)).toHaveLength(0);
  const item = await t.run((ctx) => ctx.db.get(itemId));
  expect(item?.isAvailable).toBe(true);
});

test('the group audit name snapshot survives a business hard delete', async () => {
  const t = convexTest(schema, modules);
  const { businessId, groupId } = await seed(t);

  await asOwner(t).mutation(api.menus.setGroupAvailability, {
    businessId,
    groupId,
    isAvailable: false,
  });

  // The cascade removes the group; the audit row must stay searchable (Q7).
  await t
    .withIdentity({ subject: 'user_admin' })
    .mutation(api.businesses.adminMutations.hardDeleteBusiness, {
      businessId,
      confirmName: 'Blue Harbor Diner',
    });

  expect(await t.run((ctx) => ctx.db.get(groupId))).toBeNull();
  const rows = await t.run((ctx) =>
    ctx.db
      .query('auditLogs')
      .withIndex('byTarget', (q) => q.eq('targetType', 'menuGroup').eq('targetId', groupId))
      .collect()
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.targetName).toBe('Bowls');
});
