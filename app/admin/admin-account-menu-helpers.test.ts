#!/usr/bin/env node
/**
 * Pins the identity derivation behind the admin account menu (PR #69 / T5).
 * The module has no React or Clerk imports, so `node --test` can reach it;
 * these cases are the strings the menu rendered before the helpers moved out
 * of `admin-account-menu.tsx`.
 *
 * Run: node --test app/admin/admin-account-menu-helpers.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  accountEmail,
  accountInitials,
  accountName,
  initials,
} from './admin-account-menu-helpers.ts';

test('initials falls back to A when the name is absent or blank', () => {
  assert.equal(initials(null), 'A');
  assert.equal(initials(undefined), 'A');
  assert.equal(initials('   '), 'A');
});

test('initials uses the first two letters of a single word, uppercased', () => {
  assert.equal(initials('maya'), 'MA');
  assert.equal(initials('  Maya  '), 'MA');
});

test('initials uses the first and last word initials', () => {
  assert.equal(initials('Maya Chen'), 'MC');
  assert.equal(initials('Maya Lopez Chen'), 'MC');
});

test('accountName prefers full name, then username, then the admin fallback', () => {
  assert.equal(accountName({ fullName: 'Maya Chen', username: 'maya.chen' }), 'Maya Chen');
  assert.equal(accountName({ fullName: null, username: 'maya.chen' }), 'maya.chen');
  assert.equal(accountName({ fullName: null, username: null }), 'Super Admin');
  assert.equal(accountName(null), 'Super Admin');
  assert.equal(accountName(undefined), 'Super Admin');
});

test('accountEmail falls back to Signed in when no email is present', () => {
  assert.equal(
    accountEmail({ primaryEmailAddress: { emailAddress: 'maya@example.com' } }),
    'maya@example.com'
  );
  assert.equal(accountEmail({ primaryEmailAddress: null }), 'Signed in');
  assert.equal(accountEmail(null), 'Signed in');
});

test('accountInitials follows the same fallback order as accountName and accountEmail', () => {
  assert.equal(accountInitials({ fullName: 'Maya Chen', username: 'maya.chen' }), 'MC');
  assert.equal(accountInitials({ fullName: null, username: 'maya.chen' }), 'MA');
  assert.equal(
    accountInitials({
      fullName: null,
      username: null,
      primaryEmailAddress: { emailAddress: 'maya@example.com' },
    }),
    'MA'
  );
  assert.equal(accountInitials({ fullName: null, username: null, primaryEmailAddress: null }), 'A');
});
