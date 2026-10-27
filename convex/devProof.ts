/**
 * Order-protocol concurrency proof fixtures (issue #81, T9 / protocol §7.3
 * L1740–1749).
 *
 * Fixtures, assertions, and teardown ONLY. This module deliberately does not
 * wrap `placeOrder`, does not re-implement `transitionOrderStatus`'s core, and
 * does not re-implement expiry — the drift risk research Q1 rejected:
 *
 *   - scenario 1 (duplicate `placeOrder`, L1744) is driven by the harness
 *     against the real public `orders:placeOrder`, which is why
 *     `createProbeOrder` never writes an `orderIdempotency` row;
 *   - scenarios 2–4 (L1745–1747) are driven against the real public
 *     `orders:transitionOrderStatus` with `--identity`, and expiry runs the
 *     real internal `orderExpiry:expireOrder`.
 *
 * Everything exported here is internal (CLI / deployment authority only), so
 * no fixture is client-callable. Invoke from the harness, e.g.:
 *
 *   npx convex run devProof:seedProbe '{"runId":"<id>"}'
 *
 * `runId` scopes every fixture: the probe business is named
 * `__T9 proof <runId>__`, so concurrent or stale runs never collide and
 * cleanup reaches only rows through that business.
 *
 * Seeded fixture businesses cannot host the proof: `businesses/seedFixtures.ts`
 * sets no `orderProtocol`, so they are `legacy` and `placeOrder` rejects them
 * (`orders.ts` L849–853). The probe business sets `orderProtocol: 'basket'`.
 */

import { v } from 'convex/values';

import type { Doc, Id, TableNames } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { buildSearchText } from './businesses/helpers';
import { insertOrderAccess } from './orderAccess';
import { DEFAULT_TTL_MS } from './orderCommitPolicy';
import { businessThrottleKey } from './orderThrottle';

/** Same synthetic owner the business seed creates; `--identity` impersonates it. */
const SEED_OWNER_EXTERNAL_ID = 'seed-owner-localconnect';

/** Preferred public category (created by `categories:seedCategories`). */
const PREFERRED_CATEGORY_SLUG = 'food-drink';
/** Fallback category, created only when the preferred slug is absent. */
const PROBE_CATEGORY_SLUG = '__t9-proof';
const PROBE_CATEGORY_NAME = '__T9 proof__';
const PROBE_CATEGORY_ORDERING = 9_999;

const PROBE_MENU_GROUP_NAME = '__T9 proof menu__';
const PROBE_MENU_ITEM_NAME = '__T9 proof item__';
/** Integer cents, so `placeOrder` prices a one-line basket at $12.50. */
const PROBE_ITEM_PRICE_CENTS = 1_250;
const PROBE_CUSTOMER_NAME = 'T9 Probe Customer';

/** Bounded reads inside the synthetic probe business (it owns a handful of rows). */
const PROBE_MENU_READ_LIMIT = 200;

const probeOrderStatusValidator = v.union(
  v.literal('new'),
  v.literal('accepted'),
  v.literal('ready'),
  v.literal('completed'),
  v.literal('declined'),
  v.literal('cancelled'),
  v.literal('expired'),
  v.literal('no_show')
);

/** The single name marker that makes a probe business run-scoped. */
function probeBusinessName(runId: string): string {
  return `__T9 proof ${runId}__`;
}

/**
 * All-day, every-day opening hours.
 *
 * A period whose close is not after its open wraps past midnight
 * (`businesses/publicHours.ts` `periodStatus`), so `00:00`–`00:00` is open at
 * every business-local instant. A `23:59` close would already be closed during
 * the final local minute, which would make a probe submitted then flaky.
 * `timezone: 'UTC'` makes that instant deterministic.
 */
function allDayHours(): Doc<'businesses'>['hours'] {
  const allDay = [{ opensAt: '00:00', closesAt: '00:00' }];
  return {
    monday: allDay,
    tuesday: allDay,
    wednesday: allDay,
    thursday: allDay,
    friday: allDay,
    saturday: allDay,
    sunday: allDay,
  };
}

/**
 * Resolves the seed owner. A fresh dev deployment has no Clerk-created users,
 * so an absent row is an operator error with a fix — never a silently created
 * Clerk-less user that `--identity` could impersonate without the seed.
 */
async function seedOwnerId(ctx: MutationCtx): Promise<Id<'users'>> {
  const owner = await ctx.db
    .query('users')
    .withIndex('byExternalId', (q) => q.eq('externalId', SEED_OWNER_EXTERNAL_ID))
    .unique();

  if (owner === null) {
    throw new Error('seed owner missing — run npm run seed');
  }
  return owner._id;
}

/**
 * Reuses a seeded category by slug; otherwise creates the shared probe
 * category once. The probe category is never deleted by cleanup: it is shared
 * by every runId (unlike the run-scoped business), so deleting it would break a
 * later run's probe.
 */
async function probeCategoryId(ctx: MutationCtx): Promise<Id<'categories'>> {
  for (const slug of [PREFERRED_CATEGORY_SLUG, PROBE_CATEGORY_SLUG]) {
    const existing = await ctx.db
      .query('categories')
      .withIndex('bySlug', (q) => q.eq('slug', slug))
      .unique();
    if (existing !== null) {
      return existing._id;
    }
  }

  return await ctx.db.insert('categories', {
    name: PROBE_CATEGORY_NAME,
    slug: PROBE_CATEGORY_SLUG,
    ordering: PROBE_CATEGORY_ORDERING,
  });
}

/** One probe business for this run, by owner + run-scoped name. */
async function findProbeBusiness(
  ctx: MutationCtx | QueryCtx,
  ownerId: Id<'users'>,
  name: string
): Promise<Doc<'businesses'> | null> {
  const owned = await ctx.db
    .query('businesses')
    .withIndex('byOwnerId', (q) => q.eq('ownerId', ownerId))
    .collect();

  return owned.find((business) => business.name === name) ?? null;
}

/** Ensures the probe business exists and has the runId marker it was probed for. */
async function requireProbeBusiness(
  ctx: MutationCtx | QueryCtx,
  runId: string,
  businessId: Id<'businesses'>
): Promise<Doc<'businesses'>> {
  const business = await ctx.db.get('businesses', businessId);
  if (business === null || business.name !== probeBusinessName(runId)) {
    throw new Error(
      `business ${businessId} is not the T9 probe for run "${runId}" — run devProof:seedProbe first`
    );
  }
  return business;
}

/** Ensures one menu group inside the probe business; reuses it by name. */
async function ensureProbeMenuGroup(
  ctx: MutationCtx,
  businessId: Id<'businesses'>
): Promise<Id<'menuGroups'>> {
  const groups = await ctx.db
    .query('menuGroups')
    .withIndex('byBusinessIdOrdering', (q) => q.eq('businessId', businessId))
    .take(PROBE_MENU_READ_LIMIT);
  const existing = groups.find((group) => group.name === PROBE_MENU_GROUP_NAME);
  if (existing !== undefined) {
    return existing._id;
  }

  return await ctx.db.insert('menuGroups', {
    businessId,
    name: PROBE_MENU_GROUP_NAME,
    ordering: 0,
  });
}

/**
 * Ensures one available, priced menu item with no customization groups, so a
 * one-line `placeOrder` basket prices deterministically.
 */
async function ensureProbeMenuItem(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  groupId: Id<'menuGroups'>
): Promise<Id<'menuItems'>> {
  const items = await ctx.db
    .query('menuItems')
    .withIndex('byGroupId', (q) => q.eq('groupId', groupId))
    .take(PROBE_MENU_READ_LIMIT);
  const existing = items.find((item) => item.name === PROBE_MENU_ITEM_NAME);
  if (existing !== undefined) {
    return existing._id;
  }

  return await ctx.db.insert('menuItems', {
    businessId,
    groupId,
    name: PROBE_MENU_ITEM_NAME,
    description: 'T9 order-protocol concurrency probe item.',
    price: PROBE_ITEM_PRICE_CENTS,
    customizationOptions: [],
    ordering: 0,
    isAvailable: true,
  });
}

/**
 * The rows whose `orderThrottle.key` mentions this business: the exact
 * `business:<id>:10m` key plus both `contact:<id>:<hash>:10m|24h` siblings.
 *
 * `orderThrottle` has only `byKey`, and the contact keys put the business id
 * after the `contact:` prefix, so no index range can select them. The table is
 * dev-only and probe-sized; a table scan is the only way to return *every*
 * matching row, which the evidence needs (a bounded `take` could silently drop
 * a duplicate-key row and turn a real defect into a pass). A transaction-limit
 * breach throws instead of returning a wrong answer.
 */
async function readProbeThrottleRows(
  ctx: MutationCtx | QueryCtx,
  businessId: Id<'businesses'>
): Promise<Doc<'orderThrottle'>[]> {
  const businessKey = businessThrottleKey(businessId);
  // Shape pinned by `orderThrottle.ts` `contactThrottleKeys` (protocol §6.2.2
  // L1009): `contact:<businessId>:<sha256>:10m` / `...:24h`.
  const contactPrefix = `contact:${businessId}:`;
  const matches = new Map<string, Doc<'orderThrottle'>>();

  for await (const row of ctx.db.query('orderThrottle')) {
    if (row.key === businessKey || row.key.startsWith(contactPrefix)) {
      matches.set(row._id, row);
    }
  }

  return [...matches.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Creates (or re-finds) the run-scoped probe business, its menu group, and its
 * one priced item. Idempotent per `runId`: a retried harness run gets the same
 * ids and writes nothing new.
 *
 * Returns the owner identity the harness impersonates for owner transitions:
 * `npx convex run … --identity '{"subject":"seed-owner-localconnect"}'`.
 */
export const seedProbe = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const now = Date.now();
    const ownerUserId = await seedOwnerId(ctx);
    const categoryId = await probeCategoryId(ctx);
    const name = probeBusinessName(runId);

    const existing = await findProbeBusiness(ctx, ownerUserId, name);
    const businessId =
      existing?._id ??
      (await ctx.db.insert('businesses', {
        name,
        categoryId,
        description: 'Order-protocol concurrency probe fixture (issue #81, T9).',
        // Shape copied from the seeded fixtures (`businesses/seed.ts`
        // L143–195): every required field present, no storage-backed photos.
        address: {
          addressLine1: '1 T9 Probe Way',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62704',
          country: 'US',
        },
        phone: '+1 555 0199',
        timezone: 'UTC',
        photos: [],
        hours: allDayHours(),
        status: 'approved',
        verification: { isVerified: true, verifiedAt: now },
        rating: 0,
        ratingCount: 0,
        services: [],
        credentials: [],
        keywords: ['__t9-proof__', runId],
        searchText: buildSearchText(
          name,
          ['__t9-proof__', runId],
          'Order-protocol concurrency probe fixture (issue #81, T9).'
        ),
        ownerId: ownerUserId,
        lastUpdatedAt: now,
        submittedAt: now,
        isFeatured: false,
        lastSavedAt: now,
        orderProtocol: 'basket',
      }));

    const groupId = await ensureProbeMenuGroup(ctx, businessId);
    const menuItemId = await ensureProbeMenuItem(ctx, businessId, groupId);

    return {
      businessId,
      menuItemId,
      ownerExternalId: SEED_OWNER_EXTERNAL_ID,
      ownerUserId,
    };
  },
});

/**
 * Minimal order fixture for the transition races (scenarios 2–4, L1745–1747).
 *
 * Scenario 1 is deliberately absent: the duplicate-commit race must run the
 * real `orders:placeOrder`, so this fixture writes no `orderIdempotency` row
 * and no `orderEvents` row — a synthetic `submitted` event would corrupt the
 * "exactly one event" assertion. The `orderExpiry` row is not yet due so an
 * accept is not rejected by the D8 expiry guard; `forceDueExpiry` makes it due
 * for scenario 4 only.
 */
export const createProbeOrder = internalMutation({
  args: {
    runId: v.string(),
    businessId: v.id('businesses'),
    status: v.optional(probeOrderStatusValidator),
  },
  handler: async (ctx, { runId, businessId, status }) => {
    const now = Date.now();
    await requireProbeBusiness(ctx, runId, businessId);

    const orderId = await ctx.db.insert('orders', {
      businessId,
      status: status ?? 'new',
      customerName: PROBE_CUSTOMER_NAME,
      createdAt: now,
      statusUpdatedAt: now,
    });

    // Reuse the production capability mint (`orderAccess.ts`) rather than
    // copying token/reference generation into a fixture.
    await insertOrderAccess(ctx, { orderId, businessId });
    await ctx.db.insert('orderExpiry', {
      orderId,
      businessId,
      expiresAt: now + DEFAULT_TTL_MS,
    });

    return { orderId };
  },
});

/**
 * Moves every expiry row for a probe order into the past, inserting one when
 * the order has none. This is the only expiry-shaped write in the module: the
 * race itself then runs the real `orderExpiry:expireOrder` (scenario 4,
 * L1747), so the expiry rule is never duplicated here.
 */
export const forceDueExpiry = internalMutation({
  args: { runId: v.string(), orderId: v.id('orders') },
  handler: async (ctx, { runId, orderId }) => {
    const now = Date.now();
    const order = await ctx.db.get('orders', orderId);
    if (order === null) {
      throw new Error(`probe order ${orderId} not found for run "${runId}"`);
    }
    await requireProbeBusiness(ctx, runId, order.businessId);

    const rows = await ctx.db
      .query('orderExpiry')
      .withIndex('byOrderId', (q) => q.eq('orderId', orderId))
      .collect();

    if (rows.length === 0) {
      await ctx.db.insert('orderExpiry', {
        orderId,
        businessId: order.businessId,
        expiresAt: now - 1_000,
      });
      return { ok: true as const };
    }

    // Every row, not just the first: a duplicate future row must not hide the
    // due row from `expireOrderAt`'s "any due row wins" check.
    for (const row of rows) {
      await ctx.db.patch(row._id, { expiresAt: now - 1_000 });
    }
    return { ok: true as const };
  },
});

/**
 * Final-row dump for the evidence file (L1749: "Record the Convex request ids
 * and the final rows"). Includes counts so the harness can assert "exactly one
 * order/event/notification" and "exactly one throttle row per key" without a
 * second round trip.
 *
 * Server-side evidence only: this returns raw `orders` rows and
 * `orderBlocks.contactHash` digests. The harness writes them to the evidence
 * markdown; they are never sent to a browser or logged, and the public/owner
 * projections keep their own masking.
 */
export const dumpProbe = internalQuery({
  args: { runId: v.string(), businessId: v.id('businesses') },
  handler: async (ctx, { runId, businessId }) => {
    const business = await requireProbeBusiness(ctx, runId, businessId);

    // Probe-scoped reads: exact counts are the evidence, so a bounded `take`
    // would silently falsify them. Convex throws on a transaction-limit breach.
    const orders = await ctx.db
      .query('orders')
      .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
      .collect();

    const orderEvents: Doc<'orderEvents'>[] = [];
    for (const order of orders) {
      const events = await ctx.db
        .query('orderEvents')
        .withIndex('byOrderIdCreatedAt', (q) => q.eq('orderId', order._id))
        .collect();
      orderEvents.push(...events);
    }

    const notifications = (
      await ctx.db
        .query('notifications')
        .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
        .collect()
    ).filter((row) => row.userId === business.ownerId);

    const orderIdempotency = await ctx.db
      .query('orderIdempotency')
      .withIndex('byBusinessIdKey', (q) => q.eq('businessId', businessId))
      .collect();

    const orderThrottle = await readProbeThrottleRows(ctx, businessId);

    const orderBlocks = await ctx.db
      .query('orderBlocks')
      .withIndex('byBusinessIdContactHash', (q) => q.eq('businessId', businessId))
      .collect();

    return {
      runId,
      businessId,
      orders,
      orderEvents,
      notifications,
      orderIdempotency,
      // Projected to the three fields the evidence needs; a raw doc is fine to
      // return here but the count assertions read only these.
      orderThrottle: orderThrottle.map((row) => ({
        key: row.key,
        windowStart: row.windowStart,
        count: row.count,
      })),
      orderBlocks,
      counts: {
        orders: orders.length,
        orderEvents: orderEvents.length,
        notifications: notifications.length,
        orderIdempotency: orderIdempotency.length,
        orderThrottle: orderThrottle.length,
        orderBlocks: orderBlocks.length,
      },
    };
  },
});

/**
 * Deletes every supplied row and returns the count. Cleanup's per-table
 * evidence: one helper keeps the handler's branching low and the counts exact.
 */
async function deleteAndCount<T extends TableNames>(
  ctx: MutationCtx,
  rows: readonly Doc<T>[]
): Promise<number> {
  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
  return rows.length;
}

/**
 * Deletes every row this `runId` created, in dependency order, and returns
 * per-table counts. A `runId` that matches nothing is a no-op with zero counts.
 *
 * Probe identity is never a table-scan heuristic: the business is found by the
 * seed owner's `byOwnerId` range plus the exact `__T9 proof <runId>__` name,
 * and every child row is reached through that `businessId` (or, for
 * `orderIdempotency`, through its `orderId`). That is why human-owned
 * `orderBlocks` rows cannot be mistaken for probe rows — the probe business is
 * synthetic and run-scoped.
 *
 * Never deleted: the seed owner user, categories (the probe category is shared
 * across runs), or any row outside the probe business.
 */
export const cleanupProbe = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const deleted = {
      orders: 0,
      orderAccess: 0,
      orderEvents: 0,
      orderIdempotency: 0,
      orderExpiry: 0,
      orderThrottle: 0,
      orderBlocks: 0,
      notifications: 0,
      menuItems: 0,
      menuGroups: 0,
      businesses: 0,
    };

    const owner = await ctx.db
      .query('users')
      .withIndex('byExternalId', (q) => q.eq('externalId', SEED_OWNER_EXTERNAL_ID))
      .unique();
    if (owner === null) {
      return { deleted };
    }

    const business = await findProbeBusiness(ctx, owner._id, probeBusinessName(runId));
    if (business === null) {
      return { deleted };
    }
    const businessId = business._id;

    const orders = await ctx.db
      .query('orders')
      .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
      .collect();
    const orderIds = new Set(orders.map((order) => order._id));

    // Order children first, then the order rows.
    for (const order of orders) {
      deleted.orderAccess += await deleteAndCount(
        ctx,
        await ctx.db
          .query('orderAccess')
          .withIndex('byOrderId', (q) => q.eq('orderId', order._id))
          .collect()
      );

      deleted.orderEvents += await deleteAndCount(
        ctx,
        await ctx.db
          .query('orderEvents')
          .withIndex('byOrderIdCreatedAt', (q) => q.eq('orderId', order._id))
          .collect()
      );

      deleted.orderExpiry += await deleteAndCount(
        ctx,
        await ctx.db
          .query('orderExpiry')
          .withIndex('byOrderId', (q) => q.eq('orderId', order._id))
          .collect()
      );
    }

    // All idempotency rows for the probe business point at its own orders.
    const idempotency = (
      await ctx.db
        .query('orderIdempotency')
        .withIndex('byBusinessIdKey', (q) => q.eq('businessId', businessId))
        .collect()
    ).filter((row) => orderIds.has(row.orderId));
    deleted.orderIdempotency += await deleteAndCount(ctx, idempotency);

    deleted.orders += await deleteAndCount(ctx, orders);

    // Probe throttle keys only: the exact business key plus contact keys
    // carrying this businessId. No other business's counters are touched.
    deleted.orderThrottle += await deleteAndCount(
      ctx,
      await readProbeThrottleRows(ctx, businessId)
    );

    deleted.orderBlocks += await deleteAndCount(
      ctx,
      await ctx.db
        .query('orderBlocks')
        .withIndex('byBusinessIdContactHash', (q) => q.eq('businessId', businessId))
        .collect()
    );

    deleted.notifications += await deleteAndCount(
      ctx,
      await ctx.db
        .query('notifications')
        .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
        .collect()
    );

    deleted.menuItems += await deleteAndCount(
      ctx,
      await ctx.db
        .query('menuItems')
        .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
        .collect()
    );

    deleted.menuGroups += await deleteAndCount(
      ctx,
      await ctx.db
        .query('menuGroups')
        .withIndex('byBusinessId', (q) => q.eq('businessId', businessId))
        .collect()
    );

    await ctx.db.delete(businessId);
    deleted.businesses += 1;

    return { deleted };
  },
});
