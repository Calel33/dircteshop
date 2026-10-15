#!/usr/bin/env node
/**
 * Pins the B4 development seed fixture contract (issue #4, todo task 2).
 *
 * The seed must prove the public discovery states with real data: >=3 approved
 * listings across categories, nonapproved rows, featured/verified cases, both
 * sides of the Highly Rated boundary (rating >= 4.5 AND ratingCount > 0),
 * keyword search coverage, IANA timezones, and hours edge cases (overnight,
 * multi-period, closed day). Feed ordering must be deterministic, so the
 * relative timestamps each fixture declares are distinct.
 *
 * Runtime idempotency and insert behavior are proven by running `pnpm seed`
 * twice against the dev deployment; this file pins the pure fixture contract.
 *
 * Run: node --test scripts/business-seed.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildSearchText } from '../convex/businesses/helpers.ts';
import { SEED_FIXTURES, type SeedFixture } from '../convex/businesses/seedFixtures.ts';

const approved = SEED_FIXTURES.filter((fixture) => fixture.status === 'approved');

function allPeriods(fixture: SeedFixture): { opensAt: string; closesAt: string }[] {
  return Object.values(fixture.hours).flatMap((day) => day ?? []);
}

test('seed defines at least three approved listings across multiple categories', () => {
  assert.ok(approved.length >= 3, `expected >= 3 approved fixtures, got ${approved.length}`);
  const categories = new Set(approved.map((fixture) => fixture.categorySlug));
  assert.ok(categories.size >= 2, `expected >= 2 approved categories, got ${categories.size}`);
});

test('seed includes nonapproved fixtures', () => {
  const nonApproved = SEED_FIXTURES.filter((fixture) => fixture.status !== 'approved');
  assert.ok(nonApproved.length >= 1, 'expected at least one nonapproved fixture');
});

test('seed covers featured, verified, and unverified approved listings', () => {
  assert.ok(
    approved.some((fixture) => fixture.isFeatured),
    'expected a featured approved fixture (Trending feed)'
  );
  assert.ok(
    approved.some((fixture) => fixture.verifiedAgoMs !== undefined),
    'expected a verified approved fixture (Recently Verified feed)'
  );
  assert.ok(
    approved.some((fixture) => fixture.verifiedAgoMs === undefined),
    'expected an unverified approved fixture'
  );
});

test('seed covers both sides of the Highly Rated boundary', () => {
  assert.ok(
    approved.some((fixture) => fixture.rating >= 4.5 && fixture.ratingCount > 0),
    'expected an approved fixture inside the Highly Rated filter'
  );
  assert.ok(
    approved.some((fixture) => fixture.rating >= 4.5 && fixture.ratingCount === 0),
    'expected an approved fixture excluded by ratingCount = 0'
  );
  assert.ok(
    approved.some((fixture) => fixture.rating < 4.5 && fixture.ratingCount > 0),
    'expected an approved fixture excluded by rating < 4.5'
  );
});

test('every fixture searchText carries its name and keywords', () => {
  for (const fixture of SEED_FIXTURES) {
    const searchText = buildSearchText(fixture.name, fixture.keywords, fixture.description);
    assert.ok(searchText.includes(fixture.name), `${fixture.name}: searchText must include the name`);
    for (const keyword of fixture.keywords) {
      assert.ok(
        searchText.includes(keyword),
        `${fixture.name}: searchText must include keyword "${keyword}"`
      );
    }
  }
});

test('seed timezones are valid IANA names with variety', () => {
  const zones = new Set(SEED_FIXTURES.map((fixture) => fixture.timezone));
  assert.ok(zones.size >= 2, `expected >= 2 distinct timezones, got ${zones.size}`);
  for (const zone of zones) {
    assert.doesNotThrow(
      () => new Intl.DateTimeFormat('en-US', { timeZone: zone }),
      `"${zone}" must be a valid IANA timezone`
    );
  }
});

test('seed hours cover overnight, multi-period, and closed-day cases', () => {
  assert.ok(
    SEED_FIXTURES.some((fixture) => allPeriods(fixture).some((p) => p.closesAt <= p.opensAt)),
    'expected an overnight period (closesAt <= opensAt)'
  );
  assert.ok(
    SEED_FIXTURES.some((fixture) =>
      Object.values(fixture.hours).some((day) => (day?.length ?? 0) >= 2)
    ),
    'expected a multi-period day'
  );
  assert.ok(
    approved.some((fixture) => Object.keys(fixture.hours).length < 7),
    'expected an approved fixture with a closed day'
  );
});

test('seed timestamps are distinct so feed ordering is deterministic', () => {
  const featured = approved.filter((fixture) => fixture.isFeatured);
  assert.equal(
    new Set(featured.map((fixture) => fixture.lastUpdatedAtAgoMs)).size,
    featured.length,
    'featured fixtures need distinct lastUpdatedAt offsets'
  );

  const submitted = approved.map((fixture) => fixture.submittedAtAgoMs);
  assert.equal(new Set(submitted).size, approved.length, 'approved fixtures need distinct submittedAt offsets');

  const verified = approved
    .filter((fixture) => fixture.verifiedAgoMs !== undefined)
    .map((fixture) => fixture.verifiedAgoMs);
  assert.equal(new Set(verified).size, verified.length, 'verified fixtures need distinct verifiedAt offsets');
});

test('fixture names are unique', () => {
  const names = SEED_FIXTURES.map((fixture) => fixture.name);
  assert.equal(new Set(names).size, names.length, 'seed fixture names must be unique');
});
