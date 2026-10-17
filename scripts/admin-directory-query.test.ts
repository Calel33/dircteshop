#!/usr/bin/env node
/**
 * Pins the B6a Super Admin directory query contract (issue #15, Task 1):
 *
 * - `listAdminDirectory` reads are bounded: the server rejects a page request
 *   larger than 25 and the pure planner only prescribes filters that an
 *   existing index can apply, so every read stays constrained.
 * - Search matches business name, owner name, and location (address line 1,
 *   city, state) case-insensitively as a substring, combined with the exact
 *   category/status/verification/featured filters.
 * - `toAdminDirectoryRow` is the only shape the directory surfaces receive:
 *   it must carry the frozen admin fields (including the listing's contact
 *   email and its `_creationTime`) and withhold owner identity (`ownerId`),
 *   the owner's user email (`ownerEmail` — users rows carry no email), search
 *   maintenance, and moderation internals.
 *
 * `convex/businesses/adminProjections.ts` imports only types from generated
 * Convex modules, so the pure helpers are asserted without a live Convex
 * deployment (runtime DB tests are unavailable in this repo; see
 * tasks/issue-15-context.md §7). The handler wiring in
 * `convex/businesses/queries.ts` mirrors the queue pattern
 * (`listPendingApprovals`) and is verified in the authenticated dev check.
 *
 * Run: node --test scripts/admin-directory-query.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Doc, Id } from '../convex/_generated/dataModel.ts';
import {
  ADMIN_DIRECTORY_PAGE_SIZE,
  assertAdminDirectoryPageSize,
  matchesAdminDirectoryFilters,
  normalizeAdminSearchTerm,
  resolveAdminDirectoryIndexPlan,
  toAdminDirectoryRow,
  type AdminDirectoryFilters,
} from '../convex/businesses/adminProjections.ts';

/** A schema-shaped business document, including the fields a client must not receive. */
function businessFixture(overrides: Partial<Doc<'businesses'>> = {}): Doc<'businesses'> {
  return {
    _id: 'businesses_1' as Id<'businesses'>,
    _creationTime: 1_700_000_000_000,
    name: 'Acme Coffee',
    categoryId: 'categories_1' as Id<'categories'>,
    description: 'A cozy neighborhood cafe',
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
    photos: [
      { storageId: 'storage_photo_1' as Id<'_storage'>, altText: 'Storefront', ordering: 0 },
    ],
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
    searchText: 'Acme Coffee coffee cafe A cozy neighborhood cafe',
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

function categoryFixture(overrides: Partial<Doc<'categories'>> = {}): Doc<'categories'> {
  return {
    _id: 'categories_1' as Id<'categories'>,
    _creationTime: 1_700_000_000_000,
    name: 'Coffee Shops',
    slug: 'coffee-shops',
    ordering: 1,
    ...overrides,
  };
}

function ownerFixture(overrides: Partial<Doc<'users'>> = {}): Doc<'users'> {
  return {
    _id: 'users_owner' as Id<'users'>,
    _creationTime: 1_700_000_000_000,
    name: 'Rosalind Owner',
    externalId: 'user_clerk_1',
    role: 'user',
    ...overrides,
  };
}

/** The structural fields the filter matcher reads off a joined directory candidate. */
function filterFields(business: Doc<'businesses'>, ownerName: string | null = 'Rosalind Owner') {
  return {
    name: business.name,
    ownerName,
    addressLine1: business.address.addressLine1,
    city: business.address.city,
    state: business.address.state,
    status: business.status,
    categoryId: business.categoryId,
    isVerified: business.verification.isVerified,
    isFeatured: business.isFeatured,
  };
}

// ---------------------------------------------------------------------------
// Read bounds: 25 rows per page, filters constrain the read.
// ---------------------------------------------------------------------------

test('directory pages are capped at 25 rows', () => {
  assert.equal(ADMIN_DIRECTORY_PAGE_SIZE, 25);
});

test('the server rejects a page request larger than 25', () => {
  assert.doesNotThrow(() => assertAdminDirectoryPageSize(1));
  assert.doesNotThrow(() => assertAdminDirectoryPageSize(25));
  assert.throws(() => assertAdminDirectoryPageSize(26), /limited to 25/);
  assert.throws(() => assertAdminDirectoryPageSize(100), /limited to 25/);
});

test('the index plan applies every filter an existing index can carry', () => {
  const categoryId = categoryFixture()._id;

  // No filter: full-table paging is the only option (no index to constrain).
  assert.deepStrictEqual(resolveAdminDirectoryIndexPlan({}), { indexName: null });

  assert.deepStrictEqual(resolveAdminDirectoryIndexPlan({ status: 'approved' }), {
    indexName: 'byStatusSubmittedAt',
    status: 'approved',
  });

  assert.deepStrictEqual(resolveAdminDirectoryIndexPlan({ categoryId }), {
    indexName: 'byCategoryId',
    categoryId,
  });

  assert.deepStrictEqual(resolveAdminDirectoryIndexPlan({ status: 'pendingReview', categoryId }), {
    indexName: 'byStatusCategorySubmittedAt',
    status: 'pendingReview',
    categoryId,
  });

  assert.deepStrictEqual(resolveAdminDirectoryIndexPlan({ status: 'approved', isVerified: true }), {
    indexName: 'byStatusVerifiedVerifiedAt',
    status: 'approved',
    isVerified: true,
  });

  // All three: status+category wins; verification is rechecked in-function.
  assert.deepStrictEqual(
    resolveAdminDirectoryIndexPlan({ status: 'approved', categoryId, isVerified: true }),
    {
      indexName: 'byStatusCategorySubmittedAt',
      status: 'approved',
      categoryId,
    }
  );

  // Verification alone has no index: the read stays a full-table page and the
  // filter is applied to the scanned window.
  assert.deepStrictEqual(resolveAdminDirectoryIndexPlan({ isVerified: true }), {
    indexName: null,
  });
});

test('the featured filter plans onto the existing status+featured index and rechecks otherwise', () => {
  const categoryId = categoryFixture()._id;

  // Featured alone has no index (byStatusFeaturedUpdatedAt steps status
  // first), so the read stays a full-table page and the filter is applied to
  // the scanned window — the same fallback as verification alone.
  assert.deepStrictEqual(resolveAdminDirectoryIndexPlan({ isFeatured: true }), { indexName: null });
  assert.deepStrictEqual(resolveAdminDirectoryIndexPlan({ isFeatured: false }), {
    indexName: null,
  });

  // Status + featured: the B4 featured index carries both steps, for either
  // featured value.
  assert.deepStrictEqual(resolveAdminDirectoryIndexPlan({ status: 'approved', isFeatured: true }), {
    indexName: 'byStatusFeaturedUpdatedAt',
    status: 'approved',
    isFeatured: true,
  });
  assert.deepStrictEqual(
    resolveAdminDirectoryIndexPlan({ status: 'approved', isFeatured: false }),
    {
      indexName: 'byStatusFeaturedUpdatedAt',
      status: 'approved',
      isFeatured: false,
    }
  );

  // Existing plans win when the featured filter rides along; it is rechecked
  // in-function on the scanned window.
  assert.deepStrictEqual(
    resolveAdminDirectoryIndexPlan({ status: 'approved', categoryId, isFeatured: true }),
    {
      indexName: 'byStatusCategorySubmittedAt',
      status: 'approved',
      categoryId,
    }
  );
  assert.deepStrictEqual(
    resolveAdminDirectoryIndexPlan({ status: 'approved', isVerified: true, isFeatured: true }),
    {
      indexName: 'byStatusVerifiedVerifiedAt',
      status: 'approved',
      isVerified: true,
    }
  );
});

// ---------------------------------------------------------------------------
// Search: name / owner name / location, case-insensitive substring.
// ---------------------------------------------------------------------------

test('normalizeAdminSearchTerm trims and treats blank as no filter', () => {
  assert.equal(normalizeAdminSearchTerm(undefined), undefined);
  assert.equal(normalizeAdminSearchTerm(''), undefined);
  assert.equal(normalizeAdminSearchTerm('   '), undefined);
  assert.equal(normalizeAdminSearchTerm('  pizza  '), 'pizza');
  assert.equal(normalizeAdminSearchTerm('ACME'), 'ACME');
});

test('search matches a name substring case-insensitively', () => {
  const fields = filterFields(businessFixture());
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'acme' }), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'COFFEE' }), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'me cof' }), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'pizza' }), false);
});

test('search matches the joined owner name case-insensitively', () => {
  const fields = filterFields(businessFixture());
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'rosalind' }), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'OWNER' }), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'nobody' }), false);
});

test('search matches location fields case-insensitively', () => {
  const fields = filterFields(businessFixture());
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'main st' }), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'springfield' }), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'il' }), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'berlin' }), false);
});

test('an empty or whitespace search matches every candidate', () => {
  const fields = filterFields(businessFixture());
  assert.equal(matchesAdminDirectoryFilters(fields, {}), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: '' }), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: '   ' }), true);
});

test('a missing owner join cannot match an owner search (but is not an error)', () => {
  const fields = filterFields(businessFixture(), null);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'rosalind' }), false);
  assert.equal(matchesAdminDirectoryFilters(fields, { search: 'acme' }), true);
});

// ---------------------------------------------------------------------------
// Exact filters AND-combine with each other and with search.
// ---------------------------------------------------------------------------

test('status, category, and verification filters compare exactly', () => {
  const fields = filterFields(businessFixture());
  assert.equal(matchesAdminDirectoryFilters(fields, { status: 'approved' }), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { status: 'pendingReview' }), false);
  assert.equal(
    matchesAdminDirectoryFilters(fields, { categoryId: 'categories_1' as Id<'categories'> }),
    true
  );
  assert.equal(
    matchesAdminDirectoryFilters(fields, { categoryId: 'categories_2' as Id<'categories'> }),
    false
  );
  assert.equal(matchesAdminDirectoryFilters(fields, { isVerified: true }), true);
  assert.equal(matchesAdminDirectoryFilters(fields, { isVerified: false }), false);
});

test('the featured filter compares exactly and treats undefined as no constraint', () => {
  const featured = filterFields(businessFixture({ isFeatured: true }));
  const plain = filterFields(businessFixture({ isFeatured: false }));

  assert.equal(matchesAdminDirectoryFilters(featured, { isFeatured: true }), true);
  assert.equal(matchesAdminDirectoryFilters(featured, { isFeatured: false }), false);
  assert.equal(matchesAdminDirectoryFilters(plain, { isFeatured: true }), false);
  assert.equal(matchesAdminDirectoryFilters(plain, { isFeatured: false }), true);
  assert.equal(matchesAdminDirectoryFilters(plain, {}), true);
});

test('search and filters combine with AND semantics', () => {
  const fields = filterFields(businessFixture());

  assert.equal(
    matchesAdminDirectoryFilters(fields, {
      search: 'acme',
      status: 'approved',
      categoryId: 'categories_1' as Id<'categories'>,
      isVerified: true,
      isFeatured: true,
    }),
    true
  );

  // One failing constraint fails the whole combination.
  const failingCombinations: AdminDirectoryFilters[] = [
    { search: 'pizza', status: 'approved', isVerified: true },
    { search: 'acme', status: 'rejected', isVerified: true },
    { search: 'acme', status: 'approved', categoryId: 'categories_9' as Id<'categories'> },
    { search: 'acme', status: 'approved', isVerified: false },
    { search: 'acme', status: 'approved', isFeatured: false },
  ];
  for (const filters of failingCombinations) {
    assert.equal(matchesAdminDirectoryFilters(fields, filters), false);
  }
});

// ---------------------------------------------------------------------------
// Row projection: frozen admin fields only, no owner identity or internals.
// ---------------------------------------------------------------------------

test('the row carries exactly the frozen admin fields', () => {
  const row = toAdminDirectoryRow({
    business: businessFixture(),
    category: categoryFixture(),
    owner: ownerFixture(),
  });

  assert.deepStrictEqual(row, {
    _id: 'businesses_1' as Id<'businesses'>,
    name: 'Acme Coffee',
    description: 'A cozy neighborhood cafe',
    status: 'approved',
    isFeatured: true,
    isVerified: true,
    categoryName: 'Coffee Shops',
    ownerName: 'Rosalind Owner',
    email: 'hi@acme.test',
    createdAt: 1_700_000_000_000,
    address: { addressLine1: '1 Main St', city: 'Springfield', state: 'IL' },
    phone: '555-0100',
    website: 'https://acme.test',
    rating: 4.6,
    ratingCount: 12,
    lastUpdatedAt: 1_700_000_000_002,
    submittedAt: 1_700_000_000_003,
  });
});

test('the contact email projects from the business row, not the owner join', () => {
  const row = toAdminDirectoryRow({
    business: businessFixture(),
    category: categoryFixture(),
    owner: ownerFixture(),
  });
  assert.equal(row.email, 'hi@acme.test');

  // Email is business data: a dangling owner join does not change it.
  const withoutOwner = toAdminDirectoryRow({
    business: businessFixture(),
    category: categoryFixture(),
    owner: null,
  });
  assert.equal(withoutOwner.email, 'hi@acme.test');
});

test('createdAt projects the Convex document creation time', () => {
  const row = toAdminDirectoryRow({
    business: businessFixture(),
    category: categoryFixture(),
    owner: ownerFixture(),
  });
  assert.equal(row.createdAt, 1_700_000_000_000);

  const later = toAdminDirectoryRow({
    business: businessFixture({ _creationTime: 1_722_345_678_901 }),
    category: categoryFixture(),
    owner: ownerFixture(),
  });
  assert.equal(later.createdAt, 1_722_345_678_901);
});

test('the row withholds owner identity, user email, search, and moderation internals', () => {
  const row = toAdminDirectoryRow({
    business: businessFixture(),
    category: categoryFixture(),
    owner: ownerFixture(),
  });
  const keys = Object.keys(row);

  for (const withheld of [
    'ownerId',
    'ownerEmail',
    'searchText',
    'keywords',
    'moderationReason',
    'moderatedAt',
    'photos',
    'hours',
    'categoryId',
    'verification',
    'lastSavedAt',
    'timezone',
  ]) {
    assert.equal(keys.includes(withheld), false, `row must not carry ${withheld}`);
  }
});

test('missing category/owner joins project to null labels', () => {
  const row = toAdminDirectoryRow({
    business: businessFixture(),
    category: null,
    owner: null,
  });

  assert.equal(row.categoryName, null);
  assert.equal(row.ownerName, null);
});

test('optional fields project to null instead of dropping keys', () => {
  const row = toAdminDirectoryRow({
    business: businessFixture({
      phone: undefined,
      website: undefined,
      email: undefined,
      submittedAt: undefined,
    }),
    category: categoryFixture(),
    owner: ownerFixture(),
  });

  assert.equal(row.phone, null);
  assert.equal(row.website, null);
  assert.equal(row.email, null);
  assert.equal(row.submittedAt, null);
});

test('blank address parts project to "Unlisted" so the surfaces never render a lone comma', () => {
  // The directory surfaces render `city, state` directly, so a blank part
  // (the schema requires the key but allows an empty string) would render
  // as ", " with no fallback of their own.
  const blank = toAdminDirectoryRow({
    business: businessFixture({
      address: { ...businessFixture().address, city: '', state: '' },
    }),
    category: categoryFixture(),
    owner: ownerFixture(),
  });
  assert.equal(blank.address.city, 'Unlisted');
  assert.equal(blank.address.state, 'Unlisted');

  const whitespace = toAdminDirectoryRow({
    business: businessFixture({
      address: { ...businessFixture().address, city: '   ', state: ' ' },
    }),
    category: categoryFixture(),
    owner: ownerFixture(),
  });
  assert.equal(whitespace.address.city, 'Unlisted');
  assert.equal(whitespace.address.state, 'Unlisted');
});

test('only blank address parts fall back; present parts pass through untouched', () => {
  const row = toAdminDirectoryRow({
    business: businessFixture({
      address: { ...businessFixture().address, state: '' },
    }),
    category: categoryFixture(),
    owner: ownerFixture(),
  });

  assert.equal(row.address.city, 'Springfield');
  assert.equal(row.address.state, 'Unlisted');
});
