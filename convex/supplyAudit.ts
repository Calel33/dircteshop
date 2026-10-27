import { ConvexError } from 'convex/values';

import type { Id } from './_generated/dataModel';

// Order-commitment protocol T6 (issue #77): the owner supply toggles write one
// `auditLogs` row per real state change, never an `orderEvents` row (§6.2.8:
// "The order board's own transitions use `orderEvents`; the supply toggles use
// `auditLogs`"). This module is the single source of truth for that row shape
// and for the toggle idempotency rules, so `setAcceptingOrders`,
// `setGroupAvailability`, and the `updateItem` audit branch cannot drift apart.
//
// Only type imports from generated Convex modules (plus `ConvexError`), so the
// helpers stay unit-addressable outside a deployment.

/**
 * §6.2.8 audit vocabulary (issue #77). The values are spec-exact: the Super
 * Admin audit feed renders an unknown action as its raw string until a UI
 * ticket adds labels (D8), so an invented variant would be a silent reporting
 * gap rather than a compile error.
 */
export type SupplyAuditAction =
  | 'orders.acceptingOrders.toggled'
  | 'orders.groupAvailability.toggled'
  | 'orders.itemAvailability.toggled';

/** §6.2.8 target vocabulary: one type per toggle surface. */
export type SupplyTargetType = 'business' | 'menuGroup' | 'menuItem';

/**
 * The single `auditLogs` row shape for every supply toggle (§6.2.8, issue
 * #77): the owner actor, the spec-exact action/target pair, the REQUIRED
 * `targetName` snapshot, and the optional note as `reason`.
 *
 * Mandatory snapshot (Q7): `resolveLiveBusinessName` returns `null` for any
 * non-business target and `backfillAuditTargetNames` only rescues `business`
 * rows, while the hard-delete cascade removes every `menuGroups`/`menuItems`
 * row — so a menu toggle written without `targetName` loses its name forever.
 *
 * Deliberately no `fromStatus`/`toStatus`: those columns are typed as listing
 * statuses (`convex/schema.ts`) and a supply toggle is not a state-machine
 * transition (§6.5, INV-22).
 */
export type SupplyAuditLog = {
  actorUserId: Id<'users'>;
  action: SupplyAuditAction;
  targetType: SupplyTargetType;
  targetId: string;
  targetName: string;
  reason?: string;
  createdAt: number;
};

/**
 * Builds the one `auditLogs` row §6.2.8 requires for a toggle (issue #77).
 * Mirrors `buildFeaturedAuditLog`/`buildCategoryAuditLog`: a plain object
 * literal, with `reason` omitted entirely when the note is absent so the row
 * carries no empty string.
 */
export function buildSupplyAuditLog(input: {
  actorUserId: Id<'users'>;
  action: SupplyAuditAction;
  targetType: SupplyTargetType;
  targetId: string;
  targetName: string;
  reason?: string;
  createdAt: number;
}): SupplyAuditLog {
  return {
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    targetName: input.targetName,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    createdAt: input.createdAt,
  };
}

/**
 * Note length cap for the pause/resume banner (issue #77, D6). No normative
 * limit exists in §6.2.8/§6.5; 200 matches the audit `reason` precedent
 * (`MAX_TRANSITION_REASON_LENGTH` in `orderCommitPolicy.ts`) and is ample for a
 * customer-visible one-liner. The 500-character limit belongs to the customer's
 * order note (`orders.ts`), not this owner toggle.
 */
export const MAX_SUPPLY_NOTE_LENGTH = 200;

/**
 * Trims a pause note; blank or absent collapses to `undefined` so the optional
 * field is removed and retries with cosmetic whitespace changes stay no-ops
 * (§6.2.8/§6.5, issue #77 Q4). Mirrors `validatedDescription`'s blank rule.
 */
export function normalizeSupplyNote(note: string | undefined): string | undefined {
  if (note === undefined) {
    return undefined;
  }
  const trimmed = note.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Validates and normalizes the optional pause note (§6.2.8 `reason`, issue
 * #77). The cap is documented on `MAX_SUPPLY_NOTE_LENGTH` (D6).
 */
export function validateSupplyNote(note: string | undefined): string | undefined {
  const normalized = normalizeSupplyNote(note);
  if (normalized !== undefined && normalized.length > MAX_SUPPLY_NOTE_LENGTH) {
    throw new ConvexError(
      `Pause note must be ${MAX_SUPPLY_NOTE_LENGTH} characters or fewer`
    );
  }
  return normalized;
}

/**
 * The customer-visible pause tuple (§6.2.8/§6.5 `acceptingOrders*`, issue #77
 * Q4): the switch, the optional auto-close time, and the optional note. The
 * tuple — not just the boolean — is the audited state, so a note-only or
 * until-only edit is still one configuration-history row.
 */
export type AcceptingOrdersTuple = {
  accepting: boolean;
  until?: number;
  note?: string;
};

/**
 * Idempotency guard for `setAcceptingOrders` (issue #77 Q4/V3): compares the
 * normalized tuple, so an identical repeat performs no patch and writes no
 * audit row, while any member moving produces exactly one row.
 *
 * Normalization is load-bearing: `null` and `undefined` are both "absent", and
 * the note is trimmed before comparison (blank ⇒ absent) so a retry that only
 * changes whitespace never manufactures a misleading event — the same rule
 * `resolveFeaturedChange` applies to the single-boolean featured flag.
 */
export function resolveSupplyChange(
  previous: AcceptingOrdersTuple,
  next: AcceptingOrdersTuple
): { changed: boolean } {
  return {
    changed:
      previous.accepting !== next.accepting ||
      (previous.until ?? undefined) !== (next.until ?? undefined) ||
      normalizeSupplyNote(previous.note) !== normalizeSupplyNote(next.note),
  };
}
