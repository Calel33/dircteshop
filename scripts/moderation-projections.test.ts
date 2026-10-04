#!/usr/bin/env node
/**
 * Pins the Super Admin approval-queue card projection for issue #13 / B3b
 * (todo #2).
 *
 * `listPendingApprovals` joins each `pendingReview` business with its category
 * and owner and narrows the triple through `toPendingApprovalCard`. The
 * projection is a pure function in `convex/businesses/moderationProjections.ts`,
 * so its field selection — in particular the server-internal fields deliberately
 * withheld from a client — can be asserted without a Convex runtime (runtime DB
 * tests are unavailable in this repo; see tasks/issue-13-context.md §4).
 *
 * Run: node --test scripts/moderation-projections.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Doc, Id } from '../convex/_generated/dataModel.ts';
import { toPendingApprovalCard } from '../convex/businesses/moderationProjections.ts';

/** A schema-shaped pending business, including the fields a card must not receive. */
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
    photos: [{ storageId: 'storage_1' as Id<'_storage'>, ordering: 0 }],
    hours: { monday: [{ opensAt: '09:00', closesAt: '17:00' }] },
    status: 'pendingReview',
    verification: { isVerified: false },
    rating: 0,
    ratingCount: 0,
    services: [],
    credentials: [],
    keywords: ['coffee'],
    searchText: 'Acme Coffee coffee A cafe',
    ownerId: 'users_owner' as Id<'users'>,
    lastUpdatedAt: 1_700_000_000_002,
    submittedAt: 1_700_000_000_003,
    isFeatured: false,
    moderationReason: 'Prior reason',
    moderatedAt: 1_700_000_000_004,
    lastSavedAt: 1_700_000_000_005,
  };
}

function categoryFixture(): Doc<'categories'> {
  return {
    _id: 'categories_1' as Id<'categories'>,
    _creationTime: 1_700_000_000_000,
    name: 'Cafes',
    slug: 'cafes',
    ordering: 1,
  };
}

function ownerFixture(): Doc<'users'> {
  return {
    _id: 'users_owner' as Id<'users'>,
    _creationTime: 1_700_000_000_000,
    name: 'Owner Name',
    externalId: 'user_clerk_id',
    role: 'user',
  };
}

test('pending card carries exactly the queue display fields', () => {
  const card = toPendingApprovalCard({
    business: businessFixture(),
    category: categoryFixture(),
    owner: ownerFixture(),
  });

  assert.deepStrictEqual(Object.keys(card).sort(), [
    '_id',
    'address',
    'categoryName',
    'email',
    'imageStorageId',
    'name',
    'ownerLabel',
    'phone',
    'submittedAt',
  ]);
});

test('pending card values reflect the joined business, category, and owner', () => {
  const card = toPendingApprovalCard({
    business: businessFixture(),
    category: categoryFixture(),
    owner: ownerFixture(),
  });

  assert.equal(card._id, 'businesses_1');
  assert.equal(card.name, 'Acme Coffee');
  assert.equal(card.categoryName, 'Cafes');
  assert.equal(card.ownerLabel, 'Owner Name');
  assert.equal(card.submittedAt, 1_700_000_000_003);
  assert.equal(card.imageStorageId, 'storage_1');
  assert.deepStrictEqual(card.address, {
    addressLine1: '1 Main St',
    city: 'Springfield',
    state: 'IL',
    country: 'US',
  });
  assert.equal(card.phone, '555-0100');
  assert.equal(card.email, 'hi@acme.test');
});

test('a missing category join yields a null category label', () => {
  const card = toPendingApprovalCard({
    business: businessFixture(),
    category: null,
    owner: ownerFixture(),
  });

  assert.equal(card.categoryName, null);
});

test('a missing owner join yields a null owner label', () => {
  const card = toPendingApprovalCard({
    business: businessFixture(),
    category: categoryFixture(),
    owner: null,
  });

  assert.equal(card.ownerLabel, null);
});

test('a business with no photos yields a null image storage id', () => {
  const card = toPendingApprovalCard({
    business: { ...businessFixture(), photos: [] },
    category: categoryFixture(),
    owner: ownerFixture(),
  });

  assert.equal(card.imageStorageId, null);
});

test('the first photo is the card image', () => {
  const card = toPendingApprovalCard({
    business: {
      ...businessFixture(),
      photos: [
        { storageId: 'storage_1' as Id<'_storage'>, ordering: 0 },
        { storageId: 'storage_2' as Id<'_storage'>, ordering: 1 },
      ],
    },
    category: categoryFixture(),
    owner: ownerFixture(),
  });

  assert.equal(card.imageStorageId, 'storage_1');
});

test('optional phone and email carry through when absent', () => {
  const card = toPendingApprovalCard({
    business: { ...businessFixture(), phone: undefined, email: undefined },
    category: categoryFixture(),
    owner: ownerFixture(),
  });

  assert.equal('phone' in card, true);
  assert.equal('email' in card, true);
  assert.equal(card.phone, undefined);
  assert.equal(card.email, undefined);
});

test('pending card withholds auth identifiers, search, and moderation internals', () => {
  const card = toPendingApprovalCard({
    business: businessFixture(),
    category: categoryFixture(),
    owner: ownerFixture(),
  }) as unknown as Record<string, unknown>;

  assert.equal('ownerId' in card, false);
  assert.equal('searchText' in card, false);
  assert.equal('keywords' in card, false);
  assert.equal('moderationReason' in card, false);
  assert.equal('moderatedAt' in card, false);
  assert.equal('verification' in card, false);
  assert.equal('categoryId' in card, false);
});
