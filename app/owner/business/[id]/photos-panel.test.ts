#!/usr/bin/env node
/**
 * Pins the pure Photos & Media helpers for issue #7 / B7 (PR #66 T2):
 * upload-response parsing fallbacks, selection capacity accounting, ordering
 * stamps, and owner-facing error extraction.
 *
 * Run: node --test "app/owner/business/[id]/photos-panel.test.ts"
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConvexError } from 'convex/values';

import { normalizePhotos } from '../../../../convex/businesses/photoPolicy.ts';

import {
  messageForError,
  readStorageId,
  stampOrdering,
  validateSelection,
  withAltText,
  type FormPhoto,
} from './photos-panel-helpers.ts';

function file(name: string, size = 10, type = 'image/jpeg'): File {
  return { name, size, type } as unknown as File;
}

function photo(storageId: string, ordering: number, altText?: string): FormPhoto {
  return { storageId, ordering, altText } as unknown as FormPhoto;
}

test('stampOrdering re-stamps ordering to the array index without mutating the input', () => {
  const photos = [photo('s1', 7), photo('s2', 3, 'Second')];

  const stamped = stampOrdering(photos);

  assert.deepStrictEqual(
    stamped.map((item) => item.ordering),
    [0, 1]
  );
  assert.equal(stamped[1].altText, 'Second');
  assert.deepStrictEqual(
    photos.map((item) => item.ordering),
    [7, 3]
  );
});

test('withAltText clears a previous value and keeps typed spaces', () => {
  const existing = photo('s1', 0, 'Storefront');

  const cleared = withAltText(existing, '');

  assert.equal(cleared.altText, '');
  assert.equal(cleared.storageId, existing.storageId);
  assert.equal(withAltText(existing, ' ').altText, ' ');
});

test('a cleared alt text collapses to absent on the save path', () => {
  const cleared = withAltText(photo('s1', 0, 'Storefront'), '');

  assert.deepStrictEqual(normalizePhotos([cleared]), [{ storageId: 's1', ordering: 0 }]);
});

test('readStorageId rejects non-object response bodies', () => {
  assert.equal(readStorageId(42), null);
  assert.equal(readStorageId('storage-1'), null);
  assert.equal(readStorageId(null), null);
  assert.equal(readStorageId(undefined), null);
});

test('readStorageId rejects a missing, empty or non-string storageId', () => {
  assert.equal(readStorageId({}), null);
  assert.equal(readStorageId({ storageId: '' }), null);
  assert.equal(readStorageId({ storageId: 7 }), null);
});

test('readStorageId returns a non-empty storage id', () => {
  assert.equal(readStorageId({ storageId: 's1' }), 's1');
});

test('messageForError prefers the ConvexError owner-facing payload', () => {
  assert.equal(messageForError(new ConvexError('Owner-facing text'), 'fallback'), 'Owner-facing text');
});

test('messageForError reads the message of an object error envelope', () => {
  assert.equal(
    messageForError(
      new ConvexError({ code: 'ORDER_TERMINAL', message: 'This order is already closed.' }),
      'fallback'
    ),
    'This order is already closed.'
  );
});

test('messageForError falls back to a generic Error message', () => {
  assert.equal(messageForError(new Error('Network failed'), 'fallback'), 'Network failed');
});

test('messageForError uses the fallback for blank or non-Error values', () => {
  assert.equal(messageForError(new Error('   '), 'fallback'), 'fallback');
  assert.equal(messageForError('boom', 'fallback'), 'fallback');
});

test('validateSelection rejects the first valid file when the listing is full', () => {
  const result = validateSelection([file('a.jpg')], 0);

  assert.deepStrictEqual(result.accepted, []);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^a\.jpg: listings can have up to 12 photos\./);
});

test('validateSelection accepts the remaining slots and rejects the overflow', () => {
  const result = validateSelection([file('a.jpg'), file('b.jpg'), file('c.jpg')], 2);

  assert.deepStrictEqual(
    result.accepted.map((item) => item.name),
    ['a.jpg', 'b.jpg']
  );
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^c\.jpg: listings can have up to 12 photos\./);
});

test('validateSelection does not spend capacity on rejected files', () => {
  const result = validateSelection([file('bad.gif', 10, 'image/gif'), file('ok.jpg')], 1);

  assert.deepStrictEqual(
    result.accepted.map((item) => item.name),
    ['ok.jpg']
  );
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^bad\.gif: Photos must be a JPEG, PNG or WebP image\./);
});
