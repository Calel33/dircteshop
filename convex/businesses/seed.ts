import { internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { buildSearchText } from './helpers';
import {
  SEED_FIXTURES,
  type SeedFixture,
  type SeedMenuFixture,
  type SeedMenuGroupFixture,
  type SeedMenuItemFixture,
} from './seedFixtures';

// Dev-only seed data for the LocalConnect public surfaces (B2, extended by B4).
// Nothing in this module is client-callable: every entry point is an
// `internalMutation`, runnable only from the CLI / Dashboard:
//
//   npx convex run businesses/seed:seedBusinesses
//
// Idempotency: the synthetic owner and Super Admin are upserted by
// `externalId`, categories are resolved by slug (seeded separately by
// `categories:seedCategories`), and a business is inserted only when the seed
// owner has no business of that name. Re-running therefore returns the same
// ids and writes nothing. Menus are child rows of a business, so they cannot be
// seeded inside `ensureFixture` (that early-returns for an existing business):
// `seedBusinesses` ensures any declared menu on EVERY run, insert-only and
// keyed by group/item name. The fixture contract (statuses, categories,
// ratings, hours, timezones, deterministic feed offsets) lives in
// `seedFixtures.ts` and is pinned by `scripts/business-seed.test.ts`.
//
// This module exists so `businesses/transition` stays a pure state machine —
// the seed never fabricates a transition, it writes the terminal docs directly.

// A fresh dev deployment has no `users` rows (they are created by the Clerk
// webhook) while `businesses.ownerId` is a required `v.id('users')`, so the
// seed must guarantee an owner row exists before inserting listings. The
// approving Super Admin row is seeded the same way for `verification.verifiedBy`.
const SEED_OWNER_EXTERNAL_ID = 'seed-owner-localconnect';
const SEED_OWNER_NAME = 'LocalConnect Seed Owner';

// `verification.verifiedBy` must reference the approving Super Admin, not the
// listing's owner, so the seed upserts a dedicated `superAdmin` row.
const SEED_ADMIN_EXTERNAL_ID = 'seed-admin-localconnect';
const SEED_ADMIN_NAME = 'LocalConnect Seed Admin';

// Bounded reads for the menu seed: the fixture is tiny, but the idempotency
// lookups must stay bounded even if an owner has grown the menu. The caps are
// the same order of magnitude as `convex/menus.ts` (50 groups / 200 items).
const MAX_SEED_MENU_GROUPS = 200;
const MAX_SEED_MENU_ITEMS_PER_GROUP = 200;

/**
 * Seeds the B4 discovery fixtures against the DEV deployment. Returns the seed
 * owner/admin ids and every fixture's id + status for the seed script to log.
 */
export const seedBusinesses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ownerId = await ensureSeedOwner(ctx);
    const adminId = await ensureSeedAdmin(ctx);
    const now = Date.now();

    const categoryIds = new Map<string, Id<'categories'>>();
    const seeded: { name: string; status: SeedFixture['status']; businessId: Id<'businesses'> }[] =
      [];

    for (const fixture of SEED_FIXTURES) {
      let categoryId = categoryIds.get(fixture.categorySlug);
      if (categoryId === undefined) {
        categoryId = await categoryIdBySlug(ctx, fixture.categorySlug);
        categoryIds.set(fixture.categorySlug, categoryId);
      }

      const businessId = await ensureFixture(ctx, ownerId, adminId, categoryId, now, fixture);
      // Menus are ensured for EVERY fixture, including one that `ensureFixture`
      // just returned early for: on a deployment seeded before B8 the business
      // exists but its menu child rows do not.
      if (fixture.menu !== undefined) {
        await ensureMenuFixture(ctx, businessId, fixture.menu);
      }
      seeded.push({ name: fixture.name, status: fixture.status, businessId });
    }

    return { ownerId, adminId, seeded };
  },
});

/** Upserts the synthetic seed owner so business inserts always have a valid `ownerId`. */
async function ensureSeedOwner(ctx: MutationCtx): Promise<Id<'users'>> {
  const existing = await ctx.db
    .query('users')
    .withIndex('byExternalId', (q) => q.eq('externalId', SEED_OWNER_EXTERNAL_ID))
    .unique();

  if (existing !== null) {
    return existing._id;
  }

  return await ctx.db.insert('users', {
    name: SEED_OWNER_NAME,
    externalId: SEED_OWNER_EXTERNAL_ID,
    role: 'user',
  });
}

/** Upserts the synthetic Super Admin so approved listings can stamp `verifiedBy`. */
async function ensureSeedAdmin(ctx: MutationCtx): Promise<Id<'users'>> {
  const existing = await ctx.db
    .query('users')
    .withIndex('byExternalId', (q) => q.eq('externalId', SEED_ADMIN_EXTERNAL_ID))
    .unique();

  if (existing !== null) {
    return existing._id;
  }

  return await ctx.db.insert('users', {
    name: SEED_ADMIN_NAME,
    externalId: SEED_ADMIN_EXTERNAL_ID,
    role: 'superAdmin',
  });
}

/** Resolves a seeded category by slug; fails loudly when the category seed has not run. */
async function categoryIdBySlug(ctx: MutationCtx, slug: string): Promise<Id<'categories'>> {
  const category = await ctx.db
    .query('categories')
    .withIndex('bySlug', (q) => q.eq('slug', slug))
    .unique();

  if (category === null) {
    throw new Error(`Seed requires category "${slug}"; run categories:seedCategories first`);
  }

  return category._id;
}

/**
 * Inserts one fixture once; subsequent runs return the existing id. Relative
 * fixture offsets become absolute timestamps against this run's `now`, so feed
 * ordering (featured by lastUpdatedAt, new by submittedAt, verified by
 * verifiedAt) is deterministic across fresh deployments.
 */
async function ensureFixture(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  adminId: Id<'users'>,
  categoryId: Id<'categories'>,
  now: number,
  fixture: SeedFixture
): Promise<Id<'businesses'>> {
  const existing = await findOwnedBusinessId(ctx, ownerId, fixture.name);
  if (existing !== null) {
    return existing;
  }

  const lastUpdatedAt = now - fixture.lastUpdatedAtAgoMs;
  const submittedAt =
    fixture.submittedAtAgoMs === undefined ? undefined : now - fixture.submittedAtAgoMs;
  const verifiedAt = fixture.verifiedAgoMs === undefined ? undefined : now - fixture.verifiedAgoMs;

  // `photos` stays empty on purpose: `photos[].storageId` is `v.id('_storage')`,
  // so a placeholder URL cannot live on the doc — card components render a
  // category-tinted placeholder. Real uploads are B7.
  return await ctx.db.insert('businesses', {
    name: fixture.name,
    categoryId,
    description: fixture.description,
    address: fixture.address,
    phone: fixture.phone,
    email: fixture.email,
    website: fixture.website,
    timezone: fixture.timezone,
    photos: [],
    hours: fixture.hours,
    status: fixture.status,
    // `verifiedBy` must reference the approving Super Admin, so the seed stamps
    // the seeded Super Admin row rather than the listing's owner.
    verification:
      verifiedAt === undefined
        ? { isVerified: false }
        : { isVerified: true, verifiedAt, verifiedBy: adminId },
    rating: fixture.rating,
    ratingCount: fixture.ratingCount,
    services: fixture.services,
    credentials: fixture.credentials,
    keywords: fixture.keywords,
    searchText: buildSearchText(fixture.name, fixture.keywords, fixture.description),
    ownerId,
    lastUpdatedAt,
    submittedAt,
    isFeatured: fixture.isFeatured,
    moderatedAt: verifiedAt ?? submittedAt,
    lastSavedAt: lastUpdatedAt,
  });
}

/** Idempotency key: this seed owner's business with the given name, if any. */
async function findOwnedBusinessId(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  name: string
): Promise<Id<'businesses'> | null> {
  const owned = await ctx.db
    .query('businesses')
    .withIndex('byOwnerId', (q) => q.eq('ownerId', ownerId))
    .collect();

  const match = owned.find((business) => business.name === name);
  return match?._id ?? null;
}

/**
 * Seeds one fixture's menu idempotently. Called on every `seedBusinesses` run,
 * including runs where `ensureFixture` found the business already present.
 *
 * Idempotency keys: groups by (businessId, name), items by (groupId, name).
 * Missing rows are inserted; existing rows are never patched, so an owner's
 * edits (rename, price, availability, reorder) survive a re-seed. `ordering` is
 * the fixture array index, which keeps the seeded tab order stable.
 *
 * B8 tracer data: the "Build Your Bowl" item drives the ordering-panel flow.
 */
async function ensureMenuFixture(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  menu: SeedMenuFixture
): Promise<void> {
  const groups = await ctx.db
    .query('menuGroups')
    .withIndex('byBusinessIdOrdering', (q) => q.eq('businessId', businessId))
    .take(MAX_SEED_MENU_GROUPS);
  const groupIdByName = new Map<string, Id<'menuGroups'>>();
  for (const group of groups) {
    groupIdByName.set(group.name, group._id);
  }

  for (const [ordering, group] of menu.groups.entries()) {
    let groupId = groupIdByName.get(group.name);
    if (groupId === undefined) {
      groupId = await insertSeedMenuGroup(ctx, businessId, group, ordering);
    }
    await ensureMenuItems(ctx, businessId, groupId, group.items);
  }
}

/** Inserts one missing group at its fixture index (B8 dev seed data). */
async function insertSeedMenuGroup(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  group: SeedMenuGroupFixture,
  ordering: number
): Promise<Id<'menuGroups'>> {
  return await ctx.db.insert('menuGroups', {
    businessId,
    name: group.name,
    description: group.description,
    ordering,
  });
}

/**
 * Inserts only the items missing from a group, keyed by name. The `byGroupId`
 * read is bounded; ordering is the item's fixture index. Existing documents are
 * left untouched so owner edits win.
 */
async function ensureMenuItems(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  groupId: Id<'menuGroups'>,
  items: SeedMenuItemFixture[]
): Promise<void> {
  const existing = await ctx.db
    .query('menuItems')
    .withIndex('byGroupId', (q) => q.eq('groupId', groupId))
    .take(MAX_SEED_MENU_ITEMS_PER_GROUP);
  const existingNames = new Set(existing.map((item) => item.name));

  for (const [ordering, item] of items.entries()) {
    if (existingNames.has(item.name)) {
      continue;
    }
    await ctx.db.insert('menuItems', {
      businessId,
      groupId,
      name: item.name,
      description: item.description,
      price: item.price,
      customizationOptions: item.customizationOptions,
      ordering,
      isAvailable: item.isAvailable,
      nutrition: item.nutrition,
    });
  }
}
