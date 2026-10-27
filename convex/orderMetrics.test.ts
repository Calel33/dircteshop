/// <reference types="vite/client" />
/**
 * Order metrics suite (issue #84, T10 / Phase 3).
 *
 * Covers the order metric counters (plan D4/D7, research design A): the
 * `bumpMetricCounter` leaf helper and the public `orderMetrics` mutations that
 * are their ONLY writers — `recordOrderRejection` (Task 5) and
 * `recordReceiptView` (Task 6). A rejection cannot be counted where it happens
 * — a throwing mutation rolls its writes back — so the client reports it
 * through a mutation of its own.
 *
 * Counter state is read straight from `orderMetricCounters`; nothing here mocks
 * the database or the handlers.
 *
 * The owner `overview` query (Tasks 7-8) belongs here too.
 *
 * `now` is deterministic: only `Date` is faked (as in `convex/orders.test.ts`),
 * so `convex-test`'s async plumbing keeps a real `setTimeout`.
 *
 * Run: pnpm exec vitest run convex/orderMetrics.test.ts
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import type { TestConvex } from 'convex-test';

import schema from './schema';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { bumpMetricCounter, clampMetricCounter } from './metricCounter';
import { REJECTION_CODES } from './orderCommitPolicy';
import {
  BASKET_LINE_COUNT_BUCKETS,
  BASKET_SUBTOTAL_BUCKETS,
  BASKET_UNIT_COUNT_BUCKETS,
  METRICS_DEFAULT_WINDOW_DAYS,
  METRICS_MAX_WINDOW_DAYS,
  METRICS_MIN_WINDOW_DAYS,
  RECEIPT_VIEW_CODE,
} from './orderMetrics';

const modules = import.meta.glob('./**/*.ts');

// Tue 2023-11-14 22:13:20 UTC = 17:13 in America/New_York, inside the seeded
// Tuesday 09:00-22:00 window — the same clock `convex/orderBlocks.test.ts` uses.
const NOW = 1_700_000_000_000;

const RAW_PHONE = '(555) 010-0100';
const RAW_EMAIL = 'ada@example.com';

// D13/Q4: pin `Date` only. `setTimeout` stays real so `convex-test`'s async
// plumbing cannot stall.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type TestBackend = TestConvex<typeof schema>;

async function insertBusiness(
  ctx: MutationCtx,
  args: { ownerId: Id<'users'>; categoryId: Id<'categories'>; name: string }
): Promise<Id<'businesses'>> {
  return await ctx.db.insert('businesses', {
    name: args.name,
    categoryId: args.categoryId,
    description: '',
    address: { addressLine1: '', city: '', state: '', country: '' },
    timezone: 'America/New_York',
    photos: [],
    hours: { tuesday: [{ opensAt: '09:00', closesAt: '22:00' }] },
    status: 'approved',
    verification: { isVerified: false },
    rating: 0,
    ratingCount: 0,
    services: [],
    credentials: [],
    keywords: [],
    searchText: args.name,
    ownerId: args.ownerId,
    lastUpdatedAt: NOW,
    isFeatured: false,
    lastSavedAt: NOW,
    orderProtocol: 'basket',
  });
}

/**
 * Two approved basket businesses (each with its own priced item) so the
 * per-business keying of a counter is observable.
 */
async function seed(t: TestBackend) {
  return await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert('users', {
      name: 'Maya Owner',
      externalId: 'user_metrics_owner',
      role: 'user',
    });
    const categoryId = await ctx.db.insert('categories', {
      name: 'Restaurants',
      slug: 'restaurants',
      ordering: 1,
    });
    const businessId = await insertBusiness(ctx, {
      ownerId,
      categoryId,
      name: 'Metrics Diner',
    });
    const otherBusinessId = await insertBusiness(ctx, {
      ownerId,
      categoryId,
      name: 'Other Metrics Diner',
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
      customizationOptions: [],
      ordering: 0,
      isAvailable: true,
    });
    const otherMenuItemId = await ctx.db.insert('menuItems', {
      businessId: otherBusinessId,
      groupId: otherGroupId,
      name: 'Grain Bowl',
      price: 1200,
      customizationOptions: [],
      ordering: 0,
      isAvailable: true,
    });

    return { businessId, otherBusinessId, menuItemId, otherMenuItemId };
  });
}

/** A valid two-unit basket on the 1200-cent bowl: subtotal 2400. */
function basketArgs(businessId: Id<'businesses'>, menuItemId: Id<'menuItems'>) {
  return {
    businessId,
    lines: [{ menuItemId, quantity: 2 }],
    customerName: 'Ada Lovelace',
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
    expectedSubtotal: 2400,
    idempotencyKey: 'order-metrics-default',
  };
}

function counterRows(t: TestBackend): Promise<Doc<'orderMetricCounters'>[]> {
  return t.run((ctx) => ctx.db.query('orderMetricCounters').collect());
}

async function readCounter(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  code: string
): Promise<number | undefined> {
  const row = await ctx.db
    .query('orderMetricCounters')
    .withIndex('byBusinessIdCode', (q) => q.eq('businessId', businessId).eq('code', code))
    .first();
  return row?.value;
}

/** `null` when the pair has no row: a `t.run` result never carries `undefined`. */
async function counterValue(
  t: TestBackend,
  businessId: Id<'businesses'>,
  code: string
): Promise<number | null> {
  const value = await t.run((ctx) => readCounter(ctx, businessId, code));
  return value ?? null;
}

/** The one token a single `placeOrder` mints, read from `orderAccess`. */
async function receiptToken(t: TestBackend): Promise<string> {
  const access = await t.run((ctx) => ctx.db.query('orderAccess').first());
  if (access === null) {
    throw new Error('expected placeOrder to mint an orderAccess row');
  }
  return access.accessToken;
}

// ---------------------------------------------------------------------------
// The closed code list
// ---------------------------------------------------------------------------

test('REJECTION_CODES is the closed six-value list the counters are keyed by', () => {
  expect([...REJECTION_CODES]).toEqual([
    'throttle_rejected',
    'block_hit',
    'price_changed',
    'item_unavailable',
    'ordering_closed',
    'outside_hours',
  ]);
});

// ---------------------------------------------------------------------------
// bumpMetricCounter: bounded upsert with a zero floor
// ---------------------------------------------------------------------------

test('clampMetricCounter keeps a counter at or above zero', () => {
  expect(clampMetricCounter(0, 1)).toBe(1);
  expect(clampMetricCounter(4, 3)).toBe(7);
  expect(clampMetricCounter(4, -3)).toBe(1);
  expect(clampMetricCounter(0, -1)).toBe(0);
  expect(clampMetricCounter(0, 0)).toBe(0);
});

test('bumpMetricCounter inserts on first use, patches one row, and never writes below zero', async () => {
  // Canary: a silent fake-Date no-op would make every NOW assertion meaningless.
  expect(Date.now()).toBe(NOW);

  const t = convexTest(schema, modules);
  const f = await seed(t);

  await t.run(async (ctx) => {
    // First use inserts the pair; later bumps patch the same row.
    await bumpMetricCounter(ctx, f.businessId, 'receipt_viewed');
    expect(await readCounter(ctx, f.businessId, 'receipt_viewed')).toBe(1);

    await bumpMetricCounter(ctx, f.businessId, 'receipt_viewed', 2);
    expect(await readCounter(ctx, f.businessId, 'receipt_viewed')).toBe(3);

    await bumpMetricCounter(ctx, f.businessId, 'receipt_viewed', -2);
    expect(await readCounter(ctx, f.businessId, 'receipt_viewed')).toBe(1);

    // A decrement that would cross the floor clamps at zero, never negative.
    await bumpMetricCounter(ctx, f.businessId, 'receipt_viewed', -10);
    expect(await readCounter(ctx, f.businessId, 'receipt_viewed')).toBe(0);

    // A first-use decrement creates no row at all (a permanent 0 is noise).
    await bumpMetricCounter(ctx, f.businessId, 'never_used', -1);
  });

  const rows = await counterRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0].code).toBe('receipt_viewed');
  expect(rows[0].value).toBe(0);
});

// ---------------------------------------------------------------------------
// recordOrderRejection: anonymous, closed list, no dedupe
// ---------------------------------------------------------------------------

test('recordOrderRejection counts a valid code and counts a repeat again', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  // No identity is presented: the rejection paths this measures include
  // anonymous throttled customers, so the mutation is anonymous by design.
  await t.mutation(api.orderMetrics.recordOrderRejection, {
    businessId: f.businessId,
    code: 'throttle_rejected',
  });
  expect(await counterValue(t, f.businessId, 'throttle_rejected')).toBe(1);

  // No dedupe, by design: a second report is a second rejected attempt. The
  // server has no caller identity to key a dedupe on (anonymous surface), so
  // "exactly once per failed attempt" is the client's ref guard, and this
  // counter stays an aggregate.
  await t.mutation(api.orderMetrics.recordOrderRejection, {
    businessId: f.businessId,
    code: 'throttle_rejected',
  });
  expect(await counterValue(t, f.businessId, 'throttle_rejected')).toBe(2);
});

test('recordOrderRejection keeps each code in its own row and each business separate', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  for (const code of REJECTION_CODES) {
    await t.mutation(api.orderMetrics.recordOrderRejection, {
      businessId: f.businessId,
      code,
    });
  }

  const rows = await counterRows(t);
  expect(rows).toHaveLength(REJECTION_CODES.length);
  expect(rows.map((row) => row.code).sort()).toEqual([...REJECTION_CODES].sort());
  // No cross-contamination: one report per code leaves every code at exactly 1.
  for (const row of rows) {
    expect(row.value).toBe(1);
  }
  // Keyed by business: the second business was never reported against.
  expect(await counterValue(t, f.otherBusinessId, 'throttle_rejected')).toBeNull();
});

test('recordOrderRejection succeeds without writing for an out-of-list code', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  // Resolves rather than throwing: this is a fire-and-forget beacon, and a
  // thrown error would surface in the customer's browser.
  await expect(
    t.mutation(api.orderMetrics.recordOrderRejection, {
      businessId: f.businessId,
      code: 'NOT_A_REJECTION',
    })
  ).resolves.toBeNull();

  expect(await counterRows(t)).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// The success path reports nothing
// ---------------------------------------------------------------------------

test('a successful placeOrder records no rejection counter', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  await t.mutation(api.orders.placeOrder, basketArgs(f.businessId, f.menuItemId));

  // The order really committed ...
  const orders = await t.run((ctx) => ctx.db.query('orders').collect());
  expect(orders).toHaveLength(1);
  // ... and the success path bumped nothing.
  expect(await counterRows(t)).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// recordReceiptView: anonymous, never throws, counts committed views
// ---------------------------------------------------------------------------

test('RECEIPT_VIEW_CODE is a metric key, not a rejection code', () => {
  expect(RECEIPT_VIEW_CODE).toBe('receipt_viewed');
  // The rejection list is the client-mapped error vocabulary the runbook cites
  // as rejections; a receipt view is not a rejected attempt and must not join it.
  expect(REJECTION_CODES).not.toContain(RECEIPT_VIEW_CODE);
});

test('recordReceiptView misses an unknown token without writing', async () => {
  const t = convexTest(schema, modules);
  await seed(t);

  // Resolves rather than throwing: the beacon is fire-and-forget from
  // `ReceiptLive`, so a thrown mutation would be an unhandled browser rejection.
  await expect(
    t.mutation(api.orderMetrics.recordReceiptView, { token: 'not-a-real-token' })
  ).resolves.toEqual({ recorded: false });

  expect(await counterRows(t)).toHaveLength(0);
});

test('recordReceiptView counts a view for the order business and counts a repeat again', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  await t.mutation(api.orders.placeOrder, basketArgs(f.businessId, f.menuItemId));
  const token = await receiptToken(t);

  await expect(t.mutation(api.orderMetrics.recordReceiptView, { token })).resolves.toEqual({
    recorded: true,
  });
  expect(await counterValue(t, f.businessId, RECEIPT_VIEW_CODE)).toBe(1);
  // Keyed by the order's business, never the other seeded one.
  expect(await counterValue(t, f.otherBusinessId, RECEIPT_VIEW_CODE)).toBeNull();

  // No server-side dedupe, by design: "once per tab" is the `ReceiptLive` ref
  // guard alone. This anonymous capability surface has no caller identity to
  // key a dedupe on, so the counter stays an aggregate of views.
  await expect(t.mutation(api.orderMetrics.recordReceiptView, { token })).resolves.toEqual({
    recorded: true,
  });
  expect(await counterValue(t, f.businessId, RECEIPT_VIEW_CODE)).toBe(2);
});

test('recordReceiptView treats an access row scoped to another business as not found', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  await t.mutation(api.orders.placeOrder, basketArgs(f.businessId, f.menuItemId));

  // Forge the one state a minted token cannot produce: an access row whose
  // business disagrees with the order it points at (INV-06 scope mismatch).
  await t.run(async (ctx) => {
    const access = await ctx.db.query('orderAccess').first();
    if (access === null) {
      throw new Error('expected placeOrder to mint an orderAccess row');
    }
    await ctx.db.patch(access._id, { businessId: f.otherBusinessId });
  });

  const token = await receiptToken(t);
  await expect(t.mutation(api.orderMetrics.recordReceiptView, { token })).resolves.toEqual({
    recorded: false,
  });

  // Neither side was credited.
  expect(await counterRows(t)).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// overview: seeded aggregates, latency pairing, window scope, owner authz
// (issue #84, plan Task 8). Every fixture is a `t.run` insert; no handler mock.
// ---------------------------------------------------------------------------

describe('overview (owner-facing order metrics)', () => {
  const DAY_MS = 24 * 60 * 60_000;
  const OWNER = 'user_metrics_owner';

  function asOwner(t: TestBackend, subject: string) {
    return t.withIdentity({ subject });
  }

  /**
   * Asserts the guard's own refusal shape — a plain `Error` from `authz.ts`
   * with the exact message — and that the rejected call returned no payload.
   */
  async function expectRefused(
    promise: Promise<unknown>,
    message: 'Unauthorized' | 'Forbidden'
  ): Promise<void> {
    let returned: unknown;
    let thrown: unknown;
    try {
      returned = await promise;
    } catch (error) {
      thrown = error;
    }
    expect(returned).toBeUndefined();
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(message);
  }

  async function ownerUserId(ctx: MutationCtx): Promise<Id<'users'>> {
    const owner = await ctx.db
      .query('users')
      .withIndex('byExternalId', (q) => q.eq('externalId', OWNER))
      .unique();
    if (owner === null) {
      throw new Error(`expected the seeded ${OWNER} row`);
    }
    return owner._id;
  }

  /**
   * One seeded order. `quantities` omit = a legacy single-item row (no
   * snapshot, derivable as one line and one unit); absent `subtotal` = unpriced.
   */
  async function insertOrder(
    ctx: MutationCtx,
    args: {
      businessId: Id<'businesses'>;
      menuItemId: Id<'menuItems'>;
      createdAt: number;
      status: Doc<'orders'>['status'];
      quantities?: readonly number[];
      subtotal?: number;
    }
  ): Promise<Id<'orders'>> {
    return await ctx.db.insert('orders', {
      businessId: args.businessId,
      customerName: 'Ada Lovelace',
      status: args.status,
      createdAt: args.createdAt,
      ...(args.quantities === undefined
        ? { menuItemId: args.menuItemId }
        : {
            items: args.quantities.map((quantity) => ({
              menuItemId: args.menuItemId,
              name: 'Grain Bowl',
              quantity,
              selections: [] as { optionName: string; choiceName: string }[],
            })),
          }),
      ...(args.subtotal === undefined ? {} : { subtotal: args.subtotal }),
    });
  }

  async function insertEvent(
    ctx: MutationCtx,
    args: {
      businessId: Id<'businesses'>;
      orderId: Id<'orders'>;
      action: Doc<'orderEvents'>['action'];
      actorType: Doc<'orderEvents'>['actorType'];
      createdAt: number;
      reason?: string;
    }
  ): Promise<void> {
    await ctx.db.insert('orderEvents', {
      businessId: args.businessId,
      orderId: args.orderId,
      action: args.action,
      actorType: args.actorType,
      toStatus: args.action,
      createdAt: args.createdAt,
      ...(args.reason === undefined ? {} : { reason: args.reason }),
    });
  }

  async function insertCounter(
    ctx: MutationCtx,
    businessId: Id<'businesses'>,
    code: string,
    value: number
  ): Promise<void> {
    await ctx.db.insert('orderMetricCounters', { businessId, code, value });
  }

  async function insertFlag(
    ctx: MutationCtx,
    args: {
      businessId: Id<'businesses'>;
      orderId: Id<'orders'>;
      actorUserId: Id<'users'>;
      active: boolean;
      createdAt: number;
    }
  ): Promise<void> {
    await ctx.db.insert('orderFlags', args);
  }

  /** Expected distribution in the exported bucket order, zeros included. */
  function distribution(
    buckets: readonly { key: string }[],
    counts: Record<string, number>
  ): { key: string; count: number }[] {
    return buckets.map((bucket) => ({ key: bucket.key, count: counts[bucket.key] ?? 0 }));
  }

  test('reports exact aggregates for a seeded window', async () => {
    // Canary: a silent fake-Date no-op would make every window assertion hollow.
    expect(Date.now()).toBe(NOW);

    const t = convexTest(schema, modules);
    const f = await seed(t);

    await t.run(async (ctx) => {
      const ownerId = await ownerUserId(ctx);
      const base = { businessId: f.businessId, menuItemId: f.menuItemId };

      // Ten in-window orders: multi-line, legacy single-item, priced, unpriced,
      // so every distribution bucket is exercised (and several stay at zero).
      const a = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 10 * DAY_MS,
        status: 'accepted',
        quantities: [1],
        subtotal: 900,
      });
      const b = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 9 * DAY_MS,
        status: 'accepted',
        quantities: [2],
        subtotal: 2400,
      });
      const c = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 8 * DAY_MS,
        status: 'accepted',
        quantities: [1, 1],
        subtotal: 3000,
      });
      // submitted and accepted carry the identical createdAt (pairing edge).
      const d = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 7 * DAY_MS,
        status: 'accepted',
        quantities: [2, 2],
        subtotal: 6000,
      });
      const e = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 6 * DAY_MS,
        status: 'declined',
        quantities: [1, 1, 1],
        subtotal: 2500,
      });
      const fOrder = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 5 * DAY_MS,
        status: 'declined',
        quantities: [5],
      });
      const g = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 4 * DAY_MS,
        status: 'cancelled',
      });
      const h = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 3 * DAY_MS,
        status: 'cancelled',
        quantities: [2, 2, 2],
        subtotal: 4999,
      });
      const i = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 2 * DAY_MS,
        status: 'cancelled',
        quantities: [1, 1, 1, 1, 1],
        subtotal: 5000,
      });
      const j = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 1 * DAY_MS,
        status: 'accepted',
        quantities: [1, 1, 1, 1, 1, 1, 1],
        subtotal: 100,
      });

      // Four submit→accept pairs at 60s, 120s, 300s, 30s, plus the same-timestamp
      // pair at 0s: sorted samples [0, 30s, 60s, 120s, 300s] ->
      // p50 = rank 3 = 60s, p95 = rank 5 = 300s.
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: a,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 10 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: a,
        action: 'accepted',
        actorType: 'owner',
        createdAt: NOW - 10 * DAY_MS + 60_000,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: b,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 9 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: b,
        action: 'accepted',
        actorType: 'owner',
        createdAt: NOW - 9 * DAY_MS + 120_000,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: c,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 8 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: c,
        action: 'accepted',
        actorType: 'owner',
        createdAt: NOW - 8 * DAY_MS + 300_000,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: d,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 7 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: d,
        action: 'accepted',
        actorType: 'owner',
        createdAt: NOW - 7 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: j,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 1 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: j,
        action: 'accepted',
        actorType: 'owner',
        createdAt: NOW - 1 * DAY_MS + 30_000,
      });

      // Two declines: one reason code, one free-text "Other" reason that keeps
      // its own bucket (the query never maps it back to a code).
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: e,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 6 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: e,
        action: 'declined',
        actorType: 'owner',
        createdAt: NOW - 6 * DAY_MS + 10_000,
        reason: 'sold_out',
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: fOrder,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 5 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: fOrder,
        action: 'declined',
        actorType: 'owner',
        createdAt: NOW - 5 * DAY_MS + 10_000,
        reason: 'Kitchen is out of rice tonight',
      });

      // One cancellation per actor type, so the split is observable.
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: g,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 4 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: g,
        action: 'cancelled',
        actorType: 'customer',
        createdAt: NOW - 4 * DAY_MS + 10_000,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: h,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 3 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: h,
        action: 'cancelled',
        actorType: 'owner',
        createdAt: NOW - 3 * DAY_MS + 10_000,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: i,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 2 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: i,
        action: 'cancelled',
        actorType: 'system',
        createdAt: NOW - 2 * DAY_MS + 10_000,
      });

      // 10 submissions => 3/10*1000 = 300 and 2/10*1000 = 200 per thousand.
      await insertCounter(ctx, f.businessId, 'throttle_rejected', 3);
      await insertCounter(ctx, f.businessId, 'block_hit', 2);
      await insertCounter(ctx, f.businessId, 'price_changed', 1);
      await insertCounter(ctx, f.businessId, RECEIPT_VIEW_CODE, 4);

      // Two flag rows, only one still active: the metric is active-at-read only.
      await insertFlag(ctx, {
        businessId: f.businessId,
        orderId: a,
        actorUserId: ownerId,
        active: true,
        createdAt: NOW - 9 * DAY_MS,
      });
      await insertFlag(ctx, {
        businessId: f.businessId,
        orderId: b,
        actorUserId: ownerId,
        active: false,
        createdAt: NOW - 8 * DAY_MS,
      });
    });

    const overview = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
    });

    expect(overview.businessId).toEqual(f.businessId);
    expect(overview.windowDays).toBe(METRICS_DEFAULT_WINDOW_DAYS);
    expect(overview.windowEnd).toBe(NOW);
    expect(overview.windowStart).toBe(NOW - METRICS_DEFAULT_WINDOW_DAYS * DAY_MS);
    expect(overview.capped).toBe(false);

    // Ten `submitted` events are the denominator for every rate below.
    expect(overview.submissions).toBe(10);

    expect(overview.latency).toEqual({ sampleSize: 5, p50: 60_000, p95: 300_000 });

    expect(overview.declines.count).toBe(2);
    expect(overview.declines.rate).toBe(0.2);
    // Equal counts tie-break on the raw reason string, code-unit ascending.
    expect(overview.declines.reasonMix).toEqual([
      { reason: 'Kitchen is out of rice tonight', count: 1 },
      { reason: 'sold_out', count: 1 },
    ]);

    expect(overview.cancellations).toEqual({
      total: 3,
      byActorType: { customer: 1, owner: 1, system: 1 },
    });

    expect(overview.throttleHits).toEqual({ count: 3, perThousandSubmissions: 300 });
    expect(overview.blockHits).toEqual({ count: 2, perThousandSubmissions: 200 });

    expect(overview.ownerFlags).toEqual({ flaggedOrders: 1, abuseRate: 0.1 });

    expect(overview.receiptViews).toBe(4);

    expect(overview.basketSize.orderCount).toBe(10);
    expect(overview.basketSize.byLineCount).toEqual(
      distribution(BASKET_LINE_COUNT_BUCKETS, { '1': 4, '2': 2, '3-4': 2, '5+': 2, unknown: 0 })
    );
    expect(overview.basketSize.byUnitCount).toEqual(
      distribution(BASKET_UNIT_COUNT_BUCKETS, { '1': 2, '2-3': 3, '4-6': 4, '7+': 1, unknown: 0 })
    );
    expect(overview.basketSize.bySubtotalCents).toEqual(
      distribution(BASKET_SUBTOTAL_BUCKETS, {
        'lt-1000': 2,
        '1000-2499': 1,
        '2500-4999': 3,
        'gte-5000': 2,
        unpriced: 2,
      })
    );

    // Every closed code, in `REJECTION_CODES` order, zero counts included.
    expect(overview.rejectionRates.map((row) => row.code)).toEqual([...REJECTION_CODES]);
    expect(overview.rejectionRates).toEqual([
      { code: 'throttle_rejected', count: 3, perThousandSubmissions: 300 },
      { code: 'block_hit', count: 2, perThousandSubmissions: 200 },
      { code: 'price_changed', count: 1, perThousandSubmissions: 100 },
      { code: 'item_unavailable', count: 0, perThousandSubmissions: 0 },
      { code: 'ordering_closed', count: 0, perThousandSubmissions: 0 },
      { code: 'outside_hours', count: 0, perThousandSubmissions: 0 },
    ]);
  });

  test('reports null percentiles when the window holds no submit→accept pair', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await t.run(async (ctx) => {
      const orderId = await insertOrder(ctx, {
        businessId: f.businessId,
        menuItemId: f.menuItemId,
        createdAt: NOW - 2 * DAY_MS,
        status: 'new',
        quantities: [1],
        subtotal: 1200,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 2 * DAY_MS,
      });
    });

    const overview = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
    });

    expect(overview.latency.sampleSize).toBe(0);
    // `null`, never `0`: a zero would read as an instant acceptance.
    expect(overview.latency.p50).toBeNull();
    expect(overview.latency.p95).toBeNull();
  });

  test('counts a same-createdAt submit→accept pair once, at zero latency', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const pairedAt = NOW - DAY_MS;

    await t.run(async (ctx) => {
      const orderId = await insertOrder(ctx, {
        businessId: f.businessId,
        menuItemId: f.menuItemId,
        createdAt: pairedAt,
        status: 'accepted',
        quantities: [1],
        subtotal: 1200,
      });
      // Identical `createdAt`: the index's `_creationTime` tie-break has to keep
      // the submitted event first, or the accepted one would pair with nothing.
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId,
        action: 'submitted',
        actorType: 'customer',
        createdAt: pairedAt,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId,
        action: 'accepted',
        actorType: 'owner',
        createdAt: pairedAt,
      });
    });

    const overview = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
    });

    // Exactly one sample (not zero, not two) and a real zero — not `null`.
    expect(overview.latency).toEqual({ sampleSize: 1, p50: 0, p95: 0 });
  });

  test('ignores terminal-only events and an accepted with no in-window submitted', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await t.run(async (ctx) => {
      const base = { businessId: f.businessId, menuItemId: f.menuItemId };

      const completedOnly = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - DAY_MS,
        status: 'completed',
        quantities: [1],
        subtotal: 1200,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: completedOnly,
        action: 'completed',
        actorType: 'owner',
        createdAt: NOW - DAY_MS,
      });

      const declinedOnly = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 2 * DAY_MS,
        status: 'declined',
        quantities: [1],
        subtotal: 1200,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: declinedOnly,
        action: 'declined',
        actorType: 'owner',
        createdAt: NOW - 2 * DAY_MS,
        reason: 'sold_out',
      });

      // Accepted with no submitted at all: nothing to pair with, so ignored.
      const orphanAccepted = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 3 * DAY_MS,
        status: 'accepted',
        quantities: [1],
        subtotal: 1200,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: orphanAccepted,
        action: 'accepted',
        actorType: 'owner',
        createdAt: NOW - 3 * DAY_MS,
      });

      // Submitted outside the 30-day window, accepted inside: the read only
      // returns the accepted event, so it must not be counted as 0 latency.
      const outsideSubmitted = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 40 * DAY_MS,
        status: 'accepted',
        quantities: [1],
        subtotal: 1200,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: outsideSubmitted,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 40 * DAY_MS,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: outsideSubmitted,
        action: 'accepted',
        actorType: 'owner',
        createdAt: NOW - DAY_MS,
      });
    });

    const overview = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
    });

    expect(overview.submissions).toBe(0);
    expect(overview.latency).toEqual({ sampleSize: 0, p50: null, p95: null });
  });

  test('reports finite zeros, not NaN, when the window has zero submissions', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await t.run(async (ctx) => {
      const ownerId = await ownerUserId(ctx);
      const orderId = await insertOrder(ctx, {
        businessId: f.businessId,
        menuItemId: f.menuItemId,
        createdAt: NOW - DAY_MS,
        status: 'new',
        quantities: [2],
        subtotal: 2400,
      });
      // Raw counts still exist; only their denominators are zero.
      await insertCounter(ctx, f.businessId, 'throttle_rejected', 2);
      await insertCounter(ctx, f.businessId, 'block_hit', 1);
      await insertCounter(ctx, f.businessId, 'price_changed', 4);
      await insertCounter(ctx, f.businessId, RECEIPT_VIEW_CODE, 3);
      await insertFlag(ctx, {
        businessId: f.businessId,
        orderId,
        actorUserId: ownerId,
        active: true,
        createdAt: NOW - DAY_MS,
      });
      // Deliberately no `orderEvents`: submissions = 0.
    });

    const overview = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
    });

    expect(overview.submissions).toBe(0);
    expect(overview.declines).toEqual({ count: 0, rate: 0, reasonMix: [] });
    expect(overview.ownerFlags).toEqual({ flaggedOrders: 1, abuseRate: 0 });
    expect(overview.throttleHits).toEqual({ count: 2, perThousandSubmissions: 0 });
    expect(overview.blockHits).toEqual({ count: 1, perThousandSubmissions: 0 });
    expect(overview.rejectionRates.map((row) => row.count)).toEqual([2, 1, 4, 0, 0, 0]);

    const rates = [
      overview.declines.rate,
      overview.ownerFlags.abuseRate,
      overview.throttleHits.perThousandSubmissions,
      overview.blockHits.perThousandSubmissions,
      ...overview.rejectionRates.map((row) => row.perThousandSubmissions),
    ];
    for (const rate of rates) {
      expect(Number.isFinite(rate)).toBe(true);
    }

    // Raw counts survive the zero denominator ...
    expect(overview.throttleHits.count).toBe(2);
    expect(overview.blockHits.count).toBe(1);
    expect(overview.receiptViews).toBe(3);
    // ... and the distribution still counts the in-window order.
    expect(overview.basketSize.orderCount).toBe(1);
  });

  test('lists every rejection code in REJECTION_CODES order when only one was reported', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await t.run(async (ctx) => {
      await insertCounter(ctx, f.businessId, 'ordering_closed', 5);
    });

    const overview = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
    });

    expect(overview.rejectionRates).toHaveLength(REJECTION_CODES.length);
    expect(overview.rejectionRates.map((row) => row.code)).toEqual([...REJECTION_CODES]);
    expect(overview.rejectionRates.map((row) => row.count)).toEqual([0, 0, 0, 0, 5, 0]);
    for (const row of overview.rejectionRates) {
      expect(row.perThousandSubmissions).toBe(0);
    }
  });

  test('scopes events, orders, and flags to the requested windowDays', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await t.run(async (ctx) => {
      const ownerId = await ownerUserId(ctx);
      const base = { businessId: f.businessId, menuItemId: f.menuItemId };

      const inside = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 2 * DAY_MS,
        status: 'new',
        quantities: [1],
        subtotal: 1200,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: inside,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 2 * DAY_MS,
      });
      await insertFlag(ctx, {
        businessId: f.businessId,
        orderId: inside,
        actorUserId: ownerId,
        active: true,
        createdAt: NOW - 2 * DAY_MS,
      });

      const outside = await insertOrder(ctx, {
        ...base,
        createdAt: NOW - 10 * DAY_MS,
        status: 'new',
        quantities: [1],
        subtotal: 1200,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId: outside,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 10 * DAY_MS,
      });
      await insertFlag(ctx, {
        businessId: f.businessId,
        orderId: outside,
        actorUserId: ownerId,
        active: true,
        createdAt: NOW - 10 * DAY_MS,
      });
    });

    const sevenDays = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
      windowDays: 7,
    });
    expect(sevenDays.windowDays).toBe(7);
    expect(sevenDays.windowStart).toBe(NOW - 7 * DAY_MS);
    expect(sevenDays.submissions).toBe(1);
    expect(sevenDays.basketSize.orderCount).toBe(1);
    expect(sevenDays.ownerFlags.flaggedOrders).toBe(1);
    // The only in-window event is a `submitted`, so no pair exists.
    expect(sevenDays.latency.sampleSize).toBe(0);

    // The same rows when the window is wide enough: proof the exclusion above
    // came from the window, not from a fixture that was never readable.
    const thirtyDays = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
    });
    expect(thirtyDays.windowDays).toBe(METRICS_DEFAULT_WINDOW_DAYS);
    expect(thirtyDays.submissions).toBe(2);
    expect(thirtyDays.basketSize.orderCount).toBe(2);
    expect(thirtyDays.ownerFlags.flaggedOrders).toBe(2);
  });

  test('clamps windowDays to the exported bounds and applies the clamped window', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await t.run(async (ctx) => {
      const orderId = await insertOrder(ctx, {
        businessId: f.businessId,
        menuItemId: f.menuItemId,
        createdAt: NOW - 2 * DAY_MS,
        status: 'new',
        quantities: [1],
        subtotal: 1200,
      });
      await insertEvent(ctx, {
        businessId: f.businessId,
        orderId,
        action: 'submitted',
        actorType: 'customer',
        createdAt: NOW - 2 * DAY_MS,
      });
    });

    const belowMinimum = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
      windowDays: 0,
    });
    expect(belowMinimum.windowDays).toBe(METRICS_MIN_WINDOW_DAYS);
    expect(belowMinimum.windowStart).toBe(NOW - METRICS_MIN_WINDOW_DAYS * DAY_MS);
    // The 2-day-old event is outside the clamped 1-day window, proving the read
    // used the clamp rather than only relabelling it.
    expect(belowMinimum.submissions).toBe(0);

    const aboveMaximum = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
      windowDays: 10_000,
    });
    expect(aboveMaximum.windowDays).toBe(METRICS_MAX_WINDOW_DAYS);
    expect(aboveMaximum.windowStart).toBe(NOW - METRICS_MAX_WINDOW_DAYS * DAY_MS);
    expect(aboveMaximum.submissions).toBe(1);

    const omitted = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
    });
    expect(omitted.windowDays).toBe(METRICS_DEFAULT_WINDOW_DAYS);
  });

  // -------------------------------------------------------------------------
  // Owner-scoped authz: the guard runs before any read.
  // -------------------------------------------------------------------------

  test('refuses an unauthenticated caller with Unauthorized', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await expectRefused(
      t.query(api.orderMetrics.overview, { businessId: f.businessId }),
      'Unauthorized'
    );
  });

  test('refuses the owner of a different business with Forbidden', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    await t.run(async (ctx) => {
      const rivalOwnerId = await ctx.db.insert('users', {
        name: 'Rival Owner',
        externalId: 'user_rival_owner',
        role: 'user',
      });
      // Both seeded businesses share one owner, so reassign the second one to
      // make "a different business's owner" a real second owner.
      await ctx.db.patch(f.otherBusinessId, { ownerId: rivalOwnerId });
    });

    await expectRefused(
      asOwner(t, 'user_rival_owner').query(api.orderMetrics.overview, {
        businessId: f.businessId,
      }),
      'Forbidden'
    );
  });

  test('refuses a non-owner user with Forbidden', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    // A registered user (a real `users` row, unlike an unknown subject) who
    // owns nothing: the ownership check, not the missing-row check, refuses.
    await t.run(async (ctx) => {
      await ctx.db.insert('users', {
        name: 'Sam Stranger',
        externalId: 'user_other',
        role: 'user',
      });
    });

    await expectRefused(
      asOwner(t, 'user_other').query(api.orderMetrics.overview, {
        businessId: f.businessId,
      }),
      'Forbidden'
    );
  });

  test('admits the legitimate owner and returns their overview', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);

    const overview = await asOwner(t, OWNER).query(api.orderMetrics.overview, {
      businessId: f.businessId,
    });

    expect(overview.businessId).toEqual(f.businessId);
    expect(overview.windowDays).toBe(METRICS_DEFAULT_WINDOW_DAYS);
    expect(overview.submissions).toBe(0);
  });
});
