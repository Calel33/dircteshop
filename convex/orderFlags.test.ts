/// <reference types="vite/client" />
/**
 * Handler-level suite for the owner fake-order flag slice (issue #84, T10 /
 * Phase 2, task T3).
 *
 * Drives the REAL `convex/orderFlags.ts` mutations against the `convex-test`
 * mock backend, so the public owner surface is proven at the function boundary:
 *   - owner-only authorization (no identity, a stranger, a foreign order);
 *   - idempotent re-flag / unflag no-ops that write nothing and audit nothing;
 *   - unflag deactivating a row in place (never deleting it);
 *   - exactly one `auditLogs` row per real state change, masked `targetName`;
 *   - re-flag reactivating the same logical row;
 *   - a flag surviving an owner decision (accept), so the abuse rate still
 *     counts it;
 *   - a well-formed but missing order id answering the typed envelope.
 *
 * `now` is deterministic: only `Date` is faked (as in `convex/orders.test.ts`
 * and `convex/orderBlocks.test.ts`), so `convex-test`'s async plumbing keeps a
 * real `setTimeout` and no test sleeps. Fixtures are local; the global seed
 * script is not used.
 *
 * Run: pnpm exec vitest run convex/orderFlags.test.ts
 */
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import { convexTest } from 'convex-test';

import schema from './schema';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { ORDER_ERRORS } from './orderCommitPolicy';

const modules = import.meta.glob('./**/*.ts');

// Tue 2023-11-14 22:13:20 UTC = 17:13 in America/New_York.
const NOW = 1_700_000_000_000;

const OWNER = 'user_owner';
/** A real user row that owns no business: the guard's ownership arm, not its null arm. */
const STRANGER = 'user_other';
const OTHER_OWNER = 'user_other_owner';

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

type TestBackend = ReturnType<typeof convexTest>;

type FlagFixtures = {
  ownerId: Id<'users'>;
  strangerId: Id<'users'>;
  otherOwnerId: Id<'users'>;
  businessId: Id<'businesses'>;
  otherBusinessId: Id<'businesses'>;
};

async function insertBusiness(
  ctx: MutationCtx,
  args: { ownerId: Id<'users'>; categoryId: Id<'categories'>; name: string }
): Promise<Id<'businesses'>> {
  return await ctx.db.insert('businesses', {
    name: args.name,
    categoryId: args.categoryId,
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
    searchText: args.name,
    ownerId: args.ownerId,
    lastUpdatedAt: NOW,
    isFeatured: false,
    lastSavedAt: NOW,
  });
}

/** One owned business, one other owner's business, and a non-owner user. */
async function seed(t: TestBackend): Promise<FlagFixtures> {
  return await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert('users', {
      name: 'Maya Owner',
      externalId: OWNER,
      role: 'user',
    });
    const strangerId = await ctx.db.insert('users', {
      name: 'Sam Stranger',
      externalId: STRANGER,
      role: 'user',
    });
    const otherOwnerId = await ctx.db.insert('users', {
      name: 'Other Owner',
      externalId: OTHER_OWNER,
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
      name: 'Blue Harbor Diner',
    });
    const otherBusinessId = await insertBusiness(ctx, {
      ownerId: otherOwnerId,
      categoryId,
      name: 'Other Diner',
    });

    return { ownerId, strangerId, otherOwnerId, businessId, otherBusinessId };
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

/** The owner guard reads only `identity.subject` (`authz.ts`). */
function asOwner(t: TestBackend, subject: string) {
  return t.withIdentity({ subject });
}

function flagRows(t: TestBackend) {
  return t.run((ctx) => ctx.db.query('orderFlags').collect());
}

function auditRows(t: TestBackend) {
  return t.run((ctx) => ctx.db.query('auditLogs').collect());
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
// Contract 1: owner-only authorization
// ---------------------------------------------------------------------------

test('flagOrder is owner-only: no identity is Unauthorized and a non-owner is Forbidden', async () => {
  // Canary: a silent fake-Date no-op would make every NOW assertion meaningless.
  expect(Date.now()).toBe(NOW);

  const t = convexTest(schema, modules);
  const f = await seed(t);
  const orderId = await insertOrder(t, f.businessId, {
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
  });
  const args = { businessId: f.businessId, orderId, reason: 'Fake order' as const };

  await expect(t.mutation(api.orderFlags.flagOrder, args)).rejects.toThrow('Unauthorized');
  await expect(asOwner(t, STRANGER).mutation(api.orderFlags.flagOrder, args)).rejects.toThrow(
    'Forbidden'
  );

  expect(await flagRows(t)).toHaveLength(0);
  expect(await auditRows(t)).toHaveLength(0);
});

test('unflagOrder is owner-only and a rejected caller leaves the flag active', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const orderId = await insertOrder(t, f.businessId, {
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
  });

  // A real flag, so the refusals below have something they could destroy.
  await asOwner(t, OWNER).mutation(api.orderFlags.flagOrder, {
    businessId: f.businessId,
    orderId,
    reason: 'Duplicate' as const,
  });
  expect(await flagRows(t)).toHaveLength(1);

  const args = { businessId: f.businessId, orderId };
  await expect(t.mutation(api.orderFlags.unflagOrder, args)).rejects.toThrow('Unauthorized');
  await expect(asOwner(t, STRANGER).mutation(api.orderFlags.unflagOrder, args)).rejects.toThrow(
    'Forbidden'
  );

  const rows = await flagRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0].active).toBe(true);
  expect(auditsFor(await auditRows(t), 'order.unflag')).toHaveLength(0);
});

test("an owner flagging another business's order gets ORDER_NOT_FOUND and writes nothing", async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const foreignOrderId = await insertOrder(t, f.otherBusinessId, {
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
  });

  // The caller owns `businessId`, so the guard passes; the order scope check is
  // what refuses. Same envelope as a missing order: no existence disclosure.
  const flagError = await expectOrderError(
    asOwner(t, OWNER).mutation(api.orderFlags.flagOrder, {
      businessId: f.businessId,
      orderId: foreignOrderId,
      reason: 'Prank' as const,
    }),
    'ORDER_NOT_FOUND'
  );
  const unflagError = await expectOrderError(
    asOwner(t, OWNER).mutation(api.orderFlags.unflagOrder, {
      businessId: f.businessId,
      orderId: foreignOrderId,
    }),
    'ORDER_NOT_FOUND'
  );

  expect(flagError).toEqual(unflagError);
  expect(flagError.message).toBe(ORDER_ERRORS.ORDER_NOT_FOUND.message);
  expect(Object.keys(flagError).sort()).toEqual(['code', 'message']);
  expect(await flagRows(t)).toHaveLength(0);
  expect(await auditRows(t)).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Contract 2: idempotency — a no-op writes nothing and audits nothing
// ---------------------------------------------------------------------------

test('re-flagging an active order returns { changed: false } and writes no second row or audit', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const orderId = await insertOrder(t, f.businessId, {
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
  });
  const args = { businessId: f.businessId, orderId, reason: 'Fake order' as const };

  const first = await asOwner(t, OWNER).mutation(api.orderFlags.flagOrder, args);
  expect(first).toEqual({ changed: true });

  const repeated = await asOwner(t, OWNER).mutation(api.orderFlags.flagOrder, args);
  expect(repeated).toEqual({ changed: false });

  const rows = await flagRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0].active).toBe(true);

  const flagAudits = auditsFor(await auditRows(t), 'order.flag');
  expect(flagAudits).toHaveLength(1);
  expect(flagAudits[0].reason).toBe('Fake order');
});

test('unflagging an order with no flag row is a no-op success with no write and no audit', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const orderId = await insertOrder(t, f.businessId);

  const result = await asOwner(t, OWNER).mutation(api.orderFlags.unflagOrder, {
    businessId: f.businessId,
    orderId,
  });
  expect(result).toEqual({ changed: false });

  expect(await flagRows(t)).toHaveLength(0);
  expect(await auditRows(t)).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Contract 3: unflag deactivates in place, never deletes
// ---------------------------------------------------------------------------

test('unflagOrder clears the flag without deleting the row', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const orderId = await insertOrder(t, f.businessId, {
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
  });

  await asOwner(t, OWNER).mutation(api.orderFlags.flagOrder, {
    businessId: f.businessId,
    orderId,
    reason: 'Wrong number' as const,
  });
  const [before] = await flagRows(t);
  expect(await flagRows(t)).toHaveLength(1);

  const cleared = await asOwner(t, OWNER).mutation(api.orderFlags.unflagOrder, {
    businessId: f.businessId,
    orderId,
  });
  expect(cleared).toEqual({ changed: true });

  const rows = await flagRows(t);
  // Deletion is never equivalent: the same document survives, deactivated.
  expect(rows).toHaveLength(1);
  expect(rows[0]._id).toBe(before._id);
  expect(rows[0].active).toBe(false);

  // An inactive flag is the second no-op arm: success, no write, no audit.
  const repeated = await asOwner(t, OWNER).mutation(api.orderFlags.unflagOrder, {
    businessId: f.businessId,
    orderId,
  });
  expect(repeated).toEqual({ changed: false });
  expect(await flagRows(t)).toHaveLength(1);
  expect(await auditRows(t)).toHaveLength(2); // one flag, one unflag
});

// ---------------------------------------------------------------------------
// Contract 4: exactly one masked audit row per real state change
// ---------------------------------------------------------------------------

test('each real flag and unflag writes exactly one audit row with a masked targetName', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const orderId = await insertOrder(t, f.businessId, {
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
  });

  await asOwner(t, OWNER).mutation(api.orderFlags.flagOrder, {
    businessId: f.businessId,
    orderId,
    reason: 'Fake order' as const,
  });
  await asOwner(t, OWNER).mutation(api.orderFlags.unflagOrder, {
    businessId: f.businessId,
    orderId,
  });

  const audits = await auditRows(t);
  expect(audits).toHaveLength(2);

  const flagAudit = onlyAudit(audits, 'order.flag');
  expect(flagAudit.actorUserId).toBe(f.ownerId);
  expect(flagAudit.targetType).toBe('order');
  expect(flagAudit.targetId).toBe(String(orderId));
  expect(flagAudit.targetName).toBe(MASKED_LABEL);
  expect(flagAudit.reason).toBe('Fake order');
  expect(flagAudit.createdAt).toBe(NOW);

  const unflagAudit = onlyAudit(audits, 'order.unflag');
  expect(unflagAudit.actorUserId).toBe(f.ownerId);
  expect(unflagAudit.targetType).toBe('order');
  expect(unflagAudit.targetId).toBe(String(orderId));
  expect(unflagAudit.targetName).toBe(MASKED_LABEL);
  expect(unflagAudit.createdAt).toBe(NOW);

  for (const audit of [flagAudit, unflagAudit]) {
    const name = audit.targetName ?? '';
    expect(name).not.toContain(RAW_PHONE);
    expect(name).not.toContain(RAW_PHONE_DIGITS);
    expect(name).not.toContain(RAW_EMAIL);
    expect(name).toBe(`${MASKED_PHONE} / ${MASKED_EMAIL}`);
    expect(JSON.stringify(audit)).not.toContain(RAW_PHONE_DIGITS);
    expect(JSON.stringify(audit)).not.toContain(RAW_EMAIL);
  }
});

// ---------------------------------------------------------------------------
// Contract 5: reactivation reuses the single row per order
// ---------------------------------------------------------------------------

test('re-flagging an unflagged order reactivates the same row', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const orderId = await insertOrder(t, f.businessId, {
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
  });

  await asOwner(t, OWNER).mutation(api.orderFlags.flagOrder, {
    businessId: f.businessId,
    orderId,
    reason: 'Fake order' as const,
  });
  const [original] = await flagRows(t);
  await asOwner(t, OWNER).mutation(api.orderFlags.unflagOrder, {
    businessId: f.businessId,
    orderId,
  });

  // Move the clock so a fresh insert and a reactivating patch are distinguishable.
  vi.setSystemTime(NOW + 60_000);
  const reactivated = await asOwner(t, OWNER).mutation(api.orderFlags.flagOrder, {
    businessId: f.businessId,
    orderId,
    reason: 'Other' as const,
  });
  expect(reactivated).toEqual({ changed: true });

  const rows = await flagRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0]._id).toBe(original._id);
  expect(rows[0].active).toBe(true);
  expect(rows[0].actorUserId).toBe(f.ownerId);
  expect(rows[0].createdAt).toBe(NOW + 60_000);
  expect(auditsFor(await auditRows(t), 'order.flag')).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Contract 6: a flag survives an owner decision (abuse-rate input)
// ---------------------------------------------------------------------------

test('an order accepted before the flag is still flagged and counted', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);
  const orderId = await insertOrder(t, f.businessId, {
    contactPhone: RAW_PHONE,
    contactEmail: RAW_EMAIL,
  });

  const accepted = await asOwner(t, OWNER).mutation(api.orders.transitionOrderStatus, {
    businessId: f.businessId,
    orderId,
    action: 'accept' as const,
  });
  expect(accepted).toEqual({ status: 'accepted', reused: false });

  const flagged = await asOwner(t, OWNER).mutation(api.orderFlags.flagOrder, {
    businessId: f.businessId,
    orderId,
    reason: 'Fake order' as const,
  });
  expect(flagged).toEqual({ changed: true });

  const rows = await flagRows(t);
  expect(rows).toHaveLength(1);
  expect(rows[0].orderId).toBe(orderId);
  expect(rows[0].businessId).toBe(f.businessId);
  expect(rows[0].active).toBe(true);
});

// ---------------------------------------------------------------------------
// Contract 7: a well-formed but missing order id is a typed refusal
// ---------------------------------------------------------------------------

test('a missing order id answers ORDER_NOT_FOUND and writes nothing', async () => {
  const t = convexTest(schema, modules);
  const f = await seed(t);

  const missingOrderId = await insertOrder(t, f.businessId);
  await t.run((ctx) => ctx.db.delete(missingOrderId));

  const flagError = await expectOrderError(
    asOwner(t, OWNER).mutation(api.orderFlags.flagOrder, {
      businessId: f.businessId,
      orderId: missingOrderId,
      reason: 'Other' as const,
    }),
    'ORDER_NOT_FOUND'
  );
  const unflagError = await expectOrderError(
    asOwner(t, OWNER).mutation(api.orderFlags.unflagOrder, {
      businessId: f.businessId,
      orderId: missingOrderId,
    }),
    'ORDER_NOT_FOUND'
  );

  expect(flagError).toEqual(unflagError);
  expect(flagError.message).toBe(ORDER_ERRORS.ORDER_NOT_FOUND.message);
  expect(await flagRows(t)).toHaveLength(0);
  expect(await auditRows(t)).toHaveLength(0);
});
