import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';

// B6a Super Admin directory action policy (issue #15, Tasks 4-6).
//
// Pure decision logic behind `convex/businesses/adminMutations.ts` and
// `convex/businesses/adminOwnerActions.ts`: the featured-toggle no-op rule and
// its audit row, the admin draft defaults, and the Clerk owner-match
// validation. Only type imports from generated Convex modules, so the module
// is `node --test`-able; handlers stay thin shells over these functions.
//
// Contract: tasks/issue-15-contracts.md §B4/§B7/§B8.

// ---------------------------------------------------------------------------
// Featured pin (Task 4; contract §B7).
// ---------------------------------------------------------------------------

/**
 * The featured toggle outcome. A request equal to the current value is a
 * no-op — the handler performs no write and writes no audit row (contract §B7:
 * duplicate no-op toggles must not create misleading audit events).
 */
export type FeaturedChange = { changed: false } | { changed: true; reason: 'pinned' | 'unpinned' };

/** Classifies a requested `isFeatured` value against the persisted one. */
export function resolveFeaturedChange(current: boolean, next: boolean): FeaturedChange {
  if (current === next) {
    return { changed: false };
  }
  return { changed: true, reason: next ? 'pinned' : 'unpinned' };
}

/**
 * The single `auditLogs` row per actual featured change (contract §B4):
 * `action: 'feature'`, `reason` = `pinned` | `unpinned` (the direction), and
 * deliberately no statuses — the flag is not a state-machine transition.
 */
export type FeaturedAuditLog = {
  actorUserId: Id<'users'>;
  action: 'feature';
  targetType: 'business';
  targetId: Id<'businesses'>;
  reason: 'pinned' | 'unpinned';
  createdAt: number;
};

export function buildFeaturedAuditLog(input: {
  actorUserId: Id<'users'>;
  targetId: Id<'businesses'>;
  reason: 'pinned' | 'unpinned';
  createdAt: number;
}): FeaturedAuditLog {
  return {
    actorUserId: input.actorUserId,
    action: 'feature',
    targetType: 'business',
    targetId: input.targetId,
    reason: input.reason,
    createdAt: input.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Admin draft for an existing owner (Task 6; contract §B7/§B8).
// ---------------------------------------------------------------------------

/**
 * Trims a requested draft name and rejects a blank one — the same server-side
 * guard as the B3a `createDraft` mutation (client `validateForm` is
 * bypassable). Returns the normalized name the draft persists.
 */
export function normalizeAdminDraftName(name: string): string {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    throw new ConvexError('Business name is required');
  }
  return trimmedName;
}

/** The inserted draft document, minus the server-assigned `_id`/`_creationTime`. */
export type AdminDraftInsert = Omit<Doc<'businesses'>, '_id' | '_creationTime'>;

/**
 * The admin-created draft body: exactly the B3a `createDraft` defaults
 * (mutations.ts L89-109) with the RESOLVED owner instead of the signed-in
 * user. `name` must already be normalized (`normalizeAdminDraftName`); the
 * category and owner validity are checked by the caller before this builder
 * runs, and no email (or any other Clerk data) ever reaches this shape.
 */
export function buildAdminDraftInsert(input: {
  name: string;
  categoryId: Id<'categories'>;
  ownerId: Id<'users'>;
  now: number;
}): AdminDraftInsert {
  const description = '';

  return {
    name: input.name,
    categoryId: input.categoryId,
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
    // The helpers.ts buildSearchText(name, [], '') formula ([name, '',
    // ''].join(' ')), written inline because a pure `node --test` module
    // cannot value-import a sibling Convex module (extensionless ESM
    // resolution). scripts/admin-create-draft.test.ts asserts parity against
    // `buildSearchText` so the two can never drift.
    searchText: [input.name, '', ''].join(' '),
    ownerId: input.ownerId,
    lastUpdatedAt: input.now,
    isFeatured: false,
    lastSavedAt: input.now,
  };
}

/**
 * The single `auditLogs` row for an admin draft creation (contract §B4):
 * `action: 'createDraft'`, `toStatus: 'draft'`, and the name snapshot. No
 * `fromStatus` (the listing did not exist) and no reason.
 */
export type CreateDraftAuditLog = {
  actorUserId: Id<'users'>;
  action: 'createDraft';
  targetType: 'business';
  targetId: Id<'businesses'>;
  toStatus: 'draft';
  targetName: string;
  createdAt: number;
};

export function buildCreateDraftAuditLog(input: {
  actorUserId: Id<'users'>;
  targetId: Id<'businesses'>;
  targetName: string;
  createdAt: number;
}): CreateDraftAuditLog {
  return {
    actorUserId: input.actorUserId,
    action: 'createDraft',
    targetType: 'business',
    targetId: input.targetId,
    toStatus: 'draft',
    targetName: input.targetName,
    createdAt: input.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Clerk owner matching (Task 6; contract §B8).
// ---------------------------------------------------------------------------

/** The structural slice of the Clerk Backend `EmailAddress` this policy reads. */
export type ClerkEmailAddressLike = {
  emailAddress: string;
  verification: { status: string } | null;
};

/** The structural slice of the Clerk Backend `User` this policy reads. */
export type ClerkUserLike = {
  id: string;
  emailAddresses: readonly ClerkEmailAddressLike[];
};

/**
 * The safe failure vocabulary for owner assignment (contract §B8: safe,
 * actionable, no PII). `unknown` covers zero matches and blank input;
 * `ambiguous` several matching accounts; `unverified` a single match whose
 * matching address is not verified.
 */
export type ClerkMatchResult =
  | { ok: true; clerkUserId: string }
  | { ok: false; failure: 'unknown' | 'ambiguous' | 'unverified' };

/**
 * Validates the Clerk Backend `getUserList({ emailAddress })` result: exactly
 * one user must carry the exact email (trimmed, case-insensitive) and THAT
 * address must be verified. Operates on structural data so it is
 * `node --test`-able without the Clerk SDK; the action maps each failure to a
 * safe message and never creates an account or persists the email.
 */
export function selectExactVerifiedClerkMatch(
  users: readonly ClerkUserLike[],
  email: string
): ClerkMatchResult {
  const needle = email.trim().toLowerCase();
  if (needle.length === 0) {
    return { ok: false, failure: 'unknown' };
  }

  const matches: { user: ClerkUserLike; address: ClerkEmailAddressLike }[] = [];
  for (const user of users) {
    const address = user.emailAddresses.find(
      (candidate) => candidate.emailAddress.trim().toLowerCase() === needle
    );
    if (address !== undefined) {
      matches.push({ user, address });
    }
  }

  if (matches.length === 0) {
    return { ok: false, failure: 'unknown' };
  }
  if (matches.length > 1) {
    return { ok: false, failure: 'ambiguous' };
  }

  const [match] = matches;
  if (match.address.verification?.status !== 'verified') {
    return { ok: false, failure: 'unverified' };
  }

  return { ok: true, clerkUserId: match.user.id };
}
