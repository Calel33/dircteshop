/// <reference types="vite/client" />
/**
 * Handler-level regression suite for the B8 (issue #8) anonymous order workflow.
 * These drive the REAL `api.orders` handlers against the `convex-test` mock
 * backend, including `requireBusinessOwner`, so the public write surface and the
 * owner-only reads are proven at the function boundary rather than through the
 * UI. The pure transition/validation matrix stays pinned by
 * `scripts/order-policy.test.ts`.
 *
 * This is the safety net for the commitment-protocol work: it pins the
 * behaviour that must survive the schema expand in slice 1 / S1 (legacy
 * single-item orders keep working while `placeOrder` is added).
 *
 * Run: pnpm exec vitest run convex/orders.test.ts
 */
import { expect, test } from 'vitest';
import { convexTest } from 'convex-test';

import schema from './schema';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

const modules = import.meta.glob('./**/*.ts');
const NOW = 1_700_000_000_000;

type TestBackend = ReturnType<typeof convexTest>;

async function seed(t: TestBackend) {
  return await t.run(async (ctx) => {
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
    const businessId = await ctx.db.insert('businesses', {
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
    });
    const otherBusinessId = await ctx.db.insert('businesses', {
      name: 'Other Diner',
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
      searchText: 'Other Diner',
      ownerId: otherOwnerId,
      lastUpdatedAt: NOW,
      isFeatured: false,
      lastSavedAt: NOW,
    });
    const groupId = await ctx.db.insert('menuGroups', {
      businessId,
      name: 'Bowls',
      ordering: 0,
    });
    const otherGroupId = await ctx.db.insert('menuGroups', {
      businessId: otherBusinessId,
      name: 'Bowls',
      ordering: 0,
    });
    const menuItemId = await ctx.db.insert('menuItems', {
      businessId,
      groupId,
      name: 'Grain Bowl',
      price: 1200,
      customizationOptions: [
        {
          name: 'Base',
          required: true,
          options: [{ name: 'Rice' }, { name: 'Greens' }],
        },
      ],
      ordering: 0,
      isAvailable: true,
    });
    const otherMenuItemId = await ctx.db.insert('menuItems', {
      businessId: otherBusinessId,
      groupId: otherGroupId,
      name: 'Other Bowl',
      price: 900,
      customizationOptions: [],
      ordering: 0,
      isAvailable: true,
    });
    return {
      ownerId,
      otherOwnerId,
      businessId,
      otherBusinessId,
      menuItemId,
      otherMenuItemId,
    };
  });
}

function validArgs(businessId: Id<'businesses'>, menuItemId: Id<'menuItems'>) {
  return {
    businessId,
    menuItemId,
    selections: [{ optionName: 'Base', choiceName: 'Rice' }],
    customerName: 'Ada Lovelace',
    contactPhone: '555-0100',
  };
}

test('anonymous visitor submits; order is new; the owner is notified', async () => {
  const t = convexTest(schema, modules);
  const { ownerId, businessId, menuItemId } = await seed(t);

  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.status).toBe('new');
  expect(order?.customerName).toBe('Ada Lovelace');
  expect(order?.selections).toEqual([{ optionName: 'Base', choiceName: 'Rice' }]);

  const notices = await t.run((ctx) =>
    ctx.db
      .query('notifications')
      .withIndex('byUserId', (q) => q.eq('userId', ownerId))
      .collect()
  );
  expect(notices.map((notice) => notice.type)).toEqual(['new_order']);

  const publicStatus = await t.query(api.orders.getOrderStatus, { orderId });
  expect(publicStatus?.status).toBe('new');
});

test('the owner board returns the order and the owner can advance it', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  const asOwner = t.withIdentity({ subject: 'user_owner' });
  const rows = await asOwner.query(api.orders.listOrders, { businessId });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.itemName).toBe('Grain Bowl');
  expect(rows[0]?.itemPrice).toBe(1200);

  for (const action of ['accept', 'ready', 'complete'] as const) {
    await asOwner.mutation(api.orders.transitionOrderStatus, {
      businessId,
      orderId,
      action,
    });
  }

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.status).toBe('completed');
});

test('an unavailable item is rejected server-side', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await t.run((ctx) => ctx.db.patch(menuItemId, { isAvailable: false }));

  await expect(
    t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId))
  ).rejects.toThrow('This item is not available for ordering.');
});

test('an unapproved business is rejected server-side', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await t.run((ctx) => ctx.db.patch(businessId, { status: 'pendingReview' }));

  await expect(
    t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId))
  ).rejects.toThrow('This business is not accepting orders.');
});

test("another business's menu item cannot be ordered through this business", async () => {
  const t = convexTest(schema, modules);
  const { businessId, otherMenuItemId } = await seed(t);

  await expect(
    t.mutation(api.orders.submitOrder, validArgs(businessId, otherMenuItemId))
  ).rejects.toThrow('This item is not available for ordering.');
});

test('unauthenticated callers cannot read the board or transition an order', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  await expect(t.query(api.orders.listOrders, { businessId })).rejects.toThrow('Unauthorized');
  await expect(
    t.mutation(api.orders.transitionOrderStatus, { businessId, orderId, action: 'accept' })
  ).rejects.toThrow('Unauthorized');
});

test('a non-owner cannot read the board or transition an order', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));
  const asOtherOwner = t.withIdentity({ subject: 'user_other_owner' });

  await expect(asOtherOwner.query(api.orders.listOrders, { businessId })).rejects.toThrow(
    'Forbidden'
  );
  await expect(
    asOtherOwner.mutation(api.orders.transitionOrderStatus, {
      businessId,
      orderId,
      action: 'accept',
    })
  ).rejects.toThrow('Forbidden');
});

test('an illegal transition is rejected', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  await expect(
    t.withIdentity({ subject: 'user_owner' }).mutation(api.orders.transitionOrderStatus, {
      businessId,
      orderId,
      action: 'ready',
    })
  ).rejects.toThrow('Invalid status transition');
});

test('a terminal order rejects every further transition', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));
  const asOwner = t.withIdentity({ subject: 'user_owner' });

  for (const action of ['accept', 'ready', 'complete'] as const) {
    await asOwner.mutation(api.orders.transitionOrderStatus, { businessId, orderId, action });
  }

  await expect(
    asOwner.mutation(api.orders.transitionOrderStatus, { businessId, orderId, action: 'accept' })
  ).rejects.toThrow('Invalid status transition');
});

test('the public status projection exposes only status and creation time', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  const status = await t.query(api.orders.getOrderStatus, { orderId });
  expect(Object.keys(status ?? {}).sort()).toEqual(['createdAt', 'status']);
  expect(JSON.stringify(status)).not.toContain('Ada Lovelace');
  expect(JSON.stringify(status)).not.toContain('555-0100');
});
