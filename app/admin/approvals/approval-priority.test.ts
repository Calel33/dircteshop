#!/usr/bin/env node
/**
 * Pins the pure presentation helpers behind the `/admin/approvals` queue
 * (issue #13 / B3b todo #4): the age-derived priority band and the humanized
 * submission age. Both derive only from `submittedAt` and a caller-supplied
 * clock, so the server render and the client render agree for the same inputs.
 *
 * Run: node --test app/admin/approvals/approval-priority.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PRIORITY_HIGH_AFTER_HOURS,
  deriveAgePriority,
  formatSubmittedAge,
} from './approval-priority.ts';

const HOUR_MS = 3_600_000;
const NOW = 1_700_000_000_000;

test('exposes the product-approved 48 hour threshold', () => {
  assert.equal(PRIORITY_HIGH_AFTER_HOURS, 48);
});

test('is high priority exactly at the 48 hour boundary', () => {
  assert.equal(deriveAgePriority(NOW - 48 * HOUR_MS, NOW), 'high');
});

test('is normal priority one millisecond below the 48 hour boundary', () => {
  assert.equal(deriveAgePriority(NOW - 48 * HOUR_MS + 1, NOW), 'normal');
});

test('is high priority for a clearly older submission', () => {
  assert.equal(deriveAgePriority(NOW - 5 * 24 * HOUR_MS, NOW), 'high');
});

test('is normal priority for a recent submission', () => {
  assert.equal(deriveAgePriority(NOW - 2 * HOUR_MS, NOW), 'normal');
});

test('is normal priority when submittedAt is undefined', () => {
  assert.equal(deriveAgePriority(undefined, NOW), 'normal');
});

test('never reports high priority for a future timestamp', () => {
  assert.equal(deriveAgePriority(NOW + 10 * HOUR_MS, NOW), 'normal');
});

test('humanizes a very recent submission as "just now"', () => {
  assert.equal(formatSubmittedAge(NOW - 30_000, NOW), 'Submitted just now');
});

test('humanizes whole hours', () => {
  assert.equal(formatSubmittedAge(NOW - HOUR_MS, NOW), 'Submitted 1 hour ago');
  assert.equal(formatSubmittedAge(NOW - 5 * HOUR_MS, NOW), 'Submitted 5 hours ago');
});

test('humanizes whole days from 24 hours upward', () => {
  assert.equal(formatSubmittedAge(NOW - 24 * HOUR_MS, NOW), 'Submitted 1 day ago');
  assert.equal(formatSubmittedAge(NOW - 3 * 24 * HOUR_MS, NOW), 'Submitted 3 days ago');
});

test('reports an unknown submission age when submittedAt is undefined', () => {
  assert.equal(formatSubmittedAge(undefined, NOW), 'Submission date unknown');
});

test('clamps a future timestamp to "just now" instead of a negative age', () => {
  assert.equal(formatSubmittedAge(NOW + HOUR_MS, NOW), 'Submitted just now');
});
