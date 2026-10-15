import assert from 'node:assert/strict';
import test from 'node:test';

import { getPhotoSlotLabels } from './editor-photo-slots.ts';

test('renders three empty photo placeholders when no photos exist', () => {
  assert.deepEqual(getPhotoSlotLabels(0), ['+', '+', '+']);
});

test('labels existing photos and keeps empty placeholders up to three slots', () => {
  assert.deepEqual(getPhotoSlotLabels(1), ['Photo 1', '+', '+']);
});

test('adds no extra placeholders when the gallery has at least three photos', () => {
  assert.deepEqual(getPhotoSlotLabels(4), ['Photo 1', 'Photo 2', 'Photo 3', 'Photo 4']);
});
