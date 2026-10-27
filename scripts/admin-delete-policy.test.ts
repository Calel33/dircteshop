#!/usr/bin/env node
/**
 * Pins the B6a hard-delete cascade policy (issue #15, Task 5):
 *
 * - Typed-name confirmation is server-checked against the CURRENT business
 *   name — client typing alone is never trusted, a wrong/stale name fails with
 *   zero writes, and surrounding whitespace on the typed value is tolerated.
 * - The cascade covers every directly linked child table (contract §B7):
 *   menuGroups, menuItems, serviceOfferings, stylists, orders, bookings,
 *   quoteRequests, notifications — and deliberately NOT `auditLogs` (the
 *   delete's audit row must survive) or `paymentAttempts` (no business FK).
 * - Referenced storage ids (business photos, menu-item images, stylist photos)
 *   are collected deduplicated in first-seen order, so a file shared inside
 *   the cascade is deleted exactly once.
 * - The audit row is the `delete` shape: prior status + REQUIRED name
 *   snapshot, and no `toStatus`/`reason`.
 *
 * `convex/businesses/adminDeletion.ts` is pure (type-only generated imports),
 * so the policy is asserted without a live Convex deployment. The handler in
 * `convex/businesses/adminMutations.ts` runs the audit insert, the child
 * deletes, the parent delete, and the storage deletes inside one Convex
 * transaction (a throw rolls all database writes back), which is verified in
 * the authenticated dev check.
 *
 * Run: node --test scripts/admin-delete-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../convex/_generated/dataModel.ts';
import {
  HARD_DELETE_CHILD_TABLES,
  assertHardDeleteConfirmation,
  assertHardDeleteHasNoOrders,
  buildHardDeleteAuditLog,
  collectStorageIds,
} from '../convex/businesses/adminDeletion.ts';

// ---------------------------------------------------------------------------
// Typed-name confirmation.
// ---------------------------------------------------------------------------

test('the exact current name confirms the delete', () => {
  assert.doesNotThrow(() => assertHardDeleteConfirmation('Acme Coffee', 'Acme Coffee'));
  assert.doesNotThrow(() =>
    assertHardDeleteConfirmation("Rosie's Diner & Bar", "Rosie's Diner & Bar")
  );
});

test('surrounding whitespace on the typed name is tolerated', () => {
  assert.doesNotThrow(() => assertHardDeleteConfirmation('Acme Coffee', '  Acme Coffee  '));
});

test('a wrong, stale, or differently-cased name fails the confirmation', () => {
  assert.throws(
    () => assertHardDeleteConfirmation('Acme Coffee', 'Acme Coffee (old name)'),
    /does not match/
  );
  assert.throws(() => assertHardDeleteConfirmation('Acme Coffee', 'acme coffee'), /does not match/);
  assert.throws(() => assertHardDeleteConfirmation('Acme Coffee', 'Acme'), /does not match/);
  assert.throws(() => assertHardDeleteConfirmation('Acme Coffee', ''), /does not match/);
  assert.throws(() => assertHardDeleteConfirmation('Acme Coffee', '   '), /does not match/);
});

// ---------------------------------------------------------------------------
// Order-history refusal (issue #84, Task 13 · protocol INV-30/E68).
// ---------------------------------------------------------------------------

/** The refusal is the `{ code, message }` envelope the admin UI renders. */
function isOrdersRefusal(error: unknown): boolean {
  assert.ok(error instanceof ConvexError, 'the refusal must be a ConvexError');
  const data: unknown = error.data;
  assert.ok(
    typeof data === 'object' && data !== null && 'code' in data,
    'the refusal must carry a machine-readable code'
  );
  const envelope: { code?: unknown; message?: unknown } = data;
  assert.equal(envelope.code, 'HAS_ORDERS');
  assert.equal(typeof envelope.message, 'string');
  assert.match(String(envelope.message), /order history/i);
  return true;
}

test('a business with no orders passes the hard-delete guard', () => {
  assert.doesNotThrow(() => assertHardDeleteHasNoOrders(0));
});

test('a business with any orders is refused with HAS_ORDERS', () => {
  assert.throws(() => assertHardDeleteHasNoOrders(1), isOrdersRefusal);
  assert.throws(() => assertHardDeleteHasNoOrders(250), isOrdersRefusal);
});

// ---------------------------------------------------------------------------
// Cascade coverage.
// ---------------------------------------------------------------------------

test('the cascade covers exactly the directly linked child tables', () => {
  assert.deepStrictEqual([...HARD_DELETE_CHILD_TABLES], [
    'menuGroups',
    'menuItems',
    'serviceOfferings',
    'stylists',
    'orders',
    'bookings',
    'quoteRequests',
    'notifications',
  ]);
});

test('audit logs and payment attempts are outside the cascade', () => {
  const covered: readonly string[] = HARD_DELETE_CHILD_TABLES;
  assert.equal(covered.includes('auditLogs'), false);
  assert.equal(covered.includes('paymentAttempts'), false);
  assert.equal(covered.includes('businesses'), false);
});

// ---------------------------------------------------------------------------
// Storage-id collection.
// ---------------------------------------------------------------------------

function photo(storageId: string) {
  return { storageId: storageId as Id<'_storage'>, ordering: 0 };
}

function menuItem(imageStorageId?: string): Pick<Doc<'menuItems'>, 'imageStorageId'> {
  return { imageStorageId: imageStorageId as Id<'_storage'> | undefined };
}

function stylist(photoStorageId?: string): Pick<Doc<'stylists'>, 'photoStorageId'> {
  return { photoStorageId: photoStorageId as Id<'_storage'> | undefined };
}

test('storage ids collect in first-seen order: photos, menu items, stylists', () => {
  const ids = collectStorageIds({
    business: { photos: [photo('storage_a'), photo('storage_b')] },
    menuItems: [menuItem('storage_c')],
    stylists: [stylist('storage_d')],
  });

  assert.deepStrictEqual(ids, [
    'storage_a' as Id<'_storage'>,
    'storage_b' as Id<'_storage'>,
    'storage_c' as Id<'_storage'>,
    'storage_d' as Id<'_storage'>,
  ]);
});

test('a storage id shared inside the cascade is deleted once', () => {
  const ids = collectStorageIds({
    business: { photos: [photo('storage_shared')] },
    menuItems: [menuItem('storage_shared'), menuItem('storage_shared')],
    stylists: [stylist('storage_shared'), stylist('storage_shared_2')],
  });

  assert.deepStrictEqual(ids, [
    'storage_shared' as Id<'_storage'>,
    'storage_shared_2' as Id<'_storage'>,
  ]);
});

test('missing child media references are skipped', () => {
  const ids = collectStorageIds({
    business: { photos: [] },
    menuItems: [menuItem(undefined)],
    stylists: [stylist(undefined)],
  });

  assert.deepStrictEqual(ids, []);
});

// ---------------------------------------------------------------------------
// Audit row: written FIRST, survives the cascade.
// ---------------------------------------------------------------------------

test('the delete audit row carries the prior status and the name snapshot', () => {
  const row = buildHardDeleteAuditLog({
    actorUserId: 'users_admin' as Id<'users'>,
    targetId: 'businesses_1' as Id<'businesses'>,
    fromStatus: 'approved',
    targetName: 'Acme Coffee',
    createdAt: 1_700_000_000_000,
  });

  assert.deepStrictEqual(row, {
    actorUserId: 'users_admin' as Id<'users'>,
    action: 'delete',
    targetType: 'business',
    targetId: 'businesses_1' as Id<'businesses'>,
    fromStatus: 'approved',
    targetName: 'Acme Coffee',
    createdAt: 1_700_000_000_000,
  });
  assert.equal('toStatus' in row, false);
  assert.equal('reason' in row, false);
});

test('a draft listing deletes with its draft status recorded', () => {
  const row = buildHardDeleteAuditLog({
    actorUserId: 'users_admin' as Id<'users'>,
    targetId: 'businesses_2' as Id<'businesses'>,
    fromStatus: 'draft',
    targetName: 'Draft Listing',
    createdAt: 42,
  });

  assert.equal(row.fromStatus, 'draft');
  assert.equal(row.createdAt, 42);
});
