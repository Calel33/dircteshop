#!/usr/bin/env node
/**
 * Pins the B6b read-only owners-table contract (issue #16, Task 2):
 *
 * - The owners read is cursor-paginated 25 users at a time and the server
 *   rejects a larger `numItems` before any read (`assertOwnersPageSize`), so
 *   one request can never materialize an oversized users page. The
 *   server-owned scan cap (`OWNERS_MAXIMUM_ROWS_READ`) keeps 4x headroom over
 *   the page size without letting a client extend the read.
 * - `toOwnerRow` is the only shape the owners surface receives: user identity
 *   (`_id`), display name, the stamped `role`, and the exact per-owner
 *   `businessCount`. The Clerk `externalId` is deliberately absent, and a
 *   `users` row carries no email, so neither can leak to the client.
 *
 * These tests pass a count into `toOwnerRow`; they do not execute `listOwners`
 * or compare the index query with database rows. The users-page scan is capped
 * at 100 rows, but each owner's business range is data-dependent and can use
 * the function's shared read budget. Live count equality and 10x-volume checks
 * remain outstanding.
 *
 * `convex/adminProjections.ts` is pure, so the projection helpers are tested
 * without a live Convex deployment. Zero-business users are included by
 * design: the read pages `users`, not `businesses`.
 *
 * Run: node --test scripts/admin-owners.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Doc, Id } from '../convex/_generated/dataModel.ts';
import {
  OWNERS_MAXIMUM_ROWS_READ,
  OWNERS_PAGE_SIZE,
  assertOwnersPageSize,
  toOwnerRow,
} from '../convex/adminProjections.ts';
import { UNKNOWN_USER_NAME } from '../convex/userName.ts';

/** A schema-shaped users document, including the fields a client must not receive. */
function userFixture(overrides: Partial<Doc<'users'>> = {}): Doc<'users'> {
  return {
    _id: 'users_1' as Id<'users'>,
    _creationTime: 1_700_000_000_000,
    name: 'Maya Chen',
    externalId: 'user_clerk_1',
    role: 'user',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Read bounds: 25 rows per page, server-owned scan cap.
// ---------------------------------------------------------------------------

test('owners pages are capped at 25 rows', () => {
  assert.equal(OWNERS_PAGE_SIZE, 25);
});

test('the owners page-size policy rejects requests larger than 25', () => {
  assert.doesNotThrow(() => assertOwnersPageSize(1));
  assert.doesNotThrow(() => assertOwnersPageSize(25));
  assert.throws(() => assertOwnersPageSize(26), /limited to 25/);
  assert.throws(() => assertOwnersPageSize(100), /limited to 25/);
});

test('the scan cap keeps 4x headroom over the page size', () => {
  assert.equal(OWNERS_MAXIMUM_ROWS_READ, OWNERS_PAGE_SIZE * 4);
  assert.ok(OWNERS_MAXIMUM_ROWS_READ >= OWNERS_PAGE_SIZE);
});

// ---------------------------------------------------------------------------
// Row projection: frozen fields only, no Clerk identity or email.
// ---------------------------------------------------------------------------

test('the row carries exactly the frozen owners fields', () => {
  const row = toOwnerRow(userFixture(), 2);

  assert.deepStrictEqual(row, {
    _id: 'users_1' as Id<'users'>,
    name: 'Maya Chen',
    role: 'user',
    businessCount: 2,
  });
});

test('a user with zero businesses counts zero and is not filtered out', () => {
  const row = toOwnerRow(userFixture({ name: 'New Signup', role: 'user' }), 0);

  assert.equal(row.businessCount, 0);
  assert.equal(row.name, 'New Signup');
  assert.equal(row.role, 'user');
});

test('multiple businesses count through unchanged (2 is not collapsed to 1)', () => {
  assert.equal(toOwnerRow(userFixture(), 2).businessCount, 2);
  assert.equal(toOwnerRow(userFixture(), 7).businessCount, 7);
});

test('the role projects the raw users.role value; the UI relabels, the row does not', () => {
  assert.equal(toOwnerRow(userFixture({ role: 'user' }), 1).role, 'user');
  assert.equal(toOwnerRow(userFixture({ role: 'superAdmin' }), 0).role, 'superAdmin');
});

test('the row withholds the Clerk external id and any email', () => {
  const row = toOwnerRow(userFixture(), 1);
  const keys = Object.keys(row);

  assert.deepStrictEqual(keys.sort(), ['_id', 'businessCount', 'name', 'role']);
  for (const withheld of ['externalId', 'email']) {
    assert.equal(keys.includes(withheld), false, `row must not carry ${withheld}`);
  }
});

test('a legacy "null null" stored name renders as the unknown label', () => {
  assert.equal(toOwnerRow(userFixture({ name: 'null null' }), 0).name, UNKNOWN_USER_NAME);
});

test('a blank stored name renders as the unknown label', () => {
  assert.equal(toOwnerRow(userFixture({ name: '   ' }), 0).name, UNKNOWN_USER_NAME);
});
