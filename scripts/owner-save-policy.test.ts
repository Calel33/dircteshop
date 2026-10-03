#!/usr/bin/env node
/**
 * Pins the B3a (issue #12) owner save/submit decision logic for todo #5.
 *
 * `convex/businesses/ownerSavePolicy.ts` is a pure module (no Convex runtime
 * imports), so the patch classification, status gates, unknown-key handling and
 * moderation-reason policy can be asserted without a Convex runtime (runtime DB
 * tests are unavailable in this repo; see tasks/issue-12-todo.md #3/#5).
 *
 * Run: node --test scripts/owner-save-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EDITABLE_FIELD_CLASS } from '../convex/businessTypes.ts';
import { approvedResubmitTarget, STATUS_TRANSITIONS } from '../convex/businesses/helpers.ts';
import {
  OWNER_MODERATION_REASON_POLICY,
  findUnknownPatchFields,
  hasCoreIdentityField,
  isBlankPatchName,
  isEditableBusinessField,
  normalizePatchName,
  ownerSaveMode,
  ownerSubmitClearsModeration,
  persistableSaveFields,
  providedEditableFields,
} from '../convex/businesses/ownerSavePolicy.ts';

const classMap = EDITABLE_FIELD_CLASS;
const allEditableFields = Object.keys(classMap) as (keyof typeof classMap)[];
const coreFields = ['name', 'categoryId', 'description', 'address'] as const;
const contentFields = ['hours', 'phone', 'email', 'website', 'tags', 'amenities'] as const;

test('read-only statuses cannot be saved by the owner', () => {
  for (const status of ['pendingReview', 'suspended', 'rejected'] as const) {
    assert.equal(ownerSaveMode(status), 'reject', `${status} must refuse owner saves`);
    assert.deepStrictEqual(persistableSaveFields('reject', classMap, allEditableFields), []);
  }
});

test('editable non-approved statuses persist every editable field', () => {
  for (const status of ['draft', 'changesRequested'] as const) {
    assert.equal(
      ownerSaveMode(status),
      'persistAll',
      `${status} must persist every editable field`
    );
    assert.deepStrictEqual(
      persistableSaveFields('persistAll', classMap, allEditableFields),
      allEditableFields
    );
  }
});

test('approved statuses persist content only and stage core identity client-side', () => {
  assert.equal(ownerSaveMode('approved'), 'persistContent');
  assert.deepStrictEqual(persistableSaveFields('persistContent', classMap, allEditableFields), [
    ...contentFields,
  ]);
  for (const core of coreFields) {
    assert.deepStrictEqual(
      persistableSaveFields('persistContent', classMap, [core]),
      [],
      `${core} must be staged client-side on an approved listing`
    );
  }
});

test('classifies editable vs non-editable keys from the frozen allowlist', () => {
  assert.equal(isEditableBusinessField(classMap, 'name'), true);
  assert.equal(isEditableBusinessField(classMap, 'amenities'), true);
  assert.equal(isEditableBusinessField(classMap, 'status'), false);
  assert.equal(isEditableBusinessField(classMap, 'searchText'), false);
});

test('rejects unknown or server-owned patch keys (never patchable)', () => {
  const patch = { name: 'Acme', status: 'approved', ownerId: 'users_1', searchText: 'x' };

  assert.deepStrictEqual(findUnknownPatchFields(classMap, patch).sort(), [
    'ownerId',
    'searchText',
    'status',
  ]);
  assert.deepStrictEqual(findUnknownPatchFields(classMap, { name: 'Acme' }), []);
});

test('treats omitted/undefined values as not provided', () => {
  const patch = { name: 'Acme', phone: undefined, status: 'approved', tags: ['coffee'] };

  assert.deepStrictEqual(providedEditableFields(classMap, patch), ['name', 'tags']);
});

test('detects whether a patch carries a core identity field', () => {
  assert.equal(hasCoreIdentityField(classMap, [...contentFields]), false);
  assert.equal(hasCoreIdentityField(classMap, ['hours', 'name']), true);
  assert.equal(hasCoreIdentityField(classMap, []), false);
});

test('normalizePatchName trims supplied names and treats omission as undefined', () => {
  assert.equal(normalizePatchName({}), undefined);
  assert.equal(normalizePatchName({ name: undefined }), undefined);
  assert.equal(normalizePatchName({ name: 'Acme' }), 'Acme');
  assert.equal(normalizePatchName({ name: '  Acme  ' }), 'Acme');
  assert.equal(normalizePatchName({ name: '   ' }), '');
});

test('isBlankPatchName flags only a supplied whitespace-only name', () => {
  assert.equal(isBlankPatchName({}), false);
  assert.equal(isBlankPatchName({ name: undefined }), false);
  assert.equal(isBlankPatchName({ name: 'Acme' }), false);
  assert.equal(isBlankPatchName({ name: '  ' }), true);
  assert.equal(isBlankPatchName({ name: '\t\n ' }), true);
});

test('derives the approved re-review target from the state machine', () => {
  assert.equal(approvedResubmitTarget('approved'), 'pendingReview');
  assert.equal(approvedResubmitTarget('draft'), undefined);
  assert.equal(approvedResubmitTarget('pendingReview'), undefined);
  // The derivation must stay anchored to the single source-of-truth table.
  assert.ok(STATUS_TRANSITIONS.approved.includes('pendingReview'));
});

/**
 * §9.1/§9.2 decisions (tasks/issue-12-contract.md). Chosen conservative
 * retention: an owner submit/revise never clears moderation metadata, matching
 * the existing `transition` behavior; owner banners must key off `status` and
 * read the reason only for `changesRequested`/`rejected`.
 */
test('retains moderation reasons across owner submit and revise', () => {
  assert.equal(OWNER_MODERATION_REASON_POLICY.onOwnerSubmit, 'retain');
  assert.equal(OWNER_MODERATION_REASON_POLICY.onOwnerRevise, 'retain');
  assert.equal(ownerSubmitClearsModeration(), false);
});
