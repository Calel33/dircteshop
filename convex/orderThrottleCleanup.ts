/**
 * Stale throttle-row cleanup (issue #81, T9 / task T13; protocol §S4 L1631).
 *
 * `orderThrottle` rows are fixed-window counters. Once `now - windowStart`
 * exceeds the longest window any key uses (the contact `:24h` window), the row
 * can never be read again as live: the next claim resets it. This module
 * deletes only those provably dead rows.
 *
 * `orderBlocks` is deliberately never read or written here. A block is
 * owner-managed state that persists until the owner unblocks the contact
 * (protocol L1631 describes throttle cleanup only), so deleting it would
 * silently restore an abusive contact's access.
 *
 * There is no `byCreatedAt` index on `orderThrottle` and none is added
 * (tasks/issue-81-plan.md, T13 gotcha): at MVP scale a bounded `.take()` scan
 * is acceptable. The scan uses the default `by_creation_time` order, so the
 * oldest rows are examined first and a backlog drains across repeated runs.
 */
import { CONTACT_THROTTLE_WINDOW_24H_MS } from './orderCommitPolicy';
import { internalMutation } from './_generated/server';

/**
 * Rows examined — and at most deleted — per run. Bounded so one run cannot scan
 * the whole table; a backlog larger than this drains over successive daily runs.
 */
export const CLEANUP_BATCH = 200;

/** Daily bounded delete of throttle rows whose window is provably dead. */
export const cleanupStaleThrottleRows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query('orderThrottle').take(CLEANUP_BATCH);

    let deleted = 0;
    for (const row of rows) {
      // Strictly greater: a row exactly 24 h old is still live for the longest
      // window, because the throttle treats the exact boundary as live.
      if (now - row.windowStart > CONTACT_THROTTLE_WINDOW_24H_MS) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    return { examined: rows.length, deleted };
  },
});
