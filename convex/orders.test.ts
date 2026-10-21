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
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';

const modules = import.meta.glob('./**/*.ts');
const NOW = 1_700_000_000_000;

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

  await expect(
    asOwner.mutation(api.orders.transitionOrderStatus, { businessId, orderId, action: 'accept' })
  ).rejects.toThrow('Invalid status transition');
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
