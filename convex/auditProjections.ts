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
// B6b (issue #16) adds the optional local date range: the UI's local
// `from`/`through` calendar dates become an inclusive start / exclusive
// next-day `createdAt` window that the handler applies to `byCreatedAt`
// before pagination, so the date filter composes with the existing filters
// without scanning outside the window.
//
// Rows survive target deletion by design: `targetName` prefers the stored
// snapshot (B6a delete rows REQUIRE one) and only then falls back to the live
// business name, so a deleted listing stays readable in the audit feed.
//
// Contract: tasks/issue-15-contracts.md §B3/§B4.
// Docs: https://docs.convex.dev/database/pagination · https://docs.convex.dev/database/reading-data/indexes
// B6b: https://github.com/Calel33/dircteshop/issues/16

/** The frozen audit page size (contract §B3; mirrors the directory page cap). */
export const AUDIT_PAGE_SIZE = 25;

/**
 * Server-owned cap on the rows one audit page may scan (contract §B3). The
 * page size bounds only the returned items; `endCursor` sets an index range, so
 * a client could otherwise ask Convex to read far more rows than the page
 * holds. Filtering happens after pagination, so 4x the page size leaves
 * headroom for reactive page splits without letting an oversized range scan
 * the whole table. When the cap is hit, Convex returns `pageStatus` /
 * `splitCursor` and the paginated client splits the page.
 */
export const AUDIT_MAXIMUM_ROWS_READ = AUDIT_PAGE_SIZE * 4;

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

/**
 * The local calendar-date range the audit UI submits (B6b, issue #16):
 * `YYYY-MM-DD` strings in the admin's local timezone. A blank/absent bound
 * stays open; `through` is inclusive, so its exclusive upper bound is the
 * local start of the following day.
 */
export type AuditDateRange = {
  from?: string;
  through?: string;
};

/** The half-open `createdAt` window handed to `byCreatedAt` (epoch ms). */
export type AuditCreatedAtBounds = {
  /** Inclusive lower bound: the local start of `from`. */
  createdAtFrom?: number;
  /** Exclusive upper bound: the local start of the day after `through`. */
  createdAtBefore?: number;
};

/**
 * Parses one `YYYY-MM-DD` local calendar date to local-midnight epoch ms,
 * shifted by `dayOffset` days. The Date constructor resolves the local day
 * boundary and rolls month/year over (the same local-midnight math as
 * `localMonthRange` in `./adminProjections.ts`), so DST transitions stay
 * correct. Malformed strings and impossible calendar days (e.g. `2026-02-31`)
 * throw instead of silently matching the whole feed.
 */
function localDayStartMs(date: string, dayOffset = 0): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    throw new ConvexError(`Invalid audit date "${date}"; expected YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const resolved = new Date(year, month - 1, day);
  if (
    resolved.getFullYear() !== year ||
    resolved.getMonth() !== month - 1 ||
    resolved.getDate() !== day
  ) {
    throw new ConvexError(`Invalid audit date "${date}"; that calendar day does not exist.`);
  }

  return new Date(year, month - 1, day + dayOffset).getTime();
}

/**
 * Converts the UI's local `from`/`through` dates to the half-open `createdAt`
 * window (B6b): `from` is the inclusive local start of that day and `through`
 * is the exclusive local start of the next day, so a row at any local time on
 * the `through` day stays visible. An inverted range (`from` after `through`)
 * throws rather than silently returning the unfiltered feed.
 */
export function resolveAuditCreatedAtBounds(range: AuditDateRange): AuditCreatedAtBounds {
  const from = normalizeAuditFilter(range.from);
  const through = normalizeAuditFilter(range.through);

  const bounds: AuditCreatedAtBounds = {};

  if (from !== undefined) {
    bounds.createdAtFrom = localDayStartMs(from);
  }

  if (through !== undefined) {
    const throughStart = localDayStartMs(through);
    if (bounds.createdAtFrom !== undefined && bounds.createdAtFrom > throughStart) {
      throw new ConvexError('Invalid audit date range: "from" is after "through".');
    }
    bounds.createdAtBefore = localDayStartMs(through, 1);
  }

  return bounds;
}

/**
 * The server-side guard for the numeric window (contract §B3): a client could
 * still send an inverted or empty window directly, and that must fail loudly
 * instead of silently returning every row. One-sided bounds are legitimate.
 */
export function assertAuditCreatedAtBounds(bounds: {
  createdAtFrom?: number;
  createdAtBefore?: number;
}): void {
  const { createdAtFrom, createdAtBefore } = bounds;
  if (
    createdAtFrom !== undefined &&
    createdAtBefore !== undefined &&
    createdAtFrom >= createdAtBefore
  ) {
    throw new ConvexError('Invalid audit date range: the start bound is not before the end bound.');
  }
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
