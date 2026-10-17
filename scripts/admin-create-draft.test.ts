#!/usr/bin/env node
/**
 * Pins the B6a admin draft-for-existing-owner contract (issue #15, Task 6):
 *
 * - An admin-created draft reproduces the B3a `createDraft` defaults exactly
 *   (contract §B7 "reproduces createDraft defaults (mutations.ts L89-109)"):
 *   blank address, `America/New_York`, `draft` status, no verification, zero
 *   ratings, not featured, `lastSavedAt`/`lastUpdatedAt` stamped — and no
 *   moderation/publication state (no `submittedAt`, no reason, no `moderatedAt`).
 * - The creation audit row is `{action: 'createDraft', toStatus: 'draft',
 *   targetName}` with NO `fromStatus` and no reason (contract §B4).
 * - The Clerk owner match is strict: exactly one result must carry the exact
 *   email (trimmed, case-insensitive) and THAT address must be verified; zero
 *   matches is `unknown`, several are `ambiguous`, an unverified or
 *   unverifiable match is `unverified`. No account is ever created and no
 *   email is persisted — the action only maps to an existing local user row.
 *
 * `convex/businesses/adminPolicy.ts` is pure (type-only generated imports), so
 * the decisions are asserted without a live Convex deployment or Clerk SDK.
 * The action (`convex/businesses/adminOwnerActions.ts`) and the internal
 * mutation (`convex/businesses/adminMutations.ts`) wire these into
 * `requireSuperAdmin` + Clerk `getUserList` + the atomic insert; the internal
 * mutation is not client-callable (internalMutation) and the public action
 * accepts no owner id — verified in the authenticated dev check.
 *
 * Run: node --test scripts/admin-create-draft.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Id } from '../convex/_generated/dataModel.ts';
import { buildSearchText } from '../convex/businesses/helpers.ts';
import {
  buildAdminDraftInsert,
  buildCreateDraftAuditLog,
  normalizeAdminDraftName,
  selectExactVerifiedClerkMatch,
} from '../convex/businesses/adminPolicy.ts';

const categoryId = 'categories_1' as Id<'categories'>;
const ownerId = 'users_owner' as Id<'users'>;
const adminId = 'users_admin' as Id<'users'>;
const businessId = 'businesses_new' as Id<'businesses'>;
const NOW = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// Draft defaults: byte-for-byte the B3a `createDraft` shape.
// ---------------------------------------------------------------------------

test('the admin draft name is trimmed and must be non-blank', () => {
  assert.equal(normalizeAdminDraftName('  Acme Coffee  '), 'Acme Coffee');
  assert.equal(normalizeAdminDraftName('Acme Coffee'), 'Acme Coffee');
  assert.throws(() => normalizeAdminDraftName(''), /Business name is required/);
  assert.throws(() => normalizeAdminDraftName('   '), /Business name is required/);
});

test('the admin draft reproduces the B3a createDraft defaults exactly', () => {
  const draft = buildAdminDraftInsert({
    name: 'Acme Coffee',
    categoryId,
    ownerId,
    now: NOW,
  });

  assert.deepStrictEqual(draft, {
    name: 'Acme Coffee',
    categoryId,
    description: '',
    address: { addressLine1: '', city: '', state: '', country: '' },
    photos: [],
    hours: {},
    timezone: 'America/New_York',
    status: 'draft',
    verification: { isVerified: false },
    rating: 0,
    ratingCount: 0,
    services: [],
    credentials: [],
    keywords: [],
    // buildSearchText(name, [], '') = [name, '', ''].join(' ').
    searchText: 'Acme Coffee  ',
    ownerId,
    lastUpdatedAt: NOW,
    isFeatured: false,
    lastSavedAt: NOW,
  });

  // No moderation/publication state on a fresh draft.
  assert.equal('submittedAt' in draft, false);
  assert.equal('moderationReason' in draft, false);
  assert.equal('moderatedAt' in draft, false);

  // Parity with the helpers.ts formula the B3a createDraft mutation uses, so
  // the draft search column can never drift from the shared invariant.
  assert.equal(draft.searchText, buildSearchText('Acme Coffee', [], ''));
});

// ---------------------------------------------------------------------------
// Creation audit row.
// ---------------------------------------------------------------------------

test('the createDraft audit row targets draft with the name snapshot', () => {
  const row = buildCreateDraftAuditLog({
    actorUserId: adminId,
    targetId: businessId,
    targetName: 'Acme Coffee',
    createdAt: NOW,
  });

  assert.deepStrictEqual(row, {
    actorUserId: adminId,
    action: 'createDraft',
    targetType: 'business',
    targetId: businessId,
    toStatus: 'draft',
    targetName: 'Acme Coffee',
    createdAt: NOW,
  });
  assert.equal('fromStatus' in row, false);
  assert.equal('reason' in row, false);
});

// ---------------------------------------------------------------------------
// Clerk owner matching: exactly one exact, verified address.
// ---------------------------------------------------------------------------

/** A structural stand-in for the Clerk Backend `User` shape the action reads. */
function clerkUser(
  id: string,
  addresses: { emailAddress: string; status?: 'verified' | 'unverified' | null }[]
) {
  return {
    id,
    emailAddresses: addresses.map((address) => ({
      emailAddress: address.emailAddress,
      verification: address.status === null ? null : { status: address.status ?? 'verified' },
    })),
  };
}

test('no Clerk result is an unknown account', () => {
  assert.deepStrictEqual(selectExactVerifiedClerkMatch([], 'acme@example.com'), {
    ok: false,
    failure: 'unknown',
  });
});

test('a blank email never matches', () => {
  const users = [clerkUser('user_1', [{ emailAddress: 'acme@example.com' }])];
  assert.deepStrictEqual(selectExactVerifiedClerkMatch(users, '   '), {
    ok: false,
    failure: 'unknown',
  });
});

test('a user without the exact email is not a match', () => {
  const users = [clerkUser('user_1', [{ emailAddress: 'other@example.com' }])];
  assert.deepStrictEqual(selectExactVerifiedClerkMatch(users, 'acme@example.com'), {
    ok: false,
    failure: 'unknown',
  });
});

test('several matching accounts are ambiguous', () => {
  const users = [
    clerkUser('user_1', [{ emailAddress: 'acme@example.com' }]),
    clerkUser('user_2', [{ emailAddress: 'ACME@example.com' }]),
  ];
  assert.deepStrictEqual(selectExactVerifiedClerkMatch(users, 'acme@example.com'), {
    ok: false,
    failure: 'ambiguous',
  });
});

test('an unverified or unverifiable match is rejected', () => {
  const unverified = [clerkUser('user_1', [{ emailAddress: 'acme@example.com', status: 'unverified' }])];
  assert.deepStrictEqual(selectExactVerifiedClerkMatch(unverified, 'acme@example.com'), {
    ok: false,
    failure: 'unverified',
  });

  const noVerification = [clerkUser('user_1', [{ emailAddress: 'acme@example.com', status: null }])];
  assert.deepStrictEqual(selectExactVerifiedClerkMatch(noVerification, 'acme@example.com'), {
    ok: false,
    failure: 'unverified',
  });
});

test('one exact verified match resolves to the Clerk user id', () => {
  const users = [clerkUser('user_clerk_1', [{ emailAddress: 'acme@example.com' }])];
  assert.deepStrictEqual(selectExactVerifiedClerkMatch(users, 'acme@example.com'), {
    ok: true,
    clerkUserId: 'user_clerk_1',
  });
});

test('the email comparison trims and ignores case on both sides', () => {
  const users = [clerkUser('user_clerk_1', [{ emailAddress: 'Acme@Example.com' }])];
  assert.deepStrictEqual(selectExactVerifiedClerkMatch(users, '  ACME@example.COM  '), {
    ok: true,
    clerkUserId: 'user_clerk_1',
  });
});

test('the MATCHED address is the one that must be verified', () => {
  const users = [
    clerkUser('user_clerk_1', [
      { emailAddress: 'primary@example.com', status: 'unverified' },
      { emailAddress: 'acme@example.com', status: 'verified' },
    ]),
  ];
  assert.deepStrictEqual(selectExactVerifiedClerkMatch(users, 'acme@example.com'), {
    ok: true,
    clerkUserId: 'user_clerk_1',
  });

  const matchedUnverified = [
    clerkUser('user_clerk_1', [
      { emailAddress: 'acme@example.com', status: 'unverified' },
      { emailAddress: 'primary@example.com', status: 'verified' },
    ]),
  ];
  assert.deepStrictEqual(selectExactVerifiedClerkMatch(matchedUnverified, 'acme@example.com'), {
    ok: false,
    failure: 'unverified',
  });
});
