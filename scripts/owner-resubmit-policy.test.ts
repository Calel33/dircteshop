#!/usr/bin/env node
/**
 * Pins the B3a (issue #12, todo #6) owner resubmit-policy and patch-guard
 * regressions that `scripts/owner-save-policy.test.ts` does not already cover.
 *
 * `approvedResubmitTarget` is the derived target for the atomic approved-identity
 * re-review (`saveAndResubmit`). It must fail closed for every non-approved
 * status and stay anchored to `STATUS_TRANSITIONS`, so a table change can never
 * silently open a second re-review path.
 *
 * The generic owner `submitForReview` action is refused for an approved listing
 * at the handler level (`convex/businesses/mutations.ts` `assertTransitionAllowed`).
 * That guard needs a Convex runtime and this repo has no `convex-test`
 * dependency, so the refusal is pinned here through the derived-target contract
 * rather than executed.
 *
 * Run: node --test scripts/owner-resubmit-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EDITABLE_FIELD_CLASS } from '../convex/businessTypes.ts';
import {
  STATUS_TRANSITIONS,
  approvedResubmitTarget,
  resolveTransition,
} from '../convex/businesses/helpers.ts';
import {
  changedCoreIdentityFields,
  findUnknownPatchFields,
  persistableSaveFields,
} from '../convex/businesses/ownerSavePolicy.ts';

const classMap = EDITABLE_FIELD_CLASS;
const allStatuses = Object.keys(STATUS_TRANSITIONS) as (keyof typeof STATUS_TRANSITIONS)[];

test('approvedResubmitTarget resolves approved listings to pendingReview', () => {
  assert.equal(approvedResubmitTarget('approved'), 'pendingReview');
});

test('approvedResubmitTarget fails closed for every non-approved status', () => {
  for (const status of allStatuses) {
    if (status === 'approved') {
      continue;
    }
    assert.equal(
      approvedResubmitTarget(status),
      undefined,
      `${status} must have no approved-identity resubmit target`
    );
  }
});

test('approvedResubmitTarget stays derived from the source-of-truth table', () => {
  for (const status of allStatuses) {
    const derived =
      status === 'approved'
        ? resolveTransition('approved', 'submitForReview')?.targetStatus
        : undefined;
    assert.equal(
      approvedResubmitTarget(status),
      derived,
      `approvedResubmitTarget(${status}) drifted from resolveTransition`
    );
  }
  assert.ok(STATUS_TRANSITIONS.approved.includes('pendingReview'));
});

test('owner re-review re-enters the queue instead of an admin moderation outcome', () => {
  // An approved listing may only be suspended by an admin; approve/requestChanges/
  // reject/restore are illegal, so the owner path cannot short-circuit to them.
  for (const adminAction of ['approve', 'requestChanges', 'reject', 'restore'] as const) {
    assert.equal(
      resolveTransition('approved', adminAction),
      undefined,
      `${adminAction} must not be a legal transition from an approved listing`
    );
  }
  assert.equal(resolveTransition('approved', 'suspend')?.requiredRole, 'superAdmin');
});

test('patch guard fails closed on an empty or unknown-only patch', () => {
  assert.deepStrictEqual(findUnknownPatchFields(classMap, {}), []);
  assert.deepStrictEqual(findUnknownPatchFields(classMap, { ownerId: 'users_1' }), ['ownerId']);
});

test('persistableSaveFields preserves order without mutating the input', () => {
  const provided = ['phone', 'name', 'hours'] as const;

  assert.deepStrictEqual(persistableSaveFields('persistContent', classMap, provided), [
    'phone',
    'hours',
  ]);
  assert.deepStrictEqual(provided, ['phone', 'name', 'hours']);
  assert.deepStrictEqual(persistableSaveFields('persistAll', classMap, []), []);
});

// A persisted approved listing used as the "no change" baseline. `address` omits
// every optional part so the equality rules can be pinned against real omissions.
const persistedBusiness = {
  name: 'Acme Coffee',
  categoryId: 'categories_1',
  description: 'A neighborhood cafe',
  address: {
    addressLine1: '1 Main St',
    city: 'Austin',
    state: 'TX',
    country: 'US',
  },
};

test('changedCoreIdentityFields reports nothing when every supplied core field matches', () => {
  const patch = {
    name: 'Acme Coffee',
    categoryId: 'categories_1',
    description: 'A neighborhood cafe',
    address: { addressLine1: '1 Main St', city: 'Austin', state: 'TX', country: 'US' },
  };

  assert.deepStrictEqual(changedCoreIdentityFields(classMap, patch, persistedBusiness), []);
});

test('changedCoreIdentityFields treats a whitespace-padded name as unchanged', () => {
  assert.deepStrictEqual(
    changedCoreIdentityFields(classMap, { name: '  Acme Coffee  ' }, persistedBusiness),
    []
  );

  const legacyUntrimmed = { ...persistedBusiness, name: ' Acme Coffee ' };
  assert.deepStrictEqual(
    changedCoreIdentityFields(classMap, { name: 'Acme Coffee' }, legacyUntrimmed),
    []
  );
});

test('changedCoreIdentityFields detects changed name, description and categoryId', () => {
  assert.deepStrictEqual(
    changedCoreIdentityFields(classMap, { name: 'Acme Roasters' }, persistedBusiness),
    ['name']
  );
  assert.deepStrictEqual(
    changedCoreIdentityFields(classMap, { description: 'Now roasting' }, persistedBusiness),
    ['description']
  );
  assert.deepStrictEqual(
    changedCoreIdentityFields(classMap, { categoryId: 'categories_2' }, persistedBusiness),
    ['categoryId']
  );
});

test('changedCoreIdentityFields lists every supplied core field that differs', () => {
  const patch = {
    name: 'Acme Roasters',
    categoryId: 'categories_1',
    description: 'Now roasting',
  };

  assert.deepStrictEqual(changedCoreIdentityFields(classMap, patch, persistedBusiness).sort(), [
    'description',
    'name',
  ]);
});

test('changedCoreIdentityFields ignores content fields', () => {
  const patch = { phone: '555-0100', hours: {}, tags: ['coffee'] };

  assert.deepStrictEqual(changedCoreIdentityFields(classMap, patch, persistedBusiness), []);
});

test('changedCoreIdentityFields treats omitted and empty optional address parts as equal', () => {
  const omitted = {
    address: { addressLine1: '1 Main St', city: 'Austin', state: 'TX', country: 'US' },
  };
  const emptied = {
    address: {
      addressLine1: '1 Main St',
      addressLine2: '',
      city: 'Austin',
      state: 'TX',
      postalCode: '',
      country: 'US',
    },
  };

  assert.deepStrictEqual(changedCoreIdentityFields(classMap, omitted, persistedBusiness), []);
  assert.deepStrictEqual(changedCoreIdentityFields(classMap, emptied, persistedBusiness), []);
});

test('changedCoreIdentityFields trims required address parts before comparing', () => {
  const patch = {
    address: {
      addressLine1: '  1 Main St ',
      city: ' Austin',
      state: 'TX ',
      country: ' US',
    },
  };

  assert.deepStrictEqual(changedCoreIdentityFields(classMap, patch, persistedBusiness), []);
});

test('changedCoreIdentityFields compares coordinates strictly when present', () => {
  const geocodedBusiness = {
    ...persistedBusiness,
    address: { ...persistedBusiness.address, latitude: 30.27, longitude: -97.74 },
  };

  assert.deepStrictEqual(
    changedCoreIdentityFields(
      classMap,
      { address: { ...geocodedBusiness.address } },
      geocodedBusiness
    ),
    []
  );
  assert.deepStrictEqual(
    changedCoreIdentityFields(
      classMap,
      { address: { ...geocodedBusiness.address, latitude: 30.28 } },
      geocodedBusiness
    ),
    ['address']
  );
  assert.deepStrictEqual(
    changedCoreIdentityFields(
      classMap,
      { address: { ...persistedBusiness.address, latitude: 30.27, longitude: -97.74 } },
      persistedBusiness
    ),
    ['address']
  );
});

test('an unchanged-only core patch yields no changed fields (the rejection condition)', () => {
  assert.deepStrictEqual(
    changedCoreIdentityFields(classMap, { name: 'Acme Coffee' }, persistedBusiness),
    []
  );
});
