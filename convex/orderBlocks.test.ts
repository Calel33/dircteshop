/// <reference types="vite/client" />
/**
 * Owner abuse-controls suite for the order commitment protocol (issue #81, T9 /
 * Phase 3, task T7).
 *
 * Drives the REAL `convex/orderBlocks.ts` handlers and the `placeOrder` block
 * check against the `convex-test` mock backend, so the owner -> customer round
 * trip is proven at the function boundary:
 *   - owner-only authorization for block / unblock / clear / list;
 *   - per-business isolation (a block is never global, a foreign order is not
 *     found with the same envelope as a missing one);
 *   - exactly one inline audit row per real write, with a masked `targetName`;
 *   - idempotent no-ops that write nothing and audit nothing;
 *   - block -> `ORDER_NOT_ACCEPTED` (no contact slots) -> unblock -> success;
 *   - the audited throttle clear restores submit capability without touching
 *     the block list;
 *   - hashes-only privacy in `orderBlocks` and in the `listBlocked` payload.
 *
 * `now` is deterministic: only `Date` is faked (as in `convex/orders.test.ts`),
 * so `convex-test`'s async plumbing keeps a real `setTimeout` and no test
 * sleeps. Fixtures are local; the global seed script is not used.
 *
 * Run: pnpm exec vitest run convex/orderBlocks.test.ts
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import { convexTest } from 'convex-test';
import type { TestConvex } from 'convex-test';

import schema from './schema';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { ORDER_ERRORS, parseContact } from './orderCommitPolicy';
import { contactThrottleKeys } from './orderThrottle';

const modules = import.meta.glob('./**/*.ts');

// Tue 2023-11-14 22:13:20 UTC = 17:13 in America/New_York, inside the seeded
// Tuesday 09:00-22:00 window.
const NOW = 1_700_000_000_000;

const OWNER_A = 'owner_a';
const OWNER_B = 'owner_b';
const STRANGER = 'stranger';

const RAW_PHONE = '(555) 010-0100';
const RAW_PHONE_DIGITS = '5550100100';
const RAW_EMAIL = 'ada@example.com';
const MASKED_PHONE = '***-0100';
const MASKED_EMAIL = 'a***@example.com';
const MASKED_LABEL = `${MASKED_PHONE} / ${MASKED_EMAIL}`;

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

type OwnerFixtures = {
  ownerAId: Id<'users'>;
  ownerBId: Id<'users'>;
  strangerId: Id<'users'>;
  businessA: Id<'businesses'>;
  businessB: Id<'businesses'>;
  /** A schema-valid id whose document no longer exists. */
  missingBusinessId: Id<'businesses'>;
  itemA: Id<'menuItems'>;
  itemB: Id<'menuItems'>;
};

type BasketArgs = {
  businessId: Id<'businesses'>;
  lines: { menuItemId: Id<'menuItems'>; quantity: number }[];
  customerName: string;
  contactPhone: string;
  contactEmail: string;
  expectedSubtotal: number;
  idempotencyKey: string;
};

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
 * Two owned basket businesses (each with one priced menu item) plus a stranger
 * user and a deleted business id for the guard's `business === null` arm.
 */
async function seed(t: TestBackend): Promise<OwnerFixtures> {
  return await t.run(async (ctx) => {
    const ownerAId = await ctx.db.insert('users', {
      name: 'Ada Owner',
      externalId: OWNER_A,
      role: 'user',
    });
    const ownerBId = await ctx.db.insert('users', {
      name: 'Ben Owner',
      externalId: OWNER_B,
      role: 'user',
    });
    const strangerId = await ctx.db.insert('users', {
      name: 'Sam Stranger',
      externalId: STRANGER,
      role: 'user',
    });
    const categoryId = await ctx.db.insert('categories', {
      name: 'Restaurants',
      slug: 'restaurants',
      ordering: 1,
    });

    const businessA = await insertBusiness(ctx, {
      ownerId: ownerAId,
      categoryId,
      name: 'A Diner',
    });
    const businessB = await insertBusiness(ctx, {
      ownerId: ownerBId,
      categoryId,
      name: 'B Diner',
    });
    const missingBusinessId = await insertBusiness(ctx, {
      ownerId: ownerAId,
      categoryId,
      name: 'Deleted Diner',
    });
    await ctx.db.delete(missingBusinessId);

    const groupA = await ctx.db.insert('menuGroups', {
      businessId: businessA,
      name: 'Bowls',
      ordering: 0,
    });
    const groupB = await ctx.db.insert('menuGroups', {
      businessId: businessB,
      name: 'Bowls',
      ordering: 0,
    });
    const itemA = await ctx.db.insert('menuItems', {
      businessId: businessA,
      groupId: groupA,
      name: 'Grain Bowl',
      price: 1200,
      customizationOptions: [],
      ordering: 0,
      isAvailable: true,
    });
    const itemB = await ctx.db.insert('menuItems', {
      businessId: businessB,
      groupId: groupB,
      name: 'Grain Bowl',
      price: 1200,
      customizationOptions: [],
      ordering: 0,
      isAvailable: true,
    });

    return {
      ownerAId,
      ownerBId,
      strangerId,
      businessA,
      businessB,
      missingBusinessId,
      itemA,
      itemB,
    };
  });
}

async function insertOrder(
  t: TestBackend,
  businessId: Id<'businesses'>,
  contact: { contactPhone?: string; contactEmail?: string } = {}
): Promise<Id<'orders'>> {
  return await t.run((ctx) =>
    ctx.db.insert('orders', {
      businessId,
      customerName: 'Ada Lovelace',
      status: 'new',
      createdAt: NOW,
      ...(contact.contactPhone === undefined ? {} : { contactPhone: contact.contactPhone }),
      ...(contact.contactEmail === undefined ? {} : { contactEmail: contact.contactEmail }),
    })
  );
}

/** A valid two-unit basket on the 1200-cent bowl: subtotal 2400. */
function basketArgs(
  businessId: Id<'businesses'>,
  menuItemId: Id<'menuItems'>,
  overrides: Partial<Omit<BasketArgs, 'businessId' | 'lines'>> = {}
): BasketArgs {
  return {
    businessId,
    lines: [{ menuItemId, quantity: 2 }],
    customerName: 'Ada Lovelace',
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
    expectedSubtotal: 2400,
    idempotencyKey: 'order-blocks-default',
    ...overrides,
  };
}

/** The owner guard reads only `identity.subject` (issue #81 plan D9). */
function asOwner(t: TestBackend, subject: string) {
  return t.withIdentity({ subject });
}

function blockRows(t: TestBackend) {
  return t.run((ctx) => ctx.db.query('orderBlocks').collect());
}

function throttleRows(t: TestBackend) {
  return t.run((ctx) => ctx.db.query('orderThrottle').collect());
}

async function contactThrottleRows(t: TestBackend) {
  const rows = await throttleRows(t);
  return rows.filter((row) => row.key.startsWith('contact:'));
}

function auditRows(t: TestBackend) {
  return t.run((ctx) => ctx.db.query('auditLogs').collect());
}

function orders(t: TestBackend) {
  return t.run((ctx) => ctx.db.query('orders').collect());
}

function auditsFor(rows: readonly Doc<'auditLogs'>[], action: string) {
  return rows.filter((row) => row.action === action);
}

function onlyAudit(rows: readonly Doc<'auditLogs'>[], action: string): Doc<'auditLogs'> {
  const matches = auditsFor(rows, action);
  expect(matches).toHaveLength(1);
  return matches[0];
}

/**
 * Asserts the §6.5 object envelope. `convex-test` restores the original
 * `ConvexError`, so `.data` is the object the handler threw.
 */
async function expectOrderError(
  promise: Promise<unknown>,
  code: string
): Promise<Record<string, string | number>> {
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

// ---------------------------------------------------------------------------
// Contract 1: owner-only negatives for all four exports
// ---------------------------------------------------------------------------

test('blockContact is owner-only: no identity is Unauthorized, a stranger or missing business is Forbidden', async () => {
  // Canary: a silent fake-Date no-op would make every NOW assertion meaningless.
  expect(Date.now()).toBe(NOW);

  const t = convexTest(schema, modules);
  const f = await seed(t);
  const args = { businessId: f.businessA, phone: RAW_PHONE };

  await expect(t.mutation(api.orderBlocks.blockContact, args)).rejects.toThrow('Unauthorized');
  await expect(asOwner(t, STRANGER).mutation(api.orderBlocks.blockContact, args)).rejects.toThrow(
    'Forbidden'
  );
  await expect(
    asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
      ...args,
      businessId: f.missingBusinessId,
    })
  ).rejects.toThrow('Forbidden');

  expect(await blockRows(t)).toHaveLength(0);
  expect(await auditRows(t)).toHaveLength(0);
});

test('unblockContact is owner-only and a rejected caller removes nothing', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  // A real block, so the refusals below have something they could destroy.
  await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
    businessId: f.businessA,
    phone: RAW_PHONE,
  });
  expect(await blockRows(t)).toHaveLength(1);

  const args = { businessId: f.businessA, phone: RAW_PHONE };
  await expect(t.mutation(api.orderBlocks.unblockContact, args)).rejects.toThrow('Unauthorized');
  await expect(asOwner(t, STRANGER).mutation(api.orderBlocks.unblockContact, args)).rejects.toThrow(
    'Forbidden'
  );
  await expect(
    asOwner(t, OWNER_A).mutation(api.orderBlocks.unblockContact, {
      ...args,
      businessId: f.missingBusinessId,
    })
  ).rejects.toThrow('Forbidden');

  expect(await blockRows(t)).toHaveLength(1);
  expect(auditsFor(await auditRows(t), 'order.unblock_contact')).toHaveLength(0);
});

test('clearContactThrottle is owner-only and a rejected caller leaves the windows intact', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const orderId = await insertOrder(t, f.businessA, {
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
  });

  const parsed = await parseContact({
    customerName: 'Ada Lovelace',
    phone: RAW_PHONE,
    email: RAW_EMAIL,
  });
  if (!parsed.ok) {
    throw new Error('fixture contact must parse');
  }
  const keys = contactThrottleKeys(f.businessA, parsed.contactHash);
  await t.run(async (ctx) => {
    await ctx.db.insert('orderThrottle', {
      key: keys.tenMinutes,
      windowStart: NOW,
      count: 3,
    });
    await ctx.db.insert('orderThrottle', { key: keys.day, windowStart: NOW, count: 3 });
  });

  const args = { businessId: f.businessA, orderId };
  await expect(t.mutation(api.orderBlocks.clearContactThrottle, args)).rejects.toThrow(
    'Unauthorized'
  );
  await expect(
    asOwner(t, STRANGER).mutation(api.orderBlocks.clearContactThrottle, args)
  ).rejects.toThrow('Forbidden');
  await expect(
    asOwner(t, OWNER_A).mutation(api.orderBlocks.clearContactThrottle, {
      ...args,
      businessId: f.missingBusinessId,
    })
  ).rejects.toThrow('Forbidden');

  const rows = await throttleRows(t);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.count)).toEqual([3, 3]);
  expect(await auditRows(t)).toHaveLength(0);
});

test('listBlocked is owner-only: no identity, a stranger and a missing business are all refused', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  await expect(t.query(api.orderBlocks.listBlocked, { businessId: f.businessA })).rejects.toThrow(
    'Unauthorized'
  );
  await expect(
    asOwner(t, STRANGER).query(api.orderBlocks.listBlocked, { businessId: f.businessA })
  ).rejects.toThrow('Forbidden');
  await expect(
    asOwner(t, OWNER_A).query(api.orderBlocks.listBlocked, { businessId: f.missingBusinessId })
  ).rejects.toThrow('Forbidden');
});

// ---------------------------------------------------------------------------
// Contract 2: cross-business isolation
// ---------------------------------------------------------------------------

test('clearContactThrottle answers a foreign order and a missing order with the identical ORDER_NOT_FOUND envelope', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  const foreignOrderId = await insertOrder(t, f.businessB, {
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
  });
  const missingOrderId = await insertOrder(t, f.businessA);
  await t.run((ctx) => ctx.db.delete(missingOrderId));

  const foreign = await expectOrderError(
    asOwner(t, OWNER_A).mutation(api.orderBlocks.clearContactThrottle, {
      businessId: f.businessA,
      orderId: foreignOrderId,
    }),
    'ORDER_NOT_FOUND'
  );
  const missing = await expectOrderError(
    asOwner(t, OWNER_A).mutation(api.orderBlocks.clearContactThrottle, {
      businessId: f.businessA,
      orderId: missingOrderId,
    }),
    'ORDER_NOT_FOUND'
  );

  // A cross-business id must not disclose that the order exists.
  expect(foreign).toEqual(missing);
  expect(foreign.message).toBe(ORDER_ERRORS.ORDER_NOT_FOUND.message);
  expect(Object.keys(foreign).sort()).toEqual(['code', 'message']);
  expect(await auditRows(t)).toHaveLength(0);
});

test('a block is per business: invisible to the other owner and it refuses only its own business', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  const block = await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
    businessId: f.businessA,
    phone: RAW_PHONE,
    email: RAW_EMAIL,
  });
  expect(block).toEqual({ created: 2 });

  expect(
    await asOwner(t, OWNER_B).query(api.orderBlocks.listBlocked, { businessId: f.businessB })
  ).toEqual([]);
  expect(
    await asOwner(t, OWNER_A).query(api.orderBlocks.listBlocked, { businessId: f.businessA })
  ).toHaveLength(2);

  // The same contact is accepted by business B and refused by business A.
  const accepted = await t.mutation(
    api.orders.placeOrder,
    basketArgs(f.businessB, f.itemB, { idempotencyKey: 'isolation-b' })
  );
  expect(accepted.orderId).toBeDefined();
  expect(await orders(t)).toHaveLength(1);

  await expectOrderError(
    t.mutation(
      api.orders.placeOrder,
      basketArgs(f.businessA, f.itemA, { idempotencyKey: 'isolation-a' })
    ),
    'ORDER_NOT_ACCEPTED'
  );
  expect(await orders(t)).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Contract 3: one audit row per real action, masked targetName
// ---------------------------------------------------------------------------

test('each real block, unblock and clear writes exactly one audit row with a masked targetName', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  const block = await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
    businessId: f.businessA,
    phone: RAW_PHONE,
    email: RAW_EMAIL,
    reason: '  Spam  ',
  });
  expect(block).toEqual({ created: 2 });

  const unblock = await asOwner(t, OWNER_A).mutation(api.orderBlocks.unblockContact, {
    businessId: f.businessA,
    phone: RAW_PHONE,
    email: RAW_EMAIL,
  });
  expect(unblock).toEqual({ removed: 2 });

  const receipt = await t.mutation(api.orders.placeOrder, basketArgs(f.businessA, f.itemA));
  const clear = await asOwner(t, OWNER_A).mutation(api.orderBlocks.clearContactThrottle, {
    businessId: f.businessA,
    orderId: receipt.orderId,
  });
  expect(clear).toEqual({ cleared: 2 });

  const audits = await auditRows(t);
  expect(audits).toHaveLength(3);

  const blockAudit = onlyAudit(audits, 'order.block_contact');
  expect(blockAudit.actorUserId).toBe(f.ownerAId);
  expect(blockAudit.targetType).toBe('order_contact');
  expect(blockAudit.targetId).toBe(String(f.businessA));
  expect(blockAudit.targetName).toBe(MASKED_LABEL);
  expect(blockAudit.reason).toBe('Spam');

  const unblockAudit = onlyAudit(audits, 'order.unblock_contact');
  expect(unblockAudit.actorUserId).toBe(f.ownerAId);
  expect(unblockAudit.targetType).toBe('order_contact');
  expect(unblockAudit.targetId).toBe(String(f.businessA));
  expect(unblockAudit.targetName).toBe(MASKED_LABEL);

  const clearAudit = onlyAudit(audits, 'order.clear_throttle');
  expect(clearAudit.actorUserId).toBe(f.ownerAId);
  expect(clearAudit.targetType).toBe('order');
  expect(clearAudit.targetId).toBe(String(receipt.orderId));
  expect(clearAudit.targetName).toBe(MASKED_LABEL);

  for (const audit of [blockAudit, unblockAudit, clearAudit]) {
    const name = audit.targetName ?? '';
    expect(name).not.toContain(RAW_PHONE);
    expect(name).not.toContain(RAW_PHONE_DIGITS);
    expect(name).not.toContain(RAW_EMAIL);
    expect(name).not.toBe(`${RAW_PHONE} / ${RAW_EMAIL}`);
    expect(JSON.stringify(audit)).not.toContain(RAW_PHONE_DIGITS);
    expect(JSON.stringify(audit)).not.toContain(RAW_EMAIL);
  }
});

// ---------------------------------------------------------------------------
// Contract 4: no-op writes write nothing and audit nothing
// ---------------------------------------------------------------------------

test('repeated block/unblock and a clear with no rows write nothing and add no audit row', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const channels = { businessId: f.businessA, phone: RAW_PHONE, email: RAW_EMAIL };

  const first = await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, channels);
  expect(first).toEqual({ created: 2 });

  const repeated = await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, channels);
  expect(repeated).toEqual({ created: 0 });
  expect(await blockRows(t)).toHaveLength(2);
  expect(auditsFor(await auditRows(t), 'order.block_contact')).toHaveLength(1);

  const unblock = await asOwner(t, OWNER_A).mutation(api.orderBlocks.unblockContact, channels);
  expect(unblock).toEqual({ removed: 2 });

  const repeatedUnblock = await asOwner(t, OWNER_A).mutation(
    api.orderBlocks.unblockContact,
    channels
  );
  expect(repeatedUnblock).toEqual({ removed: 0 });
  expect(await blockRows(t)).toHaveLength(0);
  expect(auditsFor(await auditRows(t), 'order.unblock_contact')).toHaveLength(1);

  // An order whose contact has no throttle rows: nothing to clear.
  const orderId = await insertOrder(t, f.businessA, {
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
  });
  const clear = await asOwner(t, OWNER_A).mutation(api.orderBlocks.clearContactThrottle, {
    businessId: f.businessA,
    orderId,
  });
  expect(clear).toEqual({ cleared: 0 });
  expect(await throttleRows(t)).toHaveLength(0);
  expect(auditsFor(await auditRows(t), 'order.clear_throttle')).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Contract 5: block -> refuse -> unblock -> the same submission succeeds
// ---------------------------------------------------------------------------

test('round trip: block refuses with ORDER_NOT_ACCEPTED and no contact slots, unblock accepts the same submission', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const args = basketArgs(f.businessA, f.itemA, { idempotencyKey: 'round-trip-1' });

  const block = await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
    businessId: f.businessA,
    phone: RAW_PHONE,
    email: RAW_EMAIL,
  });
  expect(block).toEqual({ created: 2 });
  expect(await blockRows(t)).toHaveLength(2);

  const refused = await expectOrderError(
    t.mutation(api.orders.placeOrder, args),
    'ORDER_NOT_ACCEPTED'
  );
  expect(refused.message).toBe(ORDER_ERRORS.ORDER_NOT_ACCEPTED.message);
  expect(Object.keys(refused).sort()).toEqual(['code', 'message']);
  // The block check precedes the contact throttle, so no contact slot was spent.
  expect(await contactThrottleRows(t)).toHaveLength(0);
  expect(await orders(t)).toHaveLength(0);

  const unblock = await asOwner(t, OWNER_A).mutation(api.orderBlocks.unblockContact, {
    businessId: f.businessA,
    phone: RAW_PHONE,
    email: RAW_EMAIL,
  });
  expect(unblock).toEqual({ removed: 2 });
  expect(await blockRows(t)).toHaveLength(0);

  const accepted = await t.mutation(api.orders.placeOrder, args);
  expect(accepted.orderId).toBeDefined();
  expect(await orders(t)).toHaveLength(1);
  expect(await contactThrottleRows(t)).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Contract 6: a block per channel refuses a dual-channel submission
// ---------------------------------------------------------------------------

test('a per-channel block refuses the same phone+email submission for either channel alone', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const args = basketArgs(f.businessA, f.itemA, { idempotencyKey: 'per-channel-1' });

  const emailOnly = await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
    businessId: f.businessA,
    email: RAW_EMAIL,
  });
  expect(emailOnly).toEqual({ created: 1 });
  expect(
    await asOwner(t, OWNER_A).query(api.orderBlocks.listBlocked, { businessId: f.businessA })
  ).toHaveLength(1);
  await expectOrderError(t.mutation(api.orders.placeOrder, args), 'ORDER_NOT_ACCEPTED');

  const emailUnblock = await asOwner(t, OWNER_A).mutation(api.orderBlocks.unblockContact, {
    businessId: f.businessA,
    email: RAW_EMAIL,
  });
  expect(emailUnblock).toEqual({ removed: 1 });

  const phoneOnly = await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
    businessId: f.businessA,
    phone: RAW_PHONE,
  });
  expect(phoneOnly).toEqual({ created: 1 });
  expect(
    await asOwner(t, OWNER_A).query(api.orderBlocks.listBlocked, { businessId: f.businessA })
  ).toHaveLength(1);
  await expectOrderError(t.mutation(api.orders.placeOrder, args), 'ORDER_NOT_ACCEPTED');

  // The phone row exists already; only the email row is new, so listBlocked
  // tracks the row count exactly.
  const both = await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
    businessId: f.businessA,
    phone: RAW_PHONE,
    email: RAW_EMAIL,
  });
  expect(both).toEqual({ created: 1 });
  expect(
    await asOwner(t, OWNER_A).query(api.orderBlocks.listBlocked, { businessId: f.businessA })
  ).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Contract 7: audited throttle clear restores submit capability
// ---------------------------------------------------------------------------

test('clearContactThrottle restores the contact windows to one slot and never touches the block list', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  // A block for a different contact must survive the clear untouched.
  const kept = await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
    businessId: f.businessA,
    phone: '555-9999',
  });
  expect(kept).toEqual({ created: 1 });
  const blocksBefore = await blockRows(t);
  expect(blocksBefore).toHaveLength(1);
  const keptBlockId = blocksBefore[0]._id;

  const receipts: { orderId: Id<'orders'> }[] = [];
  for (let index = 0; index < 3; index += 1) {
    receipts.push(
      await t.mutation(
        api.orders.placeOrder,
        basketArgs(f.businessA, f.itemA, { idempotencyKey: `throttle-${index}` })
      )
    );
  }

  const atLimit = await contactThrottleRows(t);
  expect(atLimit).toHaveLength(2);
  expect(atLimit.map((row) => row.count).sort()).toEqual([3, 3]);

  const refused = await expectOrderError(
    t.mutation(
      api.orders.placeOrder,
      basketArgs(f.businessA, f.itemA, { idempotencyKey: 'throttle-3' })
    ),
    'TOO_MANY_REQUESTS'
  );
  // The window opened at NOW, so a full ten minutes remain.
  expect(refused.retryAfterMs).toBe(600_000);
  // A rejected submission consumes no slot.
  expect((await contactThrottleRows(t)).map((row) => row.count).sort()).toEqual([3, 3]);

  const cleared = await asOwner(t, OWNER_A).mutation(api.orderBlocks.clearContactThrottle, {
    businessId: f.businessA,
    orderId: receipts[1].orderId,
  });
  expect(cleared).toEqual({ cleared: 2 });
  expect(await contactThrottleRows(t)).toHaveLength(0);

  const blocksAfterClear = await blockRows(t);
  expect(blocksAfterClear).toHaveLength(1);
  expect(blocksAfterClear[0]._id).toBe(keptBlockId);

  const accepted = await t.mutation(
    api.orders.placeOrder,
    basketArgs(f.businessA, f.itemA, { idempotencyKey: 'throttle-4' })
  );
  expect(accepted.orderId).toBeDefined();

  const recreated = await contactThrottleRows(t);
  expect(recreated).toHaveLength(2);
  expect(recreated.map((row) => row.count).sort()).toEqual([1, 1]);
  expect(recreated.map((row) => row.windowStart)).toEqual([NOW, NOW]);
});

// ---------------------------------------------------------------------------
// Contracts 8 and 9: privacy, payload projection, ordering and bound
// ---------------------------------------------------------------------------

test('orderBlocks rows and the listBlocked payload carry only hashes, never the raw contact', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
    businessId: f.businessA,
    phone: RAW_PHONE,
    email: RAW_EMAIL,
    reason: 'Spam',
  });

  const rows = await blockRows(t);
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    const domainKeys = Object.keys(row)
      .filter((key) => key !== '_id' && key !== '_creationTime')
      .sort();
    expect(domainKeys).toEqual(
      ['businessId', 'contactHash', 'createdAt', 'createdByUserId', 'reason'].sort()
    );
    expect(row.businessId).toBe(f.businessA);
    expect(row.createdByUserId).toBe(f.ownerAId);
    expect(row.createdAt).toBe(NOW);
    expect(row.contactHash).toMatch(/^[0-9a-f]{64}$/);

    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(RAW_PHONE);
    expect(serialized).not.toContain(RAW_PHONE_DIGITS);
    expect(serialized).not.toContain(RAW_EMAIL);
  }
  // Domain separation: one digest per present channel.
  const hashes = rows.map((row) => row.contactHash);
  expect(new Set(hashes).size).toBe(2);

  const listed = await asOwner(t, OWNER_A).query(api.orderBlocks.listBlocked, {
    businessId: f.businessA,
  });
  expect(listed).toHaveLength(2);
  for (const item of listed) {
    expect(Object.keys(item).sort()).toEqual(['_id', 'createdAt', 'reason'].sort());
    expect('contactHash' in item).toBe(false);

    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain(RAW_PHONE);
    expect(serialized).not.toContain(RAW_PHONE_DIGITS);
    expect(serialized).not.toContain(RAW_EMAIL);
    for (const hash of hashes) {
      expect(serialized).not.toContain(hash);
    }
  }
});

test('listBlocked returns newest first and omits contactHash', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
    businessId: f.businessA,
    phone: '555-0001',
    reason: 'older',
  });
  vi.setSystemTime(NOW + 1_000);
  await asOwner(t, OWNER_A).mutation(api.orderBlocks.blockContact, {
    businessId: f.businessA,
    phone: '555-0002',
    reason: 'newer',
  });

  const listed = await asOwner(t, OWNER_A).query(api.orderBlocks.listBlocked, {
    businessId: f.businessA,
  });
  expect(listed).toHaveLength(2);
  expect(listed.map((item) => item.createdAt)).toEqual([NOW + 1_000, NOW]);
  expect(listed.map((item) => item.reason)).toEqual(['newer', 'older']);
  for (const item of listed) {
    expect('contactHash' in item).toBe(false);
  }
});

test('listBlocked is bounded at 200 rows and every item is still sorted newest first', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  await t.run(async (ctx) => {
    for (let index = 0; index < 201; index += 1) {
      await ctx.db.insert('orderBlocks', {
        businessId: f.businessA,
        contactHash: index.toString(16).padStart(64, '0'),
        reason: `bulk-${index}`,
        createdByUserId: f.ownerAId,
        createdAt: NOW + index,
      });
    }
  });

  const listed = await asOwner(t, OWNER_A).query(api.orderBlocks.listBlocked, {
    businessId: f.businessA,
  });
  expect(listed).toHaveLength(200);
  for (let index = 1; index < listed.length; index += 1) {
    expect(listed[index].createdAt).toBeLessThanOrEqual(listed[index - 1].createdAt);
  }
  for (const item of listed) {
    expect(Object.keys(item).sort()).toEqual(['_id', 'createdAt', 'reason'].sort());
    expect('contactHash' in item).toBe(false);
  }
});
