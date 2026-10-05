#!/usr/bin/env node
/**
 * Pins the pure decision policy behind the `/admin/approvals` per-card actions
 * (issue #13 / B3b todo #5). The three decisions are Approve (no reason),
 * requestChanges and reject (both require a non-blank reason). This module has
 * no React and no Convex imports — it is the client mirror of the server's
 * `convex/businesses/moderationPolicy.ts`, which stays authoritative.
 *
 * Run: node --test app/admin/approvals/approval-actions-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APPROVAL_ACTIONS,
  actionRequiresReason,
  canSubmitDecision,
  normalizeReason,
} from './approval-actions-policy.ts';

test('exposes exactly the three queue decisions', () => {
  assert.deepEqual([...APPROVAL_ACTIONS], ['approve', 'requestChanges', 'reject']);
});

test('only requestChanges and reject require a reason', () => {
  assert.equal(actionRequiresReason('approve'), false);
  assert.equal(actionRequiresReason('requestChanges'), true);
  assert.equal(actionRequiresReason('reject'), true);
});

test('approve is submittable without any reason', () => {
  assert.equal(canSubmitDecision('approve', ''), true);
  assert.equal(canSubmitDecision('approve', '   '), true);
});

test('requestChanges blocks submit for empty and whitespace-only reasons', () => {
  assert.equal(canSubmitDecision('requestChanges', ''), false);
  assert.equal(canSubmitDecision('requestChanges', '   '), false);
  assert.equal(canSubmitDecision('requestChanges', '\n\t '), false);
});

test('requestChanges allows submit once the reason has non-blank text', () => {
  assert.equal(canSubmitDecision('requestChanges', 'Add a clearer photo'), true);
  assert.equal(canSubmitDecision('requestChanges', '  Add hours  '), true);
});

test('reject blocks submit for empty and whitespace-only reasons', () => {
  assert.equal(canSubmitDecision('reject', ''), false);
  assert.equal(canSubmitDecision('reject', '  \n '), false);
});

test('reject allows submit once the reason has non-blank text', () => {
  assert.equal(canSubmitDecision('reject', 'Duplicate of another listing'), true);
});

test('normalizeReason clears the reason for approve', () => {
  assert.equal(normalizeReason('approve', ''), undefined);
  assert.equal(normalizeReason('approve', 'looks good'), undefined);
});

test('normalizeReason trims the stored reason for requestChanges and reject', () => {
  assert.equal(normalizeReason('requestChanges', '  Add a clearer photo  '), 'Add a clearer photo');
  assert.equal(normalizeReason('reject', '\tSpam listing\n'), 'Spam listing');
});
