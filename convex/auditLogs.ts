import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';

import { query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { requireSuperAdmin } from './authz';
import {
  assertAuditPageSize,
  matchesAuditLogFilters,
  toAuditLogRow,
  type AuditLogFilters,
} from './auditProjections';

// B6a read-only audit feed (issue #15, Task 2). Super Admin only; there is no
// write path here — every row is written by its owning mutation's transaction.
// Contract: tasks/issue-15-contracts.md §B3/§B4.
// Docs: https://docs.convex.dev/database/pagination · https://docs.convex.dev/auth/functions-auth

/** Re-exported so clients can mirror the row type from the module they call. */
export type { AuditLogRow } from './auditProjections';

/**
 * Resolves the live business name for the target-name fallback. Rows whose
 * target is not a business (or whose string id no longer normalizes) resolve
 * to `null`; the stored snapshot remains the primary source, so a deleted
 * target's row stays readable.
 */
async function resolveLiveBusinessName(
  ctx: QueryCtx,
  log: Doc<'auditLogs'>
): Promise<string | null> {
  if (log.targetType !== 'business') {
    return null;
  }

  const businessId = ctx.db.normalizeId('businesses', log.targetId);
  if (businessId === null) {
    return null;
  }

  const business = await ctx.db.get(businessId);
  return business?.name ?? null;
}

/**
 * Super Admin audit feed (B6a): a cursor-paginated, newest-first page of at
 * most 25 audit rows, filterable by action (exact), actor (case-insensitive
 * substring over the joined actor name), and target/reason search
 * (case-insensitive substring over the resolved target name, target id, or
 * reason).
 *
 * The read is one `.paginate` on `byCreatedAt` descending (the runtime allows
 * one paginated query per invocation); the filters refine the scanned window
 * in-function and the returned page is every match from that window, so a
 * short page with a valid `continueCursor` is legitimate and no row is ever
 * skipped or silently dropped. Rows survive target deletion (snapshot-first
 * target names). Read-only: no mutation path is exposed here.
 */
export const listAuditLogs = query({
  args: {
    paginationOpts: paginationOptsValidator,
    action: v.optional(v.string()),
    actor: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    assertAuditPageSize(args.paginationOpts.numItems);

    const filters: AuditLogFilters = {
      action: args.action,
      actor: args.actor,
      search: args.search,
    };

    const page = await ctx.db
      .query('auditLogs')
      .withIndex('byCreatedAt')
      .order('desc')
      .paginate(args.paginationOpts);

    // Resolve the joins each row needs once: the actor name (for the actor
    // filter and the row) and the live business-name fallback (only for
    // business targets). Both run in parallel per row.
    const enriched = await Promise.all(
      page.page.map(async (log) => {
        const [actor, liveBusinessName] = await Promise.all([
          ctx.db.get('users', log.actorUserId),
          resolveLiveBusinessName(ctx, log),
        ]);
        return { log, actorName: actor?.name ?? null, liveBusinessName };
      })
    );

    const rows = enriched
      .filter(({ log, actorName, liveBusinessName }) =>
        matchesAuditLogFilters(
          {
            action: log.action,
            actorName,
            targetId: log.targetId,
            targetName: log.targetName ?? liveBusinessName ?? null,
            reason: log.reason,
          },
          filters
        )
      )
      .map(({ log, actorName, liveBusinessName }) =>
        toAuditLogRow({ log, actorName, liveBusinessName })
      );

    return { ...page, page: rows };
  },
});
