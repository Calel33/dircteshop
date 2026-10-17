import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import type { ListingStatus } from './helpers';

// B6a directory projections + read-bound policy (issue #15, Task 1).
//
// Super Admin directory browse joins each business with its category and owner
// and projects the narrow admin row the `/admin/directory` surfaces render.
// This module is pure (only type imports from generated Convex modules) so it
// is `node --test`-able; the query handler in `./queries.ts`
// (`listAdminDirectory`) is a thin shell over these functions: it authorizes,
// picks the index the planner prescribes, paginates, and maps the page.
//
// Contract: tasks/issue-15-contracts.md §B1/§B2 · prototype Variant B.
// Docs: https://docs.convex.dev/database/reading-data/indexes · https://docs.convex.dev/database/pagination

/** The frozen admin page size (contract §B1; UI mirrors it as `DIRECTORY_PAGE_SIZE`). */
export const ADMIN_DIRECTORY_PAGE_SIZE = 25;

/**
 * The Super Admin directory row (frozen contract §B2, amended for issue #15
 * B6a). Carries the listing's contact `email` and its Convex system
 * `_creationTime` (as `createdAt`) for the admin inspector. Deliberately
 * withheld: `ownerId` (an auth identifier), the owner's user email (users rows
 * carry no email — no user email field by design), search maintenance
 * (`searchText`, `keywords`), moderation internals (`moderationReason`,
 * `moderatedAt`, `verification` provenance), photos/hours (not needed by the
 * grid/table renderers), and `categoryId` (the row shows the joined name).
 */
export type AdminDirectoryRow = {
  _id: Id<'businesses'>;
  name: string;
  description: string;
  status: ListingStatus;
  isFeatured: boolean;
  isVerified: boolean;
  categoryName: string | null;
  ownerName: string | null;
  email: string | null;
  createdAt: number;
  address: { addressLine1: string; city: string; state: string };
  phone: string | null;
  website: string | null;
  rating: number;
  ratingCount: number;
  lastUpdatedAt: number;
  submittedAt: number | null;
};

/** The optional directory filters (contract §B1). `search` is a raw client value. */
export type AdminDirectoryFilters = {
  search?: string;
  categoryId?: Id<'categories'>;
  status?: ListingStatus;
  isVerified?: boolean;
  isFeatured?: boolean;
};

/**
 * The read-bound decision: which existing `businesses` index constrains this
 * filter combination BEFORE `.paginate`, carrying exactly the filter values the
 * index applies. Every read stays on an existing index (contract §B5: no new
 * index without measured evidence); anything the index cannot express is
 * rechecked on the scanned window by `matchesAdminDirectoryFilters`, so
 * correctness never depends on the plan — only read width does.
 */
export type AdminDirectoryIndexPlan =
  | {
      indexName: 'byStatusCategorySubmittedAt';
      status: ListingStatus;
      categoryId: Id<'categories'>;
    }
  | { indexName: 'byStatusVerifiedVerifiedAt'; status: ListingStatus; isVerified: boolean }
  | { indexName: 'byStatusFeaturedUpdatedAt'; status: ListingStatus; isFeatured: boolean }
  | { indexName: 'byStatusSubmittedAt'; status: ListingStatus }
  | { indexName: 'byCategoryId'; categoryId: Id<'categories'> }
  | { indexName: null };

/**
 * Prescribes the index for the given filters, mirroring the B3c queue's
 * "range before paginate" rule. Verification alone has no index (the schema's
 * `byStatusVerifiedVerifiedAt` needs a status step first), so it is rechecked
 * in-function when no status is set; the same holds for featured alone (the
 * B4 `byStatusFeaturedUpdatedAt` index also steps `status` first), while
 * `status` + `isFeatured` plans onto that index.
 */
export function resolveAdminDirectoryIndexPlan(
  filters: AdminDirectoryFilters
): AdminDirectoryIndexPlan {
  const { categoryId, status, isVerified, isFeatured } = filters;

  if (status !== undefined && categoryId !== undefined) {
    return { indexName: 'byStatusCategorySubmittedAt', status, categoryId };
  }

  if (status !== undefined && isVerified !== undefined) {
    return { indexName: 'byStatusVerifiedVerifiedAt', status, isVerified };
  }

  if (status !== undefined && isFeatured !== undefined) {
    return { indexName: 'byStatusFeaturedUpdatedAt', status, isFeatured };
  }

  if (status !== undefined) {
    return { indexName: 'byStatusSubmittedAt', status };
  }

  if (categoryId !== undefined) {
    return { indexName: 'byCategoryId', categoryId };
  }

  return { indexName: null };
}

/**
 * The server-side page bound (contract §B1): the client's `paginationOpts` is
 * never trusted to stay within the UI page size. Runs before any read, so an
 * oversized request performs no database work.
 */
export function assertAdminDirectoryPageSize(numItems: number): void {
  if (numItems > ADMIN_DIRECTORY_PAGE_SIZE) {
    throw new ConvexError(
      `Directory pages are limited to ${ADMIN_DIRECTORY_PAGE_SIZE} listings; requested ${numItems}.`
    );
  }
}

/** Trims a search input and treats a blank one as "no search filter". */
export function normalizeAdminSearchTerm(search: string | undefined): string | undefined {
  const term = (search ?? '').trim();
  return term.length === 0 ? undefined : term;
}

/** The structural fields the filter matcher reads off one joined candidate. */
export type AdminDirectoryFilterFields = {
  name: string;
  ownerName: string | null;
  addressLine1: string;
  city: string;
  state: string;
  status: ListingStatus;
  categoryId: Id<'categories'>;
  isVerified: boolean;
  isFeatured: boolean;
};

/**
 * Exact-filter equality for one optional filter pair: an absent filter matches
 * anything; a supplied one must equal the candidate's field. Keeps the matcher
 * within the lint complexity budget as exact filters accumulate.
 */
function exactFilterMatches<T>(wanted: T | undefined, actual: T): boolean {
  return wanted === undefined || wanted === actual;
}

/**
 * The full predicate for one scanned candidate: the search term matches
 * business name, owner name, or location (address line 1, city, state) as a
 * case-insensitive substring, and every supplied exact filter must equal the
 * candidate. Applied to every row of the scanned page; the returned page is
 * every match from that window, so a short page is legitimate and the cursor
 * (`continueCursor`) always advances past the whole window — no record is ever
 * skipped or silently dropped (mirrors the B4 chunked-window semantics in
 * `./queries.ts` `listDirectory`).
 */
export function matchesAdminDirectoryFilters(
  fields: AdminDirectoryFilterFields,
  filters: AdminDirectoryFilters
): boolean {
  const term = normalizeAdminSearchTerm(filters.search);
  if (term !== undefined) {
    const needle = term.toLowerCase();
    const haystacks = [
      fields.name,
      fields.ownerName ?? '',
      fields.addressLine1,
      fields.city,
      fields.state,
    ];
    if (!haystacks.some((value) => value.toLowerCase().includes(needle))) {
      return false;
    }
  }

  return (
    exactFilterMatches(filters.status, fields.status) &&
    exactFilterMatches(filters.categoryId, fields.categoryId) &&
    exactFilterMatches(filters.isVerified, fields.isVerified) &&
    exactFilterMatches(filters.isFeatured, fields.isFeatured)
  );
}

/**
 * Display-safe address part: the directory surfaces render `city, state`
 * directly with no fallback of their own, so a blank persisted part would
 * render as a lone comma. Empty and whitespace-only values read as
 * "Unlisted"; present values pass through untouched (display only — the
 * filter matcher still searches the raw business fields).
 */
function displayAddressPart(value: string): string {
  return value.trim().length === 0 ? 'Unlisted' : value;
}

/**
 * Projects one joined triple to the frozen admin row (contract §B2, amended).
 * Missing category/owner joins fall back to `null` labels (a dangling
 * reference must not hide the listing); optional business fields — including
 * the contact `email` — project to `null` so the row shape stays total;
 * `createdAt` is the document's Convex `_creationTime`; and blank address
 * parts read as `Unlisted` so the surfaces' `city, state` join never renders
 * a lone comma.
 */
export function toAdminDirectoryRow(input: {
  business: Doc<'businesses'>;
  category: Doc<'categories'> | null;
  owner: Doc<'users'> | null;
}): AdminDirectoryRow {
  const { business, category, owner } = input;

  return {
    _id: business._id,
    name: business.name,
    description: business.description,
    status: business.status,
    isFeatured: business.isFeatured,
    isVerified: business.verification.isVerified,
    categoryName: category?.name ?? null,
    ownerName: owner?.name ?? null,
    email: business.email ?? null,
    createdAt: business._creationTime,
    address: {
      addressLine1: business.address.addressLine1,
      city: displayAddressPart(business.address.city),
      state: displayAddressPart(business.address.state),
    },
    phone: business.phone ?? null,
    website: business.website ?? null,
    rating: business.rating,
    ratingCount: business.ratingCount,
    lastUpdatedAt: business.lastUpdatedAt,
    submittedAt: business.submittedAt ?? null,
  };
}
