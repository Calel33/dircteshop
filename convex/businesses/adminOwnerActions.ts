import { createClerkClient } from '@clerk/backend';
import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action, internalQuery } from '../_generated/server';
import { requireSuperAdmin } from '../authz';
import { selectExactVerifiedClerkMatch, type ClerkMatchResult, type ClerkUserLike } from './adminPolicy';

// B6a admin "Add Business" for an EXISTING owner (issue #15, Task 6).
//
// The public action authorizes first, then performs the server-only Clerk
// Backend lookup, then hands Convex ids to the internal mutation — the split
// is mandatory because mutations cannot call third-party APIs
// (https://docs.convex.dev/functions/actions). Auth is propagated
// automatically into runQuery/runMutation calls made from an action ("Action
// context", same page), so both helpers below resolve the caller's real
// identity through `requireSuperAdmin`.
//
// Contract: tasks/issue-15-contracts.md §B8. The Clerk secret is the Convex
// server env var `CLERK_SECRET_KEY` and never reaches client code; no email or
// Clerk record is persisted or returned — the action returns only a draft id.
// Docs: https://clerk.com/docs/reference/backend/user/get-user-list

/**
 * Resolves the authenticated Super Admin's local `users` row id for the audit
 * trail. Called by the public action BEFORE any Clerk request, so an
 * unauthorized caller can never trigger a Clerk lookup (contract §B8).
 */
export const resolveActorSuperAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const admin = await requireSuperAdmin(ctx);
    return admin._id;
  },
});

/**
 * Resolves a Clerk user id to its synchronized local `users` row, or `null`
 * when the account has never reached Convex (the caller turns that into a
 * safe "not synced yet" error — there is no invite/upsert fallback).
 */
export const resolveUserIdByExternalId = internalQuery({
  args: { externalId: v.string() },
  handler: async (ctx, { externalId }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('byExternalId', (q) => q.eq('externalId', externalId))
      .unique();
    return user?._id ?? null;
  },
});

/** Safe, actionable owner-match errors. Deliberately echo no email or ids. */
function ownerMatchFailureMessage(failure: Extract<ClerkMatchResult, { ok: false }>['failure']): string {
  switch (failure) {
    case 'unknown':
      return 'No existing account matches that email address.';
    case 'ambiguous':
      return 'More than one account matches that email address; resolve the duplicate first.';
    case 'unverified':
      return "That account's email address is not verified.";
  }
}

/**
 * Creates a blank draft owned by an existing account, resolved by exact email
 * (Task 6, contract §B8).
 *
 * Flow: `requireSuperAdmin` (before Clerk) -> validate the requested email ->
 * Clerk Backend `getUserList({ emailAddress })` (exact filter; unknown
 * addresses are ignored, not errors) -> exactly one exact, verified match ->
 * an existing synchronized local `users` row -> internal
 * `adminMutations.createDraftForOwner` (not client-callable; reproduces the
 * B3a `createDraft` defaults and audits). Unknown / ambiguous / unverified /
 * unsynchronized accounts fail with a safe error and create nothing; no
 * account is ever invited or created and no email is stored. The action
 * accepts no owner id, so clients cannot bypass the email lookup.
 */
export const createDraftForOwner = action({
  args: {
    name: v.string(),
    categoryId: v.id('categories'),
    ownerEmail: v.string(),
  },
  handler: async (ctx, args): Promise<{ draftId: Id<'businesses'> }> => {
    const actorUserId = await ctx.runQuery(
      internal.businesses.adminOwnerActions.resolveActorSuperAdmin,
      {}
    );

    const ownerEmail = args.ownerEmail.trim();
    if (ownerEmail.length === 0) {
      throw new ConvexError('Owner email is required.');
    }

    const secretKey = process.env.CLERK_SECRET_KEY;
    if (secretKey === undefined || secretKey.length === 0) {
      throw new ConvexError('Admin account lookup is not configured on the server.');
    }

    const clerk = createClerkClient({ secretKey });
    let clerkUsers: readonly ClerkUserLike[];
    try {
      const response = await clerk.users.getUserList({ emailAddress: [ownerEmail] });
      clerkUsers = response.data;
    } catch {
      throw new ConvexError('The account lookup service is unavailable; try again shortly.');
    }

    const match = selectExactVerifiedClerkMatch(clerkUsers, ownerEmail);
    if (!match.ok) {
      throw new ConvexError(ownerMatchFailureMessage(match.failure));
    }

    const ownerUserId = await ctx.runQuery(
      internal.businesses.adminOwnerActions.resolveUserIdByExternalId,
      { externalId: match.clerkUserId }
    );
    if (ownerUserId === null) {
      throw new ConvexError(
        'That owner account has not finished syncing; ask them to sign in once, then try again.'
      );
    }

    const draftId = await ctx.runMutation(
      internal.businesses.adminMutations.createDraftForOwner,
      {
        name: args.name,
        categoryId: args.categoryId,
        ownerUserId,
        actorUserId,
      }
    );

    return { draftId };
  },
});
