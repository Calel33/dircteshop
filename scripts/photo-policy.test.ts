#!/usr/bin/env node
/**
 * Pins the B7 (issue #7) photo policy: the upload limits recorded on the issue,
 * the client-facing rejection messages, and the ordering/alt/dedupe
 * normalization applied on save.
 *
 * `convex/businesses/photoPolicy.ts` is a pure module (type-only imports), so
 * these rules are assertable without a Convex runtime, like
 * `scripts/owner-save-policy.test.ts`.
 *
 * Run: node --test scripts/photo-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BusinessPhoto } from '../components/profile/profile-types.ts';
import {
  PHOTO_LIMITS,
  assertPhotosCount,
  invalidReasonForFile,
  normalizePhotos,
} from '../convex/businesses/photoPolicy.ts';

function storedPhoto(storageId: string, altText?: string, ordering = 0): BusinessPhoto {
  return {
    storageId: storageId as BusinessPhoto['storageId'],
    ...(altText === undefined ? {} : { altText }),
    ordering,
  };
}

function storedPhotos(count: number): BusinessPhoto[] {
  return Array.from({ length: count }, (_, index) => storedPhoto(`storage_${index}`));
}

test('pins the upload limits recorded on issue #7', () => {
  assert.equal(PHOTO_LIMITS.maxBytes, 5 * 1024 * 1024);
  assert.deepStrictEqual([...PHOTO_LIMITS.types], ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(PHOTO_LIMITS.maxPhotos, 12);
  assert.equal(PHOTO_LIMITS.maxAltLength, 200);
  assert.ok(Object.isFrozen(PHOTO_LIMITS), 'limits must be frozen');
  assert.ok(Object.isFrozen(PHOTO_LIMITS.types), 'allowed types must be frozen');
});

test('accepts jpeg, png and webp files up to the byte limit', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    const reason = invalidReasonForFile({
      name: 'photo',
      size: PHOTO_LIMITS.maxBytes,
      type,
    });
    assert.equal(reason, null, `${type} at the limit must be accepted`);
  }
});

test('rejects a file over the byte limit and names the limit in MiB', () => {
  const reason = invalidReasonForFile({
    name: 'large.jpg',
    size: PHOTO_LIMITS.maxBytes + 1,
    type: 'image/jpeg',
  });

  assert.ok(reason !== null);
  assert.match(reason, /5\.0 MB/);
});

test('formats a non-whole-MiB limit with one decimal instead of floating noise', () => {
  const reason = invalidReasonForFile(
    { name: 'large.jpg', size: 5_000_001, type: 'image/jpeg' },
    { ...PHOTO_LIMITS, maxBytes: 5_000_000 }
  );

  assert.ok(reason !== null);
  assert.match(reason, /4\.8 MB/);
  assert.doesNotMatch(reason, /4\.768/);
});

test('rejects a non-finite size instead of soft-passing it', () => {
  for (const size of [NaN, -Infinity]) {
    const reason = invalidReasonForFile({ name: 'photo.jpg', size, type: 'image/jpeg' });

    assert.ok(reason !== null, `size ${String(size)} must be rejected`);
    assert.match(reason, /empty/i);
  }

  const infinite = invalidReasonForFile({ name: 'photo.jpg', size: Infinity, type: 'image/jpeg' });
  assert.ok(infinite !== null);
  assert.match(infinite, /5\.0 MB/);
});

test('caps alt text on code points so an emoji at the boundary is never split', () => {
  const [capped] = normalizePhotos([
    storedPhoto('storage_emoji', 'x'.repeat(PHOTO_LIMITS.maxAltLength - 1) + '🎉'),
  ]);

  assert.equal(Array.from(capped.altText ?? '').length, PHOTO_LIMITS.maxAltLength);
  assert.ok(capped.altText?.isWellFormed(), 'no lone surrogate may survive the cap');
  assert.equal(JSON.parse(JSON.stringify(capped.altText)), capped.altText);
});

test('checks the count after dedupe, so 13 raw entries with a duplicate are allowed', () => {
  const raw = [...storedPhotos(12), storedPhoto('storage_0', 'Duplicate')];
  const normalized = normalizePhotos(raw);

  assert.equal(normalized.length, 12);
  assert.equal(assertPhotosCount(normalized), null);
  // Counting before dedupe would falsely reject a legitimate 12-photo listing.
  assert.ok(assertPhotosCount(raw) !== null);
});

test('rejects a disallowed MIME type', () => {
  const reason = invalidReasonForFile({ name: 'animation.gif', size: 1024, type: 'image/gif' });

  assert.ok(reason !== null);
  assert.match(reason, /JPEG, PNG or WebP/);
});

test('rejects a missing MIME type instead of passing it through', () => {
  for (const type of [undefined, null, '']) {
    const reason = invalidReasonForFile({ name: 'photo.jpg', size: 1024, type });

    assert.ok(reason !== null, `type ${String(type)} must be rejected`);
    assert.match(reason, /JPEG, PNG or WebP/);
  }
});

test('rejects an empty file', () => {
  const reason = invalidReasonForFile({ name: 'empty.jpg', size: 0, type: 'image/jpeg' });

  assert.ok(reason !== null);
  assert.match(reason, /empty/i);
});

test('trims alt text and caps it at the limit', () => {
  const [trimmed, capped, missing] = normalizePhotos([
    storedPhoto('storage_trim', '  Storefront  '),
    storedPhoto('storage_cap', 'a'.repeat(PHOTO_LIMITS.maxAltLength + 50)),
    storedPhoto('storage_none'),
  ]);

  assert.equal(trimmed.altText, 'Storefront');
  assert.equal(capped.altText?.length, PHOTO_LIMITS.maxAltLength);
  assert.equal(capped.altText, 'a'.repeat(PHOTO_LIMITS.maxAltLength));
  assert.equal('altText' in missing, false, 'absent alt text stays absent');
});

test('collapses blank alt text to absent so the business-name fallback applies', () => {
  const [blank, whitespace] = normalizePhotos([
    storedPhoto('storage_blank', ''),
    storedPhoto('storage_spaces', '   '),
  ]);

  assert.equal('altText' in blank, false, "'' must not be stored (WCAG SC 1.1.1)");
  assert.equal('altText' in whitespace, false, 'whitespace-only alt must not be stored');
});

test('re-stamps ordering to the array index', () => {
  const normalized = normalizePhotos([
    storedPhoto('storage_a', undefined, 9),
    storedPhoto('storage_b', undefined, 9),
    storedPhoto('storage_c', undefined, 9),
  ]);

  assert.deepStrictEqual(
    normalized.map((photo) => photo.ordering),
    [0, 1, 2]
  );
});

test('drops duplicate storage ids and keeps the first', () => {
  const normalized = normalizePhotos([
    storedPhoto('storage_a', 'First'),
    storedPhoto('storage_b', 'Second'),
    storedPhoto('storage_a', 'Duplicate'),
  ]);

  assert.deepStrictEqual(
    normalized.map((photo) => photo.storageId),
    ['storage_a', 'storage_b']
  );
  assert.equal(normalized[0].altText, 'First');
  assert.deepStrictEqual(
    normalized.map((photo) => photo.ordering),
    [0, 1]
  );
});

test('does not mutate the input array or its photos', () => {
  const input = [
    storedPhoto('storage_a', '  Storefront  ', 7),
    storedPhoto('storage_b', '  Entrance  ', 8),
  ];
  const snapshot = structuredClone(input);

  const normalized = normalizePhotos(input);

  assert.deepStrictEqual(input, snapshot, 'input photos must be untouched');
  assert.notStrictEqual(normalized, input, 'result must be a fresh array');
  assert.notStrictEqual(normalized[0], input[0], 'result photos must be fresh objects');
});

test('normalizes undefined input to an empty array', () => {
  assert.deepStrictEqual(normalizePhotos(undefined), []);
});

test('allows twelve photos and rejects thirteen', () => {
  assert.equal(assertPhotosCount(storedPhotos(12)), null);
  assert.equal(assertPhotosCount(storedPhotos(0)), null);

  const reason = assertPhotosCount(storedPhotos(13));
  assert.ok(reason !== null);
  assert.match(reason, /12/);
});
