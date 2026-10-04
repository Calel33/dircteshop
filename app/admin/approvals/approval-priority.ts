/**
 * Pure presentation helpers for the `/admin/approvals` queue cards
 * (issue #13 / B3b todo #4). No React, no Convex, no ambient clock: both
 * helpers derive their result from an explicit `submittedAt` and the caller's
 * `now`, so the value is deterministic per input and safe to compute during
 * server render and client hydration. Mirrors the `editor-status.ts` pure-module
 * pattern so it can be pinned with `node --test`.
 */

/** A submission at or past this age is surfaced as high priority. */
export const PRIORITY_HIGH_AFTER_HOURS = 48;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Presentation-only urgency band derived from submission age. */
export type ApprovalPriority = 'high' | 'normal';

/**
 * Derives the age priority band. Presentation-only and not persisted: a
 * missing `submittedAt` is normal, and a future timestamp (negative age) never
 * reports high.
 */
export function deriveAgePriority(
  submittedAt: number | undefined,
  now: number,
): ApprovalPriority {
  if (submittedAt === undefined) {
    return 'normal';
  }

  return now - submittedAt >= PRIORITY_HIGH_AFTER_HOURS * HOUR_MS ? 'high' : 'normal';
}

/**
 * Humanizes how long ago a listing was submitted. A missing `submittedAt`
 * reports an unknown date; a future timestamp is clamped to "just now" so age
 * is never rendered as a negative duration.
 */
export function formatSubmittedAge(submittedAt: number | undefined, now: number): string {
  if (submittedAt === undefined) {
    return 'Submission date unknown';
  }

  const elapsed = Math.max(0, now - submittedAt);

  if (elapsed < HOUR_MS) {
    return 'Submitted just now';
  }

  const hours = Math.floor(elapsed / HOUR_MS);

  if (hours < 24) {
    return `Submitted ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }

  const days = Math.floor(elapsed / DAY_MS);

  return `Submitted ${days} ${days === 1 ? 'day' : 'days'} ago`;
}
