#!/usr/bin/env node
/**
 * Pins the B3a (issue #12) editable-field policy: which owner-editable fields
 * are CORE identity (an edit on an approved listing must re-enter review) and
 * which are CONTENT (an edit on an approved listing publishes immediately).
 *
 * The classification is data-only in `convex/businessTypes.ts`. The core set is
 * transcribed from SPEC §5 (`screens/SPEC.md` L90) — "only core identity fields
 * (name, categoryId, address, description) trigger `approved -> pendingReview`".
 *
 * Run: node --test scripts/field-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EDITABLE_FIELD_CLASS } from '../convex/businessTypes.ts';
import * as stateMachine from '../convex/businesses/helpers.ts';

const classification = EDITABLE_FIELD_CLASS;

test('classifies the SPEC §5 core identity fields as "core"', () => {
  const coreFields = ['name', 'categoryId', 'description', 'address'] as const;

  for (const field of coreFields) {
    assert.equal(classification[field], 'core', `${field} must be core identity`);
  }
});

test('classifies the remaining editable fields as "content"', () => {
  const contentFields = ['hours', 'phone', 'email', 'website', 'tags', 'amenities'] as const;

  for (const field of contentFields) {
    assert.equal(classification[field], 'content', `${field} must be content`);
  }
});

test('pins the exact editable allowlist and its classes', () => {
  assert.deepStrictEqual(classification, {
    name: 'core',
    categoryId: 'core',
    description: 'core',
    address: 'core',
    hours: 'content',
    phone: 'content',
    email: 'content',
    website: 'content',
    tags: 'content',
    amenities: 'content',
  });
});

test('excludes non-editable and out-of-scope B3a fields', () => {
  // Server-derived / moderation / vertical fields are never owner-editable.
  const excluded = [
    'status',
    'ownerId',
    'searchText',
    'verification',
    'rating',
    'ratingCount',
    'photos',
    'services',
    'credentials',
    'keywords',
    'timezone',
    'isFeatured',
    'moderationReason',
    'moderatedAt',
    'submittedAt',
  ] as const;

  for (const field of excluded) {
    assert.equal(field in classification, false, `${field} must not be owner-editable`);
  }
});

test('partitions the allowlist into disjoint core and content classes', () => {
  const entries = Object.entries(classification);
  const core = entries.filter(([, klass]) => klass === 'core').map(([field]) => field);
  const content = entries.filter(([, klass]) => klass === 'content').map(([field]) => field);

  // Every class value is one of the two allowed classes.
  for (const [, klass] of entries) {
    assert.ok(klass === 'core' || klass === 'content', `unknown class "${klass}"`);
  }

  // Core and content are disjoint and together form the whole allowlist.
  const overlap = core.filter((field) => content.includes(field));
  assert.deepStrictEqual(overlap, []);
  assert.deepStrictEqual([...core, ...content].sort(), Object.keys(classification).sort());
});

/**
 * The state machine already supports the owner submit/revise actions B3a relies
 * on today. These assertions only pin existing behavior; the atomic
 * approved-identity submit is B3a implementation work (todo #5), not this test.
 */
test('state machine supports owner draft/changes-requested submit', () => {
  assert.deepStrictEqual(stateMachine.resolveTransition('draft', 'submitForReview'), {
    requiredRole: 'owner',
    targetStatus: 'pendingReview',
  });
  assert.deepStrictEqual(stateMachine.resolveTransition('changesRequested', 'submitForReview'), {
    requiredRole: 'owner',
    targetStatus: 'pendingReview',
  });
});

test('state machine exposes approved -> pendingReview for the dedicated resubmit path', () => {
  assert.deepStrictEqual(stateMachine.resolveTransition('approved', 'submitForReview'), {
    requiredRole: 'owner',
    targetStatus: 'pendingReview',
  });
  assert.ok(stateMachine.STATUS_TRANSITIONS.approved.includes('pendingReview'));
});

test('owner rejected re-entry is reopenAsDraft, not a direct resubmit', () => {
  assert.deepStrictEqual(stateMachine.resolveTransition('rejected', 'reopenAsDraft'), {
    requiredRole: 'owner',
    targetStatus: 'draft',
  });
  assert.equal(
    stateMachine.resolveTransition('rejected', 'submitForReview')?.requiredRole,
    'superAdmin'
  );
});
