import { ConvexError, v } from 'convex/values';
import type { Infer } from 'convex/values';

import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { EDITABLE_FIELD_CLASS, editableBusinessFieldsValidator } from '../businessTypes';
import type { EditableBusinessField } from '../businessTypes';
import { configuredSuperAdminIds, requireBusinessOwner, requireSuperAdmin } from '../authz';
import {
  insertNotification,
  moderationNotificationEvent,
  notifyAdminRecipients,
  planTransitionNotification,
} from '../notificationHelpers';
import { getCurrentUserOrThrow } from '../users';
import {
  approvedResubmitTarget,
  buildSearchText,
  resolveTransition,
  STATUS_TRANSITIONS,
} from './helpers';
import type { ListingStatus, TransitionAction, TransitionRole } from './helpers';
import {
  assertAllPendingReview,
  assertModerationReason,
  buildModerationAuditLog,
  normalizeBulkApproveIds,
  normalizeModerationReason,
  type ModerationAction,
} from './moderationPolicy';
import {
  changedCoreIdentityFields,
  findUnknownPatchFields,
  hasCoreIdentityField,
  isBlankPatchName,
  normalizePatchName,
  ownerSaveMode,
  ownerSubmitClearsModeration,
  persistableSaveFields,
  providedEditableFields,
} from './ownerSavePolicy';

// Owner + admin writes for the listing lifecycle. Mutations accept an ACTION,
// never a client-supplied status (SPEC §5); the target status is resolved
// server-side and checked against the STATUS_TRANSITIONS allow-list.

// The action allow-list is enforced by the validator. Moderation decisions
// (approve / requestChanges / reject) are deliberately excluded here: they must
// go through `moderateListing`, which writes the required audit row in the same
// transaction (issue #13). Transition handles only the remaining lifecycle
// actions.
const actionValidator = v.union(
  v.literal('submitForReview'),
  v.literal('suspend'),
  v.literal('restore'),
  v.literal('reopenAsDraft')
);

/** `.partial()` makes every editable field optional for partial saves. */
const editablePatchValidator = editableBusinessFieldsValidator.partial();

type EditablePatch = Infer<typeof editablePatchValidator>;

/**
 * Creates a blank listing owned by the signed-in user ("Add Your Business",
 * SPEC §9). Any authenticated user may call it; ownership is derived from their
 * users row and never accepted from the client. Everything else starts empty so
 * the owner editor (B3) can build the listing up from a schema-valid draft.
 */
export const createDraft = mutation({
  args: { name: v.string(), categoryId: v.id('categories') },
  handler: async (ctx, { name, categoryId }) => {
    const trimmedName = name.trim();

    if (trimmedName.length === 0) {
      throw new ConvexError('Business name is required');
    }

    const owner = await getCurrentUserOrThrow(ctx);

    const category = await ctx.db.get('categories', categoryId);
    if (category === null) {
      throw new Error('Unknown category');
    }

    const description = '';
    const now = Date.now();

    return await ctx.db.insert('businesses', {
      name: trimmedName,
      categoryId,
      description,
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
      searchText: buildSearchText(trimmedName, [], description),
      ownerId: owner._id,
      lastUpdatedAt: now,
      isFeatured: false,
      lastSavedAt: now,
    });
  },
});

/**
 * Explicit owner save of a listing's editable fields ("Save Draft", SPEC §9).
 *
 * Status gates (contract §4.2/§5): `pendingReview`/`suspended` are read-only and
 * `rejected` must be revised to a draft first, so all three are refused.
 * `draft`/`changesRequested` persist every editable field. On an `approved`
 * listing only content fields persist; core identity edits (`name`,
 * `categoryId`, `description`, `address`) are staged client-side and ignored here
 * so unreviewed identity never becomes public — `saveAndResubmit` persists them
 * atomically with `approved -> pendingReview`.
 *
 * `searchText` is recomputed whenever the persisted `name`/`description` change.
 * A supplied `name` is trimmed and must be non-blank (T4). `ownerId`/`status` are
 * server-owned and never patchable.
 */
export const saveDraft = mutation({
  args: { businessId: v.id('businesses'), patch: editablePatchValidator },
  handler: async (ctx, { businessId, patch }) => {
    const business = await requireBusinessOwner(ctx, businessId);
    assertPatchInAllowlist(patch);
    assertValidPatchName(patch);

    const mode = ownerSaveMode(business.status);

    if (mode === 'reject') {
      throw new ConvexError(readOnlySaveMessage(business.status));
    }

    const provided = providedEditableFields(EDITABLE_FIELD_CLASS, patch);
    const persistFields = persistableSaveFields(mode, EDITABLE_FIELD_CLASS, provided);
    const now = Date.now();
    const searchChanged =
      persistFields.includes('name') ||
      persistFields.includes('description') ||
      persistFields.includes('keywords');
    const normalizedPatch = withNormalizedName(patch);

    await ctx.db.patch(businessId, {
      ...buildEditablePatch(normalizedPatch, persistFields),
      lastSavedAt: now,
      lastUpdatedAt: now,
      ...(searchChanged
        ? {
            searchText: buildSearchText(
              normalizedPatch.name ?? business.name,
              normalizedPatch.keywords ?? business.keywords,
              normalizedPatch.description ?? business.description
            ),
          }
        : {}),
    });
  },
});

/**
 * Performs one legal listing transition for the acting owner or Super Admin.
 *
 * SPEC §5 order: load doc -> resolve user -> role check -> allow-list -> atomic
 * patch. The whole write commits atomically, so status, searchText, moderation
 * and verification never drift apart. Docs on patch semantics (shallow merge,
 * `undefined` removes a field): https://docs.convex.dev/database/writing-data
 */
export const transition = mutation({
  args: {
    businessId: v.id('businesses'),
    action: actionValidator,
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertReasonProvided(args.action, args.reason);

    const business = await ctx.db.get('businesses', args.businessId);
    if (business === null) {
      throw new Error('Business not found');
    }

    const resolution = resolveTransition(business.status, args.action);
    if (resolution === undefined) {
      throw new Error(`Invalid transition from ${business.status} for ${args.action}`);
    }

    const actor = await authorizeAction(ctx, args.businessId, resolution.requiredRole);
    assertTransitionAllowed(business.status, args.action, resolution.targetStatus);

    const now = Date.now();

    await ctx.db.patch(args.businessId, {
      status: resolution.targetStatus,
      searchText: buildSearchText(business.name, business.keywords, business.description),
      lastUpdatedAt: now,
      // submitForReview is the only writer of `submittedAt` (SPEC §4); the
      // approvals queue reads it for "submitted age" (SPEC §10, B6).
      ...(args.action === 'submitForReview' ? { submittedAt: now } : {}),
      // Admin moderation stamps. Passing `undefined` removes a stale
      // moderationReason on suspend / restore.
      ...(resolution.requiredRole === 'superAdmin'
        ? { moderatedAt: now, moderationReason: args.reason }
        : {}),
    });

    // B5 notice in the same transaction (plan §Trigger matrix): owner submit
    // notifies every configured Super Admin; the admin reopen of a rejected
    // listing (same action, superAdmin-resolved) notifies the others and never
    // the actor; suspend/restore notify the owner. Any other combination
    // inserts nothing. A failed insert rolls back the transition above.
    const notificationPlan = planTransitionNotification({
      action: args.action,
      requiredRole: resolution.requiredRole,
      targetStatus: resolution.targetStatus,
      businessId: args.businessId,
      businessName: business.name,
      reason: args.reason,
    });

    if (notificationPlan !== undefined) {
      if (notificationPlan.audience === 'owner') {
        await insertNotification(ctx, business.ownerId, notificationPlan.event, now);
      } else {
        await notifyAdminRecipients(ctx, notificationPlan.event, {
          allowlist: configuredSuperAdminIds(),
          excludeUserId:
            notificationPlan.audience === 'configuredAdminsExcludingActor'
              ? (actor?._id ?? null)
              : null,
          createdAt: now,
        });
      }
    }
  },
});

/**
 * B3b per-card moderation decision (issue #13, Task 3), extended by B6a
 * (issue #15, Task 3) to the full directory action set: Approve, Request
 * Changes, Reject (a `pendingReview` listing) and Suspend, Restore (a live
 * one). Deliberately separate from `transition` so owner submit/reopen
 * behavior is untouched, and only this decision writes its atomic audit row.
 *
 * Frozen check order (contract §B6): reason -> authorize -> load ->
 * resolve + current-status guard -> atomic patch + audit insert. The target
 * status is resolved server-side (`resolveTransition`) and the acting Super
 * Admin is derived from `requireSuperAdmin`; a client never supplies a status,
 * actor id, or verification stamp.
 *
 * The explicit current-status guard is required because the state machine
 * resolves a `suspended -> approved` `approve` (helpers.ts), so a stale card
 * could otherwise re-approve a listing that already left review; Suspend is
 * `approved`-only and Restore `suspended`-only for the same reason.
 */
const moderationActionValidator = v.union(
  v.literal('approve'),
  v.literal('requestChanges'),
  v.literal('reject'),
  v.literal('suspend'),
  v.literal('restore')
);

/** The current status each moderation action requires (contract §A). */
const MODERATION_REQUIRED_STATUS: Record<
  ModerationAction,
  'pendingReview' | 'approved' | 'suspended'
> = {
  approve: 'pendingReview',
  requestChanges: 'pendingReview',
  reject: 'pendingReview',
  suspend: 'approved',
  restore: 'suspended',
};

function assertModerationCurrentStatus(
  action: ModerationAction,
  currentStatus: ListingStatus
): void {
  const required = MODERATION_REQUIRED_STATUS[action];
  if (currentStatus === required) {
    return;
  }

  if (required === 'pendingReview') {
    throw new ConvexError('Listing is no longer pending review; refresh the queue.');
  }
  throw new ConvexError(
    `Only a ${required} listing can be ${action === 'suspend' ? 'suspended' : 'restored'}.`
  );
}

export const moderateListing = mutation({
  args: {
    businessId: v.id('businesses'),
    action: moderationActionValidator,
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertModerationReason(args.action, args.reason);

    const admin = await requireSuperAdmin(ctx);

    const business = await ctx.db.get('businesses', args.businessId);
    if (business === null) {
      throw new ConvexError('Business not found');
    }

    const resolution = resolveTransition(business.status, args.action);
    if (resolution === undefined) {
      throw new ConvexError(`Invalid transition from ${business.status} for ${args.action}`);
    }

    assertModerationCurrentStatus(args.action, business.status);

    const now = Date.now();
    const normalizedReason = normalizeModerationReason(args.action, args.reason);

    await ctx.db.patch(args.businessId, {
      status: resolution.targetStatus,
      lastUpdatedAt: now,
      moderatedAt: now,
      moderationReason: normalizedReason,
      // Only approve stamps verification; suspend/restore never touch it.
      ...(args.action === 'approve'
        ? { verification: { isVerified: true, verifiedAt: now, verifiedBy: admin._id } }
        : {}),
    });

    await ctx.db.insert(
      'auditLogs',
      buildModerationAuditLog({
        actorUserId: admin._id,
        action: args.action,
        targetId: args.businessId,
        fromStatus: business.status,
        toStatus: resolution.targetStatus,
        reason: normalizedReason,
        targetName: business.name,
        createdAt: now,
      })
    );

    // Notification parity with the existing `transition()` path:
    // approve/requestChanges/reject keep the moderation event; suspend/restore
    // write the same owner notice as the transition path
    // (`planTransitionNotification`). Both are inserted in the same
    // transaction, so a status change never commits without its notice.
    if (args.action === 'suspend' || args.action === 'restore') {
      const notificationPlan = planTransitionNotification({
        action: args.action,
        requiredRole: 'superAdmin',
        targetStatus: resolution.targetStatus,
        businessId: args.businessId,
        businessName: business.name,
        reason: normalizedReason,
      });

      if (notificationPlan?.audience === 'owner') {
        await insertNotification(ctx, business.ownerId, notificationPlan.event, now);
      }
    } else {
      await insertNotification(
        ctx,
        business.ownerId,
        moderationNotificationEvent({
          action: args.action,
          businessId: args.businessId,
          businessName: business.name,
          reason: normalizedReason,
        }),
        now
      );
    }
  },
});

/**
 * B3c bulk approve (issue #14, Task 2): approves a deduplicated set of 1–25
 * current-page listings in ONE atomic transaction, all-or-none.
 *
 * Approve-only by design (SPEC §10: "bulk approve only"). The selection is
 * validated as a whole before any write, so a single stale/decided id rejects
 * the entire batch and leaves every business and audit row unchanged — the
 * admin refreshes and reselects rather than getting a partial success. Each
 * approved listing receives exactly the single-`moderateListing` approve side
 * effects (status, `lastUpdatedAt`, `moderatedAt`, stale `moderationReason`
 * cleared, verification stamp) and exactly one audit row. The acting Super
 * Admin is derived server-side; a client never supplies an actor, status, or
 * verification stamp. The action is fixed to `approve`, so no client action is
 * accepted.
 */
export const approveSelected = mutation({
  args: { businessIds: v.array(v.id('businesses')) },
  handler: async (ctx, { businessIds }) => {
    const ids = normalizeBulkApproveIds(businessIds);
    const admin = await requireSuperAdmin(ctx);

    const listings = await Promise.all(ids.map((listingId) => ctx.db.get(listingId)));
    const statuses: ListingStatus[] = [];
    const pending: Doc<'businesses'>[] = [];
    for (const listing of listings) {
      if (listing === null) {
        throw new ConvexError('One or more listings no longer exist; refresh the queue.');
      }
      statuses.push(listing.status);
      pending.push(listing);
    }
    assertAllPendingReview(statuses);

    const resolution = resolveTransition('pendingReview', 'approve');
    if (resolution === undefined) {
      throw new Error('approve is not a legal transition from pendingReview');
    }

    const now = Date.now();
    const normalizedReason = normalizeModerationReason('approve', undefined);

    for (const listing of pending) {
      await ctx.db.patch(listing._id, {
        status: resolution.targetStatus,
        lastUpdatedAt: now,
        moderatedAt: now,
        moderationReason: normalizedReason,
        verification: { isVerified: true, verifiedAt: now, verifiedBy: admin._id },
      });

      await ctx.db.insert(
        'auditLogs',
        buildModerationAuditLog({
          actorUserId: admin._id,
          action: 'approve',
          targetId: listing._id,
          fromStatus: 'pendingReview',
          toStatus: resolution.targetStatus,
          reason: normalizedReason,
          targetName: listing.name,
          createdAt: now,
        })
      );

      // B5 notice in the same transaction: one owner notice per approved
      // listing, inside the existing all-or-none loop.
      await insertNotification(
        ctx,
        listing.ownerId,
        moderationNotificationEvent({
          action: 'approve',
          businessId: listing._id,
          businessName: listing.name,
          reason: normalizedReason,
        }),
        now
      );
    }

    return { approvedCount: ids.length };
  },
});

/**
 * Atomic approved-identity re-review ("Submit" after editing a live listing).
 *
 * The patch must contain at least one core identity field whose value differs
 * from the persisted document (T5) — re-sending an unchanged value must not
 * delist an approved listing. On an `approved` listing the staged identity
 * values are persisted together with the re-review transition in ONE
 * `ctx.db.patch`, so unreviewed identity is never public and no
 * approved-baseline snapshot is needed (contract §4.2/§5). The target status is
 * derived from `STATUS_TRANSITIONS` via `approvedResubmitTarget` — this path
 * deliberately does NOT route through the generic `transition` mutation, whose
 * owner `submitForReview` from `approved` stays refused.
 *
 * Any additionally supplied content fields are persisted in the same patch so no
 * dirty edit is dropped. Moderation metadata follows the §9.1 retention policy.
 */
export const saveAndResubmit = mutation({
  args: { businessId: v.id('businesses'), patch: editablePatchValidator },
  handler: async (ctx, { businessId, patch }) => {
    const business = await requireBusinessOwner(ctx, businessId);
    assertPatchInAllowlist(patch);
    assertValidPatchName(patch);

    const provided = providedEditableFields(EDITABLE_FIELD_CLASS, patch);
    if (!hasCoreIdentityField(EDITABLE_FIELD_CLASS, provided)) {
      throw new ConvexError(
        'saveAndResubmit requires at least one core identity field (name, categoryId, description, address)'
      );
    }

    if (business.status !== 'approved') {
      throw new ConvexError('Only an approved listing can be resubmitted with identity changes');
    }

    if (changedCoreIdentityFields(EDITABLE_FIELD_CLASS, patch, business).length === 0) {
      throw new ConvexError(
        'saveAndResubmit requires a change to at least one core identity field (name, categoryId, description, address)'
      );
    }

    const targetStatus = approvedResubmitTarget(business.status);
    if (targetStatus === undefined) {
      throw new Error(`No resubmit target for ${business.status}`);
    }

    const now = Date.now();
    const normalizedPatch = withNormalizedName(patch);

    await ctx.db.patch(businessId, {
      ...buildEditablePatch(normalizedPatch, provided),
      searchText: buildSearchText(
        normalizedPatch.name ?? business.name,
        normalizedPatch.keywords ?? business.keywords,
        normalizedPatch.description ?? business.description
      ),
      status: targetStatus,
      submittedAt: now,
      lastUpdatedAt: now,
      ...(ownerSubmitClearsModeration()
        ? { moderationReason: undefined, moderatedAt: undefined }
        : {}),
    });

    // B5 notice in the same transaction (the easy-to-miss path, plan L206):
    // an owner-origin resubmit notifies every configured Super Admin, using
    // the resubmitted name so the review is keyed to what they will see.
    await notifyAdminRecipients(
      ctx,
      {
        type: 'listing_submitted',
        businessId,
        businessName: normalizedPatch.name ?? business.name,
        reason: undefined,
      },
      {
        allowlist: configuredSuperAdminIds(),
        excludeUserId: null,
        createdAt: now,
      }
    );
  },
});

/**
 * Resolves and authorizes the acting user for an action's required role.
 * Returns the Super Admin doc (needed to stamp `verification.verifiedBy`), or
 * `null` for owner actions, which need no actor stamp. Both guards fail closed.
 */
async function authorizeAction(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  requiredRole: TransitionRole
) {
  if (requiredRole === 'superAdmin') {
    return await requireSuperAdmin(ctx);
  }

  await requireBusinessOwner(ctx, businessId);
  return null;
}

/**
 * `requestChanges` and `reject` must carry a moderation reason (SPEC §10: the
 * reason is shown to the owner). Enforced before any state is read or written.
 */
function assertReasonProvided(action: TransitionAction, reason: string | undefined) {
  const requiresReason = action === 'requestChanges' || action === 'reject';

  if (requiresReason && (reason ?? '').trim().length === 0) {
    throw new Error(`${action} requires a reason`);
  }
}

/**
 * Enforces SPEC §5: the action's target status must be reachable from the
 * business's current status per `STATUS_TRANSITIONS` (the source of truth).
 *
 * T3 boundary: `approved -> pendingReview` is in the table for the edit-triggered
 * re-review path (SPEC §5 re-review policy — only core identity edits send a live
 * listing back to review). The plain owner `submitForReview` action must not use
 * that combination to re-submit an already-approved listing, so it is rejected
 * here; the edit-triggered path will be a separate B3 mutation that reuses the
 * same table.
 */
function assertTransitionAllowed(
  current: ListingStatus,
  action: TransitionAction,
  target: ListingStatus
) {
  if (!STATUS_TRANSITIONS[current].includes(target)) {
    throw new Error(`Invalid transition from ${current} to ${target}`);
  }

  if (action === 'submitForReview' && current === 'approved') {
    throw new Error('Approved listings cannot be resubmitted for review');
  }
}

/**
 * Handler-level defense-in-depth against non-editable patch keys. Convex object
 * validation already rejects undeclared keys at the API boundary; this keeps the
 * rule explicit and derived from `EDITABLE_FIELD_CLASS` (contract §4.2).
 */
function assertPatchInAllowlist(patch: object) {
  const unknownFields = findUnknownPatchFields(EDITABLE_FIELD_CLASS, patch);
  if (unknownFields.length > 0) {
    throw new ConvexError(
      `Business patch contains non-editable field(s): ${unknownFields.join(', ')}`
    );
  }
}

/**
 * T4: `v.string()` accepts whitespace-only names and the client `validateForm`
 * is bypassable by calling the mutation directly, so a supplied blank name is
 * rejected server-side before anything is persisted. Omitted names pass — a
 * partial save that does not touch `name` keeps the persisted value.
 */
function assertValidPatchName(patch: object) {
  if (isBlankPatchName(patch)) {
    throw new ConvexError('Business name is required');
  }
}

/**
 * T4: returns the patch with `name` replaced by its trimmed value (and omitted
 * when absent), so both persistence and `searchText` use the normalized name.
 */
function withNormalizedName(patch: EditablePatch): EditablePatch {
  const name = normalizePatchName(patch);
  return name === undefined ? patch : { ...patch, name };
}

function readOnlySaveMessage(status: ListingStatus): string {
  if (status === 'rejected') {
    return 'Rejected listings are read-only; revise the listing to a draft before saving.';
  }
  return `Listings in status "${status}" are read-only and cannot be edited.`;
}

/**
 * Narrows a validated editable patch to the fields the server persists. Each
 * editable field shares its validator type with the matching `businesses`
 * column, and Convex re-validates the write against the schema, so the cast is
 * safe.
 */
function buildEditablePatch(
  patch: EditablePatch,
  fields: readonly EditableBusinessField[]
): Partial<Doc<'businesses'>> {
  const result: Record<string, unknown> = {};
  const record = patch as Record<string, unknown>;
  for (const field of fields) {
    result[field] = record[field];
  }
  return result as Partial<Doc<'businesses'>>;
}
