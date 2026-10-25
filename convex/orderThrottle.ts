import { ConvexError } from 'convex/values';

import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { BUSINESS_THROTTLE_10M, ORDER_ERRORS } from './orderCommitPolicy';

// Order commitment protocol §6.2.3 / §6.2.4 (issue #78, T4): the per-business
// fixed-window throttle. `claimBusinessThrottle` reads and patches one
// `orderThrottle` row keyed `business:<id>:10m`; that patch is also the
// serialization write that makes the following idempotency re-check safe under
// OCC retry, so the caller runs it before the inserts, never after (§6.2.3
// L1044).
//
// Scope: S1 enforces the business limit only. Contact throttling and the block
// list are S4 and are added to this same file as sibling keys (§6.2.3 L1044
// "S4 adds the contact throttle and block list"; S1 file list L1561; S4 file
// list L1622) — no contact key is read or written here.
//
// Fixed window: 10 minutes, limit `BUSINESS_THROTTLE_10M` (60) per business
// (§6.2.4 L1065). The window resets only when `now - windowStart` is strictly
// greater than 10 minutes, so a row exactly 10 minutes old is still live; the
// exact-boundary error case is handled under the throw below.
//
// Clock: `now` is a parameter and this module never reads the ambient clock.
// The handler reads the clock once and passes it in, which keeps the window
// testable under fake timers and keeps the module free of ambient time (same
// rule as `orderCommitPolicy.ts` header rule (e)).
//
// Error: D12 / §6.5 L1273–1316 / INV-14 L310 — a live window at the limit
// throws `ConvexError({ code: 'TOO_MANY_REQUESTS', message, retryAfterMs })`.
// `message` is `ORDER_ERRORS.TOO_MANY_REQUESTS.message` with `{n}` replaced by
// the remaining window in whole minutes (ceil). At the exact boundary
// `retryAfterMs` is 0, so `{n}` is clamped up to 1: the catalog sentence must
// never render "Try again in 0 minutes" (INV-14).

const MINUTE_MS = 60_000;

/** §6.2.4: fixed throttle window, shared by every key this module will own. */
export const BUSINESS_THROTTLE_WINDOW_MS = 10 * MINUTE_MS;

/**
 * The serialization key for one business (`schema.ts:315-319`; §6.2.3 L1044).
 * Exported so S4 can mint sibling `contact:<businessId>:<sha256>:10m` keys
 * without changing the claim below.
 */
export function businessThrottleKey(businessId: Id<'businesses'>): string {
  return `business:${businessId}:10m`;
}

/**
 * Claims one slot in the business's current 10-minute window.
 *
 * - no row: insert `{ key, windowStart: now, count: 1 }`
 * - row exists and `now - windowStart > 10m`: patch `{ windowStart: now, count: 1 }`
 * - row exists, window live, `count >= BUSINESS_THROTTLE_10M`: throw
 * - row exists, window live, below the limit: patch `{ count: count + 1 }`
 *
 * Only `orderThrottle` is read or written. The write is the serialization
 * point: the caller's idempotency re-check must run after this returns.
 */
export async function claimBusinessThrottle(
  ctx: MutationCtx,
  args: { businessId: Id<'businesses'>; now: number }
): Promise<void> {
  const key = businessThrottleKey(args.businessId);
  const row = await ctx.db
    .query('orderThrottle')
    .withIndex('byKey', (q) => q.eq('key', key))
    .first();

  if (row === null) {
    await ctx.db.insert('orderThrottle', {
      key,
      windowStart: args.now,
      count: 1,
    });
    return;
  }

  if (args.now - row.windowStart > BUSINESS_THROTTLE_WINDOW_MS) {
    await ctx.db.patch(row._id, { windowStart: args.now, count: 1 });
    return;
  }

  if (row.count >= BUSINESS_THROTTLE_10M) {
    // Exact boundary (`retryAfterMs === 0`) is the only way `ceil` yields 0,
    // so the clamp is what keeps `{n}` at 1 minute instead of "0 minutes".
    const retryAfterMs = Math.max(
      0,
      row.windowStart + BUSINESS_THROTTLE_WINDOW_MS - args.now
    );
    const minutes = Math.max(1, Math.ceil(retryAfterMs / MINUTE_MS));

    throw new ConvexError({
      code: 'TOO_MANY_REQUESTS',
      message: ORDER_ERRORS.TOO_MANY_REQUESTS.message.replace(
        '{n}',
        String(minutes)
      ),
      retryAfterMs,
    });
  }

  await ctx.db.patch(row._id, { count: row.count + 1 });
}
