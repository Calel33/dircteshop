#!/usr/bin/env node
/**
 * Pins the unsaved-state preview adapter for issue #12 / B3a (todo #9): form
 * state maps onto the public `PublicBusiness` shape while non-edited fields carry
 * through from the owned document, so `BusinessProfile` can render WYSIWYS
 * without forking the shared renderer.
 *
 * Run: node --test "app/owner/business/[id]/preview-adapter.test.ts"
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Id } from '@/convex/_generated/dataModel';

import { createEditorForm } from './editor-form.ts';
import { toPreviewBusiness, type PreviewSource } from './preview-adapter.ts';

const DOC = {
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

const SOURCE: PreviewSource = {
  _id: 'businesses_1' as Id<'businesses'>,
  photos: [],
  verification: { isVerified: true },
  rating: 4.5,
  ratingCount: 10,
  services: ['espresso'],
  credentials: [],
  lastUpdatedAt: 1_700_000_000_002,
};

test('preview reflects unsaved form values over the owned document', () => {
  const form = {
    ...createEditorForm(DOC),
    name: 'Acme Roasters',
    description: 'Now roasting daily',
  };

  const preview = toPreviewBusiness(SOURCE, form);

  assert.equal(preview.name, 'Acme Roasters');
  assert.equal(preview.description, 'Now roasting daily');
});

test('carries non-edited fields through from the owned document', () => {
  const preview = toPreviewBusiness(SOURCE, createEditorForm(DOC));

  assert.equal(preview._id, SOURCE._id);
  assert.deepStrictEqual(preview.photos, []);
  assert.deepStrictEqual(preview.verification, { isVerified: true });
  assert.equal(preview.rating, 4.5);
  assert.equal(preview.ratingCount, 10);
  assert.deepStrictEqual(preview.services, ['espresso']);
  assert.deepStrictEqual(preview.credentials, []);
  assert.equal(preview.lastUpdatedAt, SOURCE.lastUpdatedAt);
});

test('cleared contact fields become absent instead of empty strings', () => {
  const form = { ...createEditorForm(DOC), phone: '', email: '', website: '  ' };

  const preview = toPreviewBusiness(SOURCE, form);

  assert.equal(preview.phone, undefined);
  assert.equal(preview.email, undefined);
  assert.equal(preview.website, undefined);
});

test('keeps set contact fields trimmed', () => {
  const form = { ...createEditorForm(DOC), phone: ' 555-0100 ', website: ' https://acme.test ' };

  const preview = toPreviewBusiness(SOURCE, form);

  assert.equal(preview.phone, '555-0100');
  assert.equal(preview.website, 'https://acme.test');
  assert.equal(preview.email, 'hi@acme.test');
});

test('normalises address and drops empty weekdays for rendering', () => {
  const form = createEditorForm(DOC);
  const preview = toPreviewBusiness(SOURCE, {
    ...form,
    address: { ...form.address, addressLine2: '', postalCode: '' },
  });

  assert.deepStrictEqual(preview.address, {
    addressLine1: '1 Main St',
    city: 'Springfield',
    state: 'IL',
    country: 'US',
  });
  assert.deepStrictEqual(preview.hours, {
    monday: [{ opensAt: '09:00', closesAt: '17:00' }],
  });
});
