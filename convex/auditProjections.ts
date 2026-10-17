import { ConvexError } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import type { ListingStatus } from './businesses/helpers';

// B6a audit-log projections + filter policy (issue #15, Task 2).
//
// The read-only `/admin/audit` surface pages `auditLogs` newest-first and
// filters by action (exact), actor (case-insensitive substring over the joined
// actor name), and target/reason search. This module is pure (only type
// imports from generated Convex modules) so it is `node --test`-able; the
// query handler in `./auditLogs.ts` (`listAuditLogs`) is a thin shell: it
// authorizes, paginates `byCreatedAt` descending, and maps the page.
//
// Rows survive target deletion by design: `targetName` prefers the stored
// snapshot (B6a delete rows REQUIRE one) and only then falls back to the live
// business name, so a deleted listing stays readable in the audit feed.
//
// Contract: tasks/issue-15-contracts.md §B3/§B4.
// Docs: https://docs.convex.dev/database/pagination

/** The frozen audit page size (contract §B3; mirrors the directory page cap). */
export const AUDIT_PAGE_SIZE = 25;

/**
 * The narrow audit row (frozen contract §B3). `reason` is `null` for actions
 * that carry none; `fromStatus`/`toStatus` are `null` for actions that never
 * change status (feature/delete/createDraft). `actorName`/`targetName` are
 * `null` when the join (or snapshot) has no value — never a raw doc.
 */
export type AuditLogRow = {
  _id: Id<'auditLogs'>;
  at: number; // createdAt
  action: string;
  actorName: string | null;
  targetType: string;
  targetId: string;
  targetName: string | null;
  fromStatus: ListingStatus | null;
  toStatus: ListingStatus | null;
  reason: string | null;
};

/** The optional audit filters (contract §B3). Values are raw client inputs. */
export type AuditLogFilters = {
  action?: string;
  actor?: string;
  search?: string;
};

/**
 * The server-side page bound (contract §B3): the client's `paginationOpts` is
 * never trusted to stay within the UI page size. Runs before any read.
 */
export function assertAuditPageSize(numItems: number): void {
  if (numItems > AUDIT_PAGE_SIZE) {
    throw new ConvexError(
      `Audit pages are limited to ${AUDIT_PAGE_SIZE} rows; requested ${numItems}.`
    );
  }
}

/** Trims a filter input and treats a blank one as "no filter". */
export function normalizeAuditFilter(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** The structural fields the audit matcher reads off one enriched row. */
export type AuditLogFilterFields = {
  action: string;
  actorName: string | null;
  targetId: string;
  targetName: string | null; // already resolved: snapshot ?? live ?? null
  reason: string | undefined;
};

/**
 * The full predicate for one scanned audit row: `action` matches exactly
 * (case-sensitive — the action vocabulary is a closed server-owned set);
 * `actor` is a case-insensitive substring over the joined actor name; search
 * is a case-insensitive substring over the resolved target name, target id, or
 * reason. Applied to every row of the scanned page; the returned page is every
 * match from that window, so a short page is legitimate and `continueCursor`
 * always advances past the whole window — no record is skipped (filters refine
 * the scanned window, contract §B3).
 */
export function matchesAuditLogFilters(
  fields: AuditLogFilterFields,
  filters: AuditLogFilters
): boolean {
  const action = normalizeAuditFilter(filters.action);
  if (action !== undefined && fields.action !== action) {
    return false;
  }

  const actor = normalizeAuditFilter(filters.actor);
  if (actor !== undefined && !(fields.actorName ?? '').toLowerCase().includes(actor.toLowerCase())) {
    return false;
  }

  const search = normalizeAuditFilter(filters.search);
  if (search !== undefined) {
    const needle = search.toLowerCase();
    const haystacks = [fields.targetName ?? '', fields.targetId, fields.reason ?? ''];
    if (!haystacks.some((value) => value.toLowerCase().includes(needle))) {
      return false;
    }
  }

  return true;
}

/**
 * Projects one enriched audit row to the frozen shape (contract §B3).
 * `targetName` resolves stored snapshot ?? live business name ?? null: the
 * snapshot is what keeps a hard-deleted listing's audit row readable, while
 * pre-B6a rows without a snapshot still resolve their live name.
 */
export function toAuditLogRow(input: {
  log: Doc<'auditLogs'>;
  actorName: string | null;
  liveBusinessName: string | null;
}): AuditLogRow {
  const { log, actorName, liveBusinessName } = input;

  return {
    _id: log._id,
    at: log.createdAt,
    action: log.action,
    actorName,
    targetType: log.targetType,
    targetId: log.targetId,
    targetName: log.targetName ?? liveBusinessName ?? null,
    fromStatus: log.fromStatus ?? null,
    toStatus: log.toStatus ?? null,
    reason: log.reason ?? null,
  };
}
