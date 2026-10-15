import type { Doc } from '../_generated/dataModel';
import type { OpenStatus } from './publicHours';

// Narrow public projections for the B4 directory surfaces (SPEC §8).
//
// Every public card renders `PublicDirectoryCard` — never a raw business
// document. The allowlist withholds owner identity (`ownerId`), moderation
// internals (`moderationReason`, `moderatedAt`, `verification.verifiedBy`),
// search maintenance (`searchText`, `keywords`), and the lifecycle status
// itself (public results are approved by construction; the field is not part
// of the display contract).
//
// Pure functions + types only (no Convex runtime imports), so the field
// allowlist is pinned by `scripts/public-directory-projections.test.ts`.

/** The public card projection rendered by every directory `BusinessCard`. */
export type PublicDirectoryCard = {
  _id: Doc<'businesses'>['_id'];
  name: string;
  categoryId: Doc<'businesses'>['categoryId'];
  description: string;
  address: { addressLine1: string; city: string; state: string };
  phone?: string;
  website?: string;
  rating: number;
  ratingCount: number;
  verification: { isVerified: boolean };
  isFeatured: boolean;
  lastUpdatedAt: number;
};

/**
 * What the directory queries actually return: the card plus the business's
 * Open Now status computed server-side against the stable-`now` argument, so
 * the client never re-implements hours arithmetic in the visitor's (wrong)
 * timezone.
 */
export type PublicDirectoryResult = PublicDirectoryCard & { openStatus: OpenStatus };

/** Projects a business document to the public card allowlist. */
export function toPublicDirectoryCard(business: Doc<'businesses'>): PublicDirectoryCard {
  return {
    _id: business._id,
    name: business.name,
    categoryId: business.categoryId,
    description: business.description,
    address: {
      addressLine1: business.address.addressLine1,
      city: business.address.city,
      state: business.address.state,
    },
    phone: business.phone,
    website: business.website,
    rating: business.rating,
    ratingCount: business.ratingCount,
    verification: { isVerified: business.verification.isVerified },
    isFeatured: business.isFeatured,
    lastUpdatedAt: business.lastUpdatedAt,
  };
}

/**
 * Approved businesses per category. Pure so the approved-only semantics are
 * pinned without a Convex runtime; the caller feeds either a pre-filtered
 * approved scan or a mixed page. Non-approved rows are skipped defensively —
 * public visibility is a correctness boundary (SPEC §5).
 */
export function countApprovedByCategory(
  businesses: readonly Doc<'businesses'>[]
): Map<Doc<'businesses'>['categoryId'], number> {
  const counts = new Map<Doc<'businesses'>['categoryId'], number>();

  for (const business of businesses) {
    if (business.status !== 'approved') {
      continue;
    }

    counts.set(business.categoryId, (counts.get(business.categoryId) ?? 0) + 1);
  }

  return counts;
}
