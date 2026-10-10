#!/usr/bin/env node
/**
 * Pins the B3c (issue #14) client-only session history and Reset-Section
 * mapping (Task 7).
 *
 * `editor-session-history.ts` is a pure module, so the undo/redo model, the
 * redo-branch clearing, the 50-snapshot cap with oldest-evicted, and the
 * baseline restore are asserted with Node's test runner. Nothing here persists;
 * the React wiring lives in `editor-shell.tsx` / `editor-save-bar.tsx`.
 *
 * Run: node --test "app/owner/business/[id]/editor-session-history.test.ts"
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EditorFormState } from './editor-form.ts';
import {
  canRedo,
  canUndo,
  createHistory,
  HISTORY_LIMIT,
  isEditableSectionKey,
  pushHistory,
  redoHistory,
  resetHistory,
  restoreFieldsFromBaseline,
  sectionResetFields,
  undoHistory,
} from './editor-session-history.ts';

function form(overrides: Partial<EditorFormState> = {}): EditorFormState {
  return {
    name: 'Acme',
    categoryId: 'categories_1',
    description: 'A cafe',
    address: {
      addressLine1: '1 Main St',
      addressLine2: '',
      city: 'Springfield',
      state: 'IL',
      postalCode: '',
      country: 'US',
    },
    hours: {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    },
    phone: '',
    email: '',
    website: '',
    tags: [],
    amenities: [],
    ...overrides,
  };
}

test('a fresh history has a present and no frames', () => {
  const state = createHistory(form());
  assert.deepStrictEqual(state.past, []);
  assert.deepStrictEqual(state.future, []);
  assert.equal(canUndo(state), false);
  assert.equal(canRedo(state), false);
});

test('push records the previous present and enables undo', () => {
  const first = form();
  const state = pushHistory(createHistory(first), form({ name: 'Two' }));
  assert.equal(state.past.length, 1);
  assert.equal(state.past[0], first);
  assert.equal(state.present.name, 'Two');
  assert.equal(canUndo(state), true);
});

test('pushing the same reference is a no-op', () => {
  const start = createHistory(form());
  assert.equal(pushHistory(start, start.present), start);
});

test('undo and redo move one frame at a time', () => {
  const a = form({ name: 'A' });
  const b = form({ name: 'B' });
  const state = pushHistory(createHistory(a), b);

  const undone = undoHistory(state);
  assert.equal(undone.present, a);
  assert.equal(canRedo(undone), true);

  const redone = redoHistory(undone);
  assert.equal(redone.present, b);
  assert.equal(canRedo(redone), false);
});

test('undo at the start and redo at the end are no-ops', () => {
  const start = createHistory(form());
  assert.equal(undoHistory(start), start);
  assert.equal(redoHistory(start), start);
});

test('a new edit after undo clears the redo branch', () => {
  const a = form({ name: 'A' });
  const b = form({ name: 'B' });
  const c = form({ name: 'C' });

  const undone = undoHistory(pushHistory(createHistory(a), b));
  assert.equal(canRedo(undone), true);

  const branched = pushHistory(undone, c);
  assert.equal(branched.future.length, 0);
  assert.equal(canRedo(branched), false);
  assert.equal(branched.present, c);
});

test('the cap retains the most recent 50 frames and evicts the oldest', () => {
  assert.equal(HISTORY_LIMIT, 50);

  let state = createHistory(form({ name: '0' }));
  for (let index = 1; index <= 60; index += 1) {
    state = pushHistory(state, form({ name: String(index) }));
  }

  assert.equal(state.past.length, 50);
  assert.equal(state.present.name, '60');
  assert.equal(state.past[0].name, '10');
  assert.equal(state.past[state.past.length - 1].name, '59');

  let undone = state;
  for (let index = 0; index < 50; index += 1) {
    undone = undoHistory(undone);
  }
  assert.equal(undone.present.name, '10');
  assert.equal(canUndo(undone), false);
});

test('reset drops every frame and re-baselines on the present', () => {
  const state = resetHistory(form({ name: 'Saved' }));
  assert.equal(state.present.name, 'Saved');
  assert.deepStrictEqual(state.past, []);
  assert.deepStrictEqual(state.future, []);
});

test('only the six editable sections have reset fields', () => {
  assert.equal(isEditableSectionKey('hours'), true);
  assert.equal(isEditableSectionKey('analytics'), false);
  assert.equal(isEditableSectionKey('change-history'), false);
  assert.equal(sectionResetFields('analytics').length, 0);
  assert.deepStrictEqual(sectionResetFields('contact'), ['phone', 'email', 'website']);
  assert.deepStrictEqual(sectionResetFields('basic-info'), ['name', 'categoryId', 'description']);
});

test('restoreFieldsFromBaseline copies only the section fields, from a fresh object', () => {
  const current = form({ name: 'Edited', description: 'Edited desc', phone: '555-0000' });
  const baseline = form({ name: 'Saved', description: 'Saved desc' });

  const restored = restoreFieldsFromBaseline(current, baseline, sectionResetFields('basic-info'));
  assert.notEqual(restored, current);
  assert.equal(restored.name, 'Saved');
  assert.equal(restored.description, 'Saved desc');
  assert.equal(restored.phone, '555-0000');
});
