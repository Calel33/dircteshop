import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval('sweep expired orders', { minutes: 5 }, internal.orderExpiry.sweepExpiredOrders);

// Optional stale-row cleanup (issue #81 T13; protocol §S4 L1631). Throttle rows
// only — `orderBlocks` is owner-managed state and is never swept.
crons.daily(
  'cleanup stale order throttle',
  { hourUTC: 4, minuteUTC: 0 },
  internal.orderThrottleCleanup.cleanupStaleThrottleRows
);

export default crons;
