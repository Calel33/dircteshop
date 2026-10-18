#!/usr/bin/env node
/**
 * Pins the B6b audited business CSV export contract (issue #16, Task 6):
 *
 * - The exact header `name,category,status,owner,rating,createdAt,submittedAt,
 *   lastUpdatedAt`, with one record per input row in input order.
 * - Dates are UTC ISO 8601; a missing `submittedAt` renders BLANK (not "null",
 *   not the epoch, not a locale string).
 * - CSV escaping follows RFC 4180: values carrying a comma, a quote, or a line
 *   break are quoted, and quotes inside a value are doubled.
 * - String-sourced cells (`name`, `category`, `owner`) that could open as a
 *   spreadsheet formula (`=`, `+`, `-`, `@`, tab, or CR — including after
 *   leading whitespace/control characters) are neutralized with a single
 *   quote (OWASP CSV-injection guard). Numeric and ISO-date columns are not.
 * - The pure page-size policy rejects requests larger than 25 rows.
 * - The completion-audit builder produces the frozen event shape: action
 *   `exportBusinessesCsv`, targetType `businesses`, targetId `all`.
 *
 * `convex/adminExportPolicy.ts` imports only types from generated Convex
 * modules, so the pure helpers are asserted without a live Convex deployment.
 * The fake-page test covers retrying a `SplitRequired` result at the same
 * cursor; this suite does not invoke the guarded query, Server Action, audit
 * mutation, or browser download. Those authenticated runtime checks remain
 * outstanding.
 *
 * Run: node --test scripts/admin-export-policy.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Id } from '../convex/_generated/dataModel.ts';
import {
  EXPORT_CSV_HEADER,
  EXPORT_MAXIMUM_ROWS_READ,
  EXPORT_PAGE_SIZE,
  assertExportPageSize,
  buildBusinessExportCsv,
  buildBusinessExportFileName,
  buildExportCompletionAuditLog,
  collectExportPages,
  escapeCsvField,
  formatExportDate,
  neutralizeFormula,
  reduceExportPageSize,
  type BusinessExportRow,
} from '../convex/adminExportPolicy.ts';

/** A schema-shaped export row; timestamps are the well-known 2023-11-14 epoch. */
function exportRowFixture(overrides: Partial<BusinessExportRow> = {}): BusinessExportRow {
  return {
    name: 'Blue Harbor Diner',
    category: 'Food & Drink',
    status: 'approved',
    owner: 'Maya Chen',
    rating: 4.6,
    createdAt: 1_700_000_000_000, // 2023-11-14T22:13:20.000Z
    submittedAt: 1_700_000_000_500, // 2023-11-14T22:13:20.500Z
    lastUpdatedAt: 1_700_000_004_000, // 2023-11-14T22:13:24.000Z
    ...overrides,
  };
}

/** Minimal RFC 4180 parser used ONLY to prove the generated file round-trips. */
function parseCsv(csv: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (inQuotes) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      record.push(field);
      field = '';
    } else if (char === '\r' && csv[i + 1] === '\n') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
      i += 1;
    } else {
      field += char;
    }
  }

  return records;
}

test('the header is the exact frozen column list', () => {
  assert.equal(
    EXPORT_CSV_HEADER,
    'name,category,status,owner,rating,createdAt,submittedAt,lastUpdatedAt'
  );
});

test('export pages are capped at 25 rows and the server rejects more', () => {
  assert.equal(EXPORT_PAGE_SIZE, 25);
  assert.equal(EXPORT_MAXIMUM_ROWS_READ, 100);
  assert.doesNotThrow(() => assertExportPageSize(1));
  assert.doesNotThrow(() => assertExportPageSize(25));
  assert.throws(() => assertExportPageSize(26), /limited to 25/);
  assert.throws(() => assertExportPageSize(500), /limited to 25/);
});

test('a split-required export page retries smaller without reaching a zero-sized page', () => {
  assert.equal(reduceExportPageSize(25), 12);
  assert.equal(reduceExportPageSize(12), 6);
  assert.equal(reduceExportPageSize(2), 1);
  assert.equal(reduceExportPageSize(1), 1);
});

test('a split-required export page retries the same cursor and discards its incomplete rows', async () => {
  const requested: { numItems: number; cursor: string | null }[] = [];
  const pages = [
    {
      page: ['incomplete row'],
      isDone: false,
      continueCursor: 'cursor-after-incomplete-page',
      pageStatus: 'SplitRequired' as const,
    },
    { page: ['first complete row'], isDone: false, continueCursor: 'cursor-1' },
    { page: ['second complete row'], isDone: true, continueCursor: 'cursor-2' },
  ];

  const rows = await collectExportPages(async (options) => {
    requested.push(options);
    const page = pages.shift();
    assert.ok(page);
    return page;
  });

  assert.deepStrictEqual(rows, ['first complete row', 'second complete row']);
  assert.deepStrictEqual(requested, [
    { numItems: 25, cursor: null },
    { numItems: 12, cursor: null },
    { numItems: 25, cursor: 'cursor-1' },
  ]);
});

test('dates render as UTC ISO 8601', () => {
  assert.equal(formatExportDate(1_700_000_000_000), '2023-11-14T22:13:20.000Z');
  assert.equal(formatExportDate(1_700_000_000_500), '2023-11-14T22:13:20.500Z');
  assert.equal(formatExportDate(0), '1970-01-01T00:00:00.000Z');
});

test('a missing submittedAt renders blank — not "null", not the epoch', () => {
  assert.equal(formatExportDate(null), '');
  assert.equal(formatExportDate(undefined), '');

  const csv = buildBusinessExportCsv([
    exportRowFixture({ submittedAt: null }),
    exportRowFixture({ submittedAt: undefined }),
  ]);
  assert.equal(csv.includes('null'), false);
  assert.equal(csv.includes('1970-'), false);

  for (const [, , , , , , submittedAt] of parseCsv(csv).slice(1)) {
    assert.equal(submittedAt, '');
  }
});

test('escaping follows RFC 4180: quote on comma/quote/newline, double the quotes', () => {
  assert.equal(escapeCsvField('Acme Coffee'), 'Acme Coffee');
  assert.equal(escapeCsvField('Cedar & Sage'), 'Cedar & Sage');
  assert.equal(escapeCsvField('Comma, Corp'), '"Comma, Corp"');
  assert.equal(escapeCsvField('He said "hi"'), '"He said ""hi"""');
  assert.equal(escapeCsvField('"'), '""""');
  assert.equal(escapeCsvField('Line1\nLine2'), '"Line1\nLine2"');
  assert.equal(escapeCsvField('Carriage\r\nReturn'), '"Carriage\r\nReturn"');
});

test('formula triggers are neutralized with a leading single quote', () => {
  assert.equal(neutralizeFormula('=1+1'), "'=1+1");
  assert.equal(neutralizeFormula('@SUM'), "'@SUM");
  assert.equal(neutralizeFormula('-5'), "'-5");
  assert.equal(neutralizeFormula('+cmd'), "'+cmd");
  assert.equal(
    neutralizeFormula('=HYPERLINK("https://evil.example","Click")'),
    '\'=HYPERLINK("https://evil.example","Click")'
  );
});

test('leading whitespace or control characters do not disarm a formula trigger', () => {
  assert.equal(neutralizeFormula('  =1+1'), "'  =1+1");
  assert.equal(neutralizeFormula(' +cmd'), "' +cmd");
  assert.equal(neutralizeFormula('\t@SUM'), "'\t@SUM");
  assert.equal(neutralizeFormula('\r=1+1'), "'\r=1+1");
  assert.equal(neutralizeFormula('\tanything'), "'\tanything");
});

test('safe text passes the formula guard unchanged', () => {
  assert.equal(neutralizeFormula('Acme Coffee'), 'Acme Coffee');
  assert.equal(neutralizeFormula('Cedar & Sage'), 'Cedar & Sage');
  assert.equal(neutralizeFormula('  Acme Coffee  '), '  Acme Coffee  ');
  assert.equal(neutralizeFormula(''), '');
});

test('formula-triggering name/category/owner cells round-trip as literal text', () => {
  const csv = buildBusinessExportCsv([
    exportRowFixture({
      name: '=HYPERLINK("https://evil.example","Click")',
      category: '@SUM',
      owner: ' -5',
      rating: -5,
    }),
  ]);

  const [, row] = parseCsv(csv);
  assert.equal(row[0], '\'=HYPERLINK("https://evil.example","Click")');
  assert.equal(row[1], "'@SUM");
  assert.equal(row[3], "' -5");
  // Numeric and ISO-date columns are never neutralized.
  assert.equal(row[2], 'approved');
  assert.equal(row[4], '-5');
  assert.equal(row[5], '2023-11-14T22:13:20.000Z');
  assert.equal(row[7], '2023-11-14T22:13:24.000Z');
});

test('one clean row serializes exactly: header, CRLF separators, column order', () => {
  const csv = buildBusinessExportCsv([exportRowFixture()]);
  assert.equal(
    csv,
    'name,category,status,owner,rating,createdAt,submittedAt,lastUpdatedAt\r\n' +
      'Blue Harbor Diner,Food & Drink,approved,Maya Chen,4.6,' +
      '2023-11-14T22:13:20.000Z,2023-11-14T22:13:20.500Z,2023-11-14T22:13:24.000Z\r\n'
  );
});

test('an empty table still exports the header record', () => {
  assert.equal(buildBusinessExportCsv([]), `${EXPORT_CSV_HEADER}\r\n`);
});

test('rating 0 and integer ratings serialize verbatim', () => {
  const csv = buildBusinessExportCsv([
    exportRowFixture({ rating: 0 }),
    exportRowFixture({ rating: 5 }),
  ]);
  const [, zeroRow, fiveRow] = parseCsv(csv);
  assert.equal(zeroRow[4], '0');
  assert.equal(fiveRow[4], '5');
});

test('hostile values survive a round-trip through a strict parser', () => {
  const csv = buildBusinessExportCsv([
    exportRowFixture({
      name: 'Bait, Shop "Q"',
      category: 'Food\n& Drink',
      owner: 'CRLF\r\nOwner',
      status: 'pendingReview',
    }),
  ]);

  const [header, row] = parseCsv(csv);
  assert.deepStrictEqual(header, [
    'name',
    'category',
    'status',
    'owner',
    'rating',
    'createdAt',
    'submittedAt',
    'lastUpdatedAt',
  ]);
  assert.deepStrictEqual(row, [
    'Bait, Shop "Q"',
    'Food\n& Drink',
    'pendingReview',
    'CRLF\r\nOwner',
    '4.6',
    '2023-11-14T22:13:20.000Z',
    '2023-11-14T22:13:20.500Z',
    '2023-11-14T22:13:24.000Z',
  ]);
});

test('the download file name is the UTC day of the export', () => {
  assert.equal(buildBusinessExportFileName(1_700_000_000_000), 'businesses-export-2023-11-14.csv');
});

test('the completion audit event carries the frozen action and target', () => {
  assert.deepStrictEqual(
    buildExportCompletionAuditLog({
      actorUserId: 'users_admin' as Id<'users'>,
      createdAt: 1_700_000_000_000,
    }),
    {
      actorUserId: 'users_admin' as Id<'users'>,
      action: 'exportBusinessesCsv',
      targetType: 'businesses',
      targetId: 'all',
      targetName: 'Business CSV export',
      createdAt: 1_700_000_000_000,
    }
  );
});
