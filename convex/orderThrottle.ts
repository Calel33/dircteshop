import { ConvexError } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import {
  BUSINESS_THROTTLE_10M,
  CONTACT_THROTTLE_10M,
  CONTACT_THROTTLE_24H,
  CONTACT_THROTTLE_WINDOW_24H_MS,
  ORDER_ERRORS,
} from './orderCommitPolicy.ts';

// Order commitment protocol §6.2.3 / §6.2.4 (issue #78 S1, issue #81 T9):
// the fixed-window throttles and the contact block check that guard the public
// write surface. The module owns three things:
//
//   1. The per-business key `business:<id>:10m`. `claimBusinessThrottle`'s
//      patch is the serialization write that makes the following idempotency
//      re-check safe under OCC retry, so the caller runs it before the inserts,
//      never after (§6.2.3 L1044).
//   2. The sibling contact keys `contact:<businessId>:<sha256>:10m` and
//      `contact:<businessId>:<sha256>:24h` (§6.2.3 L1009; limits §6.2.4
//      L1063–1064). The digest is the name-excluded identity hash returned by
//      `parseContact` — never a raw phone or email. `claimContactThrottle`
//      reads both rows, judges both limits, and only then writes, so a rejected
//      order consumes no slot in either window.
//   3. The owner-managed block list. `assertContactNotBlocked` probes the
//      per-channel hashes from `contactChannelHashes` and refuses with the
//      generic `ORDER_NOT_ACCEPTED` copy — never a block disclosure and never
//      the hash in the error payload.
//
// Fixed window: `BUSINESS_THROTTLE_WINDOW_MS` (10 minutes) is shared by the
// business key and the contact `:10m` key; the contact `:24h` key uses
// `CONTACT_THROTTLE_WINDOW_24H_MS`. A window resets only when
// `now - windowStart` is strictly greater than its length, so a row exactly one
// window old is still live; the exact-boundary error case is handled under the
// throw below.
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
 * The contact keys below are its siblings; both shapes are pinned by the
 * protocol (L1009).
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

// ---------------------------------------------------------------------------
// Contact throttle (§6.2.3 L1044 step 4; limits §6.2.4 L1063–1064)
// ---------------------------------------------------------------------------

/**
 * The two contact window keys for one business.
 *
 * The shape `contact:<businessId>:<contactHash>:10m|24h` is pinned by the
 * protocol at §6.2.2 L1009 (and by the `schema.ts:316` comment), so it must not
 * be reformatted. `contactHash` is the name-excluded identity digest from
 * `parseContact`; the raw phone/email is never interpolated into a key.
 */
export function contactThrottleKeys(
  businessId: Id<'businesses'>,
  contactHash: string
): { tenMinutes: string; day: string } {
  return {
    tenMinutes: `contact:${businessId}:${contactHash}:10m`,
    day: `contact:${businessId}:${contactHash}:24h`,
  };
}

type ThrottleWindow = {
  readonly key: string;
  readonly windowMs: number;
  readonly limit: number;
};

type ThrottleClaim = {
  readonly window: ThrottleWindow;
  readonly row: Doc<'orderThrottle'> | null;
  /** Recorded once, at read time, from the same `now` as the limits below. */
  readonly live: boolean;
};

function throttleRejection(
  window: ThrottleWindow,
  windowStart: number,
  now: number
): ConvexError<Record<string, string | number>> {
  // Same ceil/clamp rule as the business claim: at the exact boundary
  // `retryAfterMs` is 0, so `{n}` clamps up to 1 rather than "0 minutes".
  const retryAfterMs = Math.max(0, windowStart + window.windowMs - now);
  const minutes = Math.max(1, Math.ceil(retryAfterMs / MINUTE_MS));

  return new ConvexError({
    code: 'TOO_MANY_REQUESTS',
    message: ORDER_ERRORS.TOO_MANY_REQUESTS.message.replace(
      '{n}',
      String(minutes)
    ),
    retryAfterMs,
  });
}

/**
 * Reads one window's row.
 *
 * `null` is still a recorded read: the `byKey` index interval for this exact
 * key — including "no row" — joins the transaction's read set, so a concurrent
 * insert of the same key conflicts and the loser retries and sees the winner's
 * row (issue #81 research Q5). That is why there is deliberately no re-read
 * after an insert; adding one would cost a query without changing anything.
 */
function readThrottleWindow(
  ctx: MutationCtx,
  window: ThrottleWindow
): Promise<Doc<'orderThrottle'> | null> {
  return ctx.db
    .query('orderThrottle')
    .withIndex('byKey', (q) => q.eq('key', window.key))
    .first();
}

/** Throws when the recorded liveness says the window is live and at its limit. */
function assertWindowAvailable(claim: ThrottleClaim, now: number): void {
  const { window, row, live } = claim;
  if (row === null || !live) {
    return;
  }
  if (row.count >= window.limit) {
    throw throttleRejection(window, row.windowStart, now);
  }
}

/**
 * Claims one slot in one window. One helper for both windows so the insert /
 * reset / increment rules cannot drift between `:10m` and `:24h`.
 */
async function writeWindowClaim(
  ctx: MutationCtx,
  claim: ThrottleClaim,
  now: number
): Promise<void> {
  const { window, row, live } = claim;

  if (row === null) {
    await ctx.db.insert('orderThrottle', {
      key: window.key,
      windowStart: now,
      count: 1,
    });
    return;
  }

  if (!live) {
    await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    return;
  }

  await ctx.db.patch(row._id, { count: row.count + 1 });
}

/**
 * Claims one slot in both contact windows for `businessId` × `contactHash`.
 *
 * Ordering is load-bearing (§6.2.3 L1044 step 4, plan T2):
 *   1. read both rows and record each window's liveness;
 *   2. judge both limits — a live window at its limit throws
 *      `TOO_MANY_REQUESTS` with that window's own `retryAfterMs`;
 *   3. only when both are clear, write both rows.
 *
 * Because the throw precedes the first write, a rejected order consumes no
 * quota slot in either window.
 */
export async function claimContactThrottle(
  ctx: MutationCtx,
  args: { businessId: Id<'businesses'>; contactHash: string; now: number }
): Promise<void> {
  const keys = contactThrottleKeys(args.businessId, args.contactHash);
  const windows: readonly ThrottleWindow[] = [
    {
      key: keys.tenMinutes,
      windowMs: BUSINESS_THROTTLE_WINDOW_MS,
      limit: CONTACT_THROTTLE_10M,
    },
    {
      key: keys.day,
      windowMs: CONTACT_THROTTLE_WINDOW_24H_MS,
      limit: CONTACT_THROTTLE_24H,
    },
  ];

  const claims: ThrottleClaim[] = [];
  for (const window of windows) {
    const row = await readThrottleWindow(ctx, window);
    claims.push({
      window,
      row,
      live: row !== null && args.now - row.windowStart <= window.windowMs,
    });
  }

  // Both limits are judged before either write, so a rejection never leaves a
  // half-claimed window behind.
  for (const claim of claims) {
    assertWindowAvailable(claim, args.now);
  }

  for (const claim of claims) {
    await writeWindowClaim(ctx, claim, args.now);
  }
}

// ---------------------------------------------------------------------------
// Block list (§6.2.3 L1044 step 4; §6.6 L1341)
// ---------------------------------------------------------------------------

/**
 * Refuses when any of the contact's per-channel hashes is blocked for this
 * business.
 *
 * `channelHashes` are the domain-separated `phone:` / `email:` digests from
 * `contactChannelHashes`, so a block on either channel refuses the order. The
 * refusal is deliberately generic — `ORDER_ERRORS.ORDER_NOT_ACCEPTED` verbatim
 * (protocol §6.5 L124) — and the payload carries no hash and no contact data:
 * a blocked contact must not learn that it is blocked, and must not learn which
 * channel matched.
 *
 * The envelope is built here rather than with `orderError` from `./orders`
 * because `orders.ts` imports this module; importing back would be a cycle.
 */
export async function assertContactNotBlocked(
  ctx: MutationCtx,
  args: { businessId: Id<'businesses'>; channelHashes: readonly string[] }
): Promise<void> {
  for (const contactHash of args.channelHashes) {
    const blocked = await ctx.db
      .query('orderBlocks')
      .withIndex('byBusinessIdContactHash', (q) =>
        q.eq('businessId', args.businessId).eq('contactHash', contactHash)
      )
      .first();

    if (blocked !== null) {
      throw new ConvexError({
        code: 'ORDER_NOT_ACCEPTED',
        message: ORDER_ERRORS.ORDER_NOT_ACCEPTED.message,
      });
    }
  }
}
