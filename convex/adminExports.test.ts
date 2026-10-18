/// <reference types="vite/client" />
/**
 * Handler tests for the B6b audited CSV export (issue #16 review follow-up,
 * R2-M2): the guarded page read (non-admin denial + joined row shape), the
 * server page bound, and the ONE completion audit write. These drive the REAL
 * `api.adminExports` handlers against the `convex-test` mock backend; the pure
 * serialization policies stay pinned by `scripts/admin-export-policy.test.ts`.
 *
 * Run: pnpm exec vitest run convex/adminExports.test.ts
 */
import { expect, test } from 'vitest';
import { convexTest } from 'convex-test';
import type { TestConvex } from 'convex-test';

import schema from './schema';
import { api } from './_generated/api';

const modules = import.meta.glob('./**/*.ts');

// `requireSuperAdmin` reads the live env whitelist on every request, so the
// admin's Clerk subject must be in it.
process.env.SUPER_ADMIN_CLERK_IDS = 'user_admin';

const NOW = 1_700_000_000_000;

async function seed(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const adminId = await ctx.db.insert('users', {
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
      name: 'Blue Harbor Diner',
      categoryId,
      description: '',
      address: { addressLine1: '', city: '', state: '', country: '' },
      timezone: 'America/New_York',
      photos: [],
      hours: {},
      status: 'approved',
      verification: { isVerified: true },
      rating: 4.6,
      ratingCount: 12,
      services: [],
      credentials: [],
      keywords: [],
      searchText: 'Blue Harbor Diner  ',
      ownerId,
      lastUpdatedAt: NOW,
      isFeatured: false,
      lastSavedAt: NOW,
      submittedAt: NOW,
    });
    return { adminId, ownerId };
  });
}

test('the export page read refuses non-admins and rejects oversized pages', async () => {
  const t = convexTest(schema, modules);
  await seed(t);
  const pageArgs = { paginationOpts: { numItems: 25, cursor: null } };

  await expect(t.query(api.adminExports.listBusinessesPage, pageArgs)).rejects.toThrow(
    'Unauthorized'
  );
  await expect(
    t.withIdentity({ subject: 'user_owner' }).query(api.adminExports.listBusinessesPage, pageArgs)
  ).rejects.toThrow('Forbidden');
  await expect(
    t.withIdentity({ subject: 'user_admin' }).query(api.adminExports.listBusinessesPage, {
      paginationOpts: { numItems: 26, cursor: null },
    })
  ).rejects.toThrow('limited to 25');
});

test('the export page joins category and owner names for every status', async () => {
  const t = convexTest(schema, modules);
  await seed(t);

  const result = await t
    .withIdentity({ subject: 'user_admin' })
    .query(api.adminExports.listBusinessesPage, { paginationOpts: { numItems: 25, cursor: null } });

  expect(result.page).toHaveLength(1);
  const row = result.page[0];
  expect(row.name).toBe('Blue Harbor Diner');
  expect(row.category).toBe('Food & Drink');
  expect(row.owner).toBe('Maya Owner');
  expect(row.status).toBe('approved');
  expect(row.rating).toBe(4.6);
  expect(row.submittedAt).toBe(NOW);
});

test('recordBusinessesCsvExport is admin-only and writes exactly one completion audit row', async () => {
  const t = convexTest(schema, modules);
  const { adminId } = await seed(t);

  await expect(t.mutation(api.adminExports.recordBusinessesCsvExport, {})).rejects.toThrow(
    'Unauthorized'
  );
  await expect(
    t
      .withIdentity({ subject: 'user_owner' })
      .mutation(api.adminExports.recordBusinessesCsvExport, {})
  ).rejects.toThrow('Forbidden');

  // A successful page read writes NO audit row on its own.
  await t
    .withIdentity({ subject: 'user_admin' })
    .query(api.adminExports.listBusinessesPage, { paginationOpts: { numItems: 25, cursor: null } });
  let audits = await t.run((ctx) => ctx.db.query('auditLogs').collect());
  expect(audits).toHaveLength(0);

  await t
    .withIdentity({ subject: 'user_admin' })
    .mutation(api.adminExports.recordBusinessesCsvExport, {});

  audits = await t.run((ctx) => ctx.db.query('auditLogs').collect());
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    actorUserId: adminId,
    action: 'exportBusinessesCsv',
    targetType: 'businesses',
    targetId: 'all',
    targetName: 'Business CSV export',
  });
});
