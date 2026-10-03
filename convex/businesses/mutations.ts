import { ConvexError, v } from 'convex/values';
import type { Infer } from 'convex/values';

import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { addressValidator, EDITABLE_FIELD_CLASS, hoursValidator } from '../businessTypes';
import type { EditableBusinessField } from '../businessTypes';
import { requireBusinessOwner, requireSuperAdmin } from '../authz';
import { getCurrentUserOrThrow } from '../users';
import {
  approvedResubmitTarget,
  buildSearchText,
  resolveTransition,
  STATUS_TRANSITIONS,
} from './helpers';
import type { ListingStatus, TransitionAction, TransitionRole } from './helpers';
import {
  findUnknownPatchFields,
  hasCoreIdentityField,
  ownerSaveMode,
  ownerSubmitClearsModeration,
  persistableSaveFields,
  providedEditableFields,
} from './ownerSavePolicy';

// Owner + admin writes for the listing lifecycle. Mutations accept an ACTION,
// never a client-supplied status (SPEC §5); the target status is resolved
// server-side and checked against the STATUS_TRANSITIONS allow-list.

// The action allow-list is enforced by the validator. The *conditional* reason
// requirement (requestChanges / reject) cannot be expressed in a flat args
// object — Convex 1.46 rejects a top-level union validator as args ("Args
// validator must be an object or any") — so it fails fast at the top of the
// handler via assertReasonProvided.
const actionValidator = v.union(
  v.literal('submitForReview'),
  v.literal('approve'),
  v.literal('requestChanges'),
  v.literal('reject'),
  v.literal('suspend'),
  v.literal('restore'),
  v.literal('reopenAsDraft')
);

/**
 * The B3a owner-editable field surface (issue #12). Its keys mirror
 * `EDITABLE_FIELD_CLASS`; server-owned fields (`status`, `ownerId`, `searchText`,
 * moderation, timestamps, vertical/photo fields) are deliberately absent. Convex
 * object validation throws on undeclared keys before the handler runs, so a
 * client can never patch them
 * (https://docs.convex.dev/functions/validation.md). `.partial()` makes every
 * field optional for partial saves.
 */
const editableBusinessFieldsValidator = v.object({
  name: v.string(),
  categoryId: v.id('categories'),
  description: v.string(),
  address: addressValidator,
  hours: hoursValidator,
  phone: v.string(),
  email: v.string(),
  website: v.string(),
  tags: v.array(v.string()),
  amenities: v.array(v.string()),
});

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

    const category = await ctx.db.get(categoryId);
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
 * `ownerId`/`status` are server-owned and never patchable.
 */
export const saveDraft = mutation({
  args: { businessId: v.id('businesses'), patch: editablePatchValidator },
  handler: async (ctx, { businessId, patch }) => {
    const business = await requireBusinessOwner(ctx, businessId);
    assertPatchInAllowlist(patch);

    const mode = ownerSaveMode(business.status);

    if (mode === 'reject') {
      throw new ConvexError(readOnlySaveMessage(business.status));
    }

    const provided = providedEditableFields(EDITABLE_FIELD_CLASS, patch);
    const persistFields = persistableSaveFields(mode, EDITABLE_FIELD_CLASS, provided);
    const now = Date.now();
    const searchChanged = persistFields.includes('name') || persistFields.includes('description');

    await ctx.db.patch(businessId, {
      ...buildEditablePatch(patch, persistFields),
      lastSavedAt: now,
      lastUpdatedAt: now,
      ...(searchChanged
        ? {
            searchText: buildSearchText(
              patch.name ?? business.name,
              business.keywords,
              patch.description ?? business.description
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

    const business = await ctx.db.get(args.businessId);
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
      // moderationReason on approve / restore.
      ...(resolution.requiredRole === 'superAdmin'
        ? { moderatedAt: now, moderationReason: args.reason }
        : {}),
      // SPEC §5: an approval stamps verification. `restore` also lands on
      // `approved` but is not an approval, so it must not re-stamp verification.
      ...(args.action === 'approve' && actor !== null
        ? { verification: { isVerified: true, verifiedAt: now, verifiedBy: actor._id } }
        : {}),
    });
  },
});

/**
 * Atomic approved-identity re-review ("Submit" after editing a live listing).
 *
 * The patch must contain at least one core identity field; on an `approved`
 * listing the staged identity values are persisted together with the re-review
 * transition in ONE `ctx.db.patch`, so unreviewed identity is never public and no
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

    const provided = providedEditableFields(EDITABLE_FIELD_CLASS, patch);
    if (!hasCoreIdentityField(EDITABLE_FIELD_CLASS, provided)) {
      throw new ConvexError(
        'saveAndResubmit requires at least one core identity field (name, categoryId, description, address)'
      );
    }

    if (business.status !== 'approved') {
      throw new ConvexError('Only an approved listing can be resubmitted with identity changes');
    }

    const targetStatus = approvedResubmitTarget(business.status);
    if (targetStatus === undefined) {
      throw new Error(`No resubmit target for ${business.status}`);
    }

    const now = Date.now();

    await ctx.db.patch(businessId, {
      ...buildEditablePatch(patch, provided),
      searchText: buildSearchText(
        patch.name ?? business.name,
        business.keywords,
        patch.description ?? business.description
      ),
      status: targetStatus,
      submittedAt: now,
      lastUpdatedAt: now,
      ...(ownerSubmitClearsModeration()
        ? { moderationReason: undefined, moderatedAt: undefined }
        : {}),
    });
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
