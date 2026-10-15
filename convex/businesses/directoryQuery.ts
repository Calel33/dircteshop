import type { Doc } from '../_generated/dataModel';

// Pure query-contract helpers for the B4 public directory (todo task 4).
//
// The paginated list (`listDirectory`) and the exact count (`countDirectory`)
// in `queries.ts` both derive from the helpers here, so the "Showing X of Y"
// total can never use different criteria than the page it describes:
//
// - `directorySearchTerm`/`directoryMode` decide between the Convex search
//   index path (nonempty term, relevance order) and the approved indexed
//   browse path (empty term, newest first) — an empty term never becomes a
//   fake search expression.
// - `matchesDirectoryFilters` is the ONE predicate for the real chips:
//   Highly Rated (`rating >= 4.5 && ratingCount > 0`) and Open Now (computed
//   per business in its IANA timezone via `publicHours.ts`).
//
// Pure functions + types only, pinned by `scripts/public-directory-query.test.ts`.

export type DirectoryFilterState = {
  openNow: boolean;
  highlyRated: boolean;
};

export type DirectoryMode = 'search' | 'browse';

/** Trimmed search term; empty means browse. */
export function directorySearchTerm(q: string): string {
  return q.trim();
}

/** Which backend branch serves the term: the text search index or approved browse. */
export function directoryMode(term: string): DirectoryMode {
  return term.length > 0 ? 'search' : 'browse';
}

export const HIGHLY_RATED_MINIMUM = 4.5;

/** The Highly Rated chip's boundary (SPEC §8): rating >= 4.5 with a positive count. */
export function isHighlyRated(rating: number, ratingCount: number): boolean {
  return rating >= HIGHLY_RATED_MINIMUM && ratingCount > 0;
}

/**
 * The composed chip predicate shared by list and count. `openNow` is the
 * business's status from the stable-`now` evaluator (`createOpenNowEvaluator`).
 */
export function matchesDirectoryFilters(
  business: Pick<Doc<'businesses'>, 'rating' | 'ratingCount'>,
  filters: DirectoryFilterState,
  openNow: boolean
): boolean {
  if (filters.highlyRated && !isHighlyRated(business.rating, business.ratingCount)) {
    return false;
  }

  if (filters.openNow && !openNow) {
    return false;
  }

  return true;
}
