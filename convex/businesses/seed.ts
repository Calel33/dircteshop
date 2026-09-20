import { internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { buildSearchText } from './helpers';

// Dev-only seed data for the LocalConnect reference profiles (B2). Nothing in
// this module is client-callable: every entry point is an `internalMutation`,
// runnable only from the CLI / Dashboard:
//
//   npx convex run businesses/seed:seedBusinesses
//
// Idempotency: the synthetic owner is upserted by `externalId`, categories are
// resolved by slug (seeded separately by `categories:seedCategories`), and a
// business is inserted only when the seed owner has no business of that name.
// Re-running therefore returns the same ids and writes nothing.
//
// This module exists so `businesses/transition` stays a pure state machine —
// the seed never fabricates a transition, it writes the terminal docs directly.

// A fresh dev deployment has no `users` rows (they are created by the Clerk
// webhook) while `businesses.ownerId` is a required `v.id('users')`, so the
// seed must guarantee an owner row exists before inserting listings.
const SEED_OWNER_EXTERNAL_ID = 'seed-owner-localconnect';
const SEED_OWNER_NAME = 'LocalConnect Seed Owner';

// The approved food-drink listing the generic public profile renders (plan T7/T8).
const APPROVED_FOOD_DRINK = {
  name: 'Sunrise Bakery & Café',
  description:
    'Neighbourhood bakery and café serving hand-rolled pastries, sourdough bread and single-origin coffee.',
  address: {
    addressLine1: '18 Maple Street',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62704',
    country: 'US',
  },
  phone: '+1 555 0134',
  website: 'https://sunrisebakery.example.com',
  hours: {
    monday: [{ opensAt: '07:00', closesAt: '17:00' }],
    tuesday: [{ opensAt: '07:00', closesAt: '17:00' }],
    wednesday: [{ opensAt: '07:00', closesAt: '17:00' }],
    thursday: [{ opensAt: '07:00', closesAt: '17:00' }],
    friday: [{ opensAt: '07:00', closesAt: '18:00' }],
    saturday: [{ opensAt: '08:00', closesAt: '16:00' }],
    sunday: [{ opensAt: '08:00', closesAt: '14:00' }],
  },
  services: ['Fresh bread', 'Pastries', 'Coffee', 'Cakes', 'Breakfast'],
  credentials: ['Certified Organic', 'Local Favourite 2025'],
  keywords: ['bakery', 'cafe', 'coffee', 'pastries', 'bread', 'breakfast'],
  rating: 4.6,
  ratingCount: 128,
};

// The draft retail listing that proves public queries hide non-approved docs.
const DRAFT_RETAIL = {
  name: 'Main Street Outfitters',
  description: 'Independent outdoor and everyday clothing shop for the Springfield community.',
  address: {
    addressLine1: '52 Main Street',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701',
    country: 'US',
  },
  phone: '+1 555 0199',
  services: ['Outdoor clothing', 'Footwear', 'Accessories'],
  credentials: [],
  keywords: ['outfitters', 'clothing', 'outdoor', 'gear', 'retail'],
};

/**
 * Seeds the two reference businesses against the DEV deployment. Returns the
 * seed owner id and both business ids for the seed script to log.
 */
export const seedBusinesses = internalMutation({
  args: {},
  handler: async (ctx) => {
    const ownerId = await ensureSeedOwner(ctx);
    const foodDrinkCategoryId = await categoryIdBySlug(ctx, 'food-drink');
    const retailCategoryId = await categoryIdBySlug(ctx, 'retail');
    const now = Date.now();

    const approvedBusinessId = await ensureApprovedFoodDrink(
      ctx,
      ownerId,
      foodDrinkCategoryId,
      now
    );
    const draftBusinessId = await ensureDraftRetail(ctx, ownerId, retailCategoryId, now);

    return { ownerId, approvedBusinessId, draftBusinessId };
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

/** Inserts the approved food-drink listing once; subsequent runs return the existing id. */
async function ensureApprovedFoodDrink(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  categoryId: Id<'categories'>,
  now: number
): Promise<Id<'businesses'>> {
  const existing = await findOwnedBusinessId(ctx, ownerId, APPROVED_FOOD_DRINK.name);
  if (existing !== null) {
    return existing;
  }

  // `photos` stays empty on purpose: `photos[].storageId` is `v.id('_storage')`,
  // so a placeholder URL cannot live on the doc — ProfileHero renders the
  // placeholder. Real uploads are B7.
  return await ctx.db.insert('businesses', {
    ...APPROVED_FOOD_DRINK,
    categoryId,
    photos: [],
    status: 'approved',
    // `verifiedBy` normally holds the approving Super Admin; the seed has only
    // the synthetic owner row, so it stamps that id (schema-valid, dev-only).
    verification: { isVerified: true, verifiedAt: now, verifiedBy: ownerId },
    searchText: buildSearchText(
      APPROVED_FOOD_DRINK.name,
      APPROVED_FOOD_DRINK.keywords,
      APPROVED_FOOD_DRINK.description
    ),
    ownerId,
    lastUpdatedAt: now,
    submittedAt: now,
    isFeatured: false,
    moderatedAt: now,
    lastSavedAt: now,
  });
}

/** Inserts the draft retail listing once; subsequent runs return the existing id. */
async function ensureDraftRetail(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  categoryId: Id<'categories'>,
  now: number
): Promise<Id<'businesses'>> {
  const existing = await findOwnedBusinessId(ctx, ownerId, DRAFT_RETAIL.name);
  if (existing !== null) {
    return existing;
  }

  return await ctx.db.insert('businesses', {
    ...DRAFT_RETAIL,
    categoryId,
    photos: [],
    hours: {},
    status: 'draft',
    verification: { isVerified: false },
    rating: 0,
    ratingCount: 0,
    searchText: buildSearchText(DRAFT_RETAIL.name, DRAFT_RETAIL.keywords, DRAFT_RETAIL.description),
    ownerId,
    lastUpdatedAt: now,
    isFeatured: false,
    lastSavedAt: now,
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
