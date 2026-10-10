#!/usr/bin/env node
/**
 * Pins the B3c (issue #14) hours quick-fill presets (Task 6).
 *
 * `editor-hours-presets.ts` is a pure module, so the exact weekly values, the
 * "Clear" behavior, and the guarantee that presets are ordinary (fresh,
 * non-mutating) form values are asserted with Node's test runner. The React
 * wiring lives in `section-editors.tsx`; runtime behavior is deferred to the
 * manual editor check.
 *
 * Run: node --test "app/owner/business/[id]/editor-hours-presets.test.ts"
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyHoursPreset,
  HOURS_PRESET_OPTIONS,
  HOURS_PRESETS,
} from './editor-hours-presets.ts';
import { WEEKDAYS } from './editor-form.ts';

const WEEKEND = ['saturday', 'sunday'] as const;
const WEEKDAYS_MON_FRI = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

test('exposes exactly the four confirmed presets with Clear replacing Custom', () => {
  assert.deepStrictEqual([...HOURS_PRESETS], ['standard', 'coffee-shop', 'weekend-only', 'clear']);
  assert.deepStrictEqual(
    HOURS_PRESET_OPTIONS.map((option) => option.id),
    ['standard', 'coffee-shop', 'weekend-only', 'clear']
  );
});

test('every preset returns all seven weekdays', () => {
  for (const preset of HOURS_PRESETS) {
    assert.deepStrictEqual(Object.keys(applyHoursPreset(preset)).sort(), [...WEEKDAYS].sort());
  }
});

test('Standard fills Mon–Fri 09:00–17:00 and closes the weekend', () => {
  const hours = applyHoursPreset('standard');
  for (const day of WEEKDAYS_MON_FRI) {
    assert.deepStrictEqual(hours[day], [{ opensAt: '09:00', closesAt: '17:00' }]);
  }
  for (const day of WEEKEND) {
    assert.deepStrictEqual(hours[day], []);
  }
});

test('Coffee shop fills Mon–Fri 07:00–18:00 and Saturday 08:00–16:00', () => {
  const hours = applyHoursPreset('coffee-shop');
  for (const day of WEEKDAYS_MON_FRI) {
    assert.deepStrictEqual(hours[day], [{ opensAt: '07:00', closesAt: '18:00' }]);
  }
  assert.deepStrictEqual(hours.saturday, [{ opensAt: '08:00', closesAt: '16:00' }]);
  assert.deepStrictEqual(hours.sunday, []);
});

test('Weekend only fills Saturday and Sunday 09:00–17:00', () => {
  const hours = applyHoursPreset('weekend-only');
  for (const day of WEEKDAYS_MON_FRI) {
    assert.deepStrictEqual(hours[day], []);
  }
  for (const day of WEEKEND) {
    assert.deepStrictEqual(hours[day], [{ opensAt: '09:00', closesAt: '17:00' }]);
  }
});

test('Clear closes every day', () => {
  const hours = applyHoursPreset('clear');
  for (const day of WEEKDAYS) {
    assert.deepStrictEqual(hours[day], []);
  }
});

test('each call returns a fresh form and mutating one does not affect the next', () => {
  const first = applyHoursPreset('standard');
  const second = applyHoursPreset('standard');
  assert.notEqual(first, second);
  assert.notEqual(first.monday, second.monday);

  first.monday.push({ opensAt: '10:00', closesAt: '11:00' });
  first.monday[0].opensAt = '00:00';

  assert.deepStrictEqual(second.monday, [{ opensAt: '09:00', closesAt: '17:00' }]);
});
