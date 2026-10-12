/**
 * Pure cursor-page planning for the `/admin/approvals` queue (issue #14 / B3c
 * review fix). No React, no Convex: the route owns a manual cursor stack over
 * `listPendingApprovals`, so this module decides — from the range currently
 * requested and its `PaginationResult` — which range to (re)request for the
 * visible page and where Next goes.
 *
 * Convex marks a page `"SplitRequired"` when it read so much data that `page`
 * *might be incomplete*; the range `(cursor, continueCursor]` must then be
 * divided at `splitCursor` into `(cursor, splitCursor]` and
 * `(splitCursor, continueCursor]`. Advancing straight to `continueCursor` would
 * skip the unreturned remainder, so a SplitRequired page is re-scoped to the
 * first half and Next is withheld until the page is complete — the second half
 * is then reached normally from the split point, so both halves are visited
 * without a gap or a loop.
 *
 * `"SplitRecommended"` marks a page that is large but *complete* (only
 * SplitRequired makes `page` possibly incomplete), so we continue normally
 * rather than fragmenting navigation: no data can be skipped either way, and
 * following the recommendation would only shrink pages for a read-size hint.
 * Mirrors the `approval-selection.ts` pure-module pattern so it can be pinned
 * with `node --test`.
 *
 * Docs: https://docs.convex.dev/api/interfaces/server.PaginationResult
 */

/** The range a single queue page covers. A `null` end uses `numItems` instead. */
export interface QueuePageRef {
  cursor: string | null;
  endCursor: string | null;
}

/**
 * The `PaginationResult` fields the cursor decision depends on. Structural, so
 * the route's inferred Convex result type satisfies it without a cast.
 */
export interface QueuePageResult {
  continueCursor: string;
  isDone: boolean;
  splitCursor?: string | null;
  pageStatus?: 'SplitRecommended' | 'SplitRequired' | null;
}

export interface QueuePagePlan {
  /** Range to request for the page currently on screen. */
  current: QueuePageRef;
  /** Range Next advances to, or `null` when Next must not advance. */
  next: QueuePageRef | null;
  /**
   * True when a `SplitRequired` page could not be re-scoped — no `splitCursor`,
   * or a `splitCursor` that does not move the bound. The range is unchanged and
   * Next is withheld, so this is a dead end unless the caller recovers (e.g. by
   * retrying a smaller page) rather than sitting on the stalled page.
   */
  stalled: boolean;
}

/** The first page's range (empty `cursor` starts at the beginning). */
export const FIRST_QUEUE_PAGE: QueuePageRef = { cursor: null, endCursor: null };

/** The route-owned traversal state a filter or cutoff change resets. */
export interface QueueTraversal {
  pageRef: QueuePageRef;
  cursorStack: QueuePageRef[];
  selectedIds: Set<string>;
}

/**
 * The traversal to return to whenever the filter or cutoff changes (B3c review):
 * the first page, no cursor history, nothing selected. The cutoff (the caller's
 * reference clock) moves only on an explicit refresh or a filter change, which
 * this reset accompanies — so a stored cursor is never invalidated mid-traversal.
 */
export function resetQueueTraversal(): QueueTraversal {
  return { pageRef: FIRST_QUEUE_PAGE, cursorStack: [], selectedIds: new Set<string>() };
}

export function planQueuePage(ref: QueuePageRef, result?: QueuePageResult): QueuePagePlan {
  if (result === undefined) {
    return { current: ref, next: null, stalled: false };
  }

  const splitRequired = result.pageStatus === 'SplitRequired';
  // Only re-scope while the split point is not yet the page's end cursor; once
  // it is, the request is already the bounded first half (idempotent, no loop).
  const canSplit = splitRequired && result.splitCursor != null && ref.endCursor !== result.splitCursor;

  const current: QueuePageRef = canSplit
    ? { cursor: ref.cursor, endCursor: result.splitCursor ?? null }
    : ref;

  // Withhold Next whenever the page may be incomplete: advancing to
  // continueCursor now is the skip this guards against. After the re-scope the
  // page returns complete and Next continues from its end cursor — the split
  // point — so the second half is visited with no gap.
  //
  // `isDone` is terminal only for an unbounded page. A bounded page (a re-scoped
  // first half) reports `isDone` once it reaches its `endCursor`; treating that
  // as global completion would strand the second half, so Next advances from
  // `ref.endCursor` with the bound cleared. Docs:
  // https://docs.convex.dev/api/interfaces/server.PaginationOptions
  const next = splitRequired
    ? null
    : result.isDone
      ? ref.endCursor === null
        ? null
        : { cursor: ref.endCursor, endCursor: null }
      : { cursor: result.continueCursor, endCursor: null };

  // A SplitRequired page that cannot be narrowed leaves the range untouched and
  // Next withheld — a dead end unless the caller retries with a smaller page.
  const stalled = splitRequired && !canSplit;

  return { current, next, stalled };
}
