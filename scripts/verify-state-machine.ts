#!/usr/bin/env node
/**
 * Pins the SPEC §5 listing approval state machine and its per-transition actor
 * mapping. The expected tables below are transcribed by hand from the sources
 * of truth — SPEC §5 (`screens/SPEC.md` L77-84) and the authoritative actor
 * table (`screens/wayfinder/research/convex-domain-model.md` L184-196) — so any
 * drift in `convex/businesses/helpers.ts` fails the quality gate.
 *
 * Run: node scripts/verify-state-machine.ts  (wired as `pnpm test`)
 */
import assert from 'node:assert/strict';

import type {
  ListingStatus,
  TransitionAction,
  TransitionRole,
} from '../convex/businesses/helpers.ts';
import * as stateMachine from '../convex/businesses/helpers.ts';

/** SPEC §5 `allowedTransitions`, copied verbatim (order-preserving). */
const specTransitions: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ['pendingReview', 'rejected'],
  pendingReview: ['approved', 'changesRequested', 'rejected'],
  approved: ['pendingReview', 'suspended'],
  changesRequested: ['pendingReview', 'draft', 'rejected'],
  rejected: ['draft', 'pendingReview'],
  suspended: ['approved'],
};

/** Actor table (from, action, target, who) from the research asset L184-196. */
const specActors: readonly {
  from: ListingStatus;
  action: TransitionAction;
  to: ListingStatus;
  role: TransitionRole;
}[] = [
  { from: 'draft', action: 'submitForReview', to: 'pendingReview', role: 'owner' },
  { from: 'pendingReview', action: 'approve', to: 'approved', role: 'superAdmin' },
  { from: 'pendingReview', action: 'requestChanges', to: 'changesRequested', role: 'superAdmin' },
  { from: 'pendingReview', action: 'reject', to: 'rejected', role: 'superAdmin' },
  { from: 'changesRequested', action: 'submitForReview', to: 'pendingReview', role: 'owner' },
  { from: 'changesRequested', action: 'reopenAsDraft', to: 'draft', role: 'owner' },
  { from: 'approved', action: 'submitForReview', to: 'pendingReview', role: 'owner' },
  { from: 'approved', action: 'suspend', to: 'suspended', role: 'superAdmin' },
  { from: 'suspended', action: 'restore', to: 'approved', role: 'superAdmin' },
  { from: 'rejected', action: 'reopenAsDraft', to: 'draft', role: 'owner' },
  { from: 'rejected', action: 'submitForReview', to: 'pendingReview', role: 'superAdmin' },
];

function assertTransitionAllowList(): void {
  assert.deepStrictEqual(
    stateMachine.STATUS_TRANSITIONS,
    specTransitions,
    'STATUS_TRANSITIONS drifted from the SPEC §5 allow-list'
  );
}

function assertActorTable(): void {
  for (const { from, action, to, role } of specActors) {
    assert.deepStrictEqual(
      stateMachine.resolveTransition(from, action),
      { requiredRole: role, targetStatus: to },
      `${from} -[${action}]-> ${to} should require ${role}`
    );
  }
}

function assertRejectedReopenGuard(): void {
  // Regression: an owner must not reopen a rejected listing into the queue.
  assert.equal(
    stateMachine.resolveTransition('rejected', 'submitForReview')?.requiredRole,
    'superAdmin'
  );
  for (const from of ['draft', 'changesRequested', 'approved'] as const) {
    assert.equal(stateMachine.resolveTransition(from, 'submitForReview')?.requiredRole, 'owner');
  }
}

function assertIllegalTransitionsRejected(): void {
  assert.equal(stateMachine.resolveTransition('draft', 'approve'), undefined);
  assert.equal(stateMachine.resolveTransition('suspended', 'submitForReview'), undefined);
  assert.equal(stateMachine.resolveTransition('suspended', 'reopenAsDraft'), undefined);
}

assertTransitionAllowList();
assertActorTable();
assertRejectedReopenGuard();
assertIllegalTransitionsRejected();

console.log(
  `verify-state-machine: ${Object.keys(stateMachine.STATUS_TRANSITIONS).length} statuses, ` +
    `${specActors.length} actor rows pinned.`
);
