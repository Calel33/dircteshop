#!/usr/bin/env node
/**
 * Pins the pure owner-editor form logic for issue #12 / B3a (todo #9):
 * classification parity with the frozen server allowlist, initial form state,
 * dirty derivation, patch normalisation, and canonicalisation/validation.
 *
 * Run: node --test "app/owner/business/[id]/editor-form.test.ts"
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EDITABLE_FIELD_CLASS } from '../../../../convex/businessTypes.ts';
import {
  buildEditablePatch,
  canonicalizeForm,
  coreIdentityFields,
  createEditorForm,
  dirtyFields,
  EDITOR_FIELD_CLASS,
  EDITOR_FIELDS,
  mergeSavedFields,
  normalizeAddress,
  normalizeHours,
  normalizeStringList,
  reconcileSavedFields,
  validateForm,
  WEEKDAYS,
} from './editor-form.ts';

const SOURCE = {
  name: 'Acme Coffee',
  categoryId: 'categories_1',
  description: 'A cafe',
  address: { addressLine1: '1 Main St', city: 'Springfield', state: 'IL', country: 'US' },
  hours: { monday: [{ opensAt: '09:00', closesAt: '17:00' }] },
  phone: '555-0100',
  email: 'hi@acme.test',
  website: 'https://acme.test',
  tags: ['coffee'],
  amenities: ['wifi'],
};

test('editor field classification matches the frozen server allowlist', () => {
  assert.deepStrictEqual(EDITOR_FIELD_CLASS, EDITABLE_FIELD_CLASS);
});

test('exposes the ten editable fields exactly once', () => {
  assert.equal(EDITOR_FIELDS.length, 10);
  assert.equal(new Set(EDITOR_FIELDS).size, EDITOR_FIELDS.length);
});

test('initialises form state from the owned document and expands all weekdays', () => {
  const form = createEditorForm(SOURCE);

  assert.equal(form.name, 'Acme Coffee');
  assert.equal(form.categoryId, 'categories_1');
  assert.equal(form.description, 'A cafe');
  assert.equal(form.phone, '555-0100');
  assert.deepStrictEqual(form.tags, ['coffee']);
  assert.deepStrictEqual(form.amenities, ['wifi']);
  assert.equal(Object.keys(form.hours).length, 7);
  assert.deepStrictEqual(form.hours.monday, [{ opensAt: '09:00', closesAt: '17:00' }]);
  assert.deepStrictEqual(form.hours.tuesday, []);
});

test('defaults optional strings and arrays when the document omits them', () => {
  const form = createEditorForm({
    ...SOURCE,
    phone: undefined,
    email: undefined,
    website: undefined,
    tags: undefined,
    amenities: undefined,
    address: { addressLine1: '1 Main St', city: 'Springfield', state: 'IL', country: 'US' },
  });

  assert.equal(form.phone, '');
  assert.equal(form.email, '');
  assert.equal(form.website, '');
  assert.deepStrictEqual(form.tags, []);
  assert.deepStrictEqual(form.amenities, []);
  assert.equal(form.address.addressLine2, '');
  assert.equal(form.address.postalCode, '');
});

test('reports no dirty fields for the initial form', () => {
  assert.deepStrictEqual(dirtyFields(createEditorForm(SOURCE), createEditorForm(SOURCE)), []);
});

test('marks only the edited field dirty and ignores whitespace-only edits', () => {
  const form = createEditorForm(SOURCE);
  const renamed = { ...form, name: 'Acme Coffee Roasters' };
  const padded = { ...form, name: ' Acme Coffee ' };

  assert.deepStrictEqual(dirtyFields(renamed, form), ['name']);
  assert.deepStrictEqual(dirtyFields(padded, form), []);
});

test('detects address and hours changes structurally', () => {
  const form = createEditorForm(SOURCE);
  const moved = { ...form, address: { ...form.address, city: 'Shelbyville' } };
  const rescheduled = {
    ...form,
    hours: { ...form.hours, tuesday: [{ opensAt: '10:00', closesAt: '14:00' }] },
  };
  const blankHours = { ...form, hours: createEditorForm({ ...SOURCE, hours: {} }).hours };

  assert.deepStrictEqual(dirtyFields(moved, form), ['address']);
  assert.deepStrictEqual(dirtyFields(rescheduled, form), ['hours']);
  assert.deepStrictEqual(dirtyFields(blankHours, form), ['hours']);
});

test('treats duplicate-only tag edits as clean and new tags as dirty', () => {
  const form = createEditorForm(SOURCE);
  const duplicated = { ...form, tags: ['coffee', ' coffee '] };
  const extended = { ...form, tags: ['coffee', 'tea'] };

  assert.deepStrictEqual(dirtyFields(duplicated, form), []);
  assert.deepStrictEqual(dirtyFields(extended, form), ['tags']);
});

test('builds a patch containing only the requested fields, normalised', () => {
  const form = createEditorForm(SOURCE);
  const messy = {
    ...form,
    name: '  Acme  ',
    phone: ' 555 ',
    tags: [' coffee ', '', 'coffee'],
  };
  const patch = buildEditablePatch(messy, ['name', 'phone', 'tags']);

  assert.deepStrictEqual(patch, { name: 'Acme', phone: '555', tags: ['coffee'] });
  assert.equal('address' in patch, false);
  assert.equal('hours' in patch, false);
});

test('patch drops empty hours days and empty optional address parts', () => {
  const form = createEditorForm(SOURCE);
  const patch = buildEditablePatch(form, ['hours', 'categoryId', 'address']);

  assert.deepStrictEqual(patch.hours, { monday: [{ opensAt: '09:00', closesAt: '17:00' }] });
  assert.equal(patch.categoryId, 'categories_1');
  assert.deepStrictEqual(patch.address, {
    addressLine1: '1 Main St',
    city: 'Springfield',
    state: 'IL',
    country: 'US',
  });
});

test('canonicalise trims only the persisted fields', () => {
  const form = createEditorForm(SOURCE);
  const messy = { ...form, name: '  Acme  ', tags: [' coffee ', 'coffee'] };
  const canonical = canonicalizeForm(messy, ['name', 'tags']);

  assert.equal(canonical.name, 'Acme');
  assert.deepStrictEqual(canonical.tags, ['coffee']);
  assert.equal(canonical.description, messy.description);
});

test('merges only saved fields into the baseline, keeping staged core edits dirty', () => {
  const form = createEditorForm(SOURCE);
  const edited = { ...form, name: 'Acme Roasters', phone: '555-9999' };
  const canonical = canonicalizeForm(edited, ['phone']);
  const baseline = mergeSavedFields(form, canonical, ['phone']);

  assert.equal(baseline.phone, '555-9999');
  assert.equal(baseline.name, form.name);
  assert.deepStrictEqual(dirtyFields(edited, baseline), ['name']);
});

test('separates core identity fields from content fields', () => {
  assert.deepStrictEqual(coreIdentityFields(['name', 'hours', 'address', 'tags']), [
    'name',
    'address',
  ]);
});

test('validates a non-empty name', () => {
  const form = createEditorForm(SOURCE);

  assert.equal(validateForm(form), null);
  assert.equal(validateForm({ ...form, name: '   ' }), 'Business name is required.');
});

test('normalisation helpers are stable on already-canonical values', () => {
  assert.deepStrictEqual(normalizeStringList(['a', ' a ', 'b', '']), ['a', 'b']);
  assert.deepStrictEqual(normalizeHours(createEditorForm(SOURCE).hours), {
    monday: [{ opensAt: '09:00', closesAt: '17:00' }],
  });
  assert.deepStrictEqual(
    normalizeAddress({
      addressLine1: ' 1 Main St ',
      addressLine2: '',
      city: 'Springfield',
      state: 'IL',
      postalCode: '',
      country: 'US',
    }),
    { addressLine1: '1 Main St', city: 'Springfield', state: 'IL', country: 'US' }
  );
});

test('canonicalise keeps EditorFormState shape for every field (no next-render crash)', () => {
  const form = createEditorForm(SOURCE);

  for (const field of EDITOR_FIELDS) {
    const canonical = canonicalizeForm(form, [field]);
    assert.doesNotThrow(() => dirtyFields(canonical, canonical));
  }
});

test('canonicalise keeps all six address keys and all seven weekdays', () => {
  const form = createEditorForm(SOURCE);
  const canonical = canonicalizeForm(form, ['address', 'hours']);

  assert.deepStrictEqual(Object.keys(canonical.address).sort(), [
    'addressLine1',
    'addressLine2',
    'city',
    'country',
    'postalCode',
    'state',
  ]);
  assert.deepStrictEqual(Object.keys(canonical.hours).sort(), [...WEEKDAYS].sort());
  assert.deepStrictEqual(canonical.hours.tuesday, []);
});

test('canonicalise preserves coordinates and empties optional address parts', () => {
  const form = createEditorForm({
    ...SOURCE,
    address: {
      addressLine1: '1 Main St',
      addressLine2: '  ',
      city: 'Springfield',
      state: 'IL',
      postalCode: ' ',
      country: 'US',
      latitude: 39.8,
      longitude: -89.6,
    },
  });
  const canonical = canonicalizeForm(form, ['address']);

  assert.equal(canonical.address.addressLine2, '');
  assert.equal(canonical.address.postalCode, '');
  assert.equal(canonical.address.latitude, 39.8);
  assert.equal(canonical.address.longitude, -89.6);
});

test('canonicalising a multi-field edit keeps the next render stable and clean', () => {
  const form = createEditorForm(SOURCE);
  const edited = {
    ...form,
    address: { ...form.address, city: 'Shelbyville' },
    hours: { ...form.hours, tuesday: [{ opensAt: '10:00', closesAt: '14:00' }] },
  };
  const dirty = dirtyFields(edited, form);
  const canonical = canonicalizeForm(edited, dirty);
  const baseline = mergeSavedFields(form, canonical, dirty);

  assert.deepStrictEqual(dirty, ['address', 'hours']);
  assert.doesNotThrow(() => dirtyFields(canonical, baseline));
  assert.deepStrictEqual(dirtyFields(canonical, baseline), []);
});

test('reconcileSavedFields takes canonical values when no mid-save edit occurred', () => {
  const form = createEditorForm(SOURCE);
  const snapshot = { ...form, name: '  Acme  ' };
  const canonical = canonicalizeForm(snapshot, ['name']);
  const reconciled = reconcileSavedFields(snapshot, snapshot, canonical, ['name']);
  const baseline = mergeSavedFields(snapshot, canonical, ['name']);

  assert.equal(reconciled.name, 'Acme');
  assert.deepStrictEqual(dirtyFields(reconciled, baseline), []);
});

test('reconcileSavedFields keeps a newer mid-save edit to a saved field', () => {
  const form = createEditorForm(SOURCE);
  const snapshot = { ...form, name: '  Acme  ' };
  const canonical = canonicalizeForm(snapshot, ['name']);
  const current = { ...form, name: 'Acme Roasters' };
  const reconciled = reconcileSavedFields(current, snapshot, canonical, ['name']);
  const baseline = mergeSavedFields(snapshot, canonical, ['name']);

  assert.equal(reconciled.name, 'Acme Roasters');
  assert.deepStrictEqual(dirtyFields(reconciled, baseline), ['name']);
});

test('reconcileSavedFields leaves edits to unsaved fields untouched', () => {
  const form = createEditorForm(SOURCE);
  const snapshot = { ...form, name: '  Acme  ' };
  const canonical = canonicalizeForm(snapshot, ['name']);
  const current = { ...snapshot, phone: '555-9999' };
  const reconciled = reconcileSavedFields(current, snapshot, canonical, ['name']);

  assert.equal(reconciled.name, 'Acme');
  assert.equal(reconciled.phone, '555-9999');
});
