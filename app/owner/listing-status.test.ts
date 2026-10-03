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

test('uses the destructive tone for rejected and suspended', () => {
  assert.equal(getStatusChip('rejected').variant, 'destructive');
  assert.equal(getStatusChip('suspended').variant, 'destructive');
});

test('uses the outline tone for a draft', () => {
  assert.equal(getStatusChip('draft').variant, 'outline');
});
