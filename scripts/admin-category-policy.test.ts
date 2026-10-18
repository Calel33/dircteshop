#!/usr/bin/env node
/**
 * Pins the B6b Super Admin category management policy (issue #16, Task 5):
 *
 * - Slugs are generated from the name (or normalized from an explicit one).
 *   This suite tests normalization, not the handler's database uniqueness
 *   check or slug immutability after creation.
 * - A reorder request must be the complete, unique category id list; the
 *   persisted `ordering` is renumbered sequentially 1..n and only categories
 *   whose position actually changed produce a write + audit row.
 * - A category update that changes nothing is a no-op: no patch and no audit
 *   row (the `setFeatured` contract), and an emptied icon clears the optional
 *   field.
 * - The pure count-label helper displays capped reference counts as "100+".
 * - The audit-row builder emits the category target and frozen action names.
 *
 * `convex/categoryAdminPolicy.ts` imports only types from generated Convex
 * modules, so these pure helpers are tested without a live deployment. This
 * suite does not execute category handlers or verify authorization, server-side
 * delete blocking, reassignment, persistence, or audit integration; those
 * authenticated runtime checks remain outstanding.
 *
 * Run: node --test scripts/admin-category-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Id } from '../convex/_generated/dataModel.ts';
import {
  buildCategoryAuditLog,
  buildCategorySlug,
  CATEGORY_AUDIT_ACTIONS,
  CATEGORY_REFERENCE_LIMIT,
  describeCategoryUpdate,
  formatBusinessCount,
  normalizeCategoryIcon,
  normalizeCategoryName,
  planCategoryReorder,
} from '../convex/categoryAdminPolicy.ts';

function categoryId(value: string): Id<'categories'> {
  return value as Id<'categories'>;
}

// ---------------------------------------------------------------------------
// Name, slug, and icon normalization.
// ---------------------------------------------------------------------------

test('normalizeCategoryName trims and leaves blank input blank for the caller to reject', () => {
  assert.equal(normalizeCategoryName('  Food & Drink  '), 'Food & Drink');
  assert.equal(normalizeCategoryName('Retail'), 'Retail');
  assert.equal(normalizeCategoryName('   '), '');
  assert.equal(normalizeCategoryName(''), '');
});

test('buildCategorySlug derives a stable ASCII hyphen slug from a name', () => {
  assert.equal(buildCategorySlug('Food & Drink'), 'food-drink');
  assert.equal(buildCategorySlug('Beauty & Wellness'), 'beauty-wellness');
  assert.equal(buildCategorySlug('Retail'), 'retail');
  assert.equal(buildCategorySlug('  Legal Services  '), 'legal-services');
  assert.equal(buildCategorySlug('Hello   World!'), 'hello-world');
});

test('buildCategorySlug collapses separators, trims hyphens, and is idempotent', () => {
  assert.equal(buildCategorySlug('--Home--Services--'), 'home-services');
  assert.equal(buildCategorySlug('A  -  B'), 'a-b');

  // Same input, same slug — published URLs never drift for a given name.
  const once = buildCategorySlug('Professional Services');
  assert.equal(buildCategorySlug('Professional Services'), once);
  // Re-slugging an already-slugged value is a no-op.
  assert.equal(buildCategorySlug(once), once);
});

test('buildCategorySlug returns an empty string when nothing slug-worthy remains', () => {
  assert.equal(buildCategorySlug('!!!'), '');
  assert.equal(buildCategorySlug('   '), '');
  // The create mutation rejects the empty result, never inventing a slug.
  assert.equal(buildCategorySlug('&'), '');
});

test('normalizeCategoryIcon trims and treats blank as cleared', () => {
  assert.equal(normalizeCategoryIcon('utensils'), 'utensils');
  assert.equal(normalizeCategoryIcon('  scale  '), 'scale');
  assert.equal(normalizeCategoryIcon(''), undefined);
  assert.equal(normalizeCategoryIcon('   '), undefined);
});

// ---------------------------------------------------------------------------
// Update planning: no-op detection + audit reason.
// ---------------------------------------------------------------------------

test('describeCategoryUpdate returns null when nothing changed', () => {
  assert.equal(
    describeCategoryUpdate({ name: 'Retail', icon: 'shopping-bag' }, { name: 'Retail', icon: 'shopping-bag' }),
    null
  );
  assert.equal(describeCategoryUpdate({ name: 'Retail' }, { name: 'Retail' }), null);
});

test('describeCategoryUpdate names the changed fields', () => {
  assert.equal(describeCategoryUpdate({ name: 'Retail' }, { name: 'Retail Shops' }), 'Name updated');
  assert.equal(
    describeCategoryUpdate({ name: 'Retail', icon: 'shopping-bag' }, { name: 'Retail', icon: 'store' }),
    'Icon updated'
  );
  assert.equal(
    describeCategoryUpdate({ name: 'Retail', icon: 'shopping-bag' }, { name: 'Retail Shops', icon: 'store' }),
    'Name and icon updated'
  );
});

test('clearing an icon counts as an icon change', () => {
  assert.equal(
    describeCategoryUpdate({ name: 'Retail', icon: 'shopping-bag' }, { name: 'Retail', icon: undefined }),
    'Icon updated'
  );
  // Absent and empty are the same stored state, so they are not a change.
  assert.equal(describeCategoryUpdate({ name: 'Retail' }, { name: 'Retail', icon: undefined }), null);
});

// ---------------------------------------------------------------------------
// Reorder planning: complete unique list, sequential 1..n, changed rows only.
// ---------------------------------------------------------------------------

test('a full valid reorder renumbers sequentially and reports every changed row', () => {
  const existing = [
    { _id: categoryId('categories_a'), ordering: 1 },
    { _id: categoryId('categories_b'), ordering: 2 },
    { _id: categoryId('categories_c'), ordering: 3 },
  ];

  const plan = planCategoryReorder(existing, [
    categoryId('categories_c'),
    categoryId('categories_a'),
    categoryId('categories_b'),
  ]);

  assert.deepStrictEqual(plan, {
    ok: true,
    changes: [
      { categoryId: 'categories_c', from: 3, to: 1 },
      { categoryId: 'categories_a', from: 1, to: 2 },
      { categoryId: 'categories_b', from: 2, to: 3 },
    ],
  });
});

test('an unchanged order is a successful no-op with no writes', () => {
  const existing = [
    { _id: categoryId('categories_a'), ordering: 1 },
    { _id: categoryId('categories_b'), ordering: 2 },
  ];

  assert.deepStrictEqual(
    planCategoryReorder(existing, [categoryId('categories_a'), categoryId('categories_b')]),
    { ok: true, changes: [] }
  );
});

test('a gapped order is normalized to sequential values, touching only changed rows', () => {
  const existing = [
    { _id: categoryId('categories_a'), ordering: 1 },
    { _id: categoryId('categories_b'), ordering: 2 },
    { _id: categoryId('categories_c'), ordering: 7 },
  ];

  assert.deepStrictEqual(
    planCategoryReorder(existing, [
      categoryId('categories_a'),
      categoryId('categories_b'),
      categoryId('categories_c'),
    ]),
    { ok: true, changes: [{ categoryId: 'categories_c', from: 7, to: 3 }] }
  );
});

test('a partial reorder is rejected with a clear message', () => {
  const existing = [
    { _id: categoryId('categories_a'), ordering: 1 },
    { _id: categoryId('categories_b'), ordering: 2 },
  ];

  assert.deepStrictEqual(planCategoryReorder(existing, [categoryId('categories_a')]), {
    ok: false,
    message: 'The reorder must include every category exactly once.',
  });
});

test('a duplicated id is rejected', () => {
  const existing = [
    { _id: categoryId('categories_a'), ordering: 1 },
    { _id: categoryId('categories_b'), ordering: 2 },
  ];

  assert.deepStrictEqual(
    planCategoryReorder(existing, [categoryId('categories_a'), categoryId('categories_a')]),
    { ok: false, message: 'The reorder must include every category exactly once.' }
  );
});

test('an unknown id is rejected', () => {
  const existing = [
    { _id: categoryId('categories_a'), ordering: 1 },
    { _id: categoryId('categories_b'), ordering: 2 },
  ];

  assert.deepStrictEqual(
    planCategoryReorder(existing, [categoryId('categories_a'), categoryId('categories_zzz')]),
    { ok: false, message: 'The reorder references an unknown category.' }
  );
});

// ---------------------------------------------------------------------------
// Reference count label + audit row builder.
// ---------------------------------------------------------------------------

test('the reference count cap is 100 and formatBusinessCount marks capped counts', () => {
  assert.equal(CATEGORY_REFERENCE_LIMIT, 100);

  assert.equal(formatBusinessCount(1, false), '1 business');
  assert.equal(formatBusinessCount(2, false), '2 businesses');
  assert.equal(formatBusinessCount(100, false), '100 businesses');
  assert.equal(formatBusinessCount(100, true), '100+ businesses');
  assert.equal(formatBusinessCount(101, true), '100+ businesses');
});

test('the category audit action vocabulary is frozen', () => {
  assert.deepStrictEqual([...CATEGORY_AUDIT_ACTIONS], [
    'createCategory',
    'updateCategory',
    'deleteCategory',
    'reorderCategory',
  ]);
});

test('buildCategoryAuditLog produces the B6a-shaped row with the category target', () => {
  const actorUserId = 'users_admin' as Id<'users'>;

  assert.deepStrictEqual(
    buildCategoryAuditLog({
      actorUserId,
      action: 'reorderCategory',
      targetId: 'categories_a',
      targetName: 'Retail',
      reason: 'ordering 3 -> 1',
      createdAt: 1_700_000_000_000,
    }),
    {
      actorUserId,
      action: 'reorderCategory',
      targetType: 'categories',
      targetId: 'categories_a',
      targetName: 'Retail',
      reason: 'ordering 3 -> 1',
      createdAt: 1_700_000_000_000,
    }
  );
});

test('buildCategoryAuditLog omits reason when absent instead of storing undefined', () => {
  const log = buildCategoryAuditLog({
    actorUserId: 'users_admin' as Id<'users'>,
    action: 'createCategory',
    targetId: 'categories_a',
    targetName: 'Retail',
    createdAt: 1_700_000_000_000,
  });

  assert.equal(Object.hasOwn(log, 'reason'), false);
  assert.equal(log.targetType, 'categories');
});
