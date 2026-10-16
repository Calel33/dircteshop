#!/usr/bin/env node
/**
 * Pins the B4 public directory contracts (issue #4, todo task 3):
 *
 * - `toPublicDirectoryCard` is the only projection that reaches a public card
 *   surface. It must carry display + working-action fields only, and withhold
 *   owner, moderation, and search-maintenance fields (SPEC §5/§8).
 * - `countApprovedByCategory` computes the approved-only category counts the
 *   category index and results sidebar render.
 *
 * Run: node --test scripts/public-directory-projections.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Doc, Id } from '../convex/_generated/dataModel.ts';
import {
  countApprovedByCategory,
  toPublicDirectoryCard,
} from '../convex/businesses/publicProjections.ts';

/** A schema-shaped business document, including the fields a client must not receive. */
function businessFixture(overrides: Partial<Doc<'businesses'>> = {}): Doc<'businesses'> {
  return {
    _id: 'businesses_1' as Id<'businesses'>,
    _creationTime: 1_700_000_000_000,
    name: 'Acme Coffee',
    categoryId: 'categories_1' as Id<'categories'>,
    description: 'A cafe',
    address: {
      addressLine1: '1 Main St',
      addressLine2: 'Suite 2',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
      latitude: 39.78,
      longitude: -89.65,
    },
    phone: '555-0100',
    email: 'hi@acme.test',
    website: 'https://acme.test',
    timezone: 'America/Chicago',
    photos: [],
    hours: { monday: [{ opensAt: '09:00', closesAt: '17:00' }] },
    status: 'approved',
    verification: {
      isVerified: true,
      verifiedAt: 1_700_000_000_001,
      verifiedBy: 'users_admin' as Id<'users'>,
    },
    rating: 4.6,
    ratingCount: 12,
    services: ['espresso'],
    credentials: [],
    keywords: ['coffee', 'cafe'],
    searchText: 'Acme Coffee coffee cafe A cafe',
    ownerId: 'users_owner' as Id<'users'>,
    lastUpdatedAt: 1_700_000_000_002,
    submittedAt: 1_700_000_000_003,
    isFeatured: true,
    moderationReason: 'Add a clearer address',
    moderatedAt: 1_700_000_000_004,
    lastSavedAt: 1_700_000_000_005,
    ...overrides,
  };
}

test('card projection carries only the public display and action fields', () => {
  const card = toPublicDirectoryCard(businessFixture());

  assert.deepStrictEqual(Object.keys(card).sort(), [
    '_id',
    'address',
    'categoryId',
    'description',
    'isFeatured',
    'lastUpdatedAt',
    'name',
    'phone',
    'rating',
    'ratingCount',
    'verification',
    'website',
  ]);
});

test('card projection withholds owner, moderation, and search-maintenance fields', () => {
  const card = toPublicDirectoryCard(businessFixture()) as unknown as Record<string, unknown>;

  for (const withheld of [
    'ownerId',
    'searchText',
    'keywords',
    'status',
    'moderationReason',
    'moderatedAt',
    'submittedAt',
    'lastSavedAt',
    'email',
    'hours',
    'timezone',
    'photos',
    'services',
    'credentials',
  ]) {
    assert.equal(withheld in card, false, `${withheld} must not reach a public card`);
  }
});

test('card address is narrowed to the displayable parts', () => {
  const card = toPublicDirectoryCard(businessFixture());

  assert.deepStrictEqual(card.address, {
    addressLine1: '1 Main St',
    city: 'Springfield',
    state: 'IL',
  });
});

test('card verification keeps only the public badge flag', () => {
  const card = toPublicDirectoryCard(businessFixture());

  assert.deepStrictEqual(card.verification, { isVerified: true });
});

test('card values reflect the source document', () => {
  const card = toPublicDirectoryCard(businessFixture());

  assert.equal(card._id, 'businesses_1');
  assert.equal(card.name, 'Acme Coffee');
  assert.equal(card.categoryId, 'categories_1');
  assert.equal(card.rating, 4.6);
  assert.equal(card.ratingCount, 12);
  assert.equal(card.isFeatured, true);
  assert.equal(card.lastUpdatedAt, 1_700_000_000_002);
  assert.equal(card.phone, '555-0100');
  assert.equal(card.website, 'https://acme.test');
});

test('card projection keeps optional contact fields as undefined when absent', () => {
  const card = toPublicDirectoryCard(businessFixture({ phone: undefined, website: undefined }));

  assert.equal(card.phone, undefined);
  assert.equal(card.website, undefined);
  assert.ok('phone' in card);
  assert.ok('website' in card);
});

test('countApprovedByCategory counts approved rows only', () => {
  const categoryA = 'categories_a' as Id<'categories'>;
  const categoryB = 'categories_b' as Id<'categories'>;

  const counts = countApprovedByCategory([
    businessFixture({ _id: 'businesses_a1' as Id<'businesses'>, categoryId: categoryA }),
    businessFixture({ _id: 'businesses_a2' as Id<'businesses'>, categoryId: categoryA }),
    businessFixture({
      _id: 'businesses_a3' as Id<'businesses'>,
      categoryId: categoryA,
      status: 'draft',
    }),
    businessFixture({ _id: 'businesses_b1' as Id<'businesses'>, categoryId: categoryB }),
    businessFixture({
      _id: 'businesses_b2' as Id<'businesses'>,
      categoryId: categoryB,
      status: 'pendingReview',
    }),
  ]);

  assert.equal(counts.get(categoryA), 2);
  assert.equal(counts.get(categoryB), 1);
  assert.equal(counts.size, 2);
});

test('countApprovedByCategory returns an empty map when nothing is approved', () => {
  const counts = countApprovedByCategory([
    businessFixture({ status: 'suspended' }),
    businessFixture({ _id: 'businesses_2' as Id<'businesses'>, status: 'rejected' }),
  ]);

  assert.equal(counts.size, 0);
});
