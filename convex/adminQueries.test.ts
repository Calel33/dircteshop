/// <reference types="vite/client" />
/**
 * Handler tests for the protected B6b `/admin` overview read (issue #16 review
 * follow-up, R2-M2): `api.adminQueries.overviewStats` behind `requireSuperAdmin`.
 * These drive the REAL handler (authz guard included) against the `convex-test`
 * mock backend, end to end — unlike `scripts/admin-overview.test.ts`, which
 * pins only the pure projections.
 *
 * Run: pnpm exec vitest run convex/adminQueries.test.ts
 */
import { expect, test } from 'vitest';
import { convexTest } from 'convex-test';
import type { TestConvex } from 'convex-test';

import schema from './schema';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';

const modules = import.meta.glob('./**/*.ts');

// `requireSuperAdmin` reads the live env whitelist on every request, so the
// admin's Clerk subject must be in it.
process.env.SUPER_ADMIN_CLERK_IDS = 'user_admin';

const NOW = 1_700_000_000_000;
/** A fixed window around the pending fixture, so local timezone never matters. */
const MONTH = { monthStart: 1_000_000, monthEndExclusive: 2_000_000 };

/** The full business insert shape (everything except the system fields). */
function businessBase(
  categoryId: Id<'categories'>,
  ownerId: Id<'users'>
): Omit<Doc<'businesses'>, '_id' | '_creationTime'> {
  return {
    name: 'Blue Harbor Diner',
    categoryId,
    description: '',
    address: { addressLine1: '', city: '', state: '', country: '' },
    timezone: 'America/New_York',
    photos: [],
    hours: {},
    status: 'draft',
    verification: { isVerified: false },
    rating: 0,
    ratingCount: 0,
    services: [],
    credentials: [],
    keywords: [],
    searchText: 'Blue Harbor Diner  ',
    ownerId,
    lastUpdatedAt: NOW,
    isFeatured: false,
    lastSavedAt: NOW,
  };
}

async function seed(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert('users', {
      name: 'Ada Admin',
      externalId: 'user_admin',
      role: 'superAdmin',
    });
    const ownerId = await ctx.db.insert('users', {
      name: 'Maya Owner',
      externalId: 'user_owner',
      role: 'user',
    });
    const categoryId = await ctx.db.insert('categories', {
      name: 'Food & Drink',
      slug: 'food-drink',
      ordering: 1,
    });

    await ctx.db.insert('businesses', {
      ...businessBase(categoryId, ownerId),
      name: 'Approved Cafe',
      status: 'approved',
      verification: { isVerified: true, verifiedAt: NOW },
    });
    await ctx.db.insert('businesses', {
      ...businessBase(categoryId, ownerId),
      name: 'Pending Cafe',
      status: 'pendingReview',
      submittedAt: 1_500_000,
    });
    // Below the window: excluded by the range's lower bound.
    await ctx.db.insert('businesses', {
      ...businessBase(categoryId, ownerId),
      name: 'Old Draft',
      submittedAt: 500_000,
    });
    // Exactly the upper bound: excluded (the window end is exclusive).
    await ctx.db.insert('businesses', {
      ...businessBase(categoryId, ownerId),
      name: 'Boundary Draft',
      submittedAt: 2_000_000,
    });
  });
}

test('overviewStats refuses callers without a Super Admin identity', async () => {
  const t = convexTest(schema, modules);
  await seed(t);

  await expect(t.query(api.adminQueries.overviewStats, MONTH)).rejects.toThrow('Unauthorized');

  await expect(
    t.withIdentity({ subject: 'user_owner' }).query(api.adminQueries.overviewStats, MONTH)
  ).rejects.toThrow('Forbidden');
});

test('overviewStats counts the seeded rows exactly inside the window', async () => {
  const t = convexTest(schema, modules);
  await seed(t);

  const stats = await t
    .withIdentity({ subject: 'user_admin' })
    .query(api.adminQueries.overviewStats, MONTH);

  expect(stats).toEqual({
    totalBusinesses: 4,
    pendingApprovals: 1,
    verifiedActive: 1,
    submissionsThisMonth: 1,
  });
});

test('overviewStats rejects an empty month window before reading', async () => {
  const t = convexTest(schema, modules);
  await seed(t);

  await expect(
    t
      .withIdentity({ subject: 'user_admin' })
      .query(api.adminQueries.overviewStats, { monthStart: 5, monthEndExclusive: 5 })
  ).rejects.toThrow('must end after it starts');
});
