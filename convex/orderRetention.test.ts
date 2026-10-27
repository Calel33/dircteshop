/// <reference types="vite/client" />
/**
 * Retention suite for the order commitment protocol (issue #84, T10 / plan D5).
 *
 * These drive the REAL `convex/orderRetention.ts` internal mutation against the
 * `convex-test` mock backend. Cron jobs cannot run under `convex-test`, so the
 * job is triggered the documented way — a direct call to the internal mutation —
 * and the registration record is pinned statically instead (same shape as
 * `convex/orderExpiry.test.ts`).
 *
 * Every age boundary is set by writing `statusUpdatedAt` / `createdAt` directly;
 * no test sleeps. `Date` alone is faked (as in `convex/orders.test.ts`) so
 * `convex-test`'s async plumbing keeps a real `setTimeout`.
 *
 * Run: pnpm exec vitest run convex/orderRetention.test.ts
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import type { TestConvex } from 'convex-test';

import schema from './schema';
import { api, internal } from './_generated/api';
import crons from './crons';
import {
  RETENTION_BATCH,
  RETENTION_COMPLETED_DAYS_MS,
  RETENTION_TERMINAL_DAYS_MS,
} from './orderCommitPolicy';
import type { Doc, Id } from './_generated/dataModel';

const modules = import.meta.glob('./**/*.ts');
const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type TestBackend = TestConvex<typeof schema>;

async function seedBusiness(t: TestBackend, name: string, externalId: string) {
  return await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert('users', {
      name: `${name} Owner`,
      externalId,
      role: 'user',
    });
    const categoryId = await ctx.db.insert('categories', {
      name: 'Food & Drink',
      slug: `food-drink-${externalId}`,
      ordering: 1,
    });
    const businessId = await ctx.db.insert('businesses', {
      name,
      categoryId,
      description: '',
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
      searchText: `${name}  `,
      ownerId,
      lastUpdatedAt: NOW,
      isFeatured: false,
      lastSavedAt: NOW,
    });
    const menuGroupId = await ctx.db.insert('menuGroups', {
      businessId,
      name: 'Mains',
      ordering: 1,
    });
    const menuItemId = await ctx.db.insert('menuItems', {
      businessId,
      groupId: menuGroupId,
      name: 'House Bowl',
      customizationOptions: [],
      ordering: 1,
      isAvailable: true,
    });
    return { ownerId, categoryId, businessId, menuGroupId, menuItemId };
  });
}

interface OrderSeed {
  status: Doc<'orders'>['status'];
  createdAt?: number;
  /** Omitted on purpose for the legacy fall-back case. */
  statusUpdatedAt?: number;
}

async function insertOrder(t: TestBackend, businessId: Id<'businesses'>, seed: OrderSeed) {
  return await t.run((ctx) =>
    ctx.db.insert('orders', {
      businessId,
      customerName: 'Ada Customer',
      status: seed.status,
      createdAt: seed.createdAt ?? NOW,
      ...(seed.statusUpdatedAt === undefined ? {} : { statusUpdatedAt: seed.statusUpdatedAt }),
    })
  );
}

/**
 * One row in each of the five companion tables. `orderFlags` and `orderAccess`
 * carry the business so a cross-business leak would be visible.
 */
async function seedCompanions(
  t: TestBackend,
  seed: { orderId: Id<'orders'>; businessId: Id<'businesses'>; ownerId: Id<'users'> }
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('orderEvents', {
      orderId: seed.orderId,
      businessId: seed.businessId,
      actorType: 'customer',
      action: 'submitted',
      toStatus: 'new',
      createdAt: NOW - DAY_MS,
    });
    await ctx.db.insert('orderFlags', {
      businessId: seed.businessId,
      orderId: seed.orderId,
      actorUserId: seed.ownerId,
      active: true,
      createdAt: NOW - DAY_MS,
    });
    await ctx.db.insert('orderAccess', {
      orderId: seed.orderId,
      businessId: seed.businessId,
      accessToken: `token-${seed.orderId}`,
      reference: 'ABC234',
      createdAt: NOW - DAY_MS,
    });
    await ctx.db.insert('orderIdempotency', {
      businessId: seed.businessId,
      key: `key-${seed.orderId}`,
      argsHash: 'a'.repeat(64),
      orderId: seed.orderId,
      createdAt: NOW - DAY_MS,
    });
    await ctx.db.insert('orderExpiry', {
      orderId: seed.orderId,
      businessId: seed.businessId,
      expiresAt: NOW - DAY_MS,
    });
  });
}

/** The non-order rows a retention run must never touch. */
async function seedBystanders(
  t: TestBackend,
  seed: {
    businessId: Id<'businesses'>;
    ownerId: Id<'users'>;
    label: string;
  }
) {
  await t.run(async (ctx) => {
    await ctx.db.insert('notifications', {
      userId: seed.ownerId,
      type: 'order_placed',
      businessId: seed.businessId,
      message: `New order for "${seed.label}".`,
      createdAt: NOW - DAY_MS,
    });
    await ctx.db.insert('orderThrottle', {
      key: `business:${seed.businessId}:10m`,
      windowStart: NOW - DAY_MS,
      count: 1,
    });
    await ctx.db.insert('orderBlocks', {
      businessId: seed.businessId,
      contactHash: `hash-${seed.label}`,
      createdByUserId: seed.ownerId,
      createdAt: NOW - DAY_MS,
    });
    await ctx.db.insert('orderMetricCounters', {
      businessId: seed.businessId,
      code: 'throttle_rejected',
      value: 1,
    });
    await ctx.db.insert('auditLogs', {
      actorUserId: seed.ownerId,
      action: 'flag_order',
      targetType: 'order',
      targetId: 'order_reference',
      createdAt: NOW - DAY_MS,
    });
  });
}

function orderRows(t: TestBackend, orderId: Id<'orders'>) {
  return t.run(async (ctx) => ({
    order: await ctx.db.get(orderId),
    orderEvents: (
      await ctx.db
        .query('orderEvents')
        .withIndex('byOrderIdCreatedAt', (q) => q.eq('orderId', orderId))
        .collect()
    ).length,
    orderFlags: (
      await ctx.db
        .query('orderFlags')
        .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
        .collect()
    ).length,
    orderAccess: (
      await ctx.db
        .query('orderAccess')
        .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
        .collect()
    ).length,
    orderIdempotency: (await ctx.db.query('orderIdempotency').collect()).filter(
      (row) => row.orderId === orderId
    ).length,
    orderExpiry: (
      await ctx.db
        .query('orderExpiry')
        .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
        .collect()
    ).length,
  }));
}

function tableCounts(t: TestBackend) {
  return t.run(async (ctx) => ({
    orders: (await ctx.db.query('orders').collect()).length,
    orderEvents: (await ctx.db.query('orderEvents').collect()).length,
    orderFlags: (await ctx.db.query('orderFlags').collect()).length,
    orderAccess: (await ctx.db.query('orderAccess').collect()).length,
    orderIdempotency: (await ctx.db.query('orderIdempotency').collect()).length,
    orderExpiry: (await ctx.db.query('orderExpiry').collect()).length,
    notifications: (await ctx.db.query('notifications').collect()).length,
    orderThrottle: (await ctx.db.query('orderThrottle').collect()).length,
    orderBlocks: (await ctx.db.query('orderBlocks').collect()).length,
    orderMetricCounters: (await ctx.db.query('orderMetricCounters').collect()).length,
    auditLogs: (await ctx.db.query('auditLogs').collect()).length,
    businesses: (await ctx.db.query('businesses').collect()).length,
    menuItems: (await ctx.db.query('menuItems').collect()).length,
  }));
}

// ---------------------------------------------------------------------------
// AC-14.4 — dry run (the safe default) performs no writes.
// ---------------------------------------------------------------------------

test('dry run is the default: it reports eligible orders and deletes nothing', async () => {
  const t = convexTest(schema, modules);
  const { businessId, ownerId } = await seedBusiness(t, 'Blue Harbor Diner', 'user_owner');
  const orderId = await insertOrder(t, businessId, {
    status: 'declined',
    statusUpdatedAt: NOW - RETENTION_TERMINAL_DAYS_MS - 1,
  });
  await seedCompanions(t, { orderId, businessId, ownerId });
  const before = await tableCounts(t);

  const summary = await t.mutation(internal.orderRetention.purgeRetainedOrders, {});

  expect(summary).toEqual({
    dryRun: true,
    scanned: 1,
    eligible: 1,
    deleted: 0,
    companions: {
      orderEvents: 0,
      orderFlags: 0,
      orderAccess: 0,
      orderIdempotency: 0,
      orderExpiry: 0,
    },
  });
  expect(await tableCounts(t)).toEqual(before);
});

// ---------------------------------------------------------------------------
// AC-14.3/AC-14.4 — wet run deletes the order and exactly its five companions.
// ---------------------------------------------------------------------------

test('wet run deletes the in-scope order and exactly its five companion kinds', async () => {
  const t = convexTest(schema, modules);
  const diner = await seedBusiness(t, 'Blue Harbor Diner', 'user_owner');
  const other = await seedBusiness(t, 'Second Business', 'user_other');

  const orderId = await insertOrder(t, diner.businessId, {
    status: 'declined',
    statusUpdatedAt: NOW - RETENTION_TERMINAL_DAYS_MS - 1,
  });
  await seedCompanions(t, { orderId, businessId: diner.businessId, ownerId: diner.ownerId });
  const otherOrderId = await insertOrder(t, other.businessId, {
    status: 'declined',
    statusUpdatedAt: NOW - RETENTION_TERMINAL_DAYS_MS - 1,
  });
  await seedCompanions(t, {
    orderId: otherOrderId,
    businessId: other.businessId,
    ownerId: other.ownerId,
  });

  await seedBystanders(t, {
    businessId: diner.businessId,
    ownerId: diner.ownerId,
    label: 'Blue Harbor Diner',
  });
  const before = await tableCounts(t);

  const summary = await t.mutation(internal.orderRetention.purgeRetainedOrders, {
    dryRun: false,
  });

  // Both businesses' orders are in scope; each is deleted with its own rows.
  expect(summary).toEqual({
    dryRun: false,
    scanned: 2,
    eligible: 2,
    deleted: 2,
    companions: {
      orderEvents: 2,
      orderFlags: 2,
      orderAccess: 2,
      orderIdempotency: 2,
      orderExpiry: 2,
    },
  });

  const after = await tableCounts(t);
  expect(after.orders).toBe(before.orders - 2);
  expect(after.orderEvents).toBe(before.orderEvents - 2);
  expect(after.orderFlags).toBe(before.orderFlags - 2);
  expect(after.orderAccess).toBe(before.orderAccess - 2);
  expect(after.orderIdempotency).toBe(before.orderIdempotency - 2);
  expect(after.orderExpiry).toBe(before.orderExpiry - 2);
  // Nothing outside the per-order set moves: business aggregates and history stay.
  expect(after.notifications).toBe(before.notifications);
  expect(after.orderThrottle).toBe(before.orderThrottle);
  expect(after.orderBlocks).toBe(before.orderBlocks);
  expect(after.orderMetricCounters).toBe(before.orderMetricCounters);
  expect(after.auditLogs).toBe(before.auditLogs);
  expect(after.businesses).toBe(before.businesses);
  expect(after.menuItems).toBe(before.menuItems);
});

test('an in-scope order with no companion rows is deleted and reports zero counts', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t, 'Blue Harbor Diner', 'user_owner');
  const orderId = await insertOrder(t, businessId, {
    status: 'cancelled',
    statusUpdatedAt: NOW - RETENTION_TERMINAL_DAYS_MS - 1,
  });

  const summary = await t.mutation(internal.orderRetention.purgeRetainedOrders, {
    dryRun: false,
  });

  expect(summary.deleted).toBe(1);
  expect(summary.companions).toEqual({
    orderEvents: 0,
    orderFlags: 0,
    orderAccess: 0,
    orderIdempotency: 0,
    orderExpiry: 0,
  });
  expect(await t.run((ctx) => ctx.db.get(orderId))).toBeNull();
});

// ---------------------------------------------------------------------------
// AC-14.2 — window per terminal status, measured from `statusUpdatedAt`.
// ---------------------------------------------------------------------------

test('completed orders under 365 days survive; at and over 365 days are deleted', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t, 'Blue Harbor Diner', 'user_owner');

  const under = await insertOrder(t, businessId, {
    status: 'completed',
    statusUpdatedAt: NOW - (RETENTION_COMPLETED_DAYS_MS - 1),
  });
  const boundary = await insertOrder(t, businessId, {
    status: 'completed',
    statusUpdatedAt: NOW - RETENTION_COMPLETED_DAYS_MS,
  });
  const over = await insertOrder(t, businessId, {
    status: 'completed',
    statusUpdatedAt: NOW - RETENTION_COMPLETED_DAYS_MS - 1,
  });

  const summary = await t.mutation(internal.orderRetention.purgeRetainedOrders, {
    dryRun: false,
  });

  expect(summary).toMatchObject({ scanned: 3, eligible: 2, deleted: 2 });
  expect(await t.run((ctx) => ctx.db.get(under))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get(boundary))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(over))).toBeNull();
});

test('terminal window boundary: exactly 90 days is in scope, one millisecond short is not', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t, 'Blue Harbor Diner', 'user_owner');

  const boundary = await insertOrder(t, businessId, {
    status: 'expired',
    statusUpdatedAt: NOW - RETENTION_TERMINAL_DAYS_MS,
  });
  const short = await insertOrder(t, businessId, {
    status: 'no_show',
    statusUpdatedAt: NOW - (RETENTION_TERMINAL_DAYS_MS - 1),
  });

  const summary = await t.mutation(internal.orderRetention.purgeRetainedOrders, {
    dryRun: false,
  });

  expect(summary).toMatchObject({ scanned: 2, eligible: 1, deleted: 1 });
  expect(await t.run((ctx) => ctx.db.get(boundary))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(short))).not.toBeNull();
});

test('every non-terminal status survives at any age', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t, 'Blue Harbor Diner', 'user_owner');
  const ancient = NOW - RETENTION_COMPLETED_DAYS_MS - 30 * DAY_MS;

  const live: Id<'orders'>[] = [];
  for (const status of ['new', 'accepted', 'ready'] as const) {
    live.push(
      await insertOrder(t, businessId, { status, createdAt: ancient, statusUpdatedAt: ancient })
    );
  }

  const summary = await t.mutation(internal.orderRetention.purgeRetainedOrders, {
    dryRun: false,
  });

  expect(summary).toMatchObject({ scanned: 3, eligible: 0, deleted: 0 });
  for (const orderId of live) {
    expect(await t.run((ctx) => ctx.db.get(orderId))).not.toBeNull();
  }
});

test('statusUpdatedAt is authoritative: an old order just declined survives', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t, 'Blue Harbor Diner', 'user_owner');
  const orderId = await insertOrder(t, businessId, {
    status: 'declined',
    createdAt: NOW - RETENTION_COMPLETED_DAYS_MS - DAY_MS,
    statusUpdatedAt: NOW - DAY_MS,
  });

  const summary = await t.mutation(internal.orderRetention.purgeRetainedOrders, {
    dryRun: false,
  });

  expect(summary).toMatchObject({ scanned: 1, eligible: 0, deleted: 0 });
  expect(await t.run((ctx) => ctx.db.get(orderId))).not.toBeNull();
});

test('legacy rows without statusUpdatedAt fall back to createdAt', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t, 'Blue Harbor Diner', 'user_owner');
  const legacy = await insertOrder(t, businessId, {
    status: 'cancelled',
    createdAt: NOW - RETENTION_TERMINAL_DAYS_MS - 1,
  });

  const summary = await t.mutation(internal.orderRetention.purgeRetainedOrders, {
    dryRun: false,
  });

  expect(summary).toMatchObject({ scanned: 1, eligible: 1, deleted: 1 });
  expect(await t.run((ctx) => ctx.db.get(legacy))).toBeNull();
});

// ---------------------------------------------------------------------------
// AC-14.7 — cross-business isolation and the OQ-7 notifications assertion.
// ---------------------------------------------------------------------------

test("another business's identical-age order and its rows are never collateral", async () => {
  const t = convexTest(schema, modules);
  const diner = await seedBusiness(t, 'Blue Harbor Diner', 'user_owner');
  const other = await seedBusiness(t, 'Second Business', 'user_other');
  const identicalAge = NOW - RETENTION_COMPLETED_DAYS_MS - 30 * DAY_MS;

  const purged = await insertOrder(t, diner.businessId, {
    status: 'declined',
    createdAt: identicalAge,
    statusUpdatedAt: NOW - RETENTION_TERMINAL_DAYS_MS - 1,
  });
  await seedCompanions(t, {
    orderId: purged,
    businessId: diner.businessId,
    ownerId: diner.ownerId,
  });

  // Same age, same business neighbourhood, but not in a terminal state.
  const survives = await insertOrder(t, other.businessId, {
    status: 'new',
    createdAt: identicalAge,
    statusUpdatedAt: identicalAge,
  });
  await seedCompanions(t, {
    orderId: survives,
    businessId: other.businessId,
    ownerId: other.ownerId,
  });
  await seedBystanders(t, {
    businessId: other.businessId,
    ownerId: other.ownerId,
    label: 'Second Business',
  });

  await t.mutation(internal.orderRetention.purgeRetainedOrders, { dryRun: false });

  expect(await t.run((ctx) => ctx.db.get(purged))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(survives))).not.toBeNull();
  const otherRows = await orderRows(t, survives);
  expect(otherRows).toMatchObject({
    orderEvents: 1,
    orderFlags: 1,
    orderAccess: 1,
    orderIdempotency: 1,
    orderExpiry: 1,
  });
});

test('notifications survive retention: order notices are business history (OQ-7)', async () => {
  const t = convexTest(schema, modules);
  const { businessId, ownerId } = await seedBusiness(t, 'Blue Harbor Diner', 'user_owner');
  const orderId = await insertOrder(t, businessId, {
    status: 'declined',
    statusUpdatedAt: NOW - RETENTION_TERMINAL_DAYS_MS - 1,
  });

  const notificationId = await t.run((ctx) =>
    ctx.db.insert('notifications', {
      userId: ownerId,
      type: 'order_cancelled',
      businessId,
      message: 'Order for "Blue Harbor Diner" was declined.',
      createdAt: NOW - DAY_MS,
    })
  );

  await t.mutation(internal.orderRetention.purgeRetainedOrders, { dryRun: false });

  expect(await t.run((ctx) => ctx.db.get(orderId))).toBeNull();
  const notification = await t.run((ctx) => ctx.db.get(notificationId));
  expect(notification).not.toBeNull();
  expect(notification?.businessId).toBe(businessId);
});

// ---------------------------------------------------------------------------
// AC-14.1 — the run is bounded by RETENTION_BATCH and drains over runs.
// ---------------------------------------------------------------------------

test('one run is bounded to RETENTION_BATCH orders and the backlog drains next run', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t, 'Blue Harbor Diner', 'user_owner');
  const total = RETENTION_BATCH + 2;

  const orderIds = await t.run(async (ctx) => {
    const ids: Id<'orders'>[] = [];
    for (let i = 0; i < total; i += 1) {
      ids.push(
        await ctx.db.insert('orders', {
          businessId,
          customerName: 'Ada Customer',
          status: 'declined',
          createdAt: NOW - RETENTION_TERMINAL_DAYS_MS - 1,
          statusUpdatedAt: NOW - RETENTION_TERMINAL_DAYS_MS - 1,
        })
      );
    }
    return ids;
  });

  const first = await t.mutation(internal.orderRetention.purgeRetainedOrders, {
    dryRun: false,
  });
  expect(first).toMatchObject({
    scanned: RETENTION_BATCH,
    eligible: RETENTION_BATCH,
    deleted: RETENTION_BATCH,
  });
  expect((await tableCounts(t)).orders).toBe(total - RETENTION_BATCH);

  const second = await t.mutation(internal.orderRetention.purgeRetainedOrders, {
    dryRun: false,
  });
  expect(second).toMatchObject({ scanned: 2, eligible: 2, deleted: 2 });
  expect((await tableCounts(t)).orders).toBe(0);

  // Pin the survivor count directly so a partially deleted row cannot hide.
  const survivors = await t.run(async (ctx) => {
    let count = 0;
    for (const orderId of orderIds) {
      if ((await ctx.db.get(orderId)) !== null) count += 1;
    }
    return count;
  });
  expect(survivors).toBe(0);
});

// ---------------------------------------------------------------------------
// AC-14.5 — registration record (cron jobs do not run under `convex-test`).
// ---------------------------------------------------------------------------

test('the retention cron is registered daily and drives the wet path', () => {
  const job = crons.crons['purge retained orders'];
  expect(job).toBeDefined();
  expect(job.schedule).toEqual({ type: 'daily', hourUTC: 5, minuteUTC: 0 });
  expect(job.name).toMatch(/purgeRetainedOrders$/);
  expect(job.args).toEqual([{ dryRun: false }]);
});

test('the retention mutation is internal: it is not on the public api surface', () => {
  expect('orderRetention' in api).toBe(false);
  expect(internal.orderRetention.purgeRetainedOrders).toBeDefined();
});
