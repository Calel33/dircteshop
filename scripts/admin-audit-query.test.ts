#!/usr/bin/env node
/**
 * Pins the B6a read-only audit query contract (issue #15, Task 2):
 *
 * - Audit reads are Super Admin-only at the handler (`requireSuperAdmin` in
 *   `convex/auditLogs.ts`) and bounded: the server rejects a page request
 *   larger than 25 and the returned rows are the narrow `AuditLogRow`
 *   projection — never raw documents.
 * - Newest-first ordering comes from the `byCreatedAt` index in the handler;
 *   the filter helpers here refine the scanned window: `action` is an exact
 *   match; `actor` is a case-insensitive substring over the joined actor name;
 *   `search` is a case-insensitive substring over resolved target name,
 *   target id, or reason.
 * - `targetName` resolves stored snapshot ?? live business name ?? null, so a
 *   deleted target stays visible (its snapshot survives) and pre-snapshot rows
 *   fall back to the live name.
 *
 * `convex/auditProjections.ts` imports only types from generated Convex
 * modules, so the pure helpers are asserted without a live Convex deployment
 * (runtime DB tests are unavailable in this repo). The handler wiring is
 * verified in the authenticated dev check.
 *
 * Run: node --test scripts/admin-audit-query.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Doc, Id } from '../convex/_generated/dataModel.ts';
import {
  AUDIT_PAGE_SIZE,
  assertAuditPageSize,
  matchesAuditLogFilters,
  normalizeAuditFilter,
  toAuditLogRow,
} from '../convex/auditProjections.ts';

/** A schema-shaped audit row; `createdAt` is the row's `at`. */
function auditLogFixture(overrides: Partial<Doc<'auditLogs'>> = {}): Doc<'auditLogs'> {
  return {
    _id: 'auditLogs_1' as Id<'auditLogs'>,
    _creationTime: 1_700_000_000_000,
    actorUserId: 'users_admin' as Id<'users'>,
    action: 'approve',
    targetType: 'business',
    targetId: 'businesses_1',
    fromStatus: 'pendingReview',
    toStatus: 'approved',
    reason: undefined,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Read bounds.
// ---------------------------------------------------------------------------

test('audit pages are capped at 25 rows', () => {
  assert.equal(AUDIT_PAGE_SIZE, 25);
});

test('the server rejects an audit page request larger than 25', () => {
  assert.doesNotThrow(() => assertAuditPageSize(1));
  assert.doesNotThrow(() => assertAuditPageSize(25));
  assert.throws(() => assertAuditPageSize(26), /limited to 25/);
  assert.throws(() => assertAuditPageSize(100), /limited to 25/);
});

test('normalizeAuditFilter trims and treats blank as no filter', () => {
  assert.equal(normalizeAuditFilter(undefined), undefined);
  assert.equal(normalizeAuditFilter(''), undefined);
  assert.equal(normalizeAuditFilter('   '), undefined);
  assert.equal(normalizeAuditFilter('  approve  '), 'approve');
  assert.equal(normalizeAuditFilter('Approve'), 'Approve');
});

// ---------------------------------------------------------------------------
// Filters: exact action, case-insensitive actor / search substrings.
// ---------------------------------------------------------------------------

function filterInput(overrides: {
  action?: string;
  actorName?: string | null;
  targetId?: string;
  targetName?: string | null;
  reason?: string;
}) {
  return {
    action: overrides.action ?? 'approve',
    // `in` checks so an explicit `null` overrides the default (?? would not).
    actorName: 'actorName' in overrides ? (overrides.actorName ?? null) : 'Rosalind Admin',
    targetId: overrides.targetId ?? 'businesses_1',
    targetName: 'targetName' in overrides ? (overrides.targetName ?? null) : 'Acme Coffee',
    reason: overrides.reason,
  };
}

test('no filters match every row', () => {
  assert.equal(matchesAuditLogFilters(filterInput({}), {}), true);
  assert.equal(matchesAuditLogFilters(filterInput({}), { action: '  ', actor: '', search: ' ' }), true);
});

test('the action filter matches exactly (case-sensitive)', () => {
  assert.equal(matchesAuditLogFilters(filterInput({ action: 'approve' }), { action: 'approve' }), true);
  assert.equal(matchesAuditLogFilters(filterInput({ action: 'approve' }), { action: 'app' }), false);
  assert.equal(matchesAuditLogFilters(filterInput({ action: 'approve' }), { action: 'Approve' }), false);
  assert.equal(matchesAuditLogFilters(filterInput({ action: 'delete' }), { action: 'approve' }), false);
});

test('the actor filter matches the joined actor name as a substring, case-insensitively', () => {
  assert.equal(matchesAuditLogFilters(filterInput({}), { actor: 'rosalind' }), true);
  assert.equal(matchesAuditLogFilters(filterInput({}), { actor: 'ADMIN' }), true);
  assert.equal(matchesAuditLogFilters(filterInput({}), { actor: 'nobody' }), false);
});

test('a missing actor join cannot match an actor filter (but is not an error)', () => {
  assert.equal(matchesAuditLogFilters(filterInput({ actorName: null }), { actor: 'rosalind' }), false);
  assert.equal(matchesAuditLogFilters(filterInput({ actorName: null }), {}), true);
});

test('the search filter matches target name, target id, or reason, case-insensitively', () => {
  assert.equal(matchesAuditLogFilters(filterInput({}), { search: 'acme' }), true);
  assert.equal(matchesAuditLogFilters(filterInput({}), { search: 'COFFEE' }), true);
  assert.equal(matchesAuditLogFilters(filterInput({}), { search: 'businesses_1' }), true);
  assert.equal(matchesAuditLogFilters(filterInput({ reason: 'Duplicate listing' }), { search: 'duplicate' }), true);
  assert.equal(matchesAuditLogFilters(filterInput({}), { search: 'unrelated' }), false);
});

test('a row without a target name or reason is still searchable by id', () => {
  const input = filterInput({ targetName: null, reason: undefined });
  assert.equal(matchesAuditLogFilters(input, { search: 'businesses_1' }), true);
  assert.equal(matchesAuditLogFilters(input, { search: 'acme' }), false);
});

test('filters AND-combine', () => {
  const input = filterInput({ action: 'reject', actorName: 'Rosalind Admin', reason: 'Duplicate listing' });

  assert.equal(
    matchesAuditLogFilters(input, { action: 'reject', actor: 'ros', search: 'duplicate' }),
    true
  );
  assert.equal(
    matchesAuditLogFilters(input, { action: 'reject', actor: 'ros', search: 'unrelated' }),
    false
  );
  assert.equal(
    matchesAuditLogFilters(input, { action: 'approve', actor: 'ros', search: 'duplicate' }),
    false
  );
});

// ---------------------------------------------------------------------------
// Row projection + target-name resolution (rows survive target deletion).
// ---------------------------------------------------------------------------

test('the row carries the frozen audit fields with nulls for absent optionals', () => {
  const row = toAuditLogRow({
    log: auditLogFixture({ reason: undefined, fromStatus: undefined, toStatus: undefined }),
    actorName: 'Rosalind Admin',
    liveBusinessName: 'Acme Coffee',
  });

  assert.deepStrictEqual(row, {
    _id: 'auditLogs_1' as Id<'auditLogs'>,
    at: 1_700_000_000_000,
    action: 'approve',
    actorName: 'Rosalind Admin',
    targetType: 'business',
    targetId: 'businesses_1',
    targetName: 'Acme Coffee',
    fromStatus: null,
    toStatus: null,
    reason: null,
  });
});

test('a missing actor join projects to a null actor name', () => {
  const row = toAuditLogRow({
    log: auditLogFixture(),
    actorName: null,
    liveBusinessName: 'Acme Coffee',
  });

  assert.equal(row.actorName, null);
});

test('the stored target-name snapshot wins over the live business name', () => {
  const row = toAuditLogRow({
    log: auditLogFixture({ targetName: 'Acme Coffee (before rename)' }),
    actorName: 'Rosalind Admin',
    liveBusinessName: 'Acme Coffee (renamed)',
  });

  assert.equal(row.targetName, 'Acme Coffee (before rename)');
});

test('a row without a snapshot falls back to the live business name', () => {
  const row = toAuditLogRow({
    log: auditLogFixture({ targetName: undefined }),
    actorName: 'Rosalind Admin',
    liveBusinessName: 'Acme Coffee',
  });

  assert.equal(row.targetName, 'Acme Coffee');
});

test('a deleted target keeps its snapshot; without one the name is null', () => {
  const withSnapshot = toAuditLogRow({
    log: auditLogFixture({ action: 'delete', targetName: 'Acme Coffee', toStatus: undefined }),
    actorName: 'Rosalind Admin',
    liveBusinessName: null,
  });
  assert.equal(withSnapshot.targetName, 'Acme Coffee');

  const withoutSnapshot = toAuditLogRow({
    log: auditLogFixture({ targetName: undefined }),
    actorName: 'Rosalind Admin',
    liveBusinessName: null,
  });
  assert.equal(withoutSnapshot.targetName, null);
});
