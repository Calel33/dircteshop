#!/usr/bin/env node
/**
 * Pins the owner-scoped read projections for issue #12 / B3a (todo #3).
 *
 * `getMine` returns the owned editor document; `listMine` returns owned-home
 * summaries. Both projections are pure functions in
 * `convex/businesses/ownerProjections.ts`, so their field selection — in
 * particular the server-internal fields deliberately withheld from a client —
 * can be asserted without a Convex runtime (runtime DB tests are unavailable in
 * this repo; see tasks/issue-12-todo.md #3).
 *
 * Run: node --test scripts/owner-projections.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Doc, Id } from '../convex/_generated/dataModel.ts';
import {
  toOwnerEditorDocument,
  toOwnerSummary,
} from '../convex/businesses/ownerProjections.ts';

/** A schema-shaped business document, including the fields a client must not receive. */
function businessFixture(): Doc<'businesses'> {
  return {
    _id: 'businesses_1' as Id<'businesses'>,
    _creationTime: 1_700_000_000_000,
    name: 'Acme Coffee',
    categoryId: 'categories_1' as Id<'categories'>,
    description: 'A cafe',
    address: {
      addressLine1: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      country: 'US',
    },
    phone: '555-0100',
    email: 'hi@acme.test',
    website: 'https://acme.test',
    timezone: 'America/Chicago',
    photos: [],
    hours: { monday: [{ opensAt: '09:00', closesAt: '17:00' }] },
    status: 'changesRequested',
    verification: {
      isVerified: true,
      verifiedAt: 1_700_000_000_001,
      verifiedBy: 'users_admin' as Id<'users'>,
    },
    rating: 4.5,
    ratingCount: 10,
    services: ['espresso'],
    credentials: [],
    keywords: ['coffee'],
    searchText: 'Acme Coffee coffee A cafe',
    ownerId: 'users_owner' as Id<'users'>,
    lastUpdatedAt: 1_700_000_000_002,
    submittedAt: 1_700_000_000_003,
    isFeatured: false,
    moderationReason: 'Add a clearer address',
    moderatedAt: 1_700_000_000_004,
    lastSavedAt: 1_700_000_000_005,
  };
}

test('listMine summary carries only the owner-card identity and lifecycle fields', () => {
  const summary = toOwnerSummary(businessFixture());

  assert.deepStrictEqual(Object.keys(summary).sort(), [
    '_id',
    'categoryId',
    'lastSavedAt',
    'lastUpdatedAt',
    'name',
    'status',
    'submittedAt',
  ]);
});

test('listMine summary values reflect the owned document', () => {
  const summary = toOwnerSummary(businessFixture());

  assert.equal(summary._id, 'businesses_1');
  assert.equal(summary.name, 'Acme Coffee');
  assert.equal(summary.status, 'changesRequested');
});

test('getMine editor document keeps status and the moderation banner fields', () => {
  const editor = toOwnerEditorDocument(businessFixture());

  assert.equal(editor.status, 'changesRequested');
  assert.equal(editor.moderationReason, 'Add a clearer address');
  assert.equal(editor.moderatedAt, 1_700_000_000_004);
  assert.equal(editor.submittedAt, 1_700_000_000_003);
  assert.equal(editor.lastSavedAt, 1_700_000_000_005);
});

test('getMine editor document keeps every owner-editable field', () => {
  const editor = toOwnerEditorDocument(businessFixture());

  assert.equal(editor.name, 'Acme Coffee');
  assert.equal(editor.categoryId, 'categories_1');
  assert.equal(editor.description, 'A cafe');
  assert.deepStrictEqual(editor.address, {
    addressLine1: '1 Main St',
    city: 'Springfield',
    state: 'IL',
    country: 'US',
  });
  assert.deepStrictEqual(editor.hours, {
    monday: [{ opensAt: '09:00', closesAt: '17:00' }],
  });
  assert.equal(editor.phone, '555-0100');
  assert.equal(editor.email, 'hi@acme.test');
  assert.equal(editor.website, 'https://acme.test');
});

test('getMine editor document withholds server-internal and admin-only fields', () => {
  const editor = toOwnerEditorDocument(businessFixture());

  assert.equal('ownerId' in editor, false);
  assert.equal('searchText' in editor, false);
  assert.deepStrictEqual(editor.verification, { isVerified: true });
});

test('getMine editor document carries forward new editable fields (tags/amenities)', () => {
  const withContentFields = {
    ...businessFixture(),
    tags: ['coffee'],
    amenities: ['wifi'],
  } as unknown as Doc<'businesses'>;

  const editor = toOwnerEditorDocument(withContentFields) as unknown as Record<string, unknown>;

  assert.deepStrictEqual(editor.tags, ['coffee']);
  assert.deepStrictEqual(editor.amenities, ['wifi']);
});
