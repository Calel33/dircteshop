import { ConvexError, v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { requireSuperAdmin } from '../authz';
import {
  assertHardDeleteConfirmation,
  buildHardDeleteAuditLog,
  cascadeHardDeleteBusiness,
} from './adminDeletion';
import {
  buildAdminDraftInsert,
  buildCreateDraftAuditLog,
  buildFeaturedAuditLog,
  normalizeAdminDraftName,
  resolveFeaturedChange,
} from './adminPolicy';

// B6a Super Admin directory mutations (issue #15, Tasks 4-6): the featured
// pin, the hard delete, and the internal admin draft creation. Separate from
// `mutations.ts` so the owner/moderation seams stay untouched. Every public
// function here authorizes with `requireSuperAdmin` before any read or write.
//
// Contract: tasks/issue-15-contracts.md §B7.
// Docs: https://docs.convex.dev/auth/functions-auth · https://docs.convex.dev/database/writing-data

/**
 * B6a featured pin (Task 4): sets `isFeatured` and stamps `lastUpdatedAt` so
 * the B4 `byStatusFeaturedUpdatedAt` feed reorders, writing the audit row in
 * the SAME transaction. A request equal to the current value is a no-op: no
 * write and no audit row (the UI must not be able to manufacture misleading
 * events). Any status is pinnable; public visibility stays with the feed's
 * existing approved-only policy.
 */
export const setFeatured = mutation({
  args: { businessId: v.id('businesses'), isFeatured: v.boolean() },
  handler: async (ctx, { businessId, isFeatured }) => {
    const admin = await requireSuperAdmin(ctx);

    const business = await ctx.db.get(businessId);
    if (business === null) {
      throw new ConvexError('Business not found');
    }

    const change = resolveFeaturedChange(business.isFeatured, isFeatured);
    if (!change.changed) {
      return;
    }

    const now = Date.now();

    await ctx.db.patch(businessId, { isFeatured, lastUpdatedAt: now });

    await ctx.db.insert(
      'auditLogs',
      buildFeaturedAuditLog({
        actorUserId: admin._id,
        targetId: businessId,
        reason: change.reason,
        createdAt: now,
      })
    );
  },
});

/**
 * B6a hard delete (Task 5): removes a business, every directly linked child
 * record, and every storage file the cascade owns — one guarded transaction.
 *
 * Frozen order (contract §B7): re-read + exact typed-name check (zero writes
 * on a wrong/stale name) -> insert the `delete` audit row FIRST (with the name
 * snapshot, so the row survives the cascade) -> `cascadeHardDeleteBusiness`
 * (adminDeletion.ts) removes the children, the parent, and finally the
 * referenced storage objects. A throw anywhere rolls every database write
 * back — the cascade never partially commits and the mutation never reports
 * success on failure. A cascade that exceeds Convex transaction limits fails
 * safely rather than deleting partially; an asynchronous cascade would need a
 * separate approved design.
 */
export const hardDeleteBusiness = mutation({
  args: { businessId: v.id('businesses'), confirmName: v.string() },
  handler: async (ctx, { businessId, confirmName }) => {
    const admin = await requireSuperAdmin(ctx);

    const business = await ctx.db.get(businessId);
    if (business === null) {
      throw new ConvexError('Business not found');
    }

    assertHardDeleteConfirmation(business.name, confirmName);

    const now = Date.now();

    await ctx.db.insert(
      'auditLogs',
      buildHardDeleteAuditLog({
        actorUserId: admin._id,
        targetId: businessId,
        fromStatus: business.status,
        targetName: business.name,
        createdAt: now,
      })
    );

    await cascadeHardDeleteBusiness(ctx, business);
  },
});

/**
 * B6a internal draft creation for an existing owner (Task 6). NOT
 * client-callable: only `adminOwnerActions.createDraftForOwner` (the public
 * action that performed the server-only Clerk email lookup) invokes it via
 * `ctx.runMutation`.
 *
 * It independently enforces Super Admin: Convex propagates the caller's auth
 * into query/mutation calls made from an action ("Auth is propagated
 * automatically when calling queries and mutations from the action",
 * https://docs.convex.dev/functions/actions — Action context), so
 * `requireSuperAdmin` resolves the ACTUAL caller here. The frozen
 * `actorUserId` argument is verified against that resolution, so the audit
 * row always names the authenticated admin even if a future internal caller
 * passed something else. A CLI/dashboard invocation has no identity and fails
 * closed.
 *
 * Reproduces the B3a `createDraft` defaults for the resolved owner
 * (buildAdminDraftInsert), confirms the owner `users` row exists, and writes
 * the `createDraft` audit row in the same transaction. No email or Clerk data
 * is persisted or returned — the caller supplies Convex ids only.
 */
export const createDraftForOwner = internalMutation({
  args: {
    name: v.string(),
    categoryId: v.id('categories'),
    ownerUserId: v.id('users'),
    actorUserId: v.id('users'),
  },
  handler: async (ctx, { name, categoryId, ownerUserId, actorUserId }) => {
    const admin = await requireSuperAdmin(ctx);
    if (admin._id !== actorUserId) {
      throw new ConvexError('Actor does not match the authenticated Super Admin');
    }

    const trimmedName = normalizeAdminDraftName(name);

    const owner = await ctx.db.get(ownerUserId);
    if (owner === null) {
      throw new ConvexError('Owner user not found');
    }

    const category = await ctx.db.get(categoryId);
    if (category === null) {
      throw new ConvexError('Unknown category');
    }

    const now = Date.now();

    const draftId = await ctx.db.insert(
      'businesses',
      buildAdminDraftInsert({
        name: trimmedName,
        categoryId,
        ownerId: owner._id,
        now,
      })
    );

    await ctx.db.insert(
      'auditLogs',
      buildCreateDraftAuditLog({
        actorUserId: admin._id,
        targetId: draftId,
        targetName: trimmedName,
        createdAt: now,
      })
    );

    return draftId;
  },
});
