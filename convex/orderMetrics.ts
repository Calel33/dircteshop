import { v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireBusinessOwner } from './authz';
import { bumpMetricCounter } from './metricCounter';
import { REJECTION_CODES, type RejectionCode } from './orderCommitPolicy';

// Order metrics (issue #84, T10 / plan D4, research design A).
//
// Rejection counters are CLIENT-REPORTED and best-effort. The server cannot
// count a rejection where it happens: every rejection path ends in a thrown
// `ConvexError`, and a mutation's writes are discarded when it throws — the
// same model `orders.ts:50-51` documents for the owner notice. So the customer's
// client calls this mutation from its own `catch`, in a transaction of its own
// that commits.
//
// Consequences the plan accepts: a caller that does not report is not counted,
// and an anonymous caller can inflate a count. Mitigations: `code` is a closed
// const list (no arbitrary keys are ever written), counters are keyed per
// `(businessId, code)` so per-code rates stay separable, and the runbook labels
// the metric "client-reported, best-effort".

const REJECTION_CODE_SET: ReadonlySet<string> = new Set(REJECTION_CODES);

/**
 * Records one rejected order attempt for a business.
 *
 * ANONYMOUS BY DESIGN — deliberately no auth guard. The rejection paths this
 * measures include anonymous throttled and blocked customers, so requiring an
 * identity here would blind the metric to the exact traffic it exists to count
 * (and a blocked contact has no account to present). A reviewer should read the
 * missing guard as the design, not an omission.
 *
 * An out-of-list `code` is a silent success with no write: this is a public
 * write surface, and the closed list is what keeps it from becoming an
 * arbitrary key-value writer.
 *
 * `businessId` is validated for shape only (`v.id`). A report against an id
 * whose business no longer exists writes a harmless orphan counter row; adding
 * an existence read would tax every report and leak which ids are live, for a
 * metric that is already inflatable by design.
 *
 * Writes nothing but the counter and carries no PII (INV-25).
 */
export const recordOrderRejection = mutation({
  args: {
    businessId: v.id('businesses'),
    // `v.string()` plus the handler check, not a `v.union` of literals: a
    // validator failure would throw, and an unknown code must succeed as a
    // no-op — this is a fire-and-forget beacon and must never surface an error.
    code: v.string(),
  },
  handler: async (ctx, args) => {
    if (!REJECTION_CODE_SET.has(args.code)) {
      return;
    }
    await bumpMetricCounter(ctx, args.businessId, args.code);
  },
});

/**
 * The receipt-view counter key (protocol §4.5 measurement plan).
 *
 * Deliberately NOT a member of `REJECTION_CODES`: that list is the client-mapped
 * error vocabulary, and the runbook cites it as the rejection set. A view is not
 * a rejected attempt. The key lives here, with the only writer, and Task 7's
 * owner `overview` query imports it from here for the read.
 */
export const RECEIPT_VIEW_CODE = 'receipt_viewed';

/**
 * Records one receipt view for the order a token names.
 *
 * ANONYMOUS BY DESIGN — deliberately no auth guard. The receipt route is public
 * (`app/order/[token]/page.tsx`): the 256-bit token is the capability, and the
 * customer viewing a receipt has no account to present. A reviewer should read
 * the missing guard as the design, not an omission.
 *
 * NEVER THROWS a client-facing error. This is a fire-and-forget, post-mount
 * beacon from `ReceiptLive`; a thrown mutation there becomes an unhandled
 * browser rejection. Every lookup miss — unknown token, an access row whose
 * order is gone, an INV-06 scope mismatch — returns `{ recorded: false }` with
 * no write, so the caller can ignore the result entirely.
 *
 * Token resolution is INLINE, mirroring `getOrderByToken` (`orders.ts:995-1012`)
 * and `cancelOrder` (`:1034-1041`). Those helpers are module-private and
 * `cancelOrder` already duplicates them, so the duplication is house style;
 * importing `orders.ts` from here would be the cycle `orderBlocks.ts:33-34`
 * guards against. `ORDER_ERRORS` is therefore not needed: nothing is thrown.
 *
 * Writes nothing but the `(businessId, RECEIPT_VIEW_CODE)` counter. No order-row
 * write, no event, no PII (INV-25).
 */
export const recordReceiptView = mutation({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ recorded: boolean }> => {
    const access = await ctx.db
      .query('orderAccess')
      .withIndex('byAccessToken', (q) => q.eq('accessToken', args.token))
      .first();
    const order = access === null ? null : await ctx.db.get('orders', access.orderId);
    // One miss path for all three: unknown token, a dangling access row, and a
    // scope mismatch all read as "not found" and write nothing.
    if (access === null || order === null || order.businessId !== access.businessId) {
      return { recorded: false };
    }

    await bumpMetricCounter(ctx, order.businessId, RECEIPT_VIEW_CODE);
    return { recorded: true };
  },
});

// ---------------------------------------------------------------------------
// Owner metrics overview (issue #84, T10 / plan Task 7, D2/D3; protocol §4.5)
//
// One owner-scoped read that answers "is the order protocol working?" from the
// data the protocol already writes. Only ids, counts, codes, and window bounds
// leave this module: no contact field is selected, and `orderAccess` is never
// read (INV-25).
//
// BOUNDED, NOT EXACT (AC-7.3): every range read is a `.take(limit + 1)` over an
// index, so the extra row proves the cap and `capped` means "or more". This is
// the accepted deviation from the Convex guidelines' `@convex-dev/aggregate`
// recommendation, for the same reason `orders.ts:365-375` records: the component
// is not installed, and adopting it would make every order write maintain a
// counter in the same transaction. Swap when a business's window approaches the
// caps below.
// ---------------------------------------------------------------------------

export const METRICS_DEFAULT_WINDOW_DAYS = 30;
export const METRICS_MIN_WINDOW_DAYS = 1;
export const METRICS_MAX_WINDOW_DAYS = 365;

/**
 * The event-read cap for one overview window. `take(limit + 1)` keeps the read
 * bounded and gives the extra row that proves the window held more events. At
 * the default 30-day window this covers every event of several hundred orders.
 */
export const METRICS_WINDOW_EVENT_LIMIT = 5_000;
/** The flag-read cap: one row per flagged order, so this is generous. */
export const METRICS_WINDOW_FLAG_LIMIT = 1_000;
/** The order-read cap for the basket distributions. */
export const METRICS_WINDOW_ORDER_LIMIT = 1_000;

const METRICS_DAY_MS = 24 * 60 * 60_000;

/** One distribution row; `key` is a member of the matching exported bucket list. */
export type MetricsBucketCount = { key: string; count: number };

/**
 * One decline reason exactly as written on the event. `''` means the event
 * carried no reason; it is a bucket, not an invented reason code.
 */
export type DeclineReasonCount = { reason: string; count: number };

/** One rejection code's counter and its rate per 1,000 submissions. */
export type RejectionRate = {
  code: RejectionCode;
  count: number;
  perThousandSubmissions: number;
};

/**
 * Basket line-count buckets: 1 line, 2 lines, 3-4 lines, 5 or more. `unknown`
 * holds a stored row whose line count cannot be derived (no `items` and no
 * legacy `menuItemId`).
 */
export const BASKET_LINE_COUNT_BUCKETS = [
  { key: '1', label: '1 line' },
  { key: '2', label: '2 lines' },
  { key: '3-4', label: '3-4 lines' },
  { key: '5+', label: '5+ lines' },
  { key: 'unknown', label: 'Unknown' },
] as const;

/**
 * Basket unit-count buckets over `sum(items[].quantity)`: 1 unit, 2-3 units,
 * 4-6 units, 7 or more. Legacy single-item rows are one unit; `unknown` is a
 * row with no derivable count.
 */
export const BASKET_UNIT_COUNT_BUCKETS = [
  { key: '1', label: '1 unit' },
  { key: '2-3', label: '2-3 units' },
  { key: '4-6', label: '4-6 units' },
  { key: '7+', label: '7+ units' },
  { key: 'unknown', label: 'Unknown' },
] as const;

/**
 * Basket subtotal buckets over the stored integer cents: `< 1000`, `1000-2499`,
 * `2500-4999`, `>= 5000`, and `unpriced` when `orders.subtotal` is absent (any
 * line was unpriced, so the total is unknown rather than zero).
 */
export const BASKET_SUBTOTAL_BUCKETS = [
  { key: 'lt-1000', label: 'Under 1000 cents' },
  { key: '1000-2499', label: '1000-2499 cents' },
  { key: '2500-4999', label: '2500-4999 cents' },
  { key: 'gte-5000', label: '5000+ cents' },
  { key: 'unpriced', label: 'Unpriced' },
] as const;

/**
 * The exact return shape of `overview`. Rates are fractions (`0.05` = 5%) so a
 * caller formats them; `perThousandSubmissions` is already multiplied by 1,000.
 * `latency.p50`/`p95` are `null` — never `0` — when `sampleSize` is zero.
 * Bucket rows are in the exported bucket-const order, including zero counts, so
 * the UI never invents a missing row.
 */
export type OrderMetricsOverview = {
  businessId: Id<'businesses'>;
  /** The clamped window actually used. */
  windowDays: number;
  /** Inclusive bounds in epoch milliseconds. */
  windowStart: number;
  windowEnd: number;
  /** True when any bounded read hit its cap; affected metrics are floors. */
  capped: boolean;
  /** `submitted` events in the window; the denominator for every rate. */
  submissions: number;
  latency: {
    sampleSize: number;
    p50: number | null;
    p95: number | null;
  };
  declines: {
    count: number;
    /** `count / submissions`, or `0` when there were no submissions. */
    rate: number;
    reasonMix: DeclineReasonCount[];
  };
  cancellations: {
    total: number;
    byActorType: { customer: number; owner: number; system: number };
  };
  throttleHits: { count: number; perThousandSubmissions: number };
  blockHits: { count: number; perThousandSubmissions: number };
  ownerFlags: {
    /** Flags created in the window and still active at read time. */
    flaggedOrders: number;
    /** `flaggedOrders / submissions`, or `0` when there were no submissions. */
    abuseRate: number;
  };
  basketSize: {
    /** In-window orders the distribution was taken over. */
    orderCount: number;
    byLineCount: MetricsBucketCount[];
    byUnitCount: MetricsBucketCount[];
    bySubtotalCents: MetricsBucketCount[];
  };
  receiptViews: number;
  /** Every `REJECTION_CODES` member, in that order, zero counts included. */
  rejectionRates: RejectionRate[];
};

/**
 * Nearest-rank percentile over an ascending-sorted sample, or `null` for an
 * empty sample. Rank = `ceil(q * n)`, one-based; the value at that rank is
 * returned with no interpolation, so every reported latency is a latency the
 * window actually observed. `q` is clamped to `[0, 1]`.
 */
export function percentile(sortedValues: readonly number[], q: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  const clamped = Math.min(Math.max(q, 0), 1);
  const rank = Math.ceil(clamped * sortedValues.length);
  const index = Math.min(Math.max(rank - 1, 0), sortedValues.length - 1);
  return sortedValues[index];
}

/** Clamps a requested window to `[METRICS_MIN_WINDOW_DAYS, METRICS_MAX_WINDOW_DAYS]`. */
function clampWindowDays(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return METRICS_DEFAULT_WINDOW_DAYS;
  }
  return Math.min(
    Math.max(Math.floor(requested), METRICS_MIN_WINDOW_DAYS),
    METRICS_MAX_WINDOW_DAYS
  );
}

/** A fraction, with a zero denominator reported as `0` (never `NaN`). */
function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** A rate per 1,000, with a zero denominator reported as `0` (never `NaN`). */
function perThousand(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : (numerator / denominator) * 1_000;
}

function bucketLineCount(lineCount: number | null): string {
  if (lineCount === null || lineCount < 1) {
    return 'unknown';
  }
  if (lineCount === 1) {
    return '1';
  }
  if (lineCount === 2) {
    return '2';
  }
  if (lineCount <= 4) {
    return '3-4';
  }
  return '5+';
}

function bucketUnitCount(unitCount: number | null): string {
  if (unitCount === null || unitCount < 1) {
    return 'unknown';
  }
  if (unitCount === 1) {
    return '1';
  }
  if (unitCount <= 3) {
    return '2-3';
  }
  if (unitCount <= 6) {
    return '4-6';
  }
  return '7+';
}

function bucketSubtotal(subtotal: number | null): string {
  if (subtotal === null) {
    return 'unpriced';
  }
  if (subtotal < 1_000) {
    return 'lt-1000';
  }
  if (subtotal < 2_500) {
    return '1000-2499';
  }
  if (subtotal < 5_000) {
    return '2500-4999';
  }
  return 'gte-5000';
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function bucketCounts(
  buckets: readonly { key: string }[],
  counts: ReadonlyMap<string, number>
): MetricsBucketCount[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    count: counts.get(bucket.key) ?? 0,
  }));
}

/**
 * Submit→accept latency (D3): pair each order's `submitted` event with its
 * next `accepted` event. Events arrive in `createdAt` order, whose index
 * tie-breaker is `_creationTime`, so a same-`createdAt` pair reports `0` and
 * pairs exactly once. A duplicate `submitted` never resets the clock, and an
 * `accepted` whose `submitted` is outside the window is ignored rather than
 * counted as a zero-latency sample.
 */
function summarizeLatency(events: readonly Doc<'orderEvents'>[]): OrderMetricsOverview['latency'] {
  const submittedAtByOrder = new Map<Id<'orders'>, number>();
  const latencies: number[] = [];

  for (const event of events) {
    if (event.action === 'submitted') {
      if (!submittedAtByOrder.has(event.orderId)) {
        submittedAtByOrder.set(event.orderId, event.createdAt);
      }
      continue;
    }
    if (event.action !== 'accepted') {
      continue;
    }
    const submittedAt = submittedAtByOrder.get(event.orderId);
    if (submittedAt === undefined) {
      continue;
    }
    submittedAtByOrder.delete(event.orderId);
    latencies.push(event.createdAt - submittedAt);
  }

  latencies.sort((left, right) => left - right);
  return {
    sampleSize: latencies.length,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
  };
}

/**
 * Counts decline reasons by the string the event actually carries. The order
 * is descending count, then ascending reason (plain code-unit comparison, not
 * `localeCompare`, so the order is identical in every runtime).
 */
function summarizeDeclineReasons(events: readonly Doc<'orderEvents'>[]): DeclineReasonCount[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.action === 'declined') {
      increment(counts, event.reason ?? '');
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }
      return left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0;
    });
}

/**
 * Cancellations split by the event's `actorType`. `cancelled` also covers the
 * visitor's own cancellation (`orders.ts:1079-1088`, actor `customer`) and an
 * owner's decline is a separate `declined` event, so the two metrics never
 * overlap.
 */
function summarizeCancellations(
  events: readonly Doc<'orderEvents'>[]
): OrderMetricsOverview['cancellations'] {
  const byActorType = { customer: 0, owner: 0, system: 0 };
  let total = 0;
  for (const event of events) {
    if (event.action === 'cancelled') {
      byActorType[event.actorType] += 1;
      total += 1;
    }
  }
  return { total, byActorType };
}

/**
 * Line-count, unit-count, and subtotal distributions over in-window orders.
 * `items` is the committed snapshot; a legacy single-item row has no snapshot
 * but is derivable as one line and one unit, and its absent `subtotal` is
 * `unpriced`. A row with neither shape lands in `unknown`.
 */
function summarizeBasketSize(orders: readonly Doc<'orders'>[]): OrderMetricsOverview['basketSize'] {
  const lineCounts = new Map<string, number>();
  const unitCounts = new Map<string, number>();
  const subtotals = new Map<string, number>();

  for (const order of orders) {
    let lineCount: number | null;
    let unitCount: number | null;
    if (order.items !== undefined && order.items.length > 0) {
      lineCount = order.items.length;
      unitCount = order.items.reduce((sum, line) => sum + line.quantity, 0);
    } else if (order.menuItemId !== undefined) {
      lineCount = 1;
      unitCount = 1;
    } else {
      lineCount = null;
      unitCount = null;
    }

    increment(lineCounts, bucketLineCount(lineCount));
    increment(unitCounts, bucketUnitCount(unitCount));
    increment(subtotals, bucketSubtotal(order.subtotal ?? null));
  }

  return {
    orderCount: orders.length,
    byLineCount: bucketCounts(BASKET_LINE_COUNT_BUCKETS, lineCounts),
    byUnitCount: bucketCounts(BASKET_UNIT_COUNT_BUCKETS, unitCounts),
    bySubtotalCents: bucketCounts(BASKET_SUBTOTAL_BUCKETS, subtotals),
  };
}

/** One bounded read: at most `limit` rows, plus whether the cap was hit. */
function bounded<T>(rows: readonly T[], limit: number): { rows: T[]; capped: boolean } {
  if (rows.length > limit) {
    return { rows: rows.slice(0, limit), capped: true };
  }
  return { rows: [...rows], capped: false };
}

/**
 * The event-derived pair counts and summaries, in one pass over the bounded
 * window. `submissions` is the denominator for every rate in the response.
 */
function summarizeEvents(events: readonly Doc<'orderEvents'>[]): {
  submissions: number;
  declines: number;
  latency: OrderMetricsOverview['latency'];
  reasonMix: DeclineReasonCount[];
  cancellations: OrderMetricsOverview['cancellations'];
} {
  let submissions = 0;
  let declines = 0;
  for (const event of events) {
    if (event.action === 'submitted') {
      submissions += 1;
    } else if (event.action === 'declined') {
      declines += 1;
    }
  }
  return {
    submissions,
    declines,
    latency: summarizeLatency(events),
    reasonMix: summarizeDeclineReasons(events),
    cancellations: summarizeCancellations(events),
  };
}

/**
 * Owner-scoped order-protocol metrics for one business window (protocol §4.5).
 *
 * Authorization runs first, before any read (AC-7.2, `orders.ts:314` /
 * `adminQueries.ts:59-92`). Every range read is bounded; `capped` reports a
 * hit cap so a reader never treats a floor as an exact total (the B4/B6 "fail
 * visibly" rule, `adminQueries.ts:20-23`).
 *
 * Rejection and receipt counters are client-reported, best-effort (plan D4 /
 * research design A) — this query only reads them and cannot detect a missing
 * report. There is deliberately no `orderAccess`, contact, or order-detail read.
 */
export const overview = query({
  args: {
    businessId: v.id('businesses'),
    windowDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<OrderMetricsOverview> => {
    await requireBusinessOwner(ctx, args.businessId);

    const windowDays = clampWindowDays(args.windowDays);
    // The window end is the read time. `overview` takes only the business and
    // the window (AC-7.1), so there is no caller-supplied clock to use instead;
    // the plan's Task 8 fakes `Date` for exactly this read. A live subscription
    // also re-runs when the rows it read change, which keeps the window moving.
    const windowEnd = Date.now();
    const windowStart = windowEnd - windowDays * METRICS_DAY_MS;

    const [eventRows, flagRows, orderRows, rejectionCounts, receiptViewRow] = await Promise.all([
      ctx.db
        .query('orderEvents')
        .withIndex('byBusinessIdCreatedAt', (q) =>
          q
            .eq('businessId', args.businessId)
            .gte('createdAt', windowStart)
            .lte('createdAt', windowEnd)
        )
        // Newest first, so a cap keeps the most recent activity; the summary
        // reverses them back into index order for the submit→accept pairing.
        .order('desc')
        .take(METRICS_WINDOW_EVENT_LIMIT + 1),
      ctx.db
        .query('orderFlags')
        .withIndex('byBusinessIdCreatedAt', (q) =>
          q
            .eq('businessId', args.businessId)
            .gte('createdAt', windowStart)
            .lte('createdAt', windowEnd)
        )
        .order('desc')
        .take(METRICS_WINDOW_FLAG_LIMIT + 1),
      // `orders.byBusinessId` has no `createdAt` field in its index, so the
      // newest rows are read first and filtered by `createdAt` in memory. The
      // extra row is the cap proof only when it too is inside the window.
      ctx.db
        .query('orders')
        .withIndex('byBusinessId', (q) => q.eq('businessId', args.businessId))
        .order('desc')
        .take(METRICS_WINDOW_ORDER_LIMIT + 1),
      // One indexed point read per closed code, in `REJECTION_CODES` order, so
      // every code is present with a zero when it has no counter row.
      Promise.all(
        REJECTION_CODES.map(async (code) => {
          const row = await ctx.db
            .query('orderMetricCounters')
            .withIndex('byBusinessIdCode', (q) =>
              q.eq('businessId', args.businessId).eq('code', code)
            )
            .first();
          return { code, count: row?.value ?? 0 };
        })
      ),
      ctx.db
        .query('orderMetricCounters')
        .withIndex('byBusinessIdCode', (q) =>
          q.eq('businessId', args.businessId).eq('code', RECEIPT_VIEW_CODE)
        )
        .first(),
    ]);

    const eventWindow = bounded(eventRows, METRICS_WINDOW_EVENT_LIMIT);
    const flagWindow = bounded(flagRows, METRICS_WINDOW_FLAG_LIMIT);
    const flaggedOrders = flagWindow.rows.reduce(
      (count, flag) => (flag.active ? count + 1 : count),
      0
    );

    // The order index is read newest first, so the window filter keeps a suffix
    // of the take; `bounded` then proves whether the window itself exceeded the
    // cap (a row older than `windowStart` in the extra slot means it did not).
    const orderWindow = bounded(
      orderRows.filter((order) => order.createdAt >= windowStart && order.createdAt <= windowEnd),
      METRICS_WINDOW_ORDER_LIMIT
    );

    // Back into ascending `createdAt` order for the submit→accept pairing.
    const summary = summarizeEvents([...eventWindow.rows].reverse());
    const throttleCount =
      rejectionCounts.find((row) => row.code === 'throttle_rejected')?.count ?? 0;
    const blockCount = rejectionCounts.find((row) => row.code === 'block_hit')?.count ?? 0;

    return {
      businessId: args.businessId,
      windowDays,
      windowStart,
      windowEnd,
      capped: eventWindow.capped || flagWindow.capped || orderWindow.capped,
      submissions: summary.submissions,
      latency: summary.latency,
      declines: {
        count: summary.declines,
        rate: ratio(summary.declines, summary.submissions),
        reasonMix: summary.reasonMix,
      },
      cancellations: summary.cancellations,
      throttleHits: {
        count: throttleCount,
        perThousandSubmissions: perThousand(throttleCount, summary.submissions),
      },
      blockHits: {
        count: blockCount,
        perThousandSubmissions: perThousand(blockCount, summary.submissions),
      },
      ownerFlags: {
        flaggedOrders,
        abuseRate: ratio(flaggedOrders, summary.submissions),
      },
      basketSize: summarizeBasketSize(orderWindow.rows),
      receiptViews: receiptViewRow?.value ?? 0,
      rejectionRates: rejectionCounts.map((row) => ({
        code: row.code,
        count: row.count,
        perThousandSubmissions: perThousand(row.count, summary.submissions),
      })),
    };
  },
});
