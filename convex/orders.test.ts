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
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import { convexTest } from 'convex-test';
import type { TestConvex } from 'convex-test';

import schema from './schema';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { DEFAULT_TTL_MS, VISITOR_CANCEL_REASON } from './orderCommitPolicy';
import { businessThrottleKey } from './orderThrottle';

const modules = import.meta.glob('./**/*.ts');
const NOW = 1_700_000_000_000;

// D13/Q4: pin `Date` only. `setTimeout` stays real so `convex-test`'s async
// plumbing cannot stall; the canary in the first basket test proves the VM's
// `Date` is actually the patched one (a silent no-op must not read as a pass).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

type TestBackend = ReturnType<typeof convexTest>;

// Explicit result shapes break the inference cycle between `t.mutation` and the
// module map (TS7022) and double as the contract these helpers rely on.
type BackfillBatchResult = {
  processed: number;
  inserted: number;
  skipped: number;
  patched: number;
  unpatchable: number;
  dryRun: boolean;
  isDone: boolean;
  nextCursor: string;
};

type BackfillStatusResult = {
  table: 'orders' | 'orderAccess';
  count: number;
  isDone: boolean;
  nextCursor: string;
};

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

/**
 * Drives `backfillBatch` from `null` to `isDone`, small pages by default so the
 * cursor path is exercised. Throws on a non-terminating run instead of hanging.
 */
async function runBackfill(t: TestBackend, options: { dryRun?: boolean; maxBatchSize?: number } = {}) {
  const totals = { processed: 0, inserted: 0, skipped: 0, patched: 0, unpatchable: 0 };
  let cursor: string | null = null;
  let isDone = false;
  let runs = 0;

  while (!isDone) {
    const result: BackfillBatchResult = await t.mutation(
      internal.migrations.backfillOrderAccess.backfillBatch,
      {
        paginationOpts: { numItems: options.maxBatchSize ?? 2, cursor },
        dryRun: options.dryRun,
        maxBatchSize: options.maxBatchSize,
      }
    );
    totals.processed += result.processed;
    totals.inserted += result.inserted;
    totals.skipped += result.skipped;
    totals.patched += result.patched;
    totals.unpatchable += result.unpatchable;
    cursor = result.nextCursor;
    isDone = result.isDone;
    runs += 1;
    if (runs > 50) {
      throw new Error('backfillBatch did not terminate');
    }
  }

  return { ...totals, runs };
}

/** Sums `backfillStatus` pages for one table (the production count-gate recipe). */
async function countTable(t: TestBackend, table: 'orders' | 'orderAccess') {
  let cursor: string | null = null;
  let isDone = false;
  let total = 0;

  while (!isDone) {
    const page: BackfillStatusResult = await t.query(
      internal.migrations.backfillOrderAccess.backfillStatus,
      {
        table,
        paginationOpts: { numItems: 2, cursor },
      }
    );
    total += page.count;
    cursor = page.nextCursor;
    isDone = page.isDone;
  }

  return total;
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

  await expectOrderError(
    t.withIdentity({ subject: 'user_owner' }).mutation(api.orders.transitionOrderStatus, {
      businessId,
      orderId,
      action: 'ready',
    }),
    'INVALID_TRANSITION'
  );
});

test('a terminal order rejects every further transition', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));
  const asOwner = t.withIdentity({ subject: 'user_owner' });

  for (const action of ['accept', 'ready', 'complete'] as const) {
    await asOwner.mutation(api.orders.transitionOrderStatus, { businessId, orderId, action });
  }

  await expectOrderError(
    asOwner.mutation(api.orders.transitionOrderStatus, { businessId, orderId, action: 'accept' }),
    'ORDER_TERMINAL'
  );
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

test('legacy-only rows project through the live join and expose no pricing source', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  const rows = await t
    .withIdentity({ subject: 'user_owner' })
    .query(api.orders.listOrders, { businessId });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.itemName).toBe('Grain Bowl');
  expect(rows[0]?.itemPrice).toBe(1200);
  expect(rows[0]?.pricingSource).toBeNull();
  expect(rows[0]?.selections).toEqual([{ optionName: 'Base', choiceName: 'Rice' }]);

  expect(await t.query(api.orders.getOrderStatus, { orderId })).toEqual({
    status: 'new',
    createdAt: expect.any(Number),
  });
});

test('a committed items[] snapshot wins over the live join and stays unpriced', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.run((ctx) =>
    ctx.db.insert('orders', {
      businessId,
      menuItemId,
      items: [
        {
          menuItemId,
          name: 'Snapshot Bowl',
          quantity: 2,
          // `unitPrice` / `lineTotal` deliberately absent: unpriced line.
          selections: [{ optionName: 'Base', choiceName: 'Greens' }],
        },
      ],
      pricingSource: 'legacyUnknown',
      customerName: 'Grace Hopper',
      status: 'new',
      createdAt: NOW,
    })
  );

  const rows = await t
    .withIdentity({ subject: 'user_owner' })
    .query(api.orders.listOrders, { businessId });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.itemName).toBe('Snapshot Bowl');
  expect(rows[0]?.itemPrice).toBeNull();
  expect(rows[0]?.pricingSource).toBe('legacyUnknown');
  expect(rows[0]?.selections).toEqual([{ optionName: 'Base', choiceName: 'Greens' }]);

  const status = await t.query(api.orders.getOrderStatus, { orderId });
  expect(Object.keys(status ?? {}).sort()).toEqual(['createdAt', 'status']);
});

test('the backfill is idempotent and creates exactly one orderAccess per order', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  for (const customerName of ['Ada', 'Grace', 'Katherine']) {
    await t.mutation(api.orders.submitOrder, {
      ...validArgs(businessId, menuItemId),
      customerName,
    });
  }

  const first = await runBackfill(t, { maxBatchSize: 2 });
  expect(first).toMatchObject({
    processed: 3,
    inserted: 3,
    skipped: 0,
    patched: 3,
    unpatchable: 0,
    runs: 2,
  });

  // A completed rerun walks every row but writes nothing.
  const second = await runBackfill(t, { maxBatchSize: 2 });
  expect(second).toMatchObject({
    processed: 3,
    inserted: 0,
    skipped: 3,
    patched: 0,
    runs: 2,
  });

  const accessRows = await t.run((ctx) => ctx.db.query('orderAccess').collect());
  expect(accessRows).toHaveLength(3);
  expect(new Set(accessRows.map((row) => row.orderId)).size).toBe(3);

  expect(await countTable(t, 'orders')).toBe(3);
  expect(await countTable(t, 'orderAccess')).toBe(3);
});

test('a backfilled order never borrows a later menu price (R11)', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));
  await runBackfill(t);

  await t.run((ctx) => ctx.db.patch(menuItemId, { price: 9999 }));

  const rows = await t
    .withIdentity({ subject: 'user_owner' })
    .query(api.orders.listOrders, { businessId });
  expect(rows[0]?.itemPrice).toBeNull();
  expect(rows[0]?.pricingSource).toBe('legacyUnknown');

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  const line = order?.items?.[0];
  expect(line?.name).toBe('Grain Bowl');
  // Key absence, not `undefined`/`null`: the fields are unpriced by omission.
  expect(Object.keys(line ?? {})).not.toContain('unitPrice');
  expect(Object.keys(line ?? {})).not.toContain('lineTotal');
  expect(Object.keys(order ?? {})).not.toContain('subtotal');
});

test('a backfilled legacy new order gains no expiry row or expiresAt', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  await runBackfill(t);

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.status).toBe('new');
  expect(Object.keys(order ?? {})).not.toContain('expiresAt');

  const expiryRows = await t.run((ctx) => ctx.db.query('orderExpiry').collect());
  expect(expiryRows).toHaveLength(0);
});

test('a completed legacy order stays terminal through the backfill', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));
  const asOwner = t.withIdentity({ subject: 'user_owner' });

  for (const action of ['accept', 'ready', 'complete'] as const) {
    await asOwner.mutation(api.orders.transitionOrderStatus, { businessId, orderId, action });
  }

  await runBackfill(t);

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.status).toBe('completed');

  await expectOrderError(
    asOwner.mutation(api.orders.transitionOrderStatus, { businessId, orderId, action: 'accept' }),
    'ORDER_TERMINAL'
  );
});

test('a deleted menu item backfills as "(item removed)" with no price', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));
  await t.run((ctx) => ctx.db.delete(menuItemId));

  await runBackfill(t);

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  const line = order?.items?.[0];
  expect(line?.name).toBe('(item removed)');
  expect(line?.selections).toEqual([{ optionName: 'Base', choiceName: 'Rice' }]);
  expect(Object.keys(line ?? {})).not.toContain('unitPrice');
  expect(Object.keys(line ?? {})).not.toContain('lineTotal');
  expect(order?.pricingSource).toBe('legacyUnknown');
});

test('a dry run reports the work without writing it', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  for (const customerName of ['Ada', 'Grace']) {
    await t.mutation(api.orders.submitOrder, {
      ...validArgs(businessId, menuItemId),
      customerName,
    });
  }

  const dry = await runBackfill(t, { dryRun: true, maxBatchSize: 2 });
  expect(dry).toMatchObject({
    processed: 2,
    inserted: 2,
    skipped: 0,
    patched: 2,
    unpatchable: 0,
    runs: 1,
  });

  const accessRows = await t.run((ctx) => ctx.db.query('orderAccess').collect());
  expect(accessRows).toHaveLength(0);
  const orders = await t.run((ctx) => ctx.db.query('orders').collect());
  for (const order of orders) {
    expect(order.items).toBeUndefined();
    expect(order.pricingSource).toBeUndefined();
  }

  // The real run still finds the work the dry run reported.
  const real = await runBackfill(t, { maxBatchSize: 2 });
  expect(real).toMatchObject({ processed: 2, inserted: 2, patched: 2, skipped: 0 });
});

test('minted tokens and references satisfy the protocol invariants', async () => {
  // `convex-test` runs under `@edge-runtime/vm`, which forwards the HOST
  // `crypto` global. This proves the code shape (length, charset, uniqueness) —
  // NOT the deployed backend's seeded ChaCha12 RNG, which only a real
  // deployment exercises.
  const t = convexTest(schema, modules);
  const { businessId, menuItemId, otherBusinessId, otherMenuItemId } = await seed(t);
  await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));
  await t.mutation(api.orders.submitOrder, {
    ...validArgs(otherBusinessId, otherMenuItemId),
    selections: [],
  });
  // A third order forces the walk into a second backfillBatch execution: with
  // numItems 2 the first execution mints two rows and the second mints the
  // third, so token uniqueness below is proved ACROSS executions — a repeated
  // per-execution rng_seed would collide exactly there.
  await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  await runBackfill(t);

  const accessRows = await t.run((ctx) => ctx.db.query('orderAccess').collect());
  expect(accessRows).toHaveLength(3);
  expect(new Set(accessRows.map((row) => row.orderId)).size).toBe(3);

  const tokens = accessRows.map((row) => row.accessToken);
  for (const token of tokens) {
    // 32 bytes → 43 unpadded base64url chars.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  }
  // Cross-execution uniqueness (see the third order above): 64^43 outcomes per
  // token, so a replayed per-execution rng_seed shows up here as a duplicate
  // 43-char token. A forced reference-collision probe is impractical (32^6
  // candidates); the retry path is instead covered by the {6,7} length
  // assertion below, which accepts the 7-char fallback.
  expect(new Set(tokens).size).toBe(tokens.length);

  for (const row of accessRows) {
    // 6 chars, or 7 after the ≤5 collision retries; protocol alphabet only.
    expect(row.reference).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6,7}$/);
    expect(row.createdAt).toEqual(expect.any(Number));
  }

  for (const ownerBusinessId of new Set(accessRows.map((row) => row.businessId))) {
    const references = accessRows
      .filter((row) => row.businessId === ownerBusinessId)
      .map((row) => row.reference);
    expect(new Set(references).size).toBe(references.length);
  }
});

test('an order without menuItemId or items[] gets access but no fabricated line', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  const orderId = await t.run((ctx) =>
    ctx.db.insert('orders', {
      businessId,
      customerName: 'No Item',
      status: 'new',
      createdAt: NOW,
    })
  );

  const result = await runBackfill(t);
  expect(result).toMatchObject({
    processed: 1,
    inserted: 1,
    patched: 0,
    unpatchable: 1,
    skipped: 0,
  });

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.items).toBeUndefined();
  expect(Object.keys(order ?? {})).not.toContain('pricingSource');

  const accessRows = await t.run((ctx) => ctx.db.query('orderAccess').collect());
  expect(accessRows).toHaveLength(1);
  expect(accessRows[0]?.orderId).toBe(orderId);
});

// ---------------------------------------------------------------------------
// Basket protocol (T4, issue #78): `placeOrder` behind `orderProtocol: 'basket'`
//
// The legacy S0 suite above is unchanged and shares `seed()`, whose business has
// no `orderProtocol` (i.e. legacy). Every basket case opts in explicitly through
// `configureBasket`, so the flag gate itself stays observable.
// ---------------------------------------------------------------------------

type BasketBusinessPatch = {
  status?: Doc<'businesses'>['status'];
  orderProtocol?: 'legacy' | 'basket';
  acceptingOrders?: boolean;
  acceptingOrdersUntil?: number;
  hours?: Doc<'businesses'>['hours'];
  phone?: string;
};

/** Patches the basket flag (plus any hours/pause state a single case needs). */
async function configureBasket(
  t: TestBackend,
  businessId: Id<'businesses'>,
  patch: BasketBusinessPatch = {}
) {
  await t.run((ctx) => ctx.db.patch(businessId, { orderProtocol: 'basket', ...patch }));
}

type BasketLineArgs = {
  menuItemId: Id<'menuItems'>;
  quantity: number;
  selections?: { optionName: string; choiceName: string }[];
};

type BasketArgs = {
  businessId: Id<'businesses'>;
  lines: BasketLineArgs[];
  customerName: string;
  contactPhone: string;
  contactEmail: string;
  note?: string;
  expectedSubtotal: number | null;
  idempotencyKey: string;
};

/**
 * A valid two-unit basket on the seeded 1200-cent bowl. The default total is the
 * server's 2400: §6.2.5 step 8 turns an omitted/`null` total on a priced basket
 * into `PRICE_CHANGED`, so a committing fixture must confirm the total it saw.
 */
function basketArgs(
  businessId: Id<'businesses'>,
  menuItemId: Id<'menuItems'>,
  overrides: Partial<Omit<BasketArgs, 'businessId'>> = {}
): BasketArgs {
  return {
    businessId,
    lines: [
      {
        menuItemId,
        quantity: 2,
        selections: [{ optionName: 'Base', choiceName: 'Rice' }],
      },
    ],
    customerName: 'Ada Lovelace',
    contactPhone: '(555) 010-0100',
    contactEmail: 'ada@example.com',
    expectedSubtotal: 2400,
    idempotencyKey: 'basket-key-0001',
    ...overrides,
  };
}

/** Row counts for one commit attempt: the six commit tables plus the throttle. */
async function rowCounts(t: TestBackend) {
  return await t.run(async (ctx) => ({
    orders: (await ctx.db.query('orders').collect()).length,
    access: (await ctx.db.query('orderAccess').collect()).length,
    idempotency: (await ctx.db.query('orderIdempotency').collect()).length,
    events: (await ctx.db.query('orderEvents').collect()).length,
    expiry: (await ctx.db.query('orderExpiry').collect()).length,
    notifications: (await ctx.db.query('notifications').collect()).length,
    throttle: (await ctx.db.query('orderThrottle').collect()).length,
  }));
}

/**
 * Asserts the §6.5 object envelope. `convex-test` restores the original
 * `ConvexError` (`deserializeConvexErrorData`), so `.data` is the object the
 * handler threw — no raw-message matching, no weakening.
 */
async function expectOrderError(
  promise: Promise<unknown>,
  code: string,
  extra?: Record<string, unknown>
) {
  const thrown = await promise.then(
    () => {
      throw new Error(`Expected ${code}, but the call succeeded`);
    },
    (error: unknown) => error
  );
  expect(thrown).toBeInstanceOf(ConvexError);
  const data = (thrown as ConvexError<Record<string, string | number>>).data;
  expect(data.code).toBe(code);
  if (extra !== undefined) {
    expect(data).toMatchObject(extra);
  }
  return data;
}

/** The seeded item's group, for cases that need to pause a section. */
async function itemGroupId(t: TestBackend, menuItemId: Id<'menuItems'>) {
  const item = await t.run((ctx) => ctx.db.get('menuItems', menuItemId));
  if (item === null) {
    throw new Error('seed menu item is missing');
  }
  return item.groupId;
}

test('basket: one order commits exactly six rows and returns the masked receipt', async () => {
  // Canary (D13/Q4): if the edge-runtime VM did not receive the patched Date,
  // every NOW assertion below is meaningless — fail here instead.
  expect(Date.now()).toBe(NOW);

  const t = convexTest(schema, modules);
  const { businessId, menuItemId, ownerId } = await seed(t);
  await configureBasket(t, businessId, { phone: '(555) 010-0100' });

  const receipt = await t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId));

  expect(await rowCounts(t)).toEqual({
    orders: 1,
    access: 1,
    idempotency: 1,
    events: 1,
    expiry: 1,
    notifications: 1,
    throttle: 1,
  });

  const order = await t.run((ctx) => ctx.db.query('orders').first());
  expect(order).toMatchObject({
    businessId,
    pricingSource: 'snapshot',
    subtotal: 2400,
    status: 'new',
    // Normalized by `parseContact` (Q2): digits-only phone, lowercased email.
    customerName: 'Ada Lovelace',
    contactPhone: '5550100100',
    contactEmail: 'ada@example.com',
    createdAt: NOW,
  });
  expect(order?.items).toEqual([
    {
      menuItemId,
      name: 'Grain Bowl',
      unitPrice: 1200,
      quantity: 2,
      selections: [{ optionName: 'Base', choiceName: 'Rice' }],
      lineTotal: 2400,
    },
  ]);

  const expiry = await t.run((ctx) => ctx.db.query('orderExpiry').first());
  expect(expiry).toMatchObject({
    orderId: receipt.orderId,
    // Q9/P4: `businessId` is required by the table and carried by the row.
    businessId,
    expiresAt: NOW + DEFAULT_TTL_MS,
  });

  const event = await t.run((ctx) => ctx.db.query('orderEvents').first());
  expect(event).toMatchObject({
    orderId: receipt.orderId,
    businessId,
    actorType: 'customer',
    action: 'submitted',
    toStatus: 'new',
    createdAt: NOW,
  });

  const notice = await t.run((ctx) => ctx.db.query('notifications').first());
  expect(notice).toMatchObject({
    userId: ownerId,
    type: 'new_order',
    businessId,
    message: 'New order for "Blue Harbor Diner".',
  });

  expect(Object.keys(receipt).sort()).toEqual([
    'accessToken',
    'business',
    'contact',
    'createdAt',
    'items',
    'orderId',
    'reference',
    'status',
    'statusReason',
    'subtotal',
  ]);
  expect(receipt).toMatchObject({
    status: 'new',
    subtotal: 2400,
    createdAt: NOW,
    contact: { phone: '***-0100', email: 'a***@example.com' },
    business: { name: 'Blue Harbor Diner', phone: '(555) 010-0100' },
    items: [
      {
        name: 'Grain Bowl',
        quantity: 2,
        selections: [{ optionName: 'Base', choiceName: 'Rice' }],
      },
    ],
  });
  expect(receipt.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(receipt.reference).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6,7}$/);

  // Leak check: the receipt never carries the raw contact or the customer name.
  const serialized = JSON.stringify(receipt);
  expect(serialized).not.toContain('5550100100');
  expect(serialized).not.toContain('ada@example.com');
  expect(serialized).not.toContain('Ada Lovelace');
});

test('basket: a same-key different-args retry conflicts before any supply guard', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  const args = basketArgs(businessId, menuItemId);
  await t.mutation(api.orders.placeOrder, args);

  // Paused business AND a different name: a guard-first handler would answer
  // ORDERING_CLOSED, so IDEMPOTENCY_CONFLICT proves the hash check runs first.
  await configureBasket(t, businessId, { acceptingOrders: false });
  await expectOrderError(
    t.mutation(api.orders.placeOrder, { ...args, customerName: 'Grace Hopper' }),
    'IDEMPOTENCY_CONFLICT'
  );
  expect((await rowCounts(t)).orders).toBe(1);
});

test('basket: a malformed contact on a fresh key is CONTACT_INVALID and writes nothing', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);

  await expectOrderError(
    t.mutation(
      api.orders.placeOrder,
      basketArgs(businessId, menuItemId, { contactPhone: 'no digits here' })
    ),
    'CONTACT_INVALID'
  );

  expect(await rowCounts(t)).toEqual({
    orders: 0,
    access: 0,
    idempotency: 0,
    events: 0,
    expiry: 0,
    notifications: 0,
    throttle: 0,
  });
});

test('basket: two tabs with the same key get the same token and reference, one order', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  const args = basketArgs(businessId, menuItemId);

  const first = await t.mutation(api.orders.placeOrder, args);
  const second = await t.mutation(api.orders.placeOrder, args);

  expect(second).toEqual(first);
  expect(second.accessToken).toBe(first.accessToken);
  expect(second.reference).toBe(first.reference);
  expect(second.orderId).toBe(first.orderId);

  // Throttle stays at 1: the fast path returns before the serialization write.
  expect(await rowCounts(t)).toEqual({
    orders: 1,
    access: 1,
    idempotency: 1,
    events: 1,
    expiry: 1,
    notifications: 1,
    throttle: 1,
  });
});

test('basket: a replay ignores current supply state (D5b)', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  const args = basketArgs(businessId, menuItemId);
  const first = await t.mutation(api.orders.placeOrder, args);

  // Post-commit closure: pause plus a flag rollback to `legacy`.
  await configureBasket(t, businessId, {
    acceptingOrders: false,
    orderProtocol: 'legacy',
  });

  const replay = await t.mutation(api.orders.placeOrder, args);
  expect(replay).toEqual(first);
  expect(await rowCounts(t)).toEqual({
    orders: 1,
    access: 1,
    idempotency: 1,
    events: 1,
    expiry: 1,
    notifications: 1,
    throttle: 1,
  });
});

test('basket: a replay with no access row throws INTERNAL and mints no second token', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  const args = basketArgs(businessId, menuItemId);
  const receipt = await t.mutation(api.orders.placeOrder, args);

  const access = await t.run((ctx) =>
    ctx.db
      .query('orderAccess')
      .withIndex('byOrderId', (q) => q.eq('orderId', receipt.orderId))
      .first()
  );
  if (access === null) {
    throw new Error('expected the committed access row');
  }
  await t.run((ctx) => ctx.db.delete(access._id));

  await expectOrderError(t.mutation(api.orders.placeOrder, args), 'INTERNAL');
  expect((await rowCounts(t)).access).toBe(0);
  expect((await rowCounts(t)).orders).toBe(1);
});

test('basket: supply guards use the spec codes and precedence', async () => {
  const t = convexTest(schema, modules);
  const { businessId, otherBusinessId, menuItemId, otherMenuItemId } = await seed(t);
  const args = basketArgs(businessId, menuItemId);

  // A. Missing flag (the legacy seed shape) → ORDERING_CLOSED (D3 pin).
  await expectOrderError(t.mutation(api.orders.placeOrder, args), 'ORDERING_CLOSED');

  // B. Explicit `legacy` → the same code; `basket` is the only accepted value.
  await configureBasket(t, businessId, { orderProtocol: 'legacy' });
  await expectOrderError(t.mutation(api.orders.placeOrder, args), 'ORDERING_CLOSED');

  // C. Paused → ORDERING_CLOSED, with `{phone}` filled from "the business".
  await configureBasket(t, businessId, { acceptingOrders: false });
  const paused = await expectOrderError(
    t.mutation(api.orders.placeOrder, args),
    'ORDERING_CLOSED'
  );
  expect(paused.message).toBe(
    "This business isn't accepting orders right now. Call the business."
  );

  // C2. The same placeholder uses the business's configured phone when present.
  await configureBasket(t, businessId, {
    acceptingOrders: false,
    phone: '555-0199',
  });
  const pausedWithPhone = await expectOrderError(
    t.mutation(api.orders.placeOrder, args),
    'ORDERING_CLOSED'
  );
  expect(pausedWithPhone.message).toBe(
    "This business isn't accepting orders right now. Call 555-0199."
  );

  // D. `acceptingOrdersUntil` reached → ORDERING_CLOSED (pause reset to true).
  await configureBasket(t, businessId, { acceptingOrders: true, acceptingOrdersUntil: NOW });
  await expectOrderError(t.mutation(api.orders.placeOrder, args), 'ORDERING_CLOSED');

  // E. Configured closed hours → OUTSIDE_HOURS, a distinct code. NOW is Tuesday
  //    17:13 in America/New_York, after a 09:00–17:00 window.
  await configureBasket(t, otherBusinessId, {
    hours: { tuesday: [{ opensAt: '09:00', closesAt: '17:00' }] },
  });
  const closed = await expectOrderError(
    t.mutation(
      api.orders.placeOrder,
      basketArgs(otherBusinessId, otherMenuItemId, {
        lines: [{ menuItemId: otherMenuItemId, quantity: 2, selections: [] }],
        expectedSubtotal: 1800,
      })
    ),
    'OUTSIDE_HOURS'
  );
  expect(closed.message).toBe(
    'This business is closed right now. Call the business or check its hours.'
  );

  // F. Unapproved → BUSINESS_UNAVAILABLE, ahead of every supply switch.
  await configureBasket(t, businessId, { status: 'pendingReview' });
  await expectOrderError(t.mutation(api.orders.placeOrder, args), 'BUSINESS_UNAVAILABLE');

  expect((await rowCounts(t)).orders).toBe(0);
  expect((await rowCounts(t)).throttle).toBe(0);
});

test('basket: a failed order consumes no quota slot', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId, { acceptingOrders: false });

  await expectOrderError(
    t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId)),
    'ORDERING_CLOSED'
  );

  const throttleRows = await t.run((ctx) => ctx.db.query('orderThrottle').collect());
  expect(throttleRows).toEqual([]);
  expect((await rowCounts(t)).orders).toBe(0);
});

test('basket: PRICE_CHANGED carries the server total and a corrected retry commits', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  const args = basketArgs(businessId, menuItemId, { expectedSubtotal: 999 });

  const failure = await expectOrderError(
    t.mutation(api.orders.placeOrder, args),
    'PRICE_CHANGED',
    { actualSubtotal: 2400 }
  );
  expect(failure.actualSubtotal).toBe(2400);

  // D4: pre-critical. No order, no idempotency row, and no throttle slot.
  expect((await rowCounts(t)).orders).toBe(0);
  expect((await rowCounts(t)).idempotency).toBe(0);
  expect((await rowCounts(t)).throttle).toBe(0);

  // The hash excludes `expectedSubtotal`, so the same key with the corrected
  // total is not a replay of anything (no row exists) and it commits.
  const receipt = await t.mutation(api.orders.placeOrder, {
    ...args,
    expectedSubtotal: 2400,
  });
  expect(receipt.subtotal).toBe(2400);
  expect((await rowCounts(t)).orders).toBe(1);
});

test('basket: a live window at the limit throws TOO_MANY_REQUESTS with retryAfterMs', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  await t.run((ctx) =>
    ctx.db.insert('orderThrottle', {
      key: businessThrottleKey(businessId),
      windowStart: NOW,
      count: 60,
    })
  );

  const data = await expectOrderError(
    t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId)),
    'TOO_MANY_REQUESTS'
  );
  expect(typeof data.retryAfterMs).toBe('number');
  expect(data.retryAfterMs).toBe(600_000);
  expect(String(data.message)).toBe(
    'Too many order attempts. Try again in 10 minutes or call the business.'
  );
  expect(String(data.message)).not.toContain('{n}');
  expect((await rowCounts(t)).orders).toBe(0);
});

test('basket: two successful orders increment one window to 2', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);

  await t.mutation(
    api.orders.placeOrder,
    basketArgs(businessId, menuItemId, { idempotencyKey: 'basket-key-a' })
  );
  await t.mutation(
    api.orders.placeOrder,
    basketArgs(businessId, menuItemId, { idempotencyKey: 'basket-key-b' })
  );

  const rows = await t.run((ctx) => ctx.db.query('orderThrottle').collect());
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    key: businessThrottleKey(businessId),
    windowStart: NOW,
    count: 2,
  });
});

test('basket: an empty basket is BASKET_EMPTY', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);

  await expectOrderError(
    t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId, { lines: [] })),
    'BASKET_EMPTY'
  );
});

test('basket: more than twenty lines is BASKET_TOO_LARGE', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);

  const lines = Array.from({ length: 21 }, () => ({
    menuItemId,
    quantity: 1,
    selections: [{ optionName: 'Base', choiceName: 'Rice' }],
  }));
  await expectOrderError(
    t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId, { lines })),
    'BASKET_TOO_LARGE'
  );
});

test('basket: more than one hundred total units is BASKET_TOO_LARGE', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);

  const lines = Array.from({ length: 6 }, () => ({ menuItemId, quantity: 20 }));
  await expectOrderError(
    t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId, { lines })),
    'BASKET_TOO_LARGE'
  );
});

test('basket: quantity 0, 21, or a fraction is QUANTITY_INVALID', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);

  for (const quantity of [0, 21, 1.5]) {
    await expectOrderError(
      t.mutation(
        api.orders.placeOrder,
        basketArgs(businessId, menuItemId, { lines: [{ menuItemId, quantity }] })
      ),
      'QUANTITY_INVALID'
    );
  }
});

test('basket: an unknown menu item is ITEM_UNAVAILABLE', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);

  const groupId = await itemGroupId(t, menuItemId);
  const ghostId = await t.run(async (ctx) => {
    const id = await ctx.db.insert('menuItems', {
      businessId,
      groupId,
      name: 'Ghost Bowl',
      customizationOptions: [],
      ordering: 9,
      isAvailable: true,
    });
    await ctx.db.delete(id);
    return id;
  });

  await expectOrderError(
    t.mutation(
      api.orders.placeOrder,
      basketArgs(businessId, ghostId, {
        lines: [{ menuItemId: ghostId, quantity: 1, selections: [] }],
        expectedSubtotal: 1200,
      })
    ),
    'ITEM_UNAVAILABLE'
  );
});

test("basket: another business's item is ITEM_UNAVAILABLE", async () => {
  const t = convexTest(schema, modules);
  const { businessId, otherMenuItemId } = await seed(t);
  await configureBasket(t, businessId);

  await expectOrderError(
    t.mutation(
      api.orders.placeOrder,
      basketArgs(businessId, otherMenuItemId, {
        lines: [{ menuItemId: otherMenuItemId, quantity: 1, selections: [] }],
        expectedSubtotal: 900,
      })
    ),
    'ITEM_UNAVAILABLE'
  );
});

test('basket: an unavailable item is ITEM_UNAVAILABLE', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  await t.run((ctx) => ctx.db.patch(menuItemId, { isAvailable: false }));

  await expectOrderError(
    t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId)),
    'ITEM_UNAVAILABLE'
  );
});

test('basket: a paused group is GROUP_UNAVAILABLE', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  const groupId = await itemGroupId(t, menuItemId);
  await t.run((ctx) => ctx.db.patch(groupId, { isAvailable: false }));

  await expectOrderError(
    t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId)),
    'GROUP_UNAVAILABLE'
  );
});

test('basket: missing, unknown, or duplicate selections are SELECTION_INVALID', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);

  for (const selections of [
    [],
    [{ optionName: 'Base', choiceName: 'Bread' }],
    [
      { optionName: 'Base', choiceName: 'Rice' },
      { optionName: 'Base', choiceName: 'Greens' },
    ],
  ]) {
    const data = await expectOrderError(
      t.mutation(
        api.orders.placeOrder,
        basketArgs(businessId, menuItemId, {
          lines: [{ menuItemId, quantity: 2, selections }],
        })
      ),
      'SELECTION_INVALID'
    );
    // §6.5 `{item}` substitution: the failing line names its catalog item.
    expect(String(data.message)).toBe(
      'Check the options for Grain Bowl; one is missing or no longer available.'
    );
  }
});

test('basket: a note over 500 characters is NOTE_TOO_LONG', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);

  await expectOrderError(
    t.mutation(
      api.orders.placeOrder,
      basketArgs(businessId, menuItemId, { note: 'x'.repeat(501) })
    ),
    'NOTE_TOO_LONG'
  );
});

test('basket: a subtotal over $1,000 is ORDER_VALUE_TOO_HIGH', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  await t.run((ctx) => ctx.db.patch(menuItemId, { price: 100_001 }));

  await expectOrderError(
    t.mutation(
      api.orders.placeOrder,
      basketArgs(businessId, menuItemId, {
        lines: [
          {
            menuItemId,
            quantity: 1,
            selections: [{ optionName: 'Base', choiceName: 'Rice' }],
          },
        ],
        expectedSubtotal: 100_001,
      })
    ),
    'ORDER_VALUE_TOO_HIGH'
  );
});

test('basket: a client price field is rejected by the args validator, never priced', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);

  // INV-01: the validator declares ids, quantities, and selections only. The
  // Convex args validator (which `convex-test` applies too) rejects fields it
  // does not declare — `Validator error: Unexpected field ...` — so a client
  // price can never reach the handler or the committed subtotal.
  const tampered = {
    ...basketArgs(businessId, menuItemId),
    lines: [
      {
        menuItemId,
        quantity: 2,
        selections: [{ optionName: 'Base', choiceName: 'Rice' }],
        unitPrice: 1,
        priceAdjustment: 0,
      },
    ],
  } as unknown as ReturnType<typeof basketArgs>;

  await expect(t.mutation(api.orders.placeOrder, tampered)).rejects.toThrow(
    /Unexpected field/
  );
  expect((await rowCounts(t)).orders).toBe(0);
});

// ---------------------------------------------------------------------------
// Token receipt read (T4): `getOrderByToken` is the public capability surface
// ---------------------------------------------------------------------------
// The token is the capability (§6.2.6 L1091): no identity, no allow-list, no S1
// throttle (INV-05 — 256 bits of entropy is the stated control). Every miss —
// unknown token, an access row whose order is gone, an INV-06 scope mismatch —
// throws the one `ORDER_NOT_FOUND` envelope (error table `:1296`) rather than
// returning `null` (`:1573` "or null" variance, Q7/P7). A hard-deleted business
// omits the business block and still answers (Q8). Each case builds its own
// backend, so the mutations below cannot leak between cases.

test('receipt: the token returns exactly the receipt placeOrder committed', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId, { phone: '(555) 010-0100' });
  const receipt = await t.mutation(
    api.orders.placeOrder,
    basketArgs(businessId, menuItemId)
  );

  // Public surface: called without `withIdentity`, exactly as the receipt page
  // does. Deep equality is the pin — the post-commit receipt and the token read
  // are the same projection, not two look-alike shapes.
  const found = await t.query(api.orders.getOrderByToken, {
    token: receipt.accessToken,
  });

  expect(found).toEqual(receipt);
});

test('receipt: the projection is an allowlist with no raw contact, identity, or second token', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId, { phone: '(555) 010-0100' });
  const receipt = await t.mutation(
    api.orders.placeOrder,
    basketArgs(businessId, menuItemId)
  );

  const found = await t.query(api.orders.getOrderByToken, {
    token: receipt.accessToken,
  });

  expect(Object.keys(found).sort()).toEqual([
    'accessToken',
    'business',
    'contact',
    'createdAt',
    'items',
    'orderId',
    'reference',
    'status',
    'statusReason',
    'subtotal',
  ]);
  expect(found.contact).toEqual({ phone: '***-0100', email: 'a***@example.com' });

  const serialized = JSON.stringify(found);
  expect(serialized).not.toContain('5550100100');
  expect(serialized).not.toContain('ada@example.com');
  expect(serialized).not.toContain('Ada Lovelace');
  expect(serialized).not.toContain('customerUserId');
  // The only token field is `accessToken`: no JSON key literally named `token`.
  expect(serialized).not.toContain('"token"');
  expect(Object.keys(found)).not.toContain('token');
});

test('receipt: an unknown token throws ORDER_NOT_FOUND', async () => {
  const t = convexTest(schema, modules);
  await seed(t);

  await expectOrderError(
    t.query(api.orders.getOrderByToken, { token: 'not-a-real-token' }),
    'ORDER_NOT_FOUND'
  );
});

test('receipt: an INV-06 business mismatch throws ORDER_NOT_FOUND', async () => {
  const t = convexTest(schema, modules);
  const { businessId, otherBusinessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  const receipt = await t.mutation(
    api.orders.placeOrder,
    basketArgs(businessId, menuItemId)
  );

  const access = await t.run((ctx) =>
    ctx.db
      .query('orderAccess')
      .withIndex('byOrderId', (q) => q.eq('orderId', receipt.orderId))
      .first()
  );
  if (access === null) {
    throw new Error('expected the committed access row');
  }
  // Corrupt the scope: the order belongs to `businessId`, the access row now
  // claims the other seeded business.
  await t.run((ctx) => ctx.db.patch(access._id, { businessId: otherBusinessId }));

  await expectOrderError(
    t.query(api.orders.getOrderByToken, { token: access.accessToken }),
    'ORDER_NOT_FOUND'
  );
});

test('receipt: an access row whose order is gone throws ORDER_NOT_FOUND', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  const receipt = await t.mutation(
    api.orders.placeOrder,
    basketArgs(businessId, menuItemId)
  );

  await t.run((ctx) => ctx.db.delete(receipt.orderId));

  await expectOrderError(
    t.query(api.orders.getOrderByToken, { token: receipt.accessToken }),
    'ORDER_NOT_FOUND'
  );
});

test('receipt: a hard-deleted business omits the business block and still answers', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId, { phone: '(555) 010-0100' });
  const receipt = await t.mutation(
    api.orders.placeOrder,
    basketArgs(businessId, menuItemId)
  );
  expect(receipt).toMatchObject({
    business: { name: 'Blue Harbor Diner', phone: '(555) 010-0100' },
  });

  await t.run((ctx) => ctx.db.delete(businessId));

  const found = await t.query(api.orders.getOrderByToken, {
    token: receipt.accessToken,
  });
  const expected = { ...receipt } as Record<string, unknown>;
  delete expected.business;
  expect(found).toEqual(expected);
  expect(found).not.toHaveProperty('business');
});

test('receipt: two tokens each return only their own order', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  const first = await t.mutation(
    api.orders.placeOrder,
    basketArgs(businessId, menuItemId, { idempotencyKey: 'basket-key-0001' })
  );
  const second = await t.mutation(
    api.orders.placeOrder,
    basketArgs(businessId, menuItemId, { idempotencyKey: 'basket-key-0002' })
  );

  expect(second.orderId).not.toBe(first.orderId);
  expect(second.accessToken).not.toBe(first.accessToken);

  const firstFound = await t.query(api.orders.getOrderByToken, {
    token: first.accessToken,
  });
  const secondFound = await t.query(api.orders.getOrderByToken, {
    token: second.accessToken,
  });

  expect(firstFound).toEqual(first);
  expect(secondFound).toEqual(second);
  expect(firstFound.orderId).toBe(first.orderId);
  expect(secondFound.orderId).toBe(second.orderId);
  expect(firstFound).not.toEqual(secondFound);
});

// ---------------------------------------------------------------------------
// Owner protocol transitions (T5, issue #79): `transitionOrderStatus`
//
// One test per acceptance row. The owner decision machine (REVISED D1), the
// reason policy (D2), the expiry boundary guard (D8), actor stamping (D9), and
// the `reused` short-circuit are proven against the real handler, including the
// `orderEvents` ledger each move appends.
// ---------------------------------------------------------------------------

// `TestBackend` above erases `convexTest`'s schema generic, which makes `ctx.db`
// fall back to `AnyDataModel` (system indexes only). These helpers read real
// indexes, so they use the schema-instantiated backend type instead.
type SchemaBackend = TestConvex<typeof schema>;

type OwnerAction = 'accept' | 'decline' | 'cancel' | 'ready' | 'complete' | 'noShow';

/** Drives one owner transition as the owner seeded by `seed()`. */
function ownerTransition(
  t: TestBackend,
  args: {
    businessId: Id<'businesses'>;
    orderId: Id<'orders'>;
    action: OwnerAction;
    reason?: string;
  }
) {
  return t
    .withIdentity({ subject: 'user_owner' })
    .mutation(api.orders.transitionOrderStatus, args);
}

/** One order's event ledger, oldest first. */
async function eventsFor(t: SchemaBackend, orderId: Id<'orders'>) {
  return await t.run((ctx) =>
    ctx.db
      .query('orderEvents')
      .withIndex('byOrderIdCreatedAt', (q) => q.eq('orderId', orderId))
      .collect()
  );
}

/** One order's expiry schedule rows. */
async function expiryFor(t: SchemaBackend, orderId: Id<'orders'>) {
  return await t.run((ctx) =>
    ctx.db
      .query('orderExpiry')
      .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
      .collect()
  );
}

/** Every notification addressed to one user, oldest first. */
async function notificationsFor(t: SchemaBackend, userId: Id<'users'>) {
  return await t.run((ctx) =>
    ctx.db
      .query('notifications')
      .withIndex('byUserId', (q) => q.eq('userId', userId))
      .collect()
  );
}

/** Inserts an order already holding `status` (a matrix-cell fixture). */
async function orderAtStatus(
  t: SchemaBackend,
  businessId: Id<'businesses'>,
  status: Doc<'orders'>['status']
) {
  return await t.run((ctx) =>
    ctx.db.insert('orders', {
      businessId,
      customerName: `Customer ${status}`,
      status,
      createdAt: NOW,
    })
  );
}

/** Inserts an order holding `status` plus its visitor capability row. */
async function orderWithToken(
  t: SchemaBackend,
  businessId: Id<'businesses'>,
  status: Doc<'orders'>['status'],
  accessToken: string
) {
  const orderId = await orderAtStatus(t, businessId, status);
  await t.run((ctx) =>
    ctx.db.insert('orderAccess', {
      orderId,
      businessId,
      accessToken,
      reference: 'CANCEL',
      createdAt: NOW,
    })
  );
  return orderId;
}

test("owner protocol: another business's order id is invisible (S0 row 15)", async () => {
  const t = convexTest(schema, modules);
  const { businessId, otherBusinessId, otherMenuItemId } = await seed(t);
  const otherOrderId = await t.mutation(api.orders.submitOrder, {
    ...validArgs(otherBusinessId, otherMenuItemId),
    selections: [],
  });

  await expectOrderError(
    ownerTransition(t, { businessId, orderId: otherOrderId, action: 'accept' }),
    'ORDER_NOT_FOUND',
    { message: 'Order not found' }
  );

  const otherOrder = await t.run((ctx) => ctx.db.get('orders', otherOrderId));
  expect(otherOrder?.status).toBe('new');
  expect(await eventsFor(t, otherOrderId)).toHaveLength(0);
});

test('owner protocol: accept, ready, complete each patch status and append one event', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId, ownerId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  const steps = [
    { action: 'accept', status: 'accepted' },
    { action: 'ready', status: 'ready' },
    { action: 'complete', status: 'completed' },
  ] as const;

  for (const step of steps) {
    const result = await ownerTransition(t, {
      businessId,
      orderId,
      action: step.action,
    });
    expect(result).toEqual({ status: step.status, reused: false });
  }

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.status).toBe('completed');
  expect(order?.statusUpdatedAt).toBe(NOW);

  const events = await eventsFor(t, orderId);
  expect(events.map((event) => event.action)).toEqual(['accepted', 'ready', 'completed']);
  expect(events.map((event) => event.fromStatus)).toEqual(['new', 'accepted', 'ready']);
  expect(events.map((event) => event.toStatus)).toEqual(['accepted', 'ready', 'completed']);
  expect(events.map((event) => event.actorType)).toEqual(['owner', 'owner', 'owner']);
  expect(events.map((event) => event.actorUserId)).toEqual([ownerId, ownerId, ownerId]);
  expect(events.every((event) => event.businessId === businessId)).toBe(true);
  expect(events.map((event) => event.createdAt)).toEqual([NOW, NOW, NOW]);
});

test('owner protocol: decline requires a reason and stores it on the order and event', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);

  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  await expectOrderError(
    ownerTransition(t, { businessId, orderId, action: 'decline' }),
    'REASON_REQUIRED'
  );
  await expectOrderError(
    ownerTransition(t, { businessId, orderId, action: 'decline', reason: '   ' }),
    'REASON_REQUIRED'
  );
  expect(await eventsFor(t, orderId)).toHaveLength(0);

  const result = await ownerTransition(t, {
    businessId,
    orderId,
    action: 'decline',
    reason: '  Sold out  ',
  });
  expect(result).toEqual({ status: 'declined', reused: false });

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.status).toBe('declined');
  expect(order?.statusReason).toBe('Sold out');

  const events = await eventsFor(t, orderId);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    orderId,
    businessId,
    actorType: 'owner',
    action: 'declined',
    fromStatus: 'new',
    toStatus: 'declined',
    reason: 'Sold out',
    createdAt: NOW,
  });

  // Exactly 200 characters is accepted; 201 is the D2 message override.
  const boundaryId = await t.mutation(api.orders.submitOrder, {
    ...validArgs(businessId, menuItemId),
    customerName: 'Grace Hopper',
  });
  const boundary = await ownerTransition(t, {
    businessId,
    orderId: boundaryId,
    action: 'decline',
    reason: 'a'.repeat(200),
  });
  expect(boundary).toEqual({ status: 'declined', reused: false });
  const boundaryOrder = await t.run((ctx) => ctx.db.get('orders', boundaryId));
  expect(boundaryOrder?.statusReason).toHaveLength(200);

  const tooLongId = await t.mutation(api.orders.submitOrder, {
    ...validArgs(businessId, menuItemId),
    customerName: 'Katherine Johnson',
  });
  const tooLong = await expectOrderError(
    ownerTransition(t, {
      businessId,
      orderId: tooLongId,
      action: 'decline',
      reason: 'a'.repeat(201),
    }),
    'REASON_REQUIRED'
  );
  expect(tooLong.message).toBe('Keep the reason under 200 characters.');
  const unchanged = await t.run((ctx) => ctx.db.get('orders', tooLongId));
  expect(unchanged?.status).toBe('new');
  expect(await eventsFor(t, tooLongId)).toHaveLength(0);
});

test('owner protocol: cancel covers new, accepted and ready and needs a reason', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);

  // From `new`: blank and whitespace both fail the reason policy.
  const freshId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));
  await expectOrderError(
    ownerTransition(t, { businessId, orderId: freshId, action: 'cancel' }),
    'REASON_REQUIRED'
  );
  await expectOrderError(
    ownerTransition(t, { businessId, orderId: freshId, action: 'cancel', reason: '  ' }),
    'REASON_REQUIRED'
  );
  const fromNew = await ownerTransition(t, {
    businessId,
    orderId: freshId,
    action: 'cancel',
    reason: 'Customer asked',
  });
  expect(fromNew).toEqual({ status: 'cancelled', reused: false });
  expect(await eventsFor(t, freshId)).toHaveLength(1);

  // From `accepted`.
  const acceptedId = await t.mutation(api.orders.submitOrder, {
    ...validArgs(businessId, menuItemId),
    customerName: 'Grace Hopper',
  });
  await ownerTransition(t, { businessId, orderId: acceptedId, action: 'accept' });
  const fromAccepted = await ownerTransition(t, {
    businessId,
    orderId: acceptedId,
    action: 'cancel',
    reason: 'Owner closed early',
  });
  expect(fromAccepted).toEqual({ status: 'cancelled', reused: false });
  expect((await eventsFor(t, acceptedId)).map((event) => event.action)).toEqual([
    'accepted',
    'cancelled',
  ]);

  // From `ready`.
  const readyId = await t.mutation(api.orders.submitOrder, {
    ...validArgs(businessId, menuItemId),
    customerName: 'Katherine Johnson',
  });
  await ownerTransition(t, { businessId, orderId: readyId, action: 'accept' });
  await ownerTransition(t, { businessId, orderId: readyId, action: 'ready' });
  const fromReady = await ownerTransition(t, {
    businessId,
    orderId: readyId,
    action: 'cancel',
    reason: 'Kitchen closed',
  });
  expect(fromReady).toEqual({ status: 'cancelled', reused: false });
  const readyEvents = await eventsFor(t, readyId);
  expect(readyEvents.map((event) => event.action)).toEqual(['accepted', 'ready', 'cancelled']);
  expect(readyEvents[readyEvents.length - 1]?.reason).toBe('Kitchen closed');

  // 201 characters is rejected on the same path.
  const longId = await t.mutation(api.orders.submitOrder, {
    ...validArgs(businessId, menuItemId),
    customerName: 'Dorothy Vaughan',
  });
  const tooLong = await expectOrderError(
    ownerTransition(t, {
      businessId,
      orderId: longId,
      action: 'cancel',
      reason: 'b'.repeat(201),
    }),
    'REASON_REQUIRED'
  );
  expect(tooLong.message).toBe('Keep the reason under 200 characters.');
  const unchanged = await t.run((ctx) => ctx.db.get('orders', longId));
  expect(unchanged?.status).toBe('new');
});

test('owner protocol: noShow is ready-only and defaults the reason at write time', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);

  const freshId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));
  await expectOrderError(
    ownerTransition(t, { businessId, orderId: freshId, action: 'noShow' }),
    'INVALID_TRANSITION'
  );

  const blankId = await t.mutation(api.orders.submitOrder, {
    ...validArgs(businessId, menuItemId),
    customerName: 'Grace Hopper',
  });
  await ownerTransition(t, { businessId, orderId: blankId, action: 'accept' });
  await ownerTransition(t, { businessId, orderId: blankId, action: 'ready' });
  const blank = await ownerTransition(t, {
    businessId,
    orderId: blankId,
    action: 'noShow',
    reason: '   ',
  });
  expect(blank).toEqual({ status: 'no_show', reused: false });
  const blankOrder = await t.run((ctx) => ctx.db.get('orders', blankId));
  expect(blankOrder?.statusReason).toBe('Not picked up');
  const blankEvents = await eventsFor(t, blankId);
  expect(blankEvents[blankEvents.length - 1]).toMatchObject({
    action: 'no_show',
    fromStatus: 'ready',
    toStatus: 'no_show',
    reason: 'Not picked up',
  });

  const explicitId = await t.mutation(api.orders.submitOrder, {
    ...validArgs(businessId, menuItemId),
    customerName: 'Katherine Johnson',
  });
  await ownerTransition(t, { businessId, orderId: explicitId, action: 'accept' });
  await ownerTransition(t, { businessId, orderId: explicitId, action: 'ready' });
  await ownerTransition(t, {
    businessId,
    orderId: explicitId,
    action: 'noShow',
    reason: '  Customer no-show  ',
  });
  const explicitOrder = await t.run((ctx) => ctx.db.get('orders', explicitId));
  expect(explicitOrder?.statusReason).toBe('Customer no-show');
});

test('owner protocol: the REVISED D1 terminal and decision-conflict matrix', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  const terminalStatuses = ['completed', 'declined', 'cancelled', 'expired', 'no_show'] as const;

  // Non-decision actions: all five terminal states reject with ORDER_TERMINAL.
  for (const status of terminalStatuses) {
    const orderId = await orderAtStatus(t, businessId, status);
    for (const action of ['cancel', 'ready', 'complete', 'noShow'] as const) {
      await expectOrderError(
        ownerTransition(t, {
          businessId,
          orderId,
          action,
          reason: action === 'cancel' ? 'Owner closed' : undefined,
        }),
        'ORDER_TERMINAL'
      );
    }
  }

  // `accept`: two specific conflicts, the rest of the terminal set is terminal.
  const acceptCells = [
    ['declined', 'ORDER_ALREADY_DECIDED'],
    ['expired', 'ORDER_EXPIRED'],
    ['ready', 'ORDER_TERMINAL'],
    ['completed', 'ORDER_TERMINAL'],
    ['cancelled', 'ORDER_TERMINAL'],
    ['no_show', 'ORDER_TERMINAL'],
  ] as const;
  for (const [status, code] of acceptCells) {
    const orderId = await orderAtStatus(t, businessId, status);
    await expectOrderError(
      ownerTransition(t, { businessId, orderId, action: 'accept' }),
      code
    );
  }

  // `decline`: the two late-decision cells; the rest of the terminal set is terminal.
  const declineCells = [
    ['accepted', 'ORDER_ALREADY_DECIDED'],
    ['ready', 'ORDER_ALREADY_DECIDED'],
    ['completed', 'ORDER_TERMINAL'],
    ['cancelled', 'ORDER_TERMINAL'],
    ['expired', 'ORDER_TERMINAL'],
    ['no_show', 'ORDER_TERMINAL'],
  ] as const;
  for (const [status, code] of declineCells) {
    const orderId = await orderAtStatus(t, businessId, status);
    await expectOrderError(
      ownerTransition(t, {
        businessId,
        orderId,
        action: 'decline',
        reason: 'Too late',
      }),
      code
    );
  }
});

test('owner protocol: non-terminal conflicts stay INVALID_TRANSITION', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);

  const cells = [
    ['new', 'ready'],
    ['new', 'complete'],
    ['new', 'noShow'],
    ['accepted', 'complete'],
    ['accepted', 'noShow'],
  ] as const;
  for (const [status, action] of cells) {
    const orderId = await orderAtStatus(t, businessId, status);
    await expectOrderError(
      ownerTransition(t, { businessId, orderId, action }),
      'INVALID_TRANSITION'
    );
  }
});

test('owner protocol: a double accept reuses the decision without a second event', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  const first = await ownerTransition(t, { businessId, orderId, action: 'accept' });
  expect(first).toEqual({ status: 'accepted', reused: false });
  const afterFirst = await t.run((ctx) => ctx.db.get('orders', orderId));

  const second = await ownerTransition(t, { businessId, orderId, action: 'accept' });
  expect(second).toEqual({ status: 'accepted', reused: true });

  const afterSecond = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(afterSecond?.status).toBe('accepted');
  expect(afterSecond?.statusUpdatedAt).toBe(afterFirst?.statusUpdatedAt);

  const events = await eventsFor(t, orderId);
  expect(events).toHaveLength(1);
  expect(events[0]?.action).toBe('accepted');
});

test('owner protocol: accepting a due, unswept order throws ORDER_EXPIRED and writes nothing', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));
  const expiryId = await t.run((ctx) =>
    ctx.db.insert('orderExpiry', { orderId, businessId, expiresAt: NOW })
  );

  await expectOrderError(
    ownerTransition(t, { businessId, orderId, action: 'accept' }),
    'ORDER_EXPIRED'
  );

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.status).toBe('new');
  expect(order?.statusReason).toBeUndefined();
  expect(order?.statusUpdatedAt).toBeUndefined();
  expect(await eventsFor(t, orderId)).toHaveLength(0);

  const rows = await expiryFor(t, orderId);
  expect(rows.map((row) => row._id)).toEqual([expiryId]);
});

test('owner protocol: a reused accept leaves the expiry row untouched', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  await ownerTransition(t, { businessId, orderId, action: 'accept' });
  const expiryId = await t.run((ctx) =>
    ctx.db.insert('orderExpiry', {
      orderId,
      businessId,
      expiresAt: NOW + DEFAULT_TTL_MS,
    })
  );

  const reused = await ownerTransition(t, { businessId, orderId, action: 'accept' });
  expect(reused).toEqual({ status: 'accepted', reused: true });

  const rows = await expiryFor(t, orderId);
  expect(rows.map((row) => row._id)).toEqual([expiryId]);
  expect(await eventsFor(t, orderId)).toHaveLength(1);
});

test('owner protocol: a decline observing an accepted order loses (D10)', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  await ownerTransition(t, { businessId, orderId, action: 'accept' });
  await expectOrderError(
    ownerTransition(t, {
      businessId,
      orderId,
      action: 'decline',
      reason: 'Sold out',
    }),
    'ORDER_ALREADY_DECIDED'
  );

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.status).toBe('accepted');
  const events = await eventsFor(t, orderId);
  expect(events.map((event) => event.action)).toEqual(['accepted']);
});

test('owner protocol: concurrent accept and decline settle one winner and one conflict', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  const results = await Promise.allSettled([
    ownerTransition(t, { businessId, orderId, action: 'accept' }),
    ownerTransition(t, {
      businessId,
      orderId,
      action: 'decline',
      reason: 'Sold out',
    }),
  ]);

  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  const conflict = rejected[0]?.reason as ConvexError<Record<string, string>>;
  expect(conflict).toBeInstanceOf(ConvexError);
  expect(conflict.data.code).toBe('ORDER_ALREADY_DECIDED');

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(['accepted', 'declined']).toContain(order?.status);
  expect(await eventsFor(t, orderId)).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Visitor cancel (T5, issue #79): `cancelOrder` + the `order_cancelled` notice
//
// The token is the capability (D4): no identity, and every miss — unknown
// token, an access row whose order is gone, an INV-06 scope mismatch — is the
// one `ORDER_NOT_FOUND` envelope. Only `new` moves; `cancelled` is idempotent
// and writes nothing; a due-but-unswept expiry row is proof without a write
// (D8, the system sweep is the only writer of `expired`).
// ---------------------------------------------------------------------------

test('visitor cancel: a new order becomes cancelled with one customer event and one owner notice', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId, ownerId } = await seed(t);
  await configureBasket(t, businessId);
  const receipt = await t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId));

  const result = await t.mutation(api.orders.cancelOrder, { token: receipt.accessToken });
  expect(result).toEqual({ status: 'cancelled' });

  const order = await t.run((ctx) => ctx.db.get('orders', receipt.orderId));
  expect(order?.status).toBe('cancelled');
  expect(order?.statusReason).toBe(VISITOR_CANCEL_REASON);
  expect(order?.statusUpdatedAt).toBe(NOW);
  expect(await expiryFor(t, receipt.orderId)).toHaveLength(0);

  const events = await eventsFor(t, receipt.orderId);
  expect(events.map((event) => event.action)).toEqual(['submitted', 'cancelled']);
  const cancelled = events.filter((event) => event.action === 'cancelled');
  expect(cancelled).toHaveLength(1);
  expect(cancelled[0]).toMatchObject({
    orderId: receipt.orderId,
    businessId,
    actorType: 'customer',
    action: 'cancelled',
    fromStatus: 'new',
    toStatus: 'cancelled',
    reason: VISITOR_CANCEL_REASON,
    createdAt: NOW,
  });
  expect(cancelled[0]?.actorUserId).toBeUndefined();

  const notices = await notificationsFor(t, ownerId);
  expect(notices.map((notice) => notice.type)).toEqual(['new_order', 'order_cancelled']);
  const cancelledNotice = notices.find((notice) => notice.type === 'order_cancelled');
  expect(cancelledNotice).toMatchObject({
    userId: ownerId,
    businessId,
    message: 'Order for "Blue Harbor Diner" was cancelled.',
  });
});

test('visitor cancel: an unknown token is ORDER_NOT_FOUND and writes nothing', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  await t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId));
  const before = await rowCounts(t);

  await expectOrderError(
    t.mutation(api.orders.cancelOrder, { token: 'not-a-real-token' }),
    'ORDER_NOT_FOUND'
  );

  expect(await rowCounts(t)).toEqual(before);
});

test('visitor cancel: a token scoped to another business is ORDER_NOT_FOUND', async () => {
  const t = convexTest(schema, modules);
  const { businessId, otherBusinessId, menuItemId } = await seed(t);
  await configureBasket(t, businessId);
  const receipt = await t.mutation(api.orders.placeOrder, basketArgs(businessId, menuItemId));

  const access = await t.run((ctx) =>
    ctx.db
      .query('orderAccess')
      .withIndex('byOrderId', (q) => q.eq('orderId', receipt.orderId))
      .first()
  );
  if (access === null) {
    throw new Error('expected the committed access row');
  }
  // Corrupt the scope: the order belongs to `businessId`, the access row now
  // claims the other seeded business.
  await t.run((ctx) => ctx.db.patch(access._id, { businessId: otherBusinessId }));

  await expectOrderError(
    t.mutation(api.orders.cancelOrder, { token: receipt.accessToken }),
    'ORDER_NOT_FOUND'
  );

  const order = await t.run((ctx) => ctx.db.get('orders', receipt.orderId));
  expect(order?.status).toBe('new');
  expect((await eventsFor(t, receipt.orderId)).map((event) => event.action)).toEqual([
    'submitted',
  ]);
});

test('visitor cancel: the status matrix rejects without touching the order', async () => {
  const t = convexTest(schema, modules);
  const { businessId, ownerId } = await seed(t);

  const cells = [
    ['accepted', 'CANNOT_CANCEL'],
    ['ready', 'CANNOT_CANCEL'],
    ['expired', 'ORDER_EXPIRED'],
    ['completed', 'ORDER_TERMINAL'],
    ['declined', 'ORDER_TERMINAL'],
    ['no_show', 'ORDER_TERMINAL'],
  ] as const;

  for (const [status, code] of cells) {
    const token = `token-${status}`;
    const orderId = await orderWithToken(t, businessId, status, token);

    await expectOrderError(t.mutation(api.orders.cancelOrder, { token }), code);

    const order = await t.run((ctx) => ctx.db.get('orders', orderId));
    expect(order?.status).toBe(status);
    expect(order?.statusReason).toBeUndefined();
    expect(order?.statusUpdatedAt).toBeUndefined();
    expect(await eventsFor(t, orderId)).toHaveLength(0);
  }

  expect(await notificationsFor(t, ownerId)).toHaveLength(0);
});

test('visitor cancel: a due, unswept order is ORDER_EXPIRED with no write', async () => {
  const t = convexTest(schema, modules);
  const { businessId, ownerId } = await seed(t);
  const token = 'token-due';
  const orderId = await orderWithToken(t, businessId, 'new', token);
  const expiryId = await t.run((ctx) =>
    ctx.db.insert('orderExpiry', { orderId, businessId, expiresAt: NOW })
  );

  await expectOrderError(t.mutation(api.orders.cancelOrder, { token }), 'ORDER_EXPIRED');

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.status).toBe('new');
  expect(order?.statusReason).toBeUndefined();
  expect(order?.statusUpdatedAt).toBeUndefined();
  expect(await eventsFor(t, orderId)).toHaveLength(0);
  expect((await expiryFor(t, orderId)).map((row) => row._id)).toEqual([expiryId]);
  expect(await notificationsFor(t, ownerId)).toHaveLength(0);
});

test('visitor cancel: a repeat is idempotent and never re-notifies', async () => {
  const t = convexTest(schema, modules);
  const { businessId, ownerId } = await seed(t);
  const token = 'token-repeat';
  const orderId = await orderWithToken(t, businessId, 'new', token);

  expect(await t.mutation(api.orders.cancelOrder, { token })).toEqual({ status: 'cancelled' });
  const strayExpiryId = await t.run((ctx) =>
    ctx.db.insert('orderExpiry', {
      orderId,
      businessId,
      expiresAt: NOW + DEFAULT_TTL_MS,
    })
  );
  expect(await eventsFor(t, orderId)).toHaveLength(1);
  expect(await notificationsFor(t, ownerId)).toHaveLength(1);

  expect(await t.mutation(api.orders.cancelOrder, { token })).toEqual({ status: 'cancelled' });

  expect(await eventsFor(t, orderId)).toHaveLength(1);
  expect(await notificationsFor(t, ownerId)).toHaveLength(1);
  expect((await expiryFor(t, orderId)).map((row) => row._id)).toEqual([strayExpiryId]);
});

test('visitor cancel: a legacy new order with no expiry row cancels fine (OQ-9)', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId, ownerId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));
  const token = 'token-legacy';
  await t.run((ctx) =>
    ctx.db.insert('orderAccess', {
      orderId,
      businessId,
      accessToken: token,
      reference: 'LEGACY',
      createdAt: NOW,
    })
  );
  expect(await expiryFor(t, orderId)).toHaveLength(0);

  expect(await t.mutation(api.orders.cancelOrder, { token })).toEqual({ status: 'cancelled' });

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.status).toBe('cancelled');
  expect(order?.statusReason).toBe(VISITOR_CANCEL_REASON);

  const events = await eventsFor(t, orderId);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    actorType: 'customer',
    action: 'cancelled',
    fromStatus: 'new',
    toStatus: 'cancelled',
    reason: VISITOR_CANCEL_REASON,
  });
  expect(events[0]?.actorUserId).toBeUndefined();
  expect(await expiryFor(t, orderId)).toHaveLength(0);

  const cancelledNotices = (await notificationsFor(t, ownerId)).filter(
    (notice) => notice.type === 'order_cancelled'
  );
  expect(cancelledNotices).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Projections + INV-11 (T5, issue #79): what the visitor receipt and the owner
// board actually carry, and the wire shape the mutation refuses.
// ---------------------------------------------------------------------------

test('owner protocol: the decline reason and transition time reach the receipt and the owner board', async () => {
  const t = convexTest(schema, modules);
  const { businessId, menuItemId } = await seed(t);
  const orderId = await t.mutation(api.orders.submitOrder, validArgs(businessId, menuItemId));

  // Legacy `submitOrder` does not mint an access row; the token is the public
  // receipt capability, so seed one as the visitor-cancel cases do.
  const accessToken = 'token-reason';
  await t.run((ctx) =>
    ctx.db.insert('orderAccess', {
      orderId,
      businessId,
      accessToken,
      reference: 'REASON',
      createdAt: NOW,
    })
  );

  // Distinguish the transition stamp from `createdAt`: `submitOrder` stamped
  // the row at NOW; the decline happens a minute later.
  const transitionedAt = NOW + 60_000;
  vi.setSystemTime(transitionedAt);

  await ownerTransition(t, {
    businessId,
    orderId,
    action: 'decline',
    reason: 'Kitchen is out of that dish',
  });

  const receipt = await t.query(api.orders.getOrderByToken, { token: accessToken });
  expect(receipt.status).toBe('declined');
  expect(receipt.statusReason).toBe('Kitchen is out of that dish');

  const asOwner = t.withIdentity({ subject: 'user_owner' });
  const rows = await asOwner.query(api.orders.listOrders, { businessId });
  const row = rows.find((candidate) => candidate._id === orderId);
  expect(row?.status).toBe('declined');
  expect(row?.statusReason).toBe('Kitchen is out of that dish');
  expect(row?.createdAt).toBe(NOW);
  expect(row?.statusUpdatedAt).toBe(transitionedAt);
  expect(row?.statusUpdatedAt).not.toBe(row?.createdAt);
});

test('owner protocol: board rows without a stamp fall back to createdAt and a missing reason is null', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  // The legacy shape: `createdAt` only, no `statusReason`, no `statusUpdatedAt`.
  const orderId = await orderAtStatus(t, businessId, 'new');

  const stored = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(stored?.statusUpdatedAt).toBeUndefined();
  expect(stored?.statusReason).toBeUndefined();

  const asOwner = t.withIdentity({ subject: 'user_owner' });
  const rows = await asOwner.query(api.orders.listOrders, { businessId });
  const row = rows.find((candidate) => candidate._id === orderId);
  expect(row?.statusUpdatedAt).toBe(NOW);
  expect(row?.statusReason).toBeNull();
});

test('owner protocol: a wire status is rejected by argument validation (INV-11)', async () => {
  const t = convexTest(schema, modules);
  const { businessId } = await seed(t);
  const orderId = await orderAtStatus(t, businessId, 'new');

  // INV-11: the client sends an action, never a status. TypeScript already
  // rejects the extra key; `as never` is local to this call so the RUNTIME
  // args validator is what gets exercised. `status: 'completed'` is a legal
  // status value, so only the wire shape can be what rejects it.
  const withStatus = {
    businessId,
    orderId,
    action: 'accept',
    status: 'completed',
  } as never;

  const thrown = await ownerTransition(t, withStatus).then(
    () => {
      throw new Error('Expected the args validator to reject the extra status key');
    },
    (error: unknown) => error
  );
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).not.toBeInstanceOf(ConvexError);
  expect((thrown as Error).message).toBe('Validator error: Unexpected field `status` in object');

  const order = await t.run((ctx) => ctx.db.get('orders', orderId));
  expect(order?.status).toBe('new');
  expect(order?.statusReason).toBeUndefined();
  expect(order?.statusUpdatedAt).toBeUndefined();
  expect(await eventsFor(t, orderId)).toHaveLength(0);
});

