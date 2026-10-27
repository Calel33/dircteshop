/// <reference types="vite/client" />
/**
 * Expiry suite for the order commitment protocol (issue #79, Task 4).
 *
 * These drive the REAL `convex/orderExpiry.ts` internals against the
 * `convex-test` mock backend. Cron jobs cannot run under `convex-test`, so the
 * sweep is triggered the documented way — a direct call to the internal
 * mutation — and the registration record is pinned statically instead.
 *
 * The expiry boundary is set by writing `orderExpiry.expiresAt` directly; no
 * test sleeps. `Date` alone is faked (as in `convex/orders.test.ts`) so
 * `convex-test`'s async plumbing keeps a real `setTimeout`.
 *
 * Run: pnpm exec vitest run convex/orderExpiry.test.ts
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import { convexTest } from 'convex-test';
import type { TestConvex } from 'convex-test';

import schema from './schema';
import { api, internal } from './_generated/api';
import crons from './crons';
import { EXPIRE_REASON } from './orderCommitPolicy';
import type { Doc, Id } from './_generated/dataModel';

const modules = import.meta.glob('./**/*.ts');
const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type TestBackend = TestConvex<typeof schema>;

async function seedBusiness(t: TestBackend) {
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
    const businessId = await ctx.db.insert('businesses', {
      name: 'Blue Harbor Diner',
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
      searchText: 'Blue Harbor Diner  ',
      ownerId,
      lastUpdatedAt: NOW,
      isFeatured: false,
      lastSavedAt: NOW,
    });
    return { ownerId, categoryId, businessId };
  });
}

async function insertOrder(
  t: TestBackend,
  businessId: Id<'businesses'>,
  status: Doc<'orders'>['status']
) {
  return await t.run((ctx) =>
    ctx.db.insert('orders', {
      businessId,
      customerName: 'Ada Customer',
      status,
      createdAt: NOW,
    })
  );
}

async function insertExpiry(
  t: TestBackend,
  orderId: Id<'orders'>,
  businessId: Id<'businesses'>,
  expiresAt: number
) {
  return await t.run((ctx) => ctx.db.insert('orderExpiry', { orderId, businessId, expiresAt }));
}

function expiryRowsFor(t: TestBackend, orderId: Id<'orders'>) {
  return t.run((ctx) =>
    ctx.db
      .query('orderExpiry')
      .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
      .collect()
  );
}

function eventsFor(t: TestBackend, orderId: Id<'orders'>) {
  return t.run((ctx) =>
    ctx.db
      .query('orderEvents')
      .withIndex('byOrderIdCreatedAt', (q) => q.eq('orderId', orderId))
      .collect()
  );
}

/**
 * Asserts the §6.5 object envelope. `convex-test` restores the original
 * `ConvexError`, so `.data` is the object the handler threw (same contract as
 * `convex/orders.test.ts`).
 */
async function expectOrderError(promise: Promise<unknown>, code: string) {
  const thrown = await promise.then(
    () => {
      throw new Error(`Expected ${code}, but the call succeeded`);
    },
    (error: unknown) => error
  );
  expect(thrown).toBeInstanceOf(ConvexError);
  const data = (thrown as ConvexError<Record<string, string | number>>).data;
  expect(data.code).toBe(code);
  return data;
}

/** Drives one owner accept through the real handler as the seeded owner. */
function ownerAccept(t: TestBackend, businessId: Id<'businesses'>, orderId: Id<'orders'>) {
  return t.withIdentity({ subject: 'user_owner' }).mutation(api.orders.transitionOrderStatus, {
    businessId,
    orderId,
    action: 'accept',
  });
}

test('sweep expires a due new order, stamps the reason and appends one system event', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const orderId = await insertOrder(t, businessId, 'new');
  await insertExpiry(t, orderId, businessId, NOW - 1);

  const summary = await t.mutation(internal.orderExpiry.sweepExpiredOrders, {});

  expect(summary).toEqual({ examined: 1, expired: 1, stale: 0 });
  const order = await t.run((ctx) => ctx.db.get(orderId));
  expect(order?.status).toBe('expired');
  expect(order?.statusReason).toBe(EXPIRE_REASON);
  expect(order?.statusUpdatedAt).toBe(NOW);

  const events = await eventsFor(t, orderId);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    actorType: 'system',
    action: 'expired',
    fromStatus: 'new',
    toStatus: 'expired',
    reason: EXPIRE_REASON,
  });
  expect(events[0].actorUserId).toBeUndefined();
  expect(await expiryRowsFor(t, orderId)).toHaveLength(0);
});

test('a not-yet-due row is left alone: status new, no event, row kept', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const orderId = await insertOrder(t, businessId, 'new');
  await insertExpiry(t, orderId, businessId, NOW + 1);

  const summary = await t.mutation(internal.orderExpiry.sweepExpiredOrders, {});

  // The due-range scan never reaches a future row, so it is not examined.
  expect(summary).toEqual({ examined: 0, expired: 0, stale: 0 });
  expect((await t.run((ctx) => ctx.db.get(orderId)))?.status).toBe('new');
  expect(await eventsFor(t, orderId)).toHaveLength(0);
  expect(await expiryRowsFor(t, orderId)).toHaveLength(1);
});

test('accepted orders never expire: the stale row is deleted, status and ledger untouched', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const orderId = await insertOrder(t, businessId, 'accepted');
  await insertExpiry(t, orderId, businessId, NOW - 1);

  const summary = await t.mutation(internal.orderExpiry.sweepExpiredOrders, {});

  expect(summary).toEqual({ examined: 1, expired: 0, stale: 1 });
  const order = await t.run((ctx) => ctx.db.get(orderId));
  expect(order?.status).toBe('accepted');
  expect(order?.statusReason).toBeUndefined();
  expect(await eventsFor(t, orderId)).toHaveLength(0);
  expect(await expiryRowsFor(t, orderId)).toHaveLength(0);
});

test('a legacy new order with no expiry row is never swept', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const orderId = await insertOrder(t, businessId, 'new');

  const summary = await t.mutation(internal.orderExpiry.sweepExpiredOrders, {});

  expect(summary).toEqual({ examined: 0, expired: 0, stale: 0 });
  expect((await t.run((ctx) => ctx.db.get(orderId)))?.status).toBe('new');
  expect(await eventsFor(t, orderId)).toHaveLength(0);
});

test('expireOrder driven directly expires a due order', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const orderId = await insertOrder(t, businessId, 'new');
  await insertExpiry(t, orderId, businessId, NOW);

  await t.mutation(internal.orderExpiry.expireOrder, { orderId });

  expect((await t.run((ctx) => ctx.db.get(orderId)))?.status).toBe('expired');
  expect(await eventsFor(t, orderId)).toHaveLength(1);
  expect(await expiryRowsFor(t, orderId)).toHaveLength(0);
});

test('expireOrder on a missing order does not throw and clears its orphan row', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const orderId = await insertOrder(t, businessId, 'new');
  await insertExpiry(t, orderId, businessId, NOW - 1);
  await t.run((ctx) => ctx.db.delete(orderId));

  await t.mutation(internal.orderExpiry.expireOrder, { orderId });

  expect(await expiryRowsFor(t, orderId)).toHaveLength(0);
});

test('duplicate rows expire the order once and are all removed', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const orderId = await insertOrder(t, businessId, 'new');
  await insertExpiry(t, orderId, businessId, NOW - 1_000);
  await insertExpiry(t, orderId, businessId, NOW + 1_000);

  const summary = await t.mutation(internal.orderExpiry.sweepExpiredOrders, {});

  expect(summary).toEqual({ examined: 1, expired: 1, stale: 0 });
  expect((await t.run((ctx) => ctx.db.get(orderId)))?.status).toBe('expired');
  expect(await eventsFor(t, orderId)).toHaveLength(1);
  expect(await expiryRowsFor(t, orderId)).toHaveLength(0);
});

test('one sweep is bounded to the 50 earliest-due rows, ascending', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const orderIds = await t.run(async (ctx) => {
    const ids: Id<'orders'>[] = [];
    for (let i = 0; i < 55; i += 1) {
      const orderId = await ctx.db.insert('orders', {
        businessId,
        customerName: 'Ada Customer',
        status: 'new',
        createdAt: NOW,
      });
      // All due; `i` ascends so index order is also insertion order.
      await ctx.db.insert('orderExpiry', { orderId, businessId, expiresAt: NOW - 10_000 + i });
      ids.push(orderId);
    }
    return ids;
  });

  const summary = await t.mutation(internal.orderExpiry.sweepExpiredOrders, {});

  expect(summary).toEqual({ examined: 50, expired: 50, stale: 0 });
  const statuses = await t.run(async (ctx) => {
    const out: Doc<'orders'>['status'][] = [];
    for (const orderId of orderIds) {
      const order = await ctx.db.get(orderId);
      if (order === null) {
        throw new Error('seeded order disappeared');
      }
      out.push(order.status);
    }
    return out;
  });
  expect(statuses.slice(0, 50)).toEqual(Array(50).fill('expired'));
  expect(statuses.slice(50)).toEqual(Array(5).fill('new'));
});

// ---------------------------------------------------------------------------
// Expire-vs-accept race semantics (issue #81, T8). Each case pins one winner;
// together they make "accepted AND expired-ledgered" unreachable.
// ---------------------------------------------------------------------------

test('expire wins over accept: a due, unswept order refuses the owner accept with ORDER_EXPIRED', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const orderId = await insertOrder(t, businessId, 'new');
  // Boundary: `expiresAt <= now` is due, so the D8 guard fires.
  await insertExpiry(t, orderId, businessId, NOW);

  await expectOrderError(ownerAccept(t, businessId, orderId), 'ORDER_EXPIRED');

  // The throwing transaction writes nothing: no status change, no event, and
  // the schedule row is still there for the system sweep to convert.
  const order = await t.run((ctx) => ctx.db.get(orderId));
  expect(order?.status).toBe('new');
  expect(order?.statusReason).toBeUndefined();
  expect(order?.statusUpdatedAt).toBeUndefined();
  const events = await eventsFor(t, orderId);
  expect(events).toHaveLength(0);
  expect(events.filter((event) => event.action === 'accepted')).toHaveLength(0);
  expect(await expiryRowsFor(t, orderId)).toHaveLength(1);
});

test('accept wins over expire: a row that becomes due after the accept sweeps stale and never expires it', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const orderId = await insertOrder(t, businessId, 'new');
  // Not due yet, so the accept passes the D8 guard and deletes this row.
  await insertExpiry(t, orderId, businessId, NOW + 60_000);

  const accepted = await ownerAccept(t, businessId, orderId);
  expect(accepted).toEqual({ status: 'accepted', reused: false });

  // The race under test: a due schedule exists for an order that is already
  // accepted (a duplicate write or a sweep retry after the accept committed).
  await insertExpiry(t, orderId, businessId, NOW);

  const summary = await t.mutation(internal.orderExpiry.sweepExpiredOrders, {});

  expect(summary).toEqual({ examined: 1, expired: 0, stale: 1 });
  const order = await t.run((ctx) => ctx.db.get(orderId));
  expect(order?.status).toBe('accepted');
  expect(order?.statusReason).toBeUndefined();

  const events = await eventsFor(t, orderId);
  expect(events.map((event) => event.action)).toEqual(['accepted']);
  expect(events.some((event) => event.toStatus === 'expired')).toBe(false);
  expect(await expiryRowsFor(t, orderId)).toHaveLength(0);

  // The forbidden combination is unreachable.
  expect(order?.status === 'accepted' && events.some((event) => event.toStatus === 'expired')).toBe(
    false
  );
});

test('accept wins over expire: expireOrder on an accepted order clears the stale row without patching', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const orderId = await insertOrder(t, businessId, 'accepted');
  await insertExpiry(t, orderId, businessId, NOW - 1);

  await t.mutation(internal.orderExpiry.expireOrder, { orderId });

  const order = await t.run((ctx) => ctx.db.get(orderId));
  expect(order?.status).toBe('accepted');
  expect(order?.statusReason).toBeUndefined();
  expect(order?.statusUpdatedAt).toBeUndefined();

  const events = await eventsFor(t, orderId);
  expect(events).toHaveLength(0);
  expect(events.some((event) => event.toStatus === 'expired')).toBe(false);
  expect(await expiryRowsFor(t, orderId)).toHaveLength(0);

  expect(order?.status === 'accepted' && events.some((event) => event.toStatus === 'expired')).toBe(
    false
  );
});

test('sweep only touches new: every non-new status reports stale and is never patched', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const nonNew: Doc<'orders'>['status'][] = [
    'accepted',
    'ready',
    'completed',
    'declined',
    'cancelled',
    'expired',
    'no_show',
  ];

  // Seven due rows: one per non-`new` status, well inside the 50-row batch.
  const seeded = await t.run(async (ctx) => {
    const rows: { status: Doc<'orders'>['status']; orderId: Id<'orders'> }[] = [];
    for (const [offset, status] of nonNew.entries()) {
      const orderId = await ctx.db.insert('orders', {
        businessId,
        customerName: 'Ada Customer',
        status,
        createdAt: NOW,
      });
      await ctx.db.insert('orderExpiry', {
        orderId,
        businessId,
        expiresAt: NOW - 10_000 + offset,
      });
      rows.push({ status, orderId });
    }
    return rows;
  });

  const summary = await t.mutation(internal.orderExpiry.sweepExpiredOrders, {});

  expect(summary).toEqual({ examined: nonNew.length, expired: 0, stale: nonNew.length });

  const after = await t.run(async (ctx) => {
    const rows: { status: Doc<'orders'>['status']; order: Doc<'orders'> | null }[] = [];
    for (const { status, orderId } of seeded) {
      rows.push({ status, order: await ctx.db.get(orderId) });
    }
    return rows;
  });
  for (const { status, order } of after) {
    expect(order?.status).toBe(status);
    expect(order?.statusReason).toBeUndefined();
    expect(order?.statusUpdatedAt).toBeUndefined();
  }

  // No ledger row was appended and every stale schedule was cleaned up.
  expect(await t.run((ctx) => ctx.db.query('orderEvents').collect())).toHaveLength(0);
  expect(await t.run((ctx) => ctx.db.query('orderExpiry').collect())).toHaveLength(0);
});

test('crons register the 5-minute expiry sweep and the daily throttle cleanup', () => {
  expect(Object.keys(crons.crons).sort()).toEqual([
    'cleanup stale order throttle',
    'sweep expired orders',
  ]);

  const sweep = crons.crons['sweep expired orders'];
  expect(sweep.schedule).toEqual({ type: 'interval', minutes: 5 });
  expect(sweep.name).toMatch(/sweepExpiredOrders$/);

  const cleanup = crons.crons['cleanup stale order throttle'];
  expect(cleanup.schedule).toEqual({ type: 'daily', hourUTC: 4, minuteUTC: 0 });
  expect(cleanup.name).toMatch(/cleanupStaleThrottleRows$/);
});
