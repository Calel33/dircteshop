import { ConvexError } from 'convex/values';
import type { PaginationResult } from 'convex/server';

import type { Doc, Id } from './_generated/dataModel';

/**
 * B6b audited business CSV export (issue #16, Task 6) — pure policy.
 *
 * The single source of truth for the export's frozen contract: the exact
 * header, UTC ISO 8601 date rendering, RFC 4180 field escaping, spreadsheet
 * formula neutralization, the server page bound, and the one completion audit
 * event. It imports only types from
 * generated Convex modules (plus `ConvexError`), so
 * `scripts/admin-export-policy.test.ts` asserts it under plain `node --test`
 * without a live deployment.
 *
 * Docs: RFC 4180 (https://www.rfc-editor.org/rfc/rfc4180) ·
 * https://docs.convex.dev/database/pagination
 */

/** The exact, frozen CSV header — column order is part of the contract. */
export const EXPORT_CSV_HEADER =
  'name,category,status,owner,rating,createdAt,submittedAt,lastUpdatedAt';

/** Export page size. Mirrors the audit/owners cap; the server rejects more. */
export const EXPORT_PAGE_SIZE = 25;

/** Scan budget for one paginated read (no in-function filter; margin mirrors audit). */
export const EXPORT_MAXIMUM_ROWS_READ = EXPORT_PAGE_SIZE * 4;

/** One audit event records a completed export; the action writes it last. */
export const EXPORT_COMPLETION_ACTION = 'exportBusinessesCsv';

/** The serializable row a guarded export page returns (no raw documents). */
export type BusinessExportRow = {
  name: string;
  category: string;
  status: Doc<'businesses'>['status'];
  owner: string;
  rating: number;
  createdAt: number;
  submittedAt: number | null;
  lastUpdatedAt: number;
};

/**
 * The server-owned export page bound. Throws rather than truncating: a client
 * cannot widen a page beyond the frozen contract.
 */
export function assertExportPageSize(numItems: number): void {
  if (numItems > EXPORT_PAGE_SIZE) {
    throw new ConvexError(`Export pages are limited to ${EXPORT_PAGE_SIZE} rows`);
  }
}

/** Halves a page that Convex marks incomplete; one row is the retry floor. */
export function reduceExportPageSize(numItems: number): number {
  return Math.max(1, Math.floor(numItems / 2));
}

/**
 * Reads every export page without advancing past an incomplete Convex page.
 * A `SplitRequired` result is retried at the same cursor with fewer rows; if
 * even one row cannot fit, the export fails instead of returning a partial CSV.
 */
export async function collectExportPages<T>(
  fetchPage: (options: {
    numItems: number;
    cursor: string | null;
  }) => Promise<Pick<PaginationResult<T>, 'page' | 'isDone' | 'continueCursor' | 'pageStatus'>>
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  let isDone = false;
  let pageSize = EXPORT_PAGE_SIZE;

  while (!isDone) {
    const page = await fetchPage({ numItems: pageSize, cursor });
    if (page.pageStatus === 'SplitRequired') {
      if (pageSize === 1) {
        throw new ConvexError('An export page exceeds the safe read limit.');
      }
      pageSize = reduceExportPageSize(pageSize);
      continue;
    }

    rows.push(...page.page);
    isDone = page.isDone;
    cursor = page.continueCursor;
    pageSize = EXPORT_PAGE_SIZE;
  }

  return rows;
}

/** UTC ISO 8601 for a timestamp; a missing date renders as an empty field. */
export function formatExportDate(timestamp: number | null | undefined): string {
  if (timestamp === null || timestamp === undefined) {
    return '';
  }
  return new Date(timestamp).toISOString();
}

/**
 * RFC 4180 §2.6–§2.7: a value containing a comma, a quote, or a line break is
 * wrapped in double quotes and its own quotes are doubled.
 */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Spreadsheet formula triggers (OWASP CSV injection): a cell whose first
 * significant character is `=`, `+`, `-`, or `@` — or whose first character
 * is a tab/CR — opens as a live formula in Excel/Sheets. Leading whitespace
 * and control characters do not disarm the sequence, so they are skipped
 * before the trigger check.
 */
const FORMULA_TRIGGER = /^[\s\p{Cc}]*[=+\-@\t\r]/u;

/**
 * OWASP CSV-injection guard for the string-sourced columns (`name`,
 * `category`, `owner`): a value that would open as a spreadsheet formula is
 * prefixed with a single quote so spreadsheet apps render it as literal text.
 * Numeric (rating) and ISO-date columns never pass through this guard.
 */
export function neutralizeFormula(value: string): string {
  if (FORMULA_TRIGGER.test(value)) {
    return `'${value}`;
  }
  return value;
}

/** Assembles the full CSV: header first, CRLF record separators (RFC 4180 §2.1–§2.2). */
export function buildBusinessExportCsv(rows: readonly BusinessExportRow[]): string {
  const lines = [EXPORT_CSV_HEADER];
  for (const row of rows) {
    lines.push(
      [
        escapeCsvField(neutralizeFormula(row.name)),
        escapeCsvField(neutralizeFormula(row.category)),
        escapeCsvField(row.status),
        escapeCsvField(neutralizeFormula(row.owner)),
        escapeCsvField(String(row.rating)),
        escapeCsvField(formatExportDate(row.createdAt)),
        escapeCsvField(formatExportDate(row.submittedAt)),
        escapeCsvField(formatExportDate(row.lastUpdatedAt)),
      ].join(',')
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Deterministic download name: the UTC day the export ran. */
export function buildBusinessExportFileName(nowMs: number): string {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return `businesses-export-${day}.csv`;
}

export type ExportCompletionAuditLog = {
  actorUserId: Id<'users'>;
  action: typeof EXPORT_COMPLETION_ACTION;
  targetType: 'businesses';
  targetId: 'all';
  targetName: 'Business CSV export';
  createdAt: number;
};

/** The single audit row written after a full export succeeds (never on failure). */
export function buildExportCompletionAuditLog(input: {
  actorUserId: Id<'users'>;
  createdAt: number;
}): ExportCompletionAuditLog {
  return {
    actorUserId: input.actorUserId,
    action: EXPORT_COMPLETION_ACTION,
    targetType: 'businesses',
    targetId: 'all',
    targetName: 'Business CSV export',
    createdAt: input.createdAt,
  };
}
