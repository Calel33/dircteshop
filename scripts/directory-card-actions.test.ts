#!/usr/bin/env node
/**
 * Pins the B4 directory card action cap (issue #4, todo task 5).
 *
 * SPEC §8: one shared `BusinessCard` whose actions are capped at 2 and only
 * ever render working destinations — the public profile, a `tel:` link, or a
 * scheme-guarded website. Booking/order/quote workflow actions stay deferred
 * to their own tickets and must never appear here.
 *
 * Run: node --test scripts/directory-card-actions.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DIRECTORY_CARD_ACTION_LIMIT,
  resolveDirectoryCardActions,
} from '../components/directory/card-actions.ts';

test('every card renders at most two actions', () => {
  const variants = [
    { _id: 'businesses_1', phone: '555-0100', website: 'https://acme.test' },
    { _id: 'businesses_2' },
    { _id: 'businesses_3', website: 'https://acme.test' },
  ];

  for (const business of variants) {
    assert.ok(
      resolveDirectoryCardActions(business).length <= DIRECTORY_CARD_ACTION_LIMIT,
      `${business._id} must not exceed the action cap`
    );
  }
});

test('the profile action is always first and links to the public profile', () => {
  const [first] = resolveDirectoryCardActions({ _id: 'businesses_1' });

  assert.deepStrictEqual(first, { kind: 'profile', href: '/business/businesses_1' });
});

test('a phone number wins the second slot as a tel: link', () => {
  const actions = resolveDirectoryCardActions({
    _id: 'businesses_1',
    phone: '+1 555 0100',
    website: 'https://acme.test',
  });

  assert.deepStrictEqual(actions, [
    { kind: 'profile', href: '/business/businesses_1' },
    { kind: 'call', href: 'tel:+1 555 0100' },
  ]);
});

test('a safe website fills the second slot when no phone exists', () => {
  const actions = resolveDirectoryCardActions({
    _id: 'businesses_1',
    website: 'https://acme.test',
  });

  assert.deepStrictEqual(actions, [
    { kind: 'profile', href: '/business/businesses_1' },
    { kind: 'website', href: 'https://acme.test' },
  ]);
});

test('an unsafe website scheme is never rendered as an action', () => {
  for (const website of ['javascript:alert(1)', 'data:text/html,x', 'not a url']) {
    const actions = resolveDirectoryCardActions({ _id: 'businesses_1', website });
    assert.deepStrictEqual(actions, [{ kind: 'profile', href: '/business/businesses_1' }]);
  }
});

test('a blank phone counts as absent and falls through to the website', () => {
  const actions = resolveDirectoryCardActions({
    _id: 'businesses_1',
    phone: '   ',
    website: 'https://acme.test',
  });

  assert.deepStrictEqual(actions, [
    { kind: 'profile', href: '/business/businesses_1' },
    { kind: 'website', href: 'https://acme.test' },
  ]);
});

test('no contact info leaves only the profile action', () => {
  const actions = resolveDirectoryCardActions({ _id: 'businesses_1' });

  assert.deepStrictEqual(actions, [{ kind: 'profile', href: '/business/businesses_1' }]);
});
