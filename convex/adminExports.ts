import { paginationOptsValidator, type PaginationResult } from 'convex/server';

import { mutation, query } from './_generated/server';
import {
  EXPORT_MAXIMUM_ROWS_READ,
  assertExportPageSize,
  buildExportCompletionAuditLog,
  type BusinessExportRow,
} from './adminExportPolicy';
import { requireSuperAdmin } from './authz';

// B6b audited business CSV export (issue #16, Task 6): the guarded read pages
// and the guarded completion write. The Server Action
// (app/admin/export-actions.ts) loops the read for every page of businesses,
// assembles the CSV, then records EXACTLY ONE completion audit event.
//
// Honest limits (v1, documented): each page is a separate authorized query, so
// there is NO snapshot isolation across pages — businesses created, deleted,
// or edited between page reads can shift which rows the export contains (this
// is stated, not claimed away; tasks/issue-16-plan.md risk table). Each page
// is bounded by `maximumRowsRead`; full coverage comes from paging, not from
// scanning the whole table in one function (Convex caps a function at ~32,000
// scanned documents / 16 MiB).
//
// Docs: https://docs.convex.dev/database/pagination ·
// https://docs.convex.dev/production/state/limits

/**
 * One page of ALL businesses (any status) for the export, in ascending
 * `_creationTime` order so cursor paging is deterministic. Category and owner
 * names are joined for the row; a dangling owner or missing category renders
 * blank rather than failing the export (owner-deletion policy is still open,
 * SPEC §3 — data egress must not depend on every join resolving).
 */
export const listBusinessesPage = query({
  args: { paginationOpts: paginationOptsValidator },
  // Explicit return type: the generated `fetchQuery` client type for a handler
  // that spreads `.paginate()` is otherwise self-referential for TypeScript
  // (TS7022 at the call site), which the repo avoids with annotations.
  handler: async (ctx, args): Promise<PaginationResult<BusinessExportRow>> => {
    await requireSuperAdmin(ctx);
    assertExportPageSize(args.paginationOpts.numItems);

    const page = await ctx.db
      .query('businesses')
      .order('asc')
      .paginate({ ...args.paginationOpts, maximumRowsRead: EXPORT_MAXIMUM_ROWS_READ });

    const rows: BusinessExportRow[] = await Promise.all(
      page.page.map(async (business) => {
        const [category, owner] = await Promise.all([
          ctx.db.get(business.categoryId),
          ctx.db.get(business.ownerId),
        ]);

        return {
          name: business.name,
          category: category?.name ?? '',
          status: business.status,
          owner: owner?.name ?? '',
          rating: business.rating,
          createdAt: business._creationTime,
          submittedAt: business.submittedAt ?? null,
          lastUpdatedAt: business.lastUpdatedAt,
        };
      })
    );

    return { ...page, page: rows };
  },
});

/**
 * The export's ONLY audit write. The Server Action calls it after the full CSV
 * was assembled successfully; a failed export never reaches this mutation, so
 * no completion event exists for it. Guarded like every admin entry point —
 * the actor is always the authenticated Super Admin doc, never a client value.
 */
export const recordBusinessesCsvExport = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireSuperAdmin(ctx);

    await ctx.db.insert(
      'auditLogs',
      buildExportCompletionAuditLog({ actorUserId: admin._id, createdAt: Date.now() })
    );
  },
});
