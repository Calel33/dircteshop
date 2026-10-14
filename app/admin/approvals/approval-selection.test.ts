#!/usr/bin/env node
/**
 * Pins the B3c (issue #14) page-scoped queue selection helpers (Task 3).
 *
 * `approval-selection.ts` is a pure module (no React, no Convex), so the
 * none/partial/all tri-state, the current-page toggle behavior, and the exact
 * page-scoped count are asserted with Node's test runner. The React wiring lives
 * in the route/queue; runtime behavior is deferred to the authenticated manual
 * check.
 *
 * Run: node --test app/admin/approvals/approval-selection.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  selectAllCheckedValue,
  selectedCountOnPage,
  selectedIdsOnPage,
  selectionState,
  toggleAllSelected,
  toggleSelected,
} from './approval-selection.ts';

const page = ['a', 'b', 'c'] as const;

test('an empty page is none', () => {
  assert.equal(selectionState(new Set(), []), 'none');
});

test('no page id selected is none', () => {
  assert.equal(selectionState(new Set(['x']), page), 'none');
});

test('every page id selected is all', () => {
  assert.equal(selectionState(new Set(['a', 'b', 'c']), page), 'all');
});

test('a proper subset is partial', () => {
  assert.equal(selectionState(new Set(['a']), page), 'partial');
  assert.equal(selectionState(new Set(['a', 'c']), page), 'partial');
});

test('off-page selected ids never change the current-page state', () => {
  assert.equal(selectionState(new Set(['a', 'x', 'y']), page), 'partial');
  assert.equal(selectionState(new Set(['x', 'y']), page), 'none');
});

test('select-all checked value maps none/partial/all to false/indeterminate/true', () => {
  assert.equal(selectAllCheckedValue('none'), false);
  assert.equal(selectAllCheckedValue('partial'), 'indeterminate');
  assert.equal(selectAllCheckedValue('all'), true);
});

test('toggling all on selects exactly the page ids', () => {
  const next = toggleAllSelected(new Set(), page, true);
  assert.deepStrictEqual([...next].sort(), ['a', 'b', 'c']);
});

test('toggling all off deselects the page ids and keeps off-page ids', () => {
  const next = toggleAllSelected(new Set(['a', 'b', 'c', 'z']), page, false);
  assert.deepStrictEqual([...next], ['z']);
});

test('toggling one id adds or removes it without touching others', () => {
  assert.deepStrictEqual([...toggleSelected(new Set(['a']), 'b', true)].sort(), ['a', 'b']);
  assert.deepStrictEqual([...toggleSelected(new Set(['a', 'b']), 'a', false)], ['b']);
});

test('the current-page selection is returned in page order', () => {
  assert.deepStrictEqual(selectedIdsOnPage(new Set(['c', 'a', 'z']), page), ['a', 'c']);
});

test('the page-scoped count is exact and excludes off-page ids', () => {
  assert.equal(selectedCountOnPage(new Set(['a', 'b', 'z']), page), 2);
  assert.equal(selectedCountOnPage(new Set(['z']), page), 0);
});
