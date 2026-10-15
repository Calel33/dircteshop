import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ListingStatus } from '@/convex/businesses/helpers';

import { getStatusChip } from './listing-status.ts';

// Pinned to the six statuses in `listingStatusValidator` (convex/businessTypes.ts,
// SPEC §5). If the state machine grows a status, this list and the chip map must
// grow together.
const ALL_STATUSES: ListingStatus[] = [
  'draft',
  'pendingReview',
  'approved',
  'changesRequested',
  'rejected',
  'suspended',
];

test('maps every listing status to a human label and description', () => {
  for (const status of ALL_STATUSES) {
    const chip = getStatusChip(status);
    assert.ok(chip.label.length > 0, `${status} has a label`);
    assert.ok(chip.description.length > 0, `${status} has a description`);
  }
});

test('gives each status a distinct label', () => {
  const labels = ALL_STATUSES.map((status) => getStatusChip(status).label);
  assert.equal(new Set(labels).size, ALL_STATUSES.length);
});

test('paints changesRequested and rejected with the red (destructive) tone', () => {
  assert.match(getStatusChip('changesRequested').className, /red/);
  assert.match(getStatusChip('rejected').className, /red/);
});

test('paints draft and suspended with the muted tone', () => {
  assert.match(getStatusChip('draft').className, /muted/);
  assert.match(getStatusChip('suspended').className, /muted/);
});

test('gives every status a distinct, status-dependent card action label', () => {
  assert.equal(getStatusChip('draft').actionLabel, 'Continue editing');
  assert.equal(getStatusChip('pendingReview').actionLabel, 'View (read-only)');
  assert.equal(getStatusChip('approved').actionLabel, 'Edit listing');
  assert.equal(getStatusChip('changesRequested').actionLabel, 'Fix & resubmit');
  assert.equal(getStatusChip('rejected').actionLabel, 'Revise & resubmit');
  assert.equal(getStatusChip('suspended').actionLabel, 'View listing');
});
