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
 * `runId` scopes every fixture: the probe businesses are named
 * `__T9 proof <runId>__` and `__T9 proof <runId> #2..10__`, so concurrent or
 * stale runs never collide and cleanup reaches only rows through those
 * businesses. Business 1 keeps the original exact name; the other nine are the
 * #84 T10 load-test fan-out (10 businesses × 10 calls stays inside the
 * 60-per-10-minute business throttle).
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

/**
 * Businesses one `seedProbe` run creates (issue #84, T10 / plan D8).
 *
 * Ten distinct approved, open businesses let the load harness fan 100
 * concurrent submissions out 10 per business. That stays inside the business
 * throttle's 60 per 10 minutes (`orderCommitPolicy.ts` `BUSINESS_THROTTLE_10M`),
 * so a `TOO_MANY_REQUESTS` in the burst is a measured outcome rather than a
 * harness-designed failure. One business cannot host the burst: its 61st claim
 * is guaranteed to be throttled (§3.3 of `tasks/issue-84-context.md`).
 */
const PROBE_BUSINESS_COUNT = 10;

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

/**
 * The single name marker that makes a probe business run-scoped.
 *
 * Business 1 keeps the pre-#84 exact name, so an existing `runId`'s fixtures and
 * the single-business scenarios (1–4) are untouched; businesses 2–10 append
 * ` #n`. Every name this run can own is therefore an exact string (see
 * `probeBusinessNames`), never a prefix match.
 */
function probeBusinessName(runId: string, index: number): string {
  return index === 0 ? `__T9 proof ${runId}__` : `__T9 proof ${runId} #${index + 1}__`;
}

/** Every business name this run may own, in seed order. */
function probeBusinessNames(runId: string): string[] {
  return Array.from({ length: PROBE_BUSINESS_COUNT }, (_, index) =>
    probeBusinessName(runId, index)
  );
}

/**
 * Per-business contact prefix the load harness completes with a 6-digit call
 * ordinal (`+1555<business digit><000000>`), so every distinct submission in the
 * burst carries a distinct normalized phone — and therefore a distinct contact
 * hash (`orderCommitPolicy` `parseContact` → `contact:<businessId>:<sha256>:10m|24h`).
 * Eleven digits, inside `MIN_PHONE_DIGITS`..`MAX_PHONE_DIGITS` (7..20).
 */
function probeContactPhonePrefix(index: number): string {
  return `+1555${index}`;
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

/** The probe businesses for this run, by owner + the run-scoped names. */
async function findProbeBusinesses(
  ctx: MutationCtx | QueryCtx,
  ownerId: Id<'users'>,
  runId: string
): Promise<Doc<'businesses'>[]> {
  const names = new Set(probeBusinessNames(runId));
  const owned = await ctx.db
    .query('businesses')
    .withIndex('byOwnerId', (q) => q.eq('ownerId', ownerId))
    .collect();

  return owned.filter((business) => names.has(business.name));
}

/** Ensures the business exists and carries one of this run's probe names. */
async function requireProbeBusiness(
  ctx: MutationCtx | QueryCtx,
  runId: string,
  businessId: Id<'businesses'>
): Promise<Doc<'businesses'>> {
  const business = await ctx.db.get('businesses', businessId);
  if (business === null || !probeBusinessNames(runId).includes(business.name)) {
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
/** True when an `orderThrottle.key` is one of this business's three keys. */
function throttleKeyMatchesBusiness(
  key: string,
  businessId: Id<'businesses'>
): boolean {
  // Exact business key plus both contact siblings. Shape pinned by
  // `orderThrottle.ts` `contactThrottleKeys` (protocol §6.2.2 L1009):
  // `contact:<businessId>:<sha256>:10m` / `...:24h`.
  return key === businessThrottleKey(businessId) || key.startsWith(`contact:${businessId}:`);
}

/**
 * The rows whose `orderThrottle.key` mentions one of these businesses: each
 * exact `business:<id>:10m` key plus its `contact:<id>:<hash>:10m|24h` siblings.
 *
 * `orderThrottle` has only `byKey`, and the contact keys put the business id
 * after the `contact:` prefix, so no index range can select them. The table is
 * dev-only and probe-sized; a table scan is the only way to return *every*
 * matching row, which the evidence needs (a bounded `take` could silently drop
 * a duplicate-key row and turn a real defect into a pass). A transaction-limit
 * breach throws instead of returning a wrong answer.
 *
 * ONE scan for the whole business set: the #84 dump/cleanup covers ten
 * businesses, and scanning per business would repeat the only full-table read
 * ten times in a single transaction.
 */
async function readProbeThrottleRows(
  ctx: MutationCtx | QueryCtx,
  businessIds: ReadonlySet<Id<'businesses'>>
): Promise<Doc<'orderThrottle'>[]> {
  const matches = new Map<string, Doc<'orderThrottle'>>();

  for await (const row of ctx.db.query('orderThrottle')) {
    for (const businessId of businessIds) {
      if (throttleKeyMatchesBusiness(row.key, businessId)) {
        matches.set(row._id, row);
        break;
      }
    }
  }

  return [...matches.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Creates one run-scoped probe business. Shape copied from the seeded fixtures
 * (`businesses/seed.ts` L143–195): every required field present, no
 * storage-backed photos. Approved, all-day open, `orderProtocol: 'basket'`, so
 * `placeOrder` accepts it.
 */
async function createProbeBusiness(
  ctx: MutationCtx,
  args: {
    name: string;
    categoryId: Id<'categories'>;
    ownerId: Id<'users'>;
    runId: string;
    now: number;
  }
): Promise<Id<'businesses'>> {
  const description = 'Order-protocol concurrency probe fixture (issue #81, T9 / #84, T10).';
  const keywords = ['__t9-proof__', args.runId];

  return await ctx.db.insert('businesses', {
    name: args.name,
    categoryId: args.categoryId,
    description,
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
    verification: { isVerified: true, verifiedAt: args.now },
    rating: 0,
    ratingCount: 0,
    services: [],
    credentials: [],
    keywords,
    searchText: buildSearchText(args.name, keywords, description),
    ownerId: args.ownerId,
    lastUpdatedAt: args.now,
    submittedAt: args.now,
    isFeatured: false,
    lastSavedAt: args.now,
    orderProtocol: 'basket',
  });
}

/**
 * Creates (or re-finds) the run-scoped probe businesses, each with its menu
 * group and one priced item. Idempotent per `runId`: a retried harness run gets
 * the same ids and writes nothing new.
 *
 * Returns the owner identity the harness impersonates for owner transitions:
 * `npx convex run … --identity '{"subject":"seed-owner-localconnect"}'`.
 *
 * `businessId`/`menuItemId` stay the first entry so scenarios 1–4 keep their
 * single-business contract; `businesses` is the #84 T10 ten-business fan-out,
 * each with the contact prefix the harness completes per call.
 */
export const seedProbe = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const now = Date.now();
    const ownerUserId = await seedOwnerId(ctx);
    const categoryId = await probeCategoryId(ctx);

    const existing = await findProbeBusinesses(ctx, ownerUserId, runId);
    const existingByName = new Map(
      existing.map((business) => [business.name, business] as const)
    );

    const businesses: Array<{
      businessId: Id<'businesses'>;
      menuItemId: Id<'menuItems'>;
      name: string;
      contactPhonePrefix: string;
    }> = [];

    for (let index = 0; index < PROBE_BUSINESS_COUNT; index += 1) {
      const name = probeBusinessName(runId, index);
      const businessId =
        existingByName.get(name)?._id ??
        (await createProbeBusiness(ctx, {
          name,
          categoryId,
          ownerId: ownerUserId,
          runId,
          now,
        }));

      const groupId = await ensureProbeMenuGroup(ctx, businessId);
      const menuItemId = await ensureProbeMenuItem(ctx, businessId, groupId);
      businesses.push({
        businessId,
        menuItemId,
        name,
        contactPhonePrefix: probeContactPhonePrefix(index),
      });
    }

    return {
      businessId: businesses[0].businessId,
      menuItemId: businesses[0].menuItemId,
      ownerExternalId: SEED_OWNER_EXTERNAL_ID,
      ownerUserId,
      businesses,
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

/** Drops duplicate ids, keeping the caller's order (primary first). */
function uniqueBusinessIds(ids: readonly Id<'businesses'>[]): Id<'businesses'>[] {
  const seen = new Set<Id<'businesses'>>();
  const ordered: Id<'businesses'>[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  return ordered;
}

/**
 * Every `orderMetricCounters` row belonging to these probe businesses.
 *
 * `orderMetricCounters` is indexed only by `byBusinessIdCode` (business + code),
 * so "every code of these businesses" has no index range — the read must scan.
 * The table is dev-only and probe-sized, and exact counts are the evidence, so a
 * bounded `take` would be wrong for the same reason it is wrong for
 * `readProbeThrottleRows`: it could drop a row and turn a missing report into a
 * pass. A transaction-limit breach throws instead of returning a wrong answer.
 */
async function readProbeMetricCounters(
  ctx: MutationCtx | QueryCtx,
  businessIds: ReadonlySet<Id<'businesses'>>
): Promise<Doc<'orderMetricCounters'>[]> {
  const rows: Doc<'orderMetricCounters'>[] = [];
  for await (const row of ctx.db.query('orderMetricCounters')) {
    if (businessIds.has(row.businessId)) {
      rows.push(row);
    }
  }

  return rows.sort(
    (left, right) =>
      left.businessId.localeCompare(right.businessId) || left.code.localeCompare(right.code)
  );
}

/** Counter values summed by code across the supplied rows. */
function sumMetricCounters(
  rows: readonly Doc<'orderMetricCounters'>[]
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[row.code] = (totals[row.code] ?? 0) + row.value;
  }
  return totals;
}

/**
 * Final-row dump for the evidence file (L1749: "Record the Convex request ids
 * and the final rows"). Includes counts so the harness can assert "exactly one
 * order/event/notification" and "exactly one throttle row per key" without a
 * second round trip.
 *
 * `businessIds` is the #84 T10 addition: the 100-way scenario spans ten probe
 * businesses, and one dump must return all of them (plus the metric counters the
 * harness reported) so the counter-vs-observed cross-check is one read. Omitting
 * it keeps the pre-#84 single-business contract byte-for-byte.
 *
 * Server-side evidence only: this returns raw `orders` rows and
 * `orderBlocks.contactHash` digests. The harness writes them to the evidence
 * markdown; they are never sent to a browser or logged, and the public/owner
 * projections keep their own masking.
 */
export const dumpProbe = internalQuery({
  args: {
    runId: v.string(),
    businessId: v.id('businesses'),
    // Additional run-scoped businesses (the #84 load scenario's other nine).
    businessIds: v.optional(v.array(v.id('businesses'))),
  },
  handler: async (ctx, { runId, businessId, businessIds }) => {
    const targetIds = uniqueBusinessIds([businessId, ...(businessIds ?? [])]);
    const businesses: Doc<'businesses'>[] = [];
    for (const id of targetIds) {
      businesses.push(await requireProbeBusiness(ctx, runId, id));
    }

    const metricCounters = await readProbeMetricCounters(ctx, new Set(targetIds));
    // One throttle scan for all target businesses (see the helper's rationale).
    const allThrottle = await readProbeThrottleRows(ctx, new Set(targetIds));

    // Probe-scoped reads: exact counts are the evidence, so a bounded `take`
    // would silently falsify them. Convex throws on a transaction-limit breach.
    const orders: Doc<'orders'>[] = [];
    const orderEvents: Doc<'orderEvents'>[] = [];
    const notifications: Doc<'notifications'>[] = [];
    const orderIdempotency: Doc<'orderIdempotency'>[] = [];
    const orderThrottle: Doc<'orderThrottle'>[] = [];
    const orderBlocks: Doc<'orderBlocks'>[] = [];
    const perBusiness: Array<{
      businessId: Id<'businesses'>;
      name: string;
      counts: Record<string, number>;
      metricCounts: Record<string, number>;
    }> = [];

    for (const business of businesses) {
      const businessOrders = await ctx.db
        .query('orders')
        .withIndex('byBusinessId', (q) => q.eq('businessId', business._id))
        .collect();

      const businessEvents: Doc<'orderEvents'>[] = [];
      for (const order of businessOrders) {
        businessEvents.push(
          ...(await ctx.db
            .query('orderEvents')
            .withIndex('byOrderIdCreatedAt', (q) => q.eq('orderId', order._id))
            .collect())
        );
      }

      const businessNotifications = (
        await ctx.db
          .query('notifications')
          .withIndex('byBusinessId', (q) => q.eq('businessId', business._id))
          .collect()
      ).filter((row) => row.userId === business.ownerId);

      const businessIdempotency = await ctx.db
        .query('orderIdempotency')
        .withIndex('byBusinessIdKey', (q) => q.eq('businessId', business._id))
        .collect();

      const businessThrottle = allThrottle.filter((row) =>
        throttleKeyMatchesBusiness(row.key, business._id)
      );

      const businessBlocks = await ctx.db
        .query('orderBlocks')
        .withIndex('byBusinessIdContactHash', (q) => q.eq('businessId', business._id))
        .collect();

      const businessCounters = metricCounters.filter(
        (row) => row.businessId === business._id
      );

      orders.push(...businessOrders);
      orderEvents.push(...businessEvents);
      notifications.push(...businessNotifications);
      orderIdempotency.push(...businessIdempotency);
      orderThrottle.push(...businessThrottle);
      orderBlocks.push(...businessBlocks);

      perBusiness.push({
        businessId: business._id,
        name: business.name,
        counts: {
          orders: businessOrders.length,
          orderEvents: businessEvents.length,
          notifications: businessNotifications.length,
          orderIdempotency: businessIdempotency.length,
          orderThrottle: businessThrottle.length,
          orderBlocks: businessBlocks.length,
          orderMetricCounters: businessCounters.length,
        },
        metricCounts: sumMetricCounters(businessCounters),
      });
    }

    return {
      runId,
      businessId,
      // Additive (#84 T10): every business this dump covered, primary first.
      businessIds: businesses.map((business) => business._id),
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
      // Additive (#84 T10): client-reported rejection counters, exactly as stored.
      orderMetricCounters: metricCounters.map((row) => ({
        businessId: row.businessId,
        code: row.code,
        value: row.value,
      })),
      metricCounts: sumMetricCounters(metricCounters),
      perBusiness,
      counts: {
        orders: orders.length,
        orderEvents: orderEvents.length,
        notifications: notifications.length,
        orderIdempotency: orderIdempotency.length,
        orderThrottle: orderThrottle.length,
        orderBlocks: orderBlocks.length,
        // Additive (#84 T10): counter rows, not their summed values.
        orderMetricCounters: metricCounters.length,
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
 * Probe identity is never a table-scan heuristic: the businesses are found by
 * the seed owner's `byOwnerId` range plus the run's exact names
 * (`__T9 proof <runId>__` and `__T9 proof <runId> #2..10__`), and every child row
 * is reached through one of those `businessId`s (or, for `orderIdempotency`,
 * through its `orderId`). That is why human-owned `orderBlocks` rows cannot be
 * mistaken for probe rows — the probe businesses are synthetic and run-scoped.
 *
 * Never deleted: the seed owner user, categories (the probe category is shared
 * across runs), or any row outside the probe businesses.
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
      orderMetricCounters: 0,
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

    const businesses = await findProbeBusinesses(ctx, owner._id, runId);
    if (businesses.length === 0) {
      return { deleted };
    }

    // One scan each for the whole run: the per-business loop below must not
    // repeat the only full-table read ten times in one transaction.
    const businessIds = new Set(businesses.map((business) => business._id));
    const allThrottle = await readProbeThrottleRows(ctx, businessIds);
    const allMetricCounters = await readProbeMetricCounters(ctx, businessIds);

    for (const business of businesses) {
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
        allThrottle.filter((row) => throttleKeyMatchesBusiness(row.key, businessId))
      );

      // Client-reported rejection counters (#84 T10) are probe rows too: leaving
      // them behind would survive this run's cleanup and pollute a rerun's story.
      deleted.orderMetricCounters += await deleteAndCount(
        ctx,
        allMetricCounters.filter((row) => row.businessId === businessId)
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
    }

    return { deleted };
  },
});
