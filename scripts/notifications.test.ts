#!/usr/bin/env node
/**
 * Pins the B5 (issue #5) notification policy for the backend track.
 *
 * `convex/notificationHelpers.ts` keeps its policy helpers pure (only type
 * imports from Convex modules), so they are asserted without a live Convex
 * deployment (runtime DB tests are unavailable in this repo; see
 * tasks/issue-5-context.md §6). The Convex handlers in `convex/notifications.ts`
 * and `convex/businesses/mutations.ts` wire these pure functions into `ctx.db`
 * reads/inserts inside the same transaction; that runtime behavior is deferred
 * to the authenticated dev checks + Reticle.
 *
 * Run: node --test scripts/notifications.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Id } from '../convex/_generated/dataModel';
import {
  MARK_ALL_READ_MAX_BATCHES,
  markAllReadBatchLimitExceeded,
} from '../components/notifications/notification-menu-policy.ts';
import {
  MARK_ALL_READ_SCAN_LIMIT,
  MARK_ALL_READ_UPDATE_LIMIT,
  NOTIFICATION_EVENT_TYPES,
  buildNotificationContent,
  moderationNotificationEvent,
  planMarkAllRead,
  planTransitionNotification,
  selectAdminRecipientUserIds,
} from '../convex/notificationHelpers.ts';

const businessId = 'businesses_1' as Id<'businesses'>;
const adminA = 'users_admin_a' as Id<'users'>;
const adminB = 'users_admin_b' as Id<'users'>;
const notificationId = (n: number) => `notifications_${n}` as Id<'notifications'>;

// ---------------------------------------------------------------------------
// Event kinds and persisted content.
// ---------------------------------------------------------------------------

test('exposes exactly the frozen B5 lifecycle event types', () => {
  assert.deepStrictEqual(
    [...NOTIFICATION_EVENT_TYPES],
    [
      'listing_submitted',
      'listing_approved',
      'listing_changes_requested',
      'listing_rejected',
      'listing_suspended',
    ]
  );
});

test('builds the server-owned message for every event type', () => {
  const expected = {
    listing_submitted: '"Sunset Cafe" was submitted for review.',
    listing_approved: '"Sunset Cafe" was approved.',
    listing_changes_requested: 'Changes were requested for "Sunset Cafe".',
    listing_rejected: '"Sunset Cafe" was rejected.',
    listing_suspended: '"Sunset Cafe" was suspended.',
  } as const;

  const content = buildNotificationContent({
    type: 'listing_submitted',
    businessName: 'Sunset Cafe',
    reason: undefined,
  });
  assert.equal(content.message, expected.listing_submitted);

  assert.equal(
    buildNotificationContent({
      type: 'listing_approved',
      businessName: 'Sunset Cafe',
      reason: undefined,
    }).message,
    expected.listing_approved
  );
  assert.equal(
    buildNotificationContent({
      type: 'listing_changes_requested',
      businessName: 'Sunset Cafe',
      reason: 'Add hours',
    }).message,
    expected.listing_changes_requested
  );
  assert.equal(
    buildNotificationContent({
      type: 'listing_rejected',
      businessName: 'Sunset Cafe',
      reason: 'Duplicate listing',
    }).message,
    expected.listing_rejected
  );
  assert.equal(
    buildNotificationContent({
      type: 'listing_suspended',
      businessName: 'Sunset Cafe',
      reason: undefined,
    }).message,
    expected.listing_suspended
  );
});

test('changesRequested and rejected content requires a non-blank reason', () => {
  for (const type of ['listing_changes_requested', 'listing_rejected'] as const) {
    assert.throws(
      () => buildNotificationContent({ type, businessName: 'Sunset Cafe', reason: undefined }),
      /requires a reason/
    );
    assert.throws(
      () => buildNotificationContent({ type, businessName: 'Sunset Cafe', reason: '   ' }),
      /requires a reason/
    );
    assert.throws(
      () => buildNotificationContent({ type, businessName: 'Sunset Cafe', reason: '\t\n ' }),
      /requires a reason/
    );
  }
});

test('required-reason content keeps the trimmed reason', () => {
  const content = buildNotificationContent({
    type: 'listing_rejected',
    businessName: 'Sunset Cafe',
    reason: '  Duplicate listing  ',
  });
  assert.equal(content.reason, 'Duplicate listing');
});

test('approved and suspended content normalizes a blank reason to undefined', () => {
  assert.equal(
    buildNotificationContent({ type: 'listing_approved', businessName: 'X', reason: undefined })
      .reason,
    undefined
  );
  assert.equal(
    buildNotificationContent({ type: 'listing_approved', businessName: 'X', reason: '   ' }).reason,
    undefined
  );
  assert.equal(
    buildNotificationContent({
      type: 'listing_suspended',
      businessName: 'X',
      reason: '  Policy review ',
    }).reason,
    'Policy review'
  );
});

test('submitted content never carries a reason', () => {
  assert.equal(
    buildNotificationContent({ type: 'listing_submitted', businessName: 'X', reason: 'ignored' })
      .reason,
    undefined
  );
});

// ---------------------------------------------------------------------------
// Recipient resolution (pure half of the live-allowlist join) and actor exclusion.
// ---------------------------------------------------------------------------

const adminUsers = [
  { _id: adminA, externalId: 'clerk_admin_a' },
  { _id: adminB, externalId: 'clerk_admin_b' },
];

test('selectAdminRecipientUserIds keeps only currently allowlisted users', () => {
  const stale = { _id: 'users_stale' as Id<'users'>, externalId: 'clerk_stale' };
  const selected = selectAdminRecipientUserIds([...adminUsers, stale], {
    allowlist: new Set(['clerk_admin_a', 'clerk_admin_b']),
    excludeUserId: null,
  });
  assert.deepStrictEqual(selected, [adminA, adminB]);
});

test('selectAdminRecipientUserIds drops allowlist ids with no local user row', () => {
  const selected = selectAdminRecipientUserIds([adminUsers[0]], {
    allowlist: new Set(['clerk_admin_a', 'clerk_not_yet_seen']),
    excludeUserId: null,
  });
  assert.deepStrictEqual(selected, [adminA]);
});

test('selectAdminRecipientUserIds excludes the acting admin (reopen path)', () => {
  const selected = selectAdminRecipientUserIds(adminUsers, {
    allowlist: new Set(['clerk_admin_a', 'clerk_admin_b']),
    excludeUserId: adminA,
  });
  assert.deepStrictEqual(selected, [adminB]);
});

test('selectAdminRecipientUserIds returns nothing when the actor is the only configured admin', () => {
  const selected = selectAdminRecipientUserIds([adminUsers[0]], {
    allowlist: new Set(['clerk_admin_a']),
    excludeUserId: adminA,
  });
  assert.deepStrictEqual(selected, []);
});

test('selectAdminRecipientUserIds returns nothing for an empty allowlist', () => {
  assert.deepStrictEqual(
    selectAdminRecipientUserIds(adminUsers, { allowlist: new Set(), excludeUserId: null }),
    []
  );
});

test('selectAdminRecipientUserIds deduplicates candidates and preserves order', () => {
  const selected = selectAdminRecipientUserIds([adminUsers[0], adminUsers[0], adminUsers[1]], {
    allowlist: new Set(['clerk_admin_a', 'clerk_admin_b']),
    excludeUserId: null,
  });
  assert.deepStrictEqual(selected, [adminA, adminB]);
});

// ---------------------------------------------------------------------------
// Transition -> event/audience mapping. Keyed on the resolved role, never the
// action name alone (the admin reopen rides `submitForReview`).
// ---------------------------------------------------------------------------

const transitionInput = (overrides: {
  action: 'submitForReview' | 'suspend' | 'restore' | 'reopenAsDraft' | 'approve' | 'requestChanges' | 'reject';
  requiredRole: 'owner' | 'superAdmin';
  targetStatus: 'pendingReview' | 'approved' | 'suspended' | 'draft' | 'changesRequested' | 'rejected';
  reason?: string;
}) => ({
  businessId,
  businessName: 'Sunset Cafe',
  reason: undefined as string | undefined,
  ...overrides,
});

test('owner-origin submit notifies all configured admins', () => {
  const plan = planTransitionNotification(
    transitionInput({ action: 'submitForReview', requiredRole: 'owner', targetStatus: 'pendingReview' })
  );
  assert.deepStrictEqual(plan, {
    audience: 'configuredAdmins',
    event: {
      type: 'listing_submitted',
      businessId,
      businessName: 'Sunset Cafe',
      reason: undefined,
    },
  });
});

test('admin-origin reopen (superAdmin-resolved submit) excludes the actor', () => {
  const plan = planTransitionNotification(
    transitionInput({
      action: 'submitForReview',
      requiredRole: 'superAdmin',
      targetStatus: 'pendingReview',
      reason: 'Reopening after owner revision',
    })
  );
  assert.equal(plan?.audience, 'configuredAdminsExcludingActor');
  assert.equal(plan?.event.type, 'listing_submitted');
  assert.equal(plan?.event.reason, undefined);
});

test('submitted events carry no reason even if one is supplied', () => {
  const plan = planTransitionNotification(
    transitionInput({
      action: 'submitForReview',
      requiredRole: 'owner',
      targetStatus: 'pendingReview',
      reason: 'why not',
    })
  );
  assert.equal(plan?.event.reason, undefined);
});

test('suspend notifies the owner and passes the reason through', () => {
  const plan = planTransitionNotification(
    transitionInput({
      action: 'suspend',
      requiredRole: 'superAdmin',
      targetStatus: 'suspended',
      reason: '  Policy review  ',
    })
  );
  assert.equal(plan?.audience, 'owner');
  assert.deepStrictEqual(plan?.event, {
    type: 'listing_suspended',
    businessId,
    businessName: 'Sunset Cafe',
    reason: '  Policy review  ',
  });
});

test('suspend without a reason still notifies the owner', () => {
  const plan = planTransitionNotification(
    transitionInput({ action: 'suspend', requiredRole: 'superAdmin', targetStatus: 'suspended' })
  );
  assert.equal(plan?.audience, 'owner');
  assert.equal(plan?.event.reason, undefined);
});

test('restore to approved notifies the owner', () => {
  const plan = planTransitionNotification(
    transitionInput({ action: 'restore', requiredRole: 'superAdmin', targetStatus: 'approved' })
  );
  assert.equal(plan?.audience, 'owner');
  assert.equal(plan?.event.type, 'listing_approved');
});

test('invalid or non-notifying transitions produce no event', () => {
  const cases = [
    // Owner draft-back: not in the B5 matrix.
    transitionInput({ action: 'reopenAsDraft', requiredRole: 'owner', targetStatus: 'draft' }),
    // Action/status pairs that cannot co-occur after resolveTransition.
    transitionInput({ action: 'submitForReview', requiredRole: 'owner', targetStatus: 'approved' }),
    transitionInput({ action: 'suspend', requiredRole: 'superAdmin', targetStatus: 'approved' }),
    transitionInput({ action: 'restore', requiredRole: 'superAdmin', targetStatus: 'suspended' }),
    // Moderation decisions never ride `transition`.
    transitionInput({ action: 'approve', requiredRole: 'superAdmin', targetStatus: 'approved' }),
    transitionInput({
      action: 'requestChanges',
      requiredRole: 'superAdmin',
      targetStatus: 'changesRequested',
    }),
    transitionInput({ action: 'reject', requiredRole: 'superAdmin', targetStatus: 'rejected' }),
  ];

  for (const input of cases) {
    assert.equal(planTransitionNotification(input), undefined);
  }
});

// ---------------------------------------------------------------------------
// Moderation decision -> owner notice mapping.
// ---------------------------------------------------------------------------

test('moderateListing approve maps to listing_approved with no reason', () => {
  const event = moderationNotificationEvent({
    action: 'approve',
    businessId,
    businessName: 'Sunset Cafe',
    reason: undefined,
  });
  assert.deepStrictEqual(event, {
    type: 'listing_approved',
    businessId,
    businessName: 'Sunset Cafe',
    reason: undefined,
  });
});

test('requestChanges maps to listing_changes_requested with the required reason', () => {
  const event = moderationNotificationEvent({
    action: 'requestChanges',
    businessId,
    businessName: 'Sunset Cafe',
    reason: 'Add hours',
  });
  assert.deepStrictEqual(event, {
    type: 'listing_changes_requested',
    businessId,
    businessName: 'Sunset Cafe',
    reason: 'Add hours',
  });
});

test('reject maps to listing_rejected with the required reason', () => {
  const event = moderationNotificationEvent({
    action: 'reject',
    businessId,
    businessName: 'Sunset Cafe',
    reason: 'Duplicate listing',
  });
  assert.deepStrictEqual(event, {
    type: 'listing_rejected',
    businessId,
    businessName: 'Sunset Cafe',
    reason: 'Duplicate listing',
  });
});

// ---------------------------------------------------------------------------
// Bounded mark-all-read batch math: reads <= 9, updates <= 8 per transaction.
// ---------------------------------------------------------------------------

test('pins the mark-all read and update limits', () => {
  assert.equal(MARK_ALL_READ_SCAN_LIMIT, 9);
  assert.equal(MARK_ALL_READ_UPDATE_LIMIT, 8);
});

test('only reports the client batch limit when unread notifications remain', () => {
  assert.equal(MARK_ALL_READ_MAX_BATCHES, 50);
  assert.equal(markAllReadBatchLimitExceeded(false, MARK_ALL_READ_MAX_BATCHES), false);
  assert.equal(markAllReadBatchLimitExceeded(true, MARK_ALL_READ_MAX_BATCHES), true);
  assert.equal(markAllReadBatchLimitExceeded(true, MARK_ALL_READ_MAX_BATCHES - 1), false);
});

test('planMarkAllRead updates everything when at most 8 unread rows were read', () => {
  assert.deepStrictEqual(planMarkAllRead([]), { toUpdate: [], updatedCount: 0, hasMore: false });

  const three = [notificationId(1), notificationId(2), notificationId(3)];
  assert.deepStrictEqual(planMarkAllRead(three), {
    toUpdate: three,
    updatedCount: 3,
    hasMore: false,
  });

  const eight = Array.from({ length: 8 }, (_, i) => notificationId(i + 1));
  assert.deepStrictEqual(planMarkAllRead(eight), {
    toUpdate: eight,
    updatedCount: 8,
    hasMore: false,
  });
});

test('a 9th read row proves more remain: update 8 and continue', () => {
  const nine = Array.from({ length: 9 }, (_, i) => notificationId(i + 1));
  const plan = planMarkAllRead(nine);
  assert.equal(plan.updatedCount, 8);
  assert.equal(plan.hasMore, true);
  assert.deepStrictEqual(plan.toUpdate, nine.slice(0, 8));
});

test('more candidates than the scan limit still update at most 8 and continue', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => notificationId(i + 1));
  const plan = planMarkAllRead(twelve);
  assert.equal(plan.updatedCount, 8);
  assert.equal(plan.hasMore, true);
  assert.deepStrictEqual(plan.toUpdate, twelve.slice(0, 8));
});
