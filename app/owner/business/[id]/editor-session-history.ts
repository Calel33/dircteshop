import type { EditableBusinessField } from '@/convex/businessTypes';

import type { EditorFormState } from './editor-form';

/**
 * Client-only session history for the owner editor (issue #14 / B3c Task 7).
 *
 * The canonical `{ past, present, future }` model: an edit pushes the previous
 * present onto `past` and CLEARS `future`; undo moves one frame from `past` to
 * `future`; redo moves one back. `past` is capped at 50 snapshots (oldest
 * evicted) to bound memory. Nothing here persists — undo/redo/reset are
 * session-only and never mutate Convex. Framework-free (type-only imports) so it
 * is `node --test`-able.
 *
 * `resetHistory` is the "new baseline" semantic: after a successful save the
 * editor resets history to the reconciled present, so `present` equals the
 * last-saved baseline and the listing no longer reads as dirty.
 */

/** The maximum retained undo frames; older frames are evicted first. */
export const HISTORY_LIMIT = 50;

export interface HistoryState {
  past: EditorFormState[];
  present: EditorFormState;
  future: EditorFormState[];
}

/** Starts a fresh history with no undo/redo frames. */
export function createHistory(present: EditorFormState): HistoryState {
  return { past: [], present, future: [] };
}

/**
 * Records a new present. A no-op (same reference) leaves the state untouched. A
 * real edit appends the previous present to `past` (trimmed to `limit`, oldest
 * first) and clears `future` — a new edit after undo discards the redo branch.
 */
export function pushHistory(
  state: HistoryState,
  next: EditorFormState,
  limit = HISTORY_LIMIT
): HistoryState {
  if (next === state.present) {
    return state;
  }

  const grown = [...state.past, state.present];
  const past = grown.length > limit ? grown.slice(grown.length - limit) : grown;
  return { past, present: next, future: [] };
}

/** Moves one frame back, pushing the current present onto `future`. */
export function undoHistory(state: HistoryState): HistoryState {
  if (state.past.length === 0) {
    return state;
  }

  const previous = state.past[state.past.length - 1];
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
  };
}

/** Moves one frame forward, pushing the current present back onto `past`. */
export function redoHistory(state: HistoryState, limit = HISTORY_LIMIT): HistoryState {
  if (state.future.length === 0) {
    return state;
  }

  const grown = [...state.past, state.present];
  const past = grown.length > limit ? grown.slice(grown.length - limit) : grown;
  return { past, present: state.future[0], future: state.future.slice(1) };
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0;
}

/** Drops every undo/redo frame and re-baselines on `present` (post-save reset). */
export function resetHistory(present: EditorFormState): HistoryState {
  return createHistory(present);
}

// ---------------------------------------------------------------------------
// "Reset Section" field mapping. A section reset copies exactly the fields that
// the section owns from the last-saved baseline; the result is an ordinary
// (undoable) form change, never a refetch or a restore of product defaults.
// ---------------------------------------------------------------------------

/** The six editable sections, keyed by their editor section id. */
export type EditorFormSectionKey =
  | 'basic-info'
  | 'hours'
  | 'contact'
  | 'location'
  | 'categories-tags'
  | 'features-amenities';

// Hyphenated ids require computed keys (eslint naming-convention).
const SECTION_RESET_FIELDS: Record<EditorFormSectionKey, readonly EditableBusinessField[]> = {
  ['basic-info']: ['name', 'categoryId', 'description'],
  hours: ['hours'],
  contact: ['phone', 'email', 'website'],
  location: ['address'],
  ['categories-tags']: ['tags'],
  ['features-amenities']: ['amenities'],
};

/** Whether an editor section id is one of the six editable sections. */
export function isEditableSectionKey(sectionId: string): sectionId is EditorFormSectionKey {
  return sectionId in SECTION_RESET_FIELDS;
}

/** The editable fields a section reset restores from the baseline. */
export function sectionResetFields(sectionId: string): readonly EditableBusinessField[] {
  return isEditableSectionKey(sectionId) ? SECTION_RESET_FIELDS[sectionId] : [];
}

/**
 * Returns a copy of `form` with `fields` (a section's fields) restored from
 * `baseline`. A fresh object, so the change is undoable like any other edit.
 */
export function restoreFieldsFromBaseline(
  form: EditorFormState,
  baseline: EditorFormState,
  fields: readonly EditableBusinessField[]
): EditorFormState {
  const next = { ...form } as Record<string, unknown>;
  const source = baseline as unknown as Record<string, unknown>;

  for (const field of fields) {
    next[field] = source[field];
  }

  return next as unknown as EditorFormState;
}
