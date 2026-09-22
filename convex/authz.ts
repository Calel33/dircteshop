import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';

type AuthenticatedCtx = QueryCtx | MutationCtx;

/**
 * Parses the `SUPER_ADMIN_CLERK_IDS` Convex env var into a set of Clerk user
 * IDs. Read inside handlers so changes take effect on the next request.
 * Empty/absent value yields an empty set (callers fail closed).
 */
export function configuredSuperAdminIds(): Set<string> {
  return new Set(
    (process.env.SUPER_ADMIN_CLERK_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/**
 * The real authorization boundary for admin Convex functions. Fails closed:
 * no identity, no users row, role not stamped `superAdmin`, or the subject no
 * longer present in the env whitelist all throw.
 *
 * The stamped row is a projection; the live env whitelist is authoritative.
 */
export async function requireSuperAdmin(ctx: AuthenticatedCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new Error('Unauthorized');
  }

  const user = await ctx.db
    .query('users')
    .withIndex('byExternalId', (q) => q.eq('externalId', identity.subject))
    .unique();

  if (
    user === null ||
    user.role !== 'superAdmin' ||
    !configuredSuperAdminIds().has(identity.subject)
  ) {
    throw new Error('Forbidden');
  }

  return user;
}

/**
 * The real authorization boundary for owner-scoped Convex functions. Fails
 * closed: no identity, no users row, a missing business, or a business owned
 * by someone else all throw. Ownership is derived from `businesses.ownerId`
 * (owner is not a `users.role` value). Returns the owned business doc so
 * callers can patch it without a second read.
 */
export async function requireBusinessOwner(ctx: AuthenticatedCtx, businessId: Id<'businesses'>) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new Error('Unauthorized');
  }

  const user = await ctx.db
    .query('users')
    .withIndex('byExternalId', (q) => q.eq('externalId', identity.subject))
    .unique();

  const business = await ctx.db.get('businesses', businessId);

  if (user === null || business === null || business.ownerId !== user._id) {
    throw new Error('Forbidden');
  }

  return business;
}
