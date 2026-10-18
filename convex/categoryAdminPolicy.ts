import type { Id } from './_generated/dataModel';

// B6b Super Admin category management policy (issue #16, Task 5). Pure
// functions only — no Convex runtime imports — so every rule here is pinned by
// `scripts/admin-category-policy.test.ts`. `convex/categories.ts` wires these
// into `requireSuperAdmin`, the `bySlug` uniqueness check, the `byCategoryId`
// reference guard, and one atomic transaction per write.
//
// Contract decisions Frozen by the plan (tasks/issue-16-plan.md §Architecture
// decisions 5):
// - Slugs are unique (enforced in the mutation — Convex indexes cannot be
//   declared unique) and stable after creation; no admin surface ever updates
//   a slug.
// - The taxonomy stays flat: nothing here reads or writes `parentCategoryId`.
// - Reassignment is the owner editor's path, never an admin flow; the delete
//   guard only blocks and reports.

/**
 * Referencing-business count cap for the delete guard and the admin list. The
 * count is exact up to this value; beyond it the surfaces show "100+" rather
 * than a false number (B4: fail visibly, never a false total).
 */
export const CATEGORY_REFERENCE_LIMIT = 100;

/** Trims an admin-supplied name; blank stays blank for the caller to reject. */
export function normalizeCategoryName(raw: string): string {
  return raw.trim();
}

/**
 * Slug for a category: lowercase ASCII letters/digits with single hyphens.
 * Used for generated slugs (derived from the name) and to normalize an
 * explicit slug — both go through the identical rule so uniqueness checks
 * compare one canonical form. An empty result is rejected by the caller.
 */
export function buildCategorySlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Trims an admin-supplied icon name; the empty string clears the optional
 * field. (`ctx.db.patch` removes a field set to `undefined` —
 * https://docs.convex.dev/database/writing-data.)
 */
export function normalizeCategoryIcon(raw: string): string | undefined {
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Human-readable reason for an update audit row; `null` when nothing changed,
 * so a no-op update writes neither the patch nor a misleading audit row (the
 * `setFeatured` contract). Absent and cleared icons compare as the same state.
 */
export function describeCategoryUpdate(
  existing: { name: string; icon?: string },
  next: { name: string; icon?: string }
): string | null {
  const nameChanged = existing.name !== next.name;
  const iconChanged = (existing.icon ?? '') !== (next.icon ?? '');

  if (!nameChanged && !iconChanged) {
    return null;
  }
  if (nameChanged && iconChanged) {
    return 'Name and icon updated';
  }
  return nameChanged ? 'Name updated' : 'Icon updated';
}

/** One category whose persisted position a reorder would change. */
export type CategoryOrderingChange = {
  categoryId: Id<'categories'>;
  from: number;
  to: number;
};

export type CategoryOrderPlan =
  | { ok: false; message: string }
  | { ok: true; changes: CategoryOrderingChange[] };

/**
 * Validates a full reorder request against the live category set and plans
 * the sequential 1..n ordering. `orderedIds` must contain every existing
 * category exactly once — a partial, duplicated, or unknown list is rejected
 * so a reorder can never orphan or silently drop a category's position. Only
 * rows whose stored value actually changes are reported for the write+audit
 * loop, which keeps an unchanged reorder a true no-op.
 */
export function planCategoryReorder(
  existing: readonly { _id: Id<'categories'>; ordering: number }[],
  orderedIds: readonly Id<'categories'>[]
): CategoryOrderPlan {
  if (orderedIds.length !== existing.length || new Set(orderedIds).size !== orderedIds.length) {
    return { ok: false, message: 'The reorder must include every category exactly once.' };
  }

  const byId = new Map(existing.map((category) => [category._id, category] as const));

  for (const categoryId of orderedIds) {
    if (!byId.has(categoryId)) {
      return { ok: false, message: 'The reorder references an unknown category.' };
    }
  }

  const changes: CategoryOrderingChange[] = [];
  orderedIds.forEach((categoryId, index) => {
    const category = byId.get(categoryId);
    if (category === undefined) {
      return;
    }
    const to = index + 1;
    if (category.ordering !== to) {
      changes.push({ categoryId, from: category.ordering, to });
    }
  });

  return { ok: true, changes };
}

/**
 * Display + guard label for a referencing-business count: exact when under
 * the cap, `100+` (never a larger number) when the bounded read hit it. Used
 * by the delete guard's error message and mirrored by the admin surfaces.
 */
export function formatBusinessCount(count: number, isCapped: boolean): string {
  const display = Math.min(count, CATEGORY_REFERENCE_LIMIT);
  if (isCapped) {
    return `${display}+ businesses`;
  }
  return display === 1 ? '1 business' : `${display} businesses`;
}

/**
 * The frozen audit action vocabulary for category writes. Task 9 adds the
 * human-readable labels for these names to `app/admin/audit/audit-types.ts`.
 */
export const CATEGORY_AUDIT_ACTIONS = [
  'createCategory',
  'updateCategory',
  'deleteCategory',
  'reorderCategory',
] as const;

export type CategoryAuditAction = (typeof CATEGORY_AUDIT_ACTIONS)[number];

/** The B6a audit-row shape; `reason` is omitted (not stored) when absent. */
export type CategoryAuditLog = {
  actorUserId: Id<'users'>;
  action: CategoryAuditAction;
  targetType: 'categories';
  targetId: string;
  targetName: string;
  reason?: string;
  createdAt: number;
};

/**
 * Builds the audit row for a successful category write. The actor is always
 * the doc returned by `requireSuperAdmin` — never a client-supplied id — and
 * `targetName` is the name snapshot taken in the same transaction (B6a
 * convention; the hard-delete path relies on the snapshot surviving the row).
 */
export function buildCategoryAuditLog(input: {
  actorUserId: Id<'users'>;
  action: CategoryAuditAction;
  targetId: string;
  targetName: string;
  reason?: string;
  createdAt: number;
}): CategoryAuditLog {
  return {
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: 'categories',
    targetId: input.targetId,
    targetName: input.targetName,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    createdAt: input.createdAt,
  };
}
