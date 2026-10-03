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
