/**
 * Pure page-scoped selection helpers for the `/admin/approvals` queue
 * (issue #14 / B3c Task 3). No React, no Convex: the queue's select-all targets
 * only the currently displayed cursor page, and because Convex pins page
 * endpoints the rendered page length can vary, so every count here is derived
 * from the actual page ids — never a fixed 25. The route clears the selection on
 * any page or filter change, so a stale id can never linger behind the header
 * checkbox. Mirrors the `approval-priority.ts` / `editor-status.ts` pure-module
 * pattern so it can be pinned with `node --test`.
 */

/** Tri-state of the header select-all control for the current page. */
export type SelectionState = 'none' | 'partial' | 'all';

/**
 * Derives the header control's state from the selected ids and the current
 * page's ids. An empty page is `none`; every page id selected is `all`; a
 * non-empty proper subset is `partial` (→ indeterminate).
 */
export function selectionState(
  selected: ReadonlySet<string>,
  pageIds: readonly string[]
): SelectionState {
  if (pageIds.length === 0) {
    return 'none';
  }

  let selectedOnPage = 0;
  for (const id of pageIds) {
    if (selected.has(id)) {
      selectedOnPage += 1;
    }
  }

  if (selectedOnPage === 0) {
    return 'none';
  }

  return selectedOnPage === pageIds.length ? 'all' : 'partial';
}

/** The Radix checkbox `checked` value that renders the header control. */
export function selectAllCheckedValue(state: SelectionState): boolean | 'indeterminate' {
  if (state === 'all') {
    return true;
  }
  if (state === 'partial') {
    return 'indeterminate';
  }
  return false;
}

/**
 * Applies a select-all/none toggle to the current page. Only page ids are
 * touched, so a selection can never grow beyond what the admin can see.
 */
export function toggleAllSelected(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
  checked: boolean
): Set<string> {
  const next = new Set(selected);
  for (const id of pageIds) {
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
  }
  return next;
}

/** Adds or removes one id from the selection. */
export function toggleSelected(
  selected: ReadonlySet<string>,
  id: string,
  checked: boolean
): Set<string> {
  const next = new Set(selected);
  if (checked) {
    next.add(id);
  } else {
    next.delete(id);
  }
  return next;
}

/** The current page's selected ids, in page order — the bulk mutation's input. */
export function selectedIdsOnPage(
  selected: ReadonlySet<string>,
  pageIds: readonly string[]
): string[] {
  return pageIds.filter((id) => selected.has(id));
}

/** The exact number of selected ids that are on the current page. */
export function selectedCountOnPage(
  selected: ReadonlySet<string>,
  pageIds: readonly string[]
): number {
  return selectedIdsOnPage(selected, pageIds).length;
}
