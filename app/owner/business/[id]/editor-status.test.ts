#!/usr/bin/env node
/**
 * Pins the pure owner-editor status logic for issue #12 / B3a (todo #10):
 * action availability per status, banner-state mapping (with the §9.1
 * moderation-reason policy), and the saved/status history derivation.
 *
 * Run: node --test "app/owner/business/[id]/editor-status.test.ts"
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ListingStatus } from '../../../../convex/businesses/helpers.ts';
import {
  deriveHistoryEntries,
  getPrimaryAction,
  getPrimaryActionLabel,
  getSaveActionLabel,
  getSaveAvailability,
  getStatusBanner,
  isEditableStatus,
} from './editor-status.ts';

test('marks only draft, changesRequested, and approved as editable', () => {
  const expected: Record<ListingStatus, boolean> = {
    draft: true,
    changesRequested: true,
    approved: true,
    pendingReview: false,
    rejected: false,
    suspended: false,
  };

  for (const status of Object.keys(expected) as ListingStatus[]) {
    assert.equal(isEditableStatus(status), expected[status], `${status} editability`);
  }
});

test('selects the single primary action for each status', () => {
  assert.equal(
    getPrimaryAction({ status: 'draft', coreStaged: false, contentDirty: false }),
    'submit'
  );
  assert.equal(
    getPrimaryAction({ status: 'changesRequested', coreStaged: false, contentDirty: false }),
    'submit'
  );
  assert.equal(
    getPrimaryAction({ status: 'rejected', coreStaged: false, contentDirty: false }),
    'revise'
  );
  assert.equal(
    getPrimaryAction({ status: 'approved', coreStaged: true, contentDirty: false }),
    'resubmit'
  );
  assert.equal(
    getPrimaryAction({ status: 'approved', coreStaged: true, contentDirty: true }),
    'resubmit'
  );
  assert.equal(
    getPrimaryAction({ status: 'approved', coreStaged: false, contentDirty: true }),
    'publish'
  );
  assert.equal(
    getPrimaryAction({ status: 'approved', coreStaged: false, contentDirty: false }),
    null
  );
  assert.equal(
    getPrimaryAction({ status: 'pendingReview', coreStaged: false, contentDirty: false }),
    null
  );
  assert.equal(
    getPrimaryAction({ status: 'suspended', coreStaged: false, contentDirty: false }),
    null
  );
});

test('offers a Publish changes primary only for approved content-only edits', () => {
  assert.equal(
    getPrimaryAction({ status: 'approved', coreStaged: false, contentDirty: true }),
    'publish'
  );
  assert.equal(
    getPrimaryAction({ status: 'approved', coreStaged: true, contentDirty: true }),
    'resubmit'
  );
  assert.equal(
    getPrimaryAction({ status: 'approved', coreStaged: false, contentDirty: false }),
    null
  );
});

test('uses distinct, user-facing primary-action labels', () => {
  assert.equal(getPrimaryActionLabel('submit'), 'Submit for approval');
  assert.equal(getPrimaryActionLabel('resubmit'), 'Submit changes for review');
  assert.equal(getPrimaryActionLabel('revise'), 'Revise listing');
  assert.equal(getPrimaryActionLabel('publish'), 'Publish changes');
});

test('labels the save button by status — approved listings say "Save changes"', () => {
  assert.equal(getSaveActionLabel('approved'), 'Save changes');
  assert.equal(getSaveActionLabel('draft'), 'Save draft');
  assert.equal(getSaveActionLabel('changesRequested'), 'Save draft');
  assert.equal(getSaveActionLabel('pendingReview'), 'Save draft');
  assert.equal(getSaveActionLabel('rejected'), 'Save draft');
  assert.equal(getSaveActionLabel('suspended'), 'Save draft');
});

test('enables Publish changes exactly when savable content edits exist', () => {
  assert.deepStrictEqual(
    getSaveAvailability({
      readOnly: false,
      busy: false,
      savableCount: 2,
      saveNameError: null,
      primaryAction: 'publish',
      primaryNameError: null,
    }),
    { canSave: true, canRunPrimary: true }
  );

  // Publish persists content only, so a staged core name error never gates it.
  assert.equal(
    getSaveAvailability({
      readOnly: false,
      busy: false,
      savableCount: 1,
      saveNameError: null,
      primaryAction: 'publish',
      primaryNameError: 'Business name is required.',
    }).canRunPrimary,
    true
  );

  assert.equal(
    getSaveAvailability({
      readOnly: false,
      busy: false,
      savableCount: 0,
      saveNameError: null,
      primaryAction: 'publish',
      primaryNameError: null,
    }).canRunPrimary,
    false
  );
});

test('disables both actions while a mutation is in flight', () => {
  assert.deepStrictEqual(
    getSaveAvailability({
      readOnly: false,
      busy: true,
      savableCount: 3,
      saveNameError: null,
      primaryAction: 'submit',
      primaryNameError: null,
    }),
    { canSave: false, canRunPrimary: false }
  );
});

test('enables Save Draft only for editable statuses with savable, valid fields', () => {
  assert.deepStrictEqual(
    getSaveAvailability({
      readOnly: false,
      busy: false,
      savableCount: 2,
      saveNameError: null,
      primaryAction: null,
      primaryNameError: null,
    }),
    { canSave: true, canRunPrimary: false }
  );

  assert.equal(
    getSaveAvailability({
      readOnly: false,
      busy: false,
      savableCount: 0,
      saveNameError: null,
      primaryAction: 'submit',
      primaryNameError: null,
    }).canSave,
    false
  );

  assert.equal(
    getSaveAvailability({
      readOnly: false,
      busy: false,
      savableCount: 1,
      saveNameError: 'Business name is required.',
      primaryAction: null,
      primaryNameError: null,
    }).canSave,
    false
  );
});

test('offers Revise on a read-only rejected listing but never Save Draft', () => {
  const availability = getSaveAvailability({
    readOnly: true,
    busy: false,
    savableCount: 0,
    saveNameError: null,
    primaryAction: 'revise',
    primaryNameError: null,
  });

  assert.deepStrictEqual(availability, { canSave: false, canRunPrimary: true });
});

test('blocks the primary action on its own field validation error', () => {
  assert.equal(
    getSaveAvailability({
      readOnly: false,
      busy: false,
      savableCount: 1,
      saveNameError: null,
      primaryAction: 'submit',
      primaryNameError: 'Business name is required.',
    }).canRunPrimary,
    false
  );
});

test('maps each status to its banner tone, or none', () => {
  assert.equal(getStatusBanner({ status: 'draft' }), null);
  assert.equal(getStatusBanner({ status: 'approved', coreStaged: false }), null);
  assert.equal(getStatusBanner({ status: 'suspended' })?.tone, 'danger');
  assert.equal(getStatusBanner({ status: 'approved', coreStaged: true })?.tone, 'brand');
});

test('surfaces the submission date on the pending banner', () => {
  const pending = getStatusBanner({ status: 'pendingReview', submittedAt: 1_700_000_000_000 });

  assert.equal(pending?.tone, 'info');
  assert.equal(pending?.submittedAt, 1_700_000_000_000);
});

test('includes the moderator reason on the changes-requested and rejected banners', () => {
  const changes = getStatusBanner({ status: 'changesRequested', moderationReason: 'Fix hours' });
  const rejected = getStatusBanner({ status: 'rejected', moderationReason: 'Not eligible' });

  assert.equal(changes?.tone, 'warning');
  assert.match(changes?.message ?? '', /Fix hours/);
  assert.equal(rejected?.tone, 'danger');
  assert.match(rejected?.message ?? '', /Not eligible/);
});

test('reads moderationReason only for changesRequested and rejected', () => {
  const approved = getStatusBanner({
    status: 'approved',
    coreStaged: true,
    moderationReason: 'stale moderator note',
  });
  assert.ok(approved);
  assert.doesNotMatch(approved.message, /stale moderator note/);

  assert.equal(
    getStatusBanner({ status: 'draft', moderationReason: 'stale moderator note' }),
    null
  );
  assert.equal(
    getStatusBanner({ status: 'pendingReview', moderationReason: 'stale moderator note' })
      ?.message.includes('stale moderator note'),
    false
  );
});

test('omits an empty moderation reason from the actioned banners', () => {
  const changes = getStatusBanner({ status: 'changesRequested', moderationReason: '   ' });
  const rejected = getStatusBanner({ status: 'rejected' });

  assert.ok(changes);
  assert.ok(rejected);
  assert.doesNotMatch(changes.message, /undefined/);
  assert.doesNotMatch(rejected.message, /undefined/);
});

test('derives a created-only history from a fresh document', () => {
  assert.deepStrictEqual(
    deriveHistoryEntries({ _creationTime: 1000, lastUpdatedAt: 1000, status: 'draft' }),
    [{ label: 'Listing created', at: 1000 }]
  );
});

test('collapses the generic update entry into the specific event that shares its timestamp', () => {
  const entries = deriveHistoryEntries({
    _creationTime: 1000,
    lastUpdatedAt: 2000,
    lastSavedAt: 2000,
    status: 'draft',
  });

  assert.deepStrictEqual(entries, [
    { label: 'Draft saved', at: 2000 },
    { label: 'Listing created', at: 1000 },
  ]);
});

test('derives submission and moderation entries newest-first without duplicates', () => {
  const entries = deriveHistoryEntries({
    _creationTime: 1000,
    lastUpdatedAt: 5000,
    lastSavedAt: 3000,
    submittedAt: 4000,
    moderatedAt: 5000,
    status: 'changesRequested',
  });

  assert.deepStrictEqual(entries, [
    { label: 'Changes requested by moderator', at: 5000 },
    { label: 'Submitted for review', at: 4000 },
    { label: 'Draft saved', at: 3000 },
    { label: 'Listing created', at: 1000 },
  ]);
});

test('history entries carry only a label and timestamp (no field diffs)', () => {
  const entries = deriveHistoryEntries({
    _creationTime: 1,
    lastUpdatedAt: 2,
    lastSavedAt: 2,
    status: 'draft',
  });

  for (const entry of entries) {
    assert.deepStrictEqual(Object.keys(entry).sort(), ['at', 'label']);
  }
});
