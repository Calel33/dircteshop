// Per-business metric counters (issue #84, T10 / protocol §7.2 S5 :1645).
//
// LEAF MODULE (plan D9, research OQ-2): the imports below are types only, so
// `orders.ts`, `orderThrottle.ts`, `orderBlocks.ts`, and `orderMetrics.ts` may
// all import this module without risking the latent
// `orders → orderThrottle → orderMetrics → orders` cycle the repo already
// guards against (`orderBlocks.ts:33-34`).
//
// PLAIN HELPER, never an `internalMutation` (plan D4 / research §Critical
// finding): a rejection path ends in a thrown `ConvexError`, and a mutation's
// writes are discarded when it throws — including a nested
// `ctx.runMutation`, which is a sub-transaction. Only a mutation that commits
// can count a rejection, so the caller is always the public report mutation in
// `./orderMetrics`, never a rejection site inside `placeOrder`.
//
// PRIVACY (INV-25): a row is `(businessId, code, value)`. `code` is a fixed
// token from the closed `REJECTION_CODES` list; no contact data, no free text.

import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

/**
 * Counters count attempts, so they never go below zero. Clamping rather than
 * writing the negative keeps every rate derived from the counter meaningful
 * (`bumpMetricCounter` takes a signed `delta`).
 */
const METRIC_COUNTER_FLOOR = 0;

/** `current + delta`, never below the counter floor. */
export function clampMetricCounter(current: number, delta: number): number {
  return Math.max(METRIC_COUNTER_FLOOR, current + delta);
}

/**
 * Adds `delta` to the `(businessId, code)` counter, inserting it on first use.
 * Bounded: one indexed point read on `byBusinessIdCode`, never a scan or
 * `.collect()`.
 *
 * The read-then-insert-or-patch upsert is the house shape (`orderBlocks.ts`
 * block rows); Convex has no unique index, so the pair is unique because this
 * helper is the only writer and it reads before it writes. Two concurrent
 * first-use bumps are serialised by the transaction's index read rather than
 * producing duplicate rows — the plan's RISKS row 4. Not observed end-to-end
 * yet: the recorded #84 load run saw zero rejections, so the first-use race was
 * never actually exercised there; the serialisation argument rests on the
 * range-read OCC semantics, not on recorded evidence.
 *
 * A `delta` that would cross the floor leaves the counter unchanged and, on
 * first use, creates no row at all — a permanent `value: 0` row would be noise
 * in every per-code read.
 */
export async function bumpMetricCounter(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  code: string,
  delta = 1
): Promise<void> {
  const existing = await ctx.db
    .query('orderMetricCounters')
    .withIndex('byBusinessIdCode', (q) => q.eq('businessId', businessId).eq('code', code))
    .first();

  const current = existing?.value ?? 0;
  const next = clampMetricCounter(current, delta);
  if (next === current) {
    return;
  }

  if (existing === null) {
    await ctx.db.insert('orderMetricCounters', { businessId, code, value: next });
    return;
  }

  await ctx.db.patch(existing._id, { value: next });
}
