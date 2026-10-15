#!/usr/bin/env node
/**
 * Pins the B4 directory query contract (issue #4, todo task 4):
 *
 * - trimmed `q` selects the search path; an empty term selects the approved
 *   browse path (never a fake search expression);
 * - Highly Rated is `rating >= 4.5 && ratingCount > 0`;
 * - the composed filter is the single predicate behind both the paginated list
 *   and the exact count, so list and total cannot disagree;
 * - the live handlers rebuild their single-use Convex query object for every
 *   read, so the multi-chunk page refill never reuses a consumed query.
 *
 * Run: node --test scripts/public-directory-query.test.ts
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

import type { Doc, Id } from '../convex/_generated/dataModel.ts';
import type { BusinessHours } from '../convex/businesses/publicHours.ts';
import {
  directoryMode,
  directorySearchTerm,
  isHighlyRated,
  matchesDirectoryFilters,
} from '../convex/businesses/directoryQuery.ts';

test('directorySearchTerm trims the raw query', () => {
  assert.equal(directorySearchTerm('  cafe  '), 'cafe');
  assert.equal(directorySearchTerm('coffee shop'), 'coffee shop');
});

test('directoryMode sends nonempty trimmed terms to search and empty terms to browse', () => {
  // The call site composes the two helpers; no other composition is valid.
  assert.equal(directoryMode(directorySearchTerm('cafe')), 'search');
  assert.equal(directoryMode(directorySearchTerm(' a ')), 'search');
  assert.equal(directoryMode(directorySearchTerm('')), 'browse');
  assert.equal(directoryMode(directorySearchTerm('   ')), 'browse');
});

test('isHighlyRated uses the rating >= 4.5 boundary with a positive count', () => {
  assert.equal(isHighlyRated(4.5, 1), true);
  assert.equal(isHighlyRated(4.6, 128), true);
  assert.equal(isHighlyRated(5, 0), false);
  assert.equal(isHighlyRated(4.49, 10), false);
  assert.equal(isHighlyRated(4.2, 215), false);
  assert.equal(isHighlyRated(0, 0), false);
});

test('matchesDirectoryFilters passes everything with both filters off', () => {
  const closed = matchesDirectoryFilters({ rating: 3.9, ratingCount: 5 }, { openNow: false, highlyRated: false }, false);

  assert.equal(closed, true);
});

test('matchesDirectoryFilters applies highlyRated alone', () => {
  const filters = { openNow: false, highlyRated: true };

  assert.equal(matchesDirectoryFilters({ rating: 4.5, ratingCount: 3 }, filters, false), true);
  assert.equal(matchesDirectoryFilters({ rating: 4.5, ratingCount: 0 }, filters, true), false);
  assert.equal(matchesDirectoryFilters({ rating: 4.4, ratingCount: 9 }, filters, true), false);
});

test('matchesDirectoryFilters applies openNow alone', () => {
  const filters = { openNow: true, highlyRated: false };

  assert.equal(matchesDirectoryFilters({ rating: 3.9, ratingCount: 5 }, filters, true), true);
  assert.equal(matchesDirectoryFilters({ rating: 4.9, ratingCount: 5 }, filters, false), false);
});

test('matchesDirectoryFilters with both filters requires both predicates', () => {
  const filters = { openNow: true, highlyRated: true };

  assert.equal(matchesDirectoryFilters({ rating: 4.5, ratingCount: 3 }, filters, true), true);
  assert.equal(matchesDirectoryFilters({ rating: 4.5, ratingCount: 3 }, filters, false), false);
  assert.equal(matchesDirectoryFilters({ rating: 4.5, ratingCount: 0 }, filters, true), false);
});

test('list and count share one predicate: identical inputs give identical verdicts', () => {
  const filters = { openNow: true, highlyRated: true };
  const businesses = [
    { rating: 4.5, ratingCount: 3, openNow: true },
    { rating: 4.5, ratingCount: 3, openNow: false },
    { rating: 4.5, ratingCount: 0, openNow: true },
    { rating: 3.9, ratingCount: 10, openNow: true },
    { rating: 4.9, ratingCount: 1, openNow: true },
  ];

  const listMatches = businesses.filter((business) =>
    matchesDirectoryFilters(business, filters, business.openNow)
  );
  const countTotal = businesses.filter((business) =>
    matchesDirectoryFilters(business, filters, business.openNow)
  ).length;

  assert.equal(listMatches.length, countTotal);
  assert.equal(listMatches.length, 2);
});

// ---------------------------------------------------------------------------
// Live-handler contract for the paginated directory reads (`/search`, the
// landing directory, `/categories/[slug]`).
//
// `listDirectory` scans one bounded window while a computed chip (Open Now /
// Highly Rated) is active. Two Convex runtime rules shape it, both enforced by
// the fake ctx below and mirrored from
// node_modules/convex/src/server/impl/query_impl.ts:
//
// 1. Query objects are single-use: every terminal read consumes the object, and
//    the next read on it throws "A query can only be chained once and can't be
//    chained after iteration begins."
// 2. A function execution runs at most ONE paginated query: `.paginate` is
//    served by a single `1.0/queryPage` async syscall, and a second one in the
//    same invocation throws the exact production error "This query or mutation
//    function ran multiple paginated queries. Convex only supports a single
//    paginated query in each function."
//
// A handler that reaches for a second `.paginate` fails here the same way it
// failed in production.
//
// Node cannot resolve `convex/`'s extensionless imports (the Convex bundler
// does), and `convex/users.ts` imports type names in value position
// (`QueryCtx`, `UserJSON`, `Validator`) that type stripping cannot elide. The
// hooks below add the missing extensions and substitute `users.ts`; neither
// `listDirectory` nor `countDirectory` calls into it.
// ---------------------------------------------------------------------------

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.[cm]?[jt]s$/.test(specifier)
    ) {
      for (const extension of ['.ts', '.js']) {
        try {
          return nextResolve(specifier + extension, context);
        } catch {
          // Try the next extension.
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/convex/users.ts')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export async function getCurrentUser() { return null; }\n',
      };
    }
    return nextLoad(url, context);
  },
});

const { listDirectory, countDirectory } = await import('../convex/businesses/queries.ts');

type DirectoryReadArgs = {
  q: string;
  categoryId?: Id<'categories'>;
  openNow: boolean;
  highlyRated: boolean;
  now: number;
};
type ListDirectoryArgs = DirectoryReadArgs & {
  paginationOpts: { numItems: number; cursor: string | null; id?: number };
};
type CountDirectoryArgs = DirectoryReadArgs;
type DirectoryPage = {
  page: Array<{ name: string; openStatus: { isOpen: boolean } }>;
  isDone: boolean;
  continueCursor: string;
};

const listDirectoryHandler = (
  listDirectory as unknown as {
    _handler: (ctx: unknown, args: ListDirectoryArgs) => Promise<DirectoryPage>;
  }
)._handler;
const countDirectoryHandler = (
  countDirectory as unknown as {
    _handler: (ctx: unknown, args: CountDirectoryArgs) => Promise<{ total: number }>;
  }
)._handler;

const CHAIN_REUSE_ERROR =
  "A query can only be chained once and can't be chained after iteration begins.";

const SINGLE_PAGINATE_ERROR =
  'This query or mutation function ran multiple paginated queries. Convex only supports a single paginated query in each function.';

/**
 * One paginated query per function execution: the backend serves `.paginate`
 * through a single `1.0/queryPage` syscall (query_impl.ts) and rejects a
 * second one for the same invocation. One budget per `directoryCtx`, so a
 * handler that calls `.paginate` twice in one call throws the exact production
 * error.
 */
class PaginateBudget {
  private used = false;

  take(): void {
    if (this.used) {
      throw new Error(SINGLE_PAGINATE_ERROR);
    }
    this.used = true;
  }
}

/**
 * Minimal `ctx.db` stand-in for the reads under test: only `query('businesses')`
 * is exercised. Every query object is single-use, mirroring
 * `QueryImpl#takeQuery`/`startQuery` (query_impl.ts) including the runtime error
 * strings, so reuse across reads is caught exactly as Convex catches it; the
 * `PaginateBudget` adds the one-paginated-query-per-function rule.
 *
 * Fixture rows are listed in `byStatusSubmittedAt` order (newest first), so the
 * fake's `order('desc')` has nothing to re-sort.
 */
class FakeQuery {
  private state: 'preparing' | 'executing' | 'closed' | 'consumed' = 'preparing';
  private readonly rows: Doc<'businesses'>[];
  private readonly equalities: ReadonlyArray<[string, unknown]>;
  private readonly paginateBudget: PaginateBudget;

  constructor(
    rows: Doc<'businesses'>[],
    paginateBudget: PaginateBudget,
    equalities: ReadonlyArray<[string, unknown]> = [],
  ) {
    this.rows = rows;
    this.equalities = equalities;
    this.paginateBudget = paginateBudget;
  }

  private matchingRows(): Doc<'businesses'>[] {
    return this.rows.filter((row) =>
      this.equalities.every(
        ([field, value]) => (row as Record<string, unknown>)[field] === value,
      ),
    );
  }

  /** Consumes the object for one chain/read; reuse throws like the runtime. */
  private takeQuery(): void {
    if (this.state !== 'preparing') {
      throw new Error(CHAIN_REUSE_ERROR);
    }
    this.state = 'closed';
  }

  private throwClosedError(): never {
    throw new Error(
      this.state === 'consumed'
        ? "This query is closed and can't emit any more values."
        : "This query has been chained with another operator and can't be reused.",
    );
  }

  order(): FakeQuery {
    this.takeQuery();
    return new FakeQuery(this.rows, this.paginateBudget, this.equalities);
  }

  async paginate(options: { cursor: string | null; numItems: number }): Promise<{
    page: Doc<'businesses'>[];
    isDone: boolean;
    continueCursor: string;
  }> {
    this.takeQuery();
    this.paginateBudget.take();
    const rows = this.matchingRows();
    const offset = options.cursor === null ? 0 : Number(options.cursor);
    const end = offset + options.numItems;
    return {
      page: rows.slice(offset, end),
      isDone: end >= rows.length,
      continueCursor: String(Math.min(end, rows.length)),
    };
  }

  async collect(): Promise<Doc<'businesses'>[]> {
    if (this.state === 'executing') {
      throw new Error('Iteration can only begin on a query once.');
    }
    if (this.state !== 'preparing') {
      this.throwClosedError();
    }
    this.state = 'executing';
    const rows = this.matchingRows();
    this.state = 'consumed';
    return rows;
  }
}

class FakeQueryInitializer {
  private readonly rows: Doc<'businesses'>[];
  private readonly paginateBudget: PaginateBudget;

  constructor(rows: Doc<'businesses'>[], paginateBudget: PaginateBudget) {
    this.rows = rows;
    this.paginateBudget = paginateBudget;
  }

  withIndex(
    _indexName: string,
    indexRange: (range: FakeIndexRange) => unknown,
  ): FakeQuery {
    const range = new FakeIndexRange();
    indexRange(range);
    return new FakeQuery(this.rows, this.paginateBudget, range.equalities);
  }
}

class FakeIndexRange {
  readonly equalities: Array<[string, unknown]> = [];

  eq(field: string, value: unknown): FakeIndexRange {
    this.equalities.push([field, value]);
    return this;
  }
}

function directoryCtx(rows: Doc<'businesses'>[]) {
  const paginateBudget = new PaginateBudget();
  return {
    db: {
      query(tableName: string) {
        assert.equal(tableName, 'businesses');
        return new FakeQueryInitializer(rows, paginateBudget);
      },
    },
  };
}

/** Fixed Thursday noon UTC — inside every `OPEN_AROUND_THE_CLOCK` window. */
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);

/** `00:00–23:59` on all seven weekdays. */
const OPEN_AROUND_THE_CLOCK = Object.fromEntries(
  (['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const).map(
    (day) => [day, [{ opensAt: '00:00', closesAt: '23:59' }]],
  ),
) as BusinessHours;

/** Schema-shaped approved business row, in the spirit of the projections tests. */
function directoryBusiness(overrides: Partial<Doc<'businesses'>> = {}): Doc<'businesses'> {
  return {
    _id: 'businesses_1' as Id<'businesses'>,
    _creationTime: 1_700_000_000_000,
    name: 'Acme Coffee',
    categoryId: 'categories_1' as Id<'categories'>,
    description: 'A cafe',
    address: {
      addressLine1: '1 Main St',
      addressLine2: 'Suite 2',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      country: 'US',
      latitude: 39.78,
      longitude: -89.65,
    },
    phone: '555-0100',
    email: 'hi@acme.test',
    website: 'https://acme.test',
    timezone: 'UTC',
    photos: [],
    hours: {},
    status: 'approved',
    verification: {
      isVerified: true,
      verifiedAt: 1_700_000_000_001,
      verifiedBy: 'users_admin' as Id<'users'>,
    },
    rating: 4.6,
    ratingCount: 12,
    services: ['espresso'],
    credentials: [],
    keywords: ['coffee', 'cafe'],
    searchText: 'Acme Coffee coffee cafe A cafe',
    ownerId: 'users_owner' as Id<'users'>,
    lastUpdatedAt: 1_700_000_000_002,
    submittedAt: 1_700_000_000_003,
    isFeatured: false,
    moderationReason: 'Add a clearer address',
    moderatedAt: 1_700_000_000_004,
    lastSavedAt: 1_700_000_000_005,
    ...overrides,
  };
}

/**
 * Eight approved rows in index order (newest first). The newest six are closed,
 * so an Open Now page (six rows per chunk) starts empty and the handler must
 * scan a second chunk to fill it — the multi-chunk refill path.
 */
function directoryRows(): Doc<'businesses'>[] {
  const closed = Array.from({ length: 6 }, (_, index) =>
    directoryBusiness({
      _id: `businesses_closed_${index}` as Id<'businesses'>,
      name: `Closed Cafe ${index + 1}`,
      submittedAt: 1_700_000_000_000 - index,
      hours: {},
    }),
  );

  return [
    ...closed,
    directoryBusiness({
      _id: 'businesses_open_bookshop' as Id<'businesses'>,
      name: 'Open Bookshop',
      submittedAt: 1_700_000_000_000 - 6,
      hours: OPEN_AROUND_THE_CLOCK,
    }),
    directoryBusiness({
      _id: 'businesses_open_bakery' as Id<'businesses'>,
      name: 'Open Bakery',
      submittedAt: 1_700_000_000_000 - 7,
      hours: OPEN_AROUND_THE_CLOCK,
    }),
  ];
}

test('listDirectory with a chip active returns every matching row from one scan window', async () => {
  const page = await listDirectoryHandler(directoryCtx(directoryRows()), {
    paginationOpts: { numItems: 6, cursor: null, id: 0 },
    q: '',
    openNow: true,
    highlyRated: false,
    now: NOW,
  });

  assert.deepStrictEqual(
    page.page.map((result) => result.name),
    ['Open Bookshop', 'Open Bakery'],
  );
  assert.equal(
    page.page.every((result) => result.openStatus.isOpen),
    true,
  );
  assert.equal(page.isDone, true);
});

test('listDirectory runs at most one paginated query per invocation and the cursor continues', async () => {
  // Production trigger, verbatim shape: a chip-active page whose leading rows
  // underfill. Round 1 built a fresh query object per chunk but still called
  // `.paginate` a second time in the same invocation, and the runtime rejected
  // it (Request ID 07a5ba189bf8881e). A one-item page forces two invocations
  // over the fixture, so the first window underfills and the cursor must carry
  // on into the second.
  const first = await listDirectoryHandler(directoryCtx(directoryRows()), {
    paginationOpts: { numItems: 1, cursor: null, id: 0 },
    q: '',
    openNow: true,
    highlyRated: false,
    now: NOW,
  });

  assert.deepStrictEqual(first.page, []);
  assert.equal(first.isDone, false);
  assert.equal(first.continueCursor, '5');

  const second = await listDirectoryHandler(directoryCtx(directoryRows()), {
    paginationOpts: { numItems: 1, cursor: first.continueCursor, id: 0 },
    q: '',
    openNow: true,
    highlyRated: false,
    now: NOW,
  });

  assert.deepStrictEqual(
    second.page.map((result) => result.name),
    ['Open Bookshop', 'Open Bakery'],
  );
  assert.equal(second.isDone, true);
});

test('countDirectory and the chip-filtered listDirectory page read the same chipped rows', async () => {
  const args = { q: '', openNow: true, highlyRated: false, now: NOW };

  const { total } = await countDirectoryHandler(directoryCtx(directoryRows()), args);
  const page = await listDirectoryHandler(directoryCtx(directoryRows()), {
    ...args,
    paginationOpts: { numItems: 6, cursor: null },
  });

  assert.equal(total, 2);
  assert.equal(page.page.length, total);
});

test('listDirectory without chips reads the first index page in one pass', async () => {
  const page = await listDirectoryHandler(directoryCtx(directoryRows()), {
    paginationOpts: { numItems: 6, cursor: null },
    q: '',
    openNow: false,
    highlyRated: false,
    now: NOW,
  });

  assert.deepStrictEqual(
    page.page.map((result) => result.name),
    ['Closed Cafe 1', 'Closed Cafe 2', 'Closed Cafe 3', 'Closed Cafe 4', 'Closed Cafe 5', 'Closed Cafe 6'],
  );
  assert.equal(page.isDone, false);
});
