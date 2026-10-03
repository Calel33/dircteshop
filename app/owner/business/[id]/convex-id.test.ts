import assert from 'node:assert/strict';
import { test } from 'node:test';

import { looksLikeConvexId } from './convex-id.ts';

// A Convex document id is Crockford base32 with the lowercase alphabet
// "0123456789abcdefghjkmnpqrstvwxyz" (so no i/l/o/u), encoding an id-v6 payload
// of 19–23 bytes → 31–37 characters.
// Sources:
// https://github.com/get-convex/convex-backend/blob/main/crates/value/src/base32.rs
// https://github.com/get-convex/convex-backend/blob/main/crates/value/src/id_v6.rs
const MIN_LENGTH_ID = 'a'.repeat(31);
const MAX_LENGTH_ID = 'k'.repeat(37);
const REALISTIC_ID = 'j574q1x9z'.padEnd(31, 'a');

test('accepts ids at the shortest and longest valid lengths', () => {
  assert.equal(looksLikeConvexId(MIN_LENGTH_ID), true);
  assert.equal(looksLikeConvexId(MAX_LENGTH_ID), true);
  assert.equal(looksLikeConvexId(REALISTIC_ID), true);
});

test('rejects strings shorter or longer than a Convex id', () => {
  assert.equal(looksLikeConvexId('a'.repeat(30)), false);
  assert.equal(looksLikeConvexId('a'.repeat(38)), false);
  assert.equal(looksLikeConvexId(''), false);
});

test('rejects uppercase characters', () => {
  assert.equal(looksLikeConvexId('A'.repeat(31)), false);
});

test('rejects characters outside the Crockford base32 alphabet', () => {
  // i, l, o and u are excluded from Convex's base32 alphabet.
  assert.equal(looksLikeConvexId(`${'a'.repeat(30)}i`), false);
  assert.equal(looksLikeConvexId(`${'a'.repeat(30)}l`), false);
  assert.equal(looksLikeConvexId(`${'a'.repeat(30)}o`), false);
  assert.equal(looksLikeConvexId(`${'a'.repeat(30)}u`), false);
  assert.equal(looksLikeConvexId(`${'a'.repeat(30)}-`), false);
  assert.equal(looksLikeConvexId(`${'a'.repeat(30)}/`), false);
});
