/// <reference types="vite/client" />
/**
 * Handler tests for the owner business supply switch (issue #77, order
 * commitment protocol §6.2.8 + §6.5): `setAcceptingOrders` writes exactly one
 * `auditLogs` row per real change and nothing on an identical repeat, and the
 * pause it stores is enforced by the real `placeOrder` guard rather than by a
 * raw database patch.
 *
 * Run: pnpm exec vitest run convex/businesses/supply.test.ts
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
      // Basket protocol so the real `placeOrder` guard is reachable (issue #77).
      orderProtocol: 'basket',
    };
    const businessId = await ctx.db.insert('businesses', baseBusiness);
    const otherBusinessId = await ctx.db.insert('businesses', {
      ...baseBusiness,
      name: 'Other Diner',
      ownerId: otherOwnerId,
      searchText: 'Other Diner',
    });
    const groupId = await ctx.db.insert('menuGroups', {
      businessId,
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
    return { adminId, ownerId, otherOwnerId, businessId, otherBusinessId, groupId, menuItemId };
  });
}

/** A valid basket for the seeded 1200-cent item (2 units = 2400 cents). */
function basketArgs(
  businessId: Id<'businesses'>,
  menuItemId: Id<'menuItems'>,
  overrides: Record<string, unknown> = {}
) {
  return {
    businessId,
    lines: [{ menuItemId, quantity: 2 }],
    customerName: 'Ada Lovelace',
    contactPhone: '(555) 010-0100',
    contactEmail: 'ada@example.com',
    expectedSubtotal: 2400,
    idempotencyKey: 'supply-key-0001',
    ...overrides,
  };
}

/** `placeOrder` throws the §6.5 `{ code, message }` ConvexError envelope. */
async function expectOrderError(promise: Promise<unknown>, code: string) {
  const thrown = await promise.then(
    () => {
      throw new Error(`Expected ${code}, but the call succeeded`);
    },
    (error: unknown) => error
  );
  expect(thrown).toBeInstanceOf(ConvexError);
  expect((thrown as ConvexError<Record<string, string | number>>).data.code).toBe(code);
}

function asOwner(t: TestBackend) {
  return t.withIdentity({ subject: 'user_owner' });
}

async function auditRows(t: TestBackend) {
  return await t.run((ctx) => ctx.db.query('auditLogs').collect());
}

test('setAcceptingOrders pauses ordering and writes one spec-exact audit row', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId, ownerId } = await seed(t);
  const until = NOW + 60 * 60 * 1000;

  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
    businessId,
    accepting: false,
    until,
    note: '  Back at 5pm  ',
  });

  const business = await t.run((ctx) => ctx.db.get(businessId));
  expect(business?.acceptingOrders).toBe(false);
  expect(business?.acceptingOrdersUntil).toBe(until);
  // Trimmed before persistence and reuse (§6.2.8 `reason`, #77 Q4).
  expect(business?.acceptingOrdersNote).toBe('Back at 5pm');

  const rows = await auditRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    actorUserId: ownerId,
    action: 'orders.acceptingOrders.toggled',
    targetType: 'business',
    targetId: businessId,
    targetName: 'Blue Harbor Diner',
    reason: 'Back at 5pm',
    createdAt: NOW,
  });
  // Supply rows are not listing transitions; the status columns stay unset.
  expect(rows[0]?.fromStatus).toBeUndefined();
  expect(rows[0]?.toStatus).toBeUndefined();

  // AC-1: the pause is enforced by the real commit guard, not by the UI.
  await expectOrderError(
    t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId)),
    'ORDERING_CLOSED'
  );
});

test('an identical toggle repeat is a no-op and writes no second row', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  const until = NOW + 60 * 60 * 1000;

  const pause = {
    businessId,
    accepting: false,
    until,
    note: 'Back at 5pm',
  } as const;
  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, pause);
  // Cosmetic whitespace must not read as a state change (Q4 normalization).
  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
    ...pause,
    note: '  Back at 5pm  ',
  });

  expect(await auditRows(t)).toHaveLength(1);
  const business = await t.run((ctx) => ctx.db.get(businessId));
  expect(business?.acceptingOrdersNote).toBe('Back at 5pm');
});

test('a note-only edit while paused writes exactly one row', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  const until = NOW + 60 * 60 * 1000;

  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
    businessId,
    accepting: false,
    until,
    note: 'Kitchen closed',
  });
  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
    businessId,
    accepting: false,
    until,
    note: 'Back at 6pm',
  });

  const rows = await auditRows(t);
  expect(rows.map((row) => row.reason)).toEqual(['Kitchen closed', 'Back at 6pm']);
  const business = await t.run((ctx) => ctx.db.get(businessId));
  expect(business?.acceptingOrdersNote).toBe('Back at 6pm');
});

test('an until-only edit while paused writes exactly one row', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  const firstUntil = NOW + 60 * 60 * 1000;

  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
    businessId,
    accepting: false,
    until: firstUntil,
    note: 'Back later',
  });
  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
    businessId,
    accepting: false,
    until: firstUntil + 60_000,
    note: 'Back later',
  });

  expect(await auditRows(t)).toHaveLength(2);
  const business = await t.run((ctx) => ctx.db.get(businessId));
  expect(business?.acceptingOrdersUntil).toBe(firstUntil + 60_000);
});

test('one-tap resume force-clears the pause until and note', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);

  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
    businessId,
    accepting: false,
    until: NOW + 60 * 60 * 1000,
    note: 'Back at 5pm',
  });
  // Stale resume args must be ignored, not rejected — even an over-long note
  // (it is force-cleared, never validated, so a retried resume stays idempotent;
  // Q1/Q6).
  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
    businessId,
    accepting: true,
    until: NOW + 999_999,
    note: 'x'.repeat(201),
  });

  const business = await t.run((ctx) => ctx.db.get(businessId));
  expect(business?.acceptingOrders).toBe(true);
  expect(business?.acceptingOrdersUntil).toBeUndefined();
  expect(business?.acceptingOrdersNote).toBeUndefined();

  const rows = await auditRows(t);
  expect(rows).toHaveLength(2);
  // Resume has no persisted note, so the row carries no `reason`.
  expect(rows[1]?.reason).toBeUndefined();

  // A second resume is an identical tuple → no third row.
  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
    businessId,
    accepting: true,
  });
  expect(await auditRows(t)).toHaveLength(2);
});

test('setAcceptingOrders refuses anonymous, other-owner, and admin callers', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  const pause = { businessId, accepting: false } as const;

  await expect(t.mutation(api.businesses.mutations.setAcceptingOrders, pause)).rejects.toThrow(
    'Unauthorized'
  );
  await expect(
    t
      .withIdentity({ subject: 'user_other_owner' })
      .mutation(api.businesses.mutations.setAcceptingOrders, pause)
  ).rejects.toThrow('Forbidden');
  // Ownership is `businesses.ownerId`; the Super Admin is not the owner.
  await expect(
    t
      .withIdentity({ subject: 'user_admin' })
      .mutation(api.businesses.mutations.setAcceptingOrders, pause)
  ).rejects.toThrow('Forbidden');

  expect(await auditRows(t)).toHaveLength(0);
  const business = await t.run((ctx) => ctx.db.get(businessId));
  expect(business?.acceptingOrders).toBeUndefined();
});

test('pause is allowed on a non-approved listing while placeOrder still rejects it', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await t.run((ctx) => ctx.db.patch(businessId, { status: 'pendingReview' }));

  // Q2: `acceptingOrders*` is server-owned supply state, not listing content,
  // so no listing-status guard applies to the toggle itself.
  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
    businessId,
    accepting: false,
    note: 'Paused while in review',
  });
  expect(await auditRows(t)).toHaveLength(1);

  // The consume side still refuses the unapproved listing first (C4).
  await expectOrderError(
    t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId)),
    'BUSINESS_UNAVAILABLE'
  );
});

test('the pause note accepts 200 characters and rejects 201', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  const atLimit = 'a'.repeat(200);

  await asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
    businessId,
    accepting: false,
    note: atLimit,
  });
  let business = await t.run((ctx) => ctx.db.get(businessId));
  expect(business?.acceptingOrdersNote).toBe(atLimit);
  expect(await auditRows(t)).toHaveLength(1);

  await expect(
    asOwner(t).mutation(api.businesses.mutations.setAcceptingOrders, {
      businessId,
      accepting: false,
      note: 'a'.repeat(201),
    })
  ).rejects.toThrow('Pause note must be 200 characters or fewer');

  business = await t.run((ctx) => ctx.db.get(businessId));
  expect(business?.acceptingOrdersNote).toBe(atLimit);
  expect(await auditRows(t)).toHaveLength(1);
});
