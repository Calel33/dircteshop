import { ConvexError, v } from 'convex/values';

import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { requireBusinessOwner, requireSuperAdmin } from '../authz';
import { getCurrentUserOrThrow } from '../users';
import { buildSearchText, resolveTransition, STATUS_TRANSITIONS } from './helpers';
import type { ListingStatus, TransitionAction, TransitionRole } from './helpers';

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

    const resolution = resolveTransition(args.action);
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
