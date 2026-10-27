/// <reference types="vite/client" />
/**
 * Contact throttle and block check (issue #81, T9 / Phase 1, task T2).
 *
 * These drive the REAL `convex/orderThrottle.ts` handlers against the
 * `convex-test` mock backend. `now` is always supplied explicitly — the module
 * never reads the ambient clock — so the windows are opened by writing
 * `windowStart` directly and no test sleeps.
 *
 * OCC is deliberately not asserted here: `convex-test` does not simulate
 * concurrent transactions. Phase 5's proof runs that against a real deployment.
 *
 * Run: pnpm exec vitest run convex/orderThrottle.test.ts
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import { convexTest } from 'convex-test';
import type { TestConvex } from 'convex-test';

import schema from './schema';
import { internal } from './_generated/api';
import {
  CONTACT_THROTTLE_10M,
  CONTACT_THROTTLE_24H,
  CONTACT_THROTTLE_WINDOW_24H_MS,
  ORDER_ERRORS,
  contactChannelHashes,
  parseContact,
} from './orderCommitPolicy';
import {
  BUSINESS_THROTTLE_WINDOW_MS,
  assertContactNotBlocked,
  claimContactThrottle,
  contactThrottleKeys,
} from './orderThrottle';
import { CLEANUP_BATCH } from './orderThrottleCleanup';
import type { Id } from './_generated/dataModel';

const modules = import.meta.glob('./**/*.ts');
const NOW = 1_700_000_000_000;
const CONTACT_HASH = 'a'.repeat(64);

// `Date` alone is faked (as in `convex/orderExpiry.test.ts`) so the cleanup's
// ambient `Date.now()` is pinned while `convex-test` keeps a real `setTimeout`.
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

function claim(
  t: TestBackend,
  businessId: Id<'businesses'>,
  now: number,
  contactHash = CONTACT_HASH
) {
  return t.run((ctx) => claimContactThrottle(ctx, { businessId, contactHash, now }));
}

function throttleRow(t: TestBackend, key: string) {
  return t.run((ctx) =>
    ctx.db
      .query('orderThrottle')
      .withIndex('byKey', (q) => q.eq('key', key))
      .first()
  );
}

function allThrottleRows(t: TestBackend) {
  return t.run((ctx) => ctx.db.query('orderThrottle').collect());
}

async function seedThrottleRow(
  t: TestBackend,
  key: string,
  windowStart: number,
  count: number
) {
  await t.run((ctx) => ctx.db.insert('orderThrottle', { key, windowStart, count }));
}

/**
 * Asserts the §6.5 object envelope. `convex-test` preserves the original
 * `ConvexError`, so `.data` is the object the handler threw.
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

test('the first claim inserts both windows at the same window start', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const keys = contactThrottleKeys(businessId, CONTACT_HASH);

  await claim(t, businessId, NOW);

  const rows = await allThrottleRows(t);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.key).sort()).toEqual([keys.day, keys.tenMinutes].sort());
  for (const row of rows) {
    expect(row.windowStart).toBe(NOW);
    expect(row.count).toBe(1);
  }
});

test('the third 10-minute claim succeeds and the fourth throws without writing', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const keys = contactThrottleKeys(businessId, CONTACT_HASH);

  await claim(t, businessId, NOW);
  await claim(t, businessId, NOW + 1_000);
  await claim(t, businessId, NOW + 2_000);

  const data = await expectOrderError(claim(t, businessId, NOW + 3_000), 'TOO_MANY_REQUESTS');

  // 10 minutes minus the 3s already burned, rounded up.
  expect(data.retryAfterMs).toBe(597_000);
  expect(data.retryAfterMs).toBeGreaterThan(0);
  expect(data.retryAfterMs).toBeLessThanOrEqual(BUSINESS_THROTTLE_WINDOW_MS);
  expect(data.message).toBe(ORDER_ERRORS.TOO_MANY_REQUESTS.message.replace('{n}', '10'));

  // Throw-before-write: the rejected claim consumed no slot in either window.
  const tenMinutes = await throttleRow(t, keys.tenMinutes);
  const day = await throttleRow(t, keys.day);
  expect(tenMinutes?.count).toBe(CONTACT_THROTTLE_10M);
  expect(day?.count).toBe(CONTACT_THROTTLE_10M);
});

test('the 24-hour window caps independently and the failed claim resets nothing', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const keys = contactThrottleKeys(businessId, CONTACT_HASH);
  // The 10-minute window is stale (would reset on a successful claim); the
  // 24-hour window is live at its limit.
  await seedThrottleRow(t, keys.tenMinutes, NOW - BUSINESS_THROTTLE_WINDOW_MS - 1, 3);
  await seedThrottleRow(t, keys.day, NOW - 1_000, CONTACT_THROTTLE_24H);

  const data = await expectOrderError(claim(t, businessId, NOW), 'TOO_MANY_REQUESTS');

  // The rejection reports the 24-hour window's own remaining time, not the
  // 10-minute window's.
  expect(data.retryAfterMs).toBe(CONTACT_THROTTLE_WINDOW_24H_MS - 1_000);

  const tenMinutes = await throttleRow(t, keys.tenMinutes);
  const day = await throttleRow(t, keys.day);
  expect(tenMinutes?.windowStart).toBe(NOW - BUSINESS_THROTTLE_WINDOW_MS - 1);
  expect(tenMinutes?.count).toBe(3);
  expect(day?.windowStart).toBe(NOW - 1_000);
  expect(day?.count).toBe(CONTACT_THROTTLE_24H);
});

test('a stale window on both keys is reset by one claim', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const keys = contactThrottleKeys(businessId, CONTACT_HASH);
  await seedThrottleRow(t, keys.tenMinutes, NOW - BUSINESS_THROTTLE_WINDOW_MS - 1, 3);
  await seedThrottleRow(t, keys.day, NOW - CONTACT_THROTTLE_WINDOW_24H_MS - 1, 10);

  await claim(t, businessId, NOW);

  const tenMinutes = await throttleRow(t, keys.tenMinutes);
  const day = await throttleRow(t, keys.day);
  expect(tenMinutes).toMatchObject({ windowStart: NOW, count: 1 });
  expect(day).toMatchObject({ windowStart: NOW, count: 1 });
});

test('a window exactly one window old is still live', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const keys = contactThrottleKeys(businessId, CONTACT_HASH);
  await seedThrottleRow(t, keys.tenMinutes, NOW - BUSINESS_THROTTLE_WINDOW_MS, 3);
  await seedThrottleRow(t, keys.day, NOW, 1);

  const data = await expectOrderError(claim(t, businessId, NOW), 'TOO_MANY_REQUESTS');

  // Exact boundary: `retryAfterMs` is 0 and the catalog sentence clamps to
  // "1 minute" rather than "0 minutes" (INV-14).
  expect(data.retryAfterMs).toBe(0);
  expect(data.message).toBe(ORDER_ERRORS.TOO_MANY_REQUESTS.message.replace('{n}', '1'));

  // Still not reset.
  const tenMinutes = await throttleRow(t, keys.tenMinutes);
  expect(tenMinutes).toMatchObject({ windowStart: NOW - BUSINESS_THROTTLE_WINDOW_MS, count: 3 });
});

test('one millisecond past the window resets it', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const keys = contactThrottleKeys(businessId, CONTACT_HASH);
  await seedThrottleRow(t, keys.tenMinutes, NOW - BUSINESS_THROTTLE_WINDOW_MS - 1, 3);
  await seedThrottleRow(t, keys.day, NOW, 1);

  await claim(t, businessId, NOW);

  const tenMinutes = await throttleRow(t, keys.tenMinutes);
  const day = await throttleRow(t, keys.day);
  expect(tenMinutes).toMatchObject({ windowStart: NOW, count: 1 });
  expect(day).toMatchObject({ windowStart: NOW, count: 2 });
});

// ---------------------------------------------------------------------------
// Block list
// ---------------------------------------------------------------------------

test('a block on one channel refuses generically and the other channel passes', async () => {
  const t = convexTest(schema, modules);
  const { ownerId, businessId } = await seedBusiness(t);
  const parsed = await parseContact({
    customerName: 'Ada Customer',
    phone: '+1 (555) 010-0100',
    email: 'alice@example.com',
  });
  if (!parsed.ok) {
    throw new Error('fixture contact must parse');
  }
  const [phoneHash, emailHash] = await contactChannelHashes(parsed.contact);
  await t.run((ctx) =>
    ctx.db.insert('orderBlocks', {
      businessId,
      contactHash: phoneHash,
      createdByUserId: ownerId,
      createdAt: NOW,
    })
  );

  const data = await expectOrderError(
    t.run((ctx) => assertContactNotBlocked(ctx, { businessId, channelHashes: [phoneHash] })),
    'ORDER_NOT_ACCEPTED'
  );

  // Generic refusal: the catalog copy verbatim, no hash and no channel hint.
  expect(data.message).toBe(ORDER_ERRORS.ORDER_NOT_ACCEPTED.message);
  expect(Object.keys(data).sort()).toEqual(['code', 'message']);
  expect('contactHash' in data).toBe(false);
  expect(JSON.stringify(data)).not.toContain(phoneHash);

  // The sibling channel is unaffected.
  await t.run((ctx) => assertContactNotBlocked(ctx, { businessId, channelHashes: [emailHash] }));
});

test('a blocked hash refuses even when another channel hash is checked first', async () => {
  const t = convexTest(schema, modules);
  const { ownerId, businessId } = await seedBusiness(t);
  const parsed = await parseContact({
    customerName: 'Ada Customer',
    phone: '+1 (555) 010-0100',
    email: 'alice@example.com',
  });
  if (!parsed.ok) {
    throw new Error('fixture contact must parse');
  }
  const [phoneHash, emailHash] = await contactChannelHashes(parsed.contact);
  await t.run((ctx) =>
    ctx.db.insert('orderBlocks', {
      businessId,
      contactHash: emailHash,
      createdByUserId: ownerId,
      createdAt: NOW,
    })
  );

  await expectOrderError(
    t.run((ctx) =>
      assertContactNotBlocked(ctx, { businessId, channelHashes: [phoneHash, emailHash] })
    ),
    'ORDER_NOT_ACCEPTED'
  );
});

test('no block row passes, and a block on another business does not refuse', async () => {
  const t = convexTest(schema, modules);
  const { ownerId, businessId } = await seedBusiness(t);
  const other = await seedBusiness(t);
  const parsed = await parseContact({
    customerName: 'Ada Customer',
    phone: '+1 (555) 010-0100',
  });
  if (!parsed.ok) {
    throw new Error('fixture contact must parse');
  }
  const [phoneHash] = await contactChannelHashes(parsed.contact);

  await t.run((ctx) => assertContactNotBlocked(ctx, { businessId, channelHashes: [phoneHash] }));

  await t.run((ctx) =>
    ctx.db.insert('orderBlocks', {
      businessId: other.businessId,
      contactHash: phoneHash,
      createdByUserId: ownerId,
      createdAt: NOW,
    })
  );

  await t.run((ctx) => assertContactNotBlocked(ctx, { businessId, channelHashes: [phoneHash] }));
  await expectOrderError(
    t.run((ctx) =>
      assertContactNotBlocked(ctx, { businessId: other.businessId, channelHashes: [phoneHash] })
    ),
    'ORDER_NOT_ACCEPTED'
  );
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

test('throttle keys never contain the raw phone or email', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const parsed = await parseContact({
    customerName: 'Ada Customer',
    phone: '+1 (555) 010-0100',
    email: 'alice@example.com',
  });
  if (!parsed.ok) {
    throw new Error('fixture contact must parse');
  }

  await claim(t, businessId, NOW, parsed.contactHash);

  const keys = contactThrottleKeys(businessId, parsed.contactHash);
  for (const key of [keys.tenMinutes, keys.day]) {
    expect(key).toContain(parsed.contactHash);
    expect(key).not.toContain('+1 (555) 010-0100');
    expect(key).not.toContain('5550100100');
    expect(key).not.toContain('alice@example.com');
  }

  for (const row of await allThrottleRows(t)) {
    expect(row.key).not.toContain('+1 (555) 010-0100');
    expect(row.key).not.toContain('5550100100');
    expect(row.key).not.toContain('alice@example.com');
  }
});

// ---------------------------------------------------------------------------
// Stale-row cleanup (issue #81, T13; protocol §S4 L1631)
// ---------------------------------------------------------------------------

function cleanup(t: TestBackend) {
  return t.mutation(internal.orderThrottleCleanup.cleanupStaleThrottleRows, {});
}

async function seedThrottleRows(t: TestBackend, count: number, windowStart: number) {
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i += 1) {
      await ctx.db.insert('orderThrottle', {
        key: `contact:probe:${i}:24h`,
        windowStart,
        count: 1,
      });
    }
  });
}

test('cleanup deletes a throttle row older than the longest window', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const keys = contactThrottleKeys(businessId, CONTACT_HASH);
  await seedThrottleRow(t, keys.day, NOW - CONTACT_THROTTLE_WINDOW_24H_MS - 1, 10);

  expect(await cleanup(t)).toEqual({ examined: 1, deleted: 1 });
  expect(await allThrottleRows(t)).toHaveLength(0);
});

test('cleanup keeps a live throttle row', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const keys = contactThrottleKeys(businessId, CONTACT_HASH);
  await seedThrottleRow(t, keys.day, NOW - 1_000, 10);

  expect(await cleanup(t)).toEqual({ examined: 1, deleted: 0 });
  expect(await throttleRow(t, keys.day)).toMatchObject({ windowStart: NOW - 1_000, count: 10 });
});

test('cleanup keeps a row exactly one 24-hour window old', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seedBusiness(t);
  const keys = contactThrottleKeys(businessId, CONTACT_HASH);
  // Strictly-greater rule: the exact boundary is still live for the throttle,
  // so it is still live here.
  await seedThrottleRow(t, keys.day, NOW - CONTACT_THROTTLE_WINDOW_24H_MS, 10);

  expect(await cleanup(t)).toEqual({ examined: 1, deleted: 0 });
  expect(await throttleRow(t, keys.day)).toMatchObject({
    windowStart: NOW - CONTACT_THROTTLE_WINDOW_24H_MS,
    count: 10,
  });
});

test('cleanup never touches orderBlocks, even for the same contact hash', async () => {
  const t = convexTest(schema, modules);
  const { ownerId, businessId } = await seedBusiness(t);
  const keys = contactThrottleKeys(businessId, CONTACT_HASH);
  await seedThrottleRow(t, keys.day, NOW - CONTACT_THROTTLE_WINDOW_24H_MS - 1, 10);
  const blockId = await t.run((ctx) =>
    ctx.db.insert('orderBlocks', {
      businessId,
      contactHash: CONTACT_HASH,
      createdByUserId: ownerId,
      createdAt: NOW - CONTACT_THROTTLE_WINDOW_24H_MS - 1,
    })
  );

  expect(await cleanup(t)).toEqual({ examined: 1, deleted: 1 });

  const blocks = await t.run((ctx) => ctx.db.query('orderBlocks').collect());
  expect(blocks).toHaveLength(1);
  expect(blocks[0]._id).toBe(blockId);
  expect(blocks[0].contactHash).toBe(CONTACT_HASH);
  // The surviving block still refuses; cleanup did not weaken the guard.
  await expectOrderError(
    t.run((ctx) => assertContactNotBlocked(ctx, { businessId, channelHashes: [CONTACT_HASH] })),
    'ORDER_NOT_ACCEPTED'
  );
});

test('one cleanup is bounded to CLEANUP_BATCH rows and the next run drains the rest', async () => {
  const t = convexTest(schema, modules);
  await seedThrottleRows(t, CLEANUP_BATCH + 5, NOW - CONTACT_THROTTLE_WINDOW_24H_MS - 1);

  expect(await cleanup(t)).toEqual({ examined: CLEANUP_BATCH, deleted: CLEANUP_BATCH });
  expect(await allThrottleRows(t)).toHaveLength(5);

  expect(await cleanup(t)).toEqual({ examined: 5, deleted: 5 });
  expect(await allThrottleRows(t)).toHaveLength(0);
});
