#!/usr/bin/env node
/**
 * Pins the Clerk -> `users.name` derivation (B6b `/admin/owners` defect): a
 * Clerk user with no first/last name used to store the literal `"null null"`
 * because the display name was built with a template literal, and the owners
 * table rendered it verbatim.
 *
 * `convex/userName.ts` is pure, so these run without a live Convex deployment.
 *
 * Run: node --test scripts/user-name.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UNKNOWN_USER_NAME, clerkDisplayName, storedDisplayName } from '../convex/userName.ts';

// ---------------------------------------------------------------------------
// Sync input: real name first, then real identity signals, then the label.
// ---------------------------------------------------------------------------

test('joins the present first and last name', () => {
  assert.equal(clerkDisplayName({ firstName: 'Maya', lastName: 'Chen' }), 'Maya Chen');
});

test('uses either name part that is present', () => {
  assert.equal(clerkDisplayName({ firstName: 'Maya', lastName: null }), 'Maya');
  assert.equal(clerkDisplayName({ firstName: null, lastName: 'Chen' }), 'Chen');
});

test('trims name parts and drops empty ones instead of emitting separators', () => {
  assert.equal(clerkDisplayName({ firstName: '  Maya  ', lastName: '   ' }), 'Maya');
  assert.equal(clerkDisplayName({ firstName: '', lastName: 'Chen' }), 'Chen');
});

test('never stringifies absent name parts as "null" or "undefined"', () => {
  assert.equal(clerkDisplayName({ firstName: null, lastName: null }), UNKNOWN_USER_NAME);
  assert.equal(clerkDisplayName({ firstName: undefined, lastName: undefined }), UNKNOWN_USER_NAME);
  assert.equal(clerkDisplayName({ firstName: 'null', lastName: 'null' }), UNKNOWN_USER_NAME);
});

test('falls back to the username when no name is present', () => {
  assert.equal(
    clerkDisplayName({ firstName: null, lastName: null, username: 'maya.chen' }),
    'maya.chen'
  );
});

test('falls back to the first email address when name and username are absent', () => {
  assert.equal(
    clerkDisplayName({
      firstName: null,
      lastName: null,
      username: null,
      emails: ['maya@example.com', 'other@example.com'],
    }),
    'maya@example.com'
  );
});

test('skips blank email addresses before the unknown label', () => {
  assert.equal(
    clerkDisplayName({
      firstName: null,
      lastName: null,
      username: null,
      emails: ['', 'maya@example.com'],
    }),
    'maya@example.com'
  );
});

test('falls back to the unknown label when Clerk sends no identity signal', () => {
  assert.equal(UNKNOWN_USER_NAME, 'Unknown user');
  assert.equal(
    clerkDisplayName({ firstName: null, lastName: null, username: null, emails: [] }),
    UNKNOWN_USER_NAME
  );
});

// ---------------------------------------------------------------------------
// Stored values: legacy rows from the old sync must render sensibly.
// ---------------------------------------------------------------------------

test('a stored legacy "null null" renders as the unknown label', () => {
  assert.equal(storedDisplayName('null null'), UNKNOWN_USER_NAME);
  assert.equal(storedDisplayName('null'), UNKNOWN_USER_NAME);
  assert.equal(storedDisplayName('undefined undefined'), UNKNOWN_USER_NAME);
});

test('a stored partial legacy name drops the null token', () => {
  assert.equal(storedDisplayName('Maya null'), 'Maya');
  assert.equal(storedDisplayName('null Chen'), 'Chen');
});

test('a stored blank name renders as the unknown label', () => {
  assert.equal(storedDisplayName(''), UNKNOWN_USER_NAME);
  assert.equal(storedDisplayName('   '), UNKNOWN_USER_NAME);
});

test('stored real names pass through trimmed', () => {
  assert.equal(storedDisplayName('Maya Chen'), 'Maya Chen');
  assert.equal(storedDisplayName('  Maya Chen  '), 'Maya Chen');
});
