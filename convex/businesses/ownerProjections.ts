import type { Doc } from '../_generated/dataModel';

type BusinessDoc = Doc<'businesses'>;

/**
 * Owned-list summary for the `/owner` home (contract §4.1: "owned-listing
 * summaries"). Identity + lifecycle only — enough for the owner cards and
 * status chips, deliberately not the full editor payload or any server-internal
 * field.
 */
export function toOwnerSummary(business: BusinessDoc) {
  return {
    _id: business._id,
    name: business.name,
    categoryId: business.categoryId,
    status: business.status,
    lastUpdatedAt: business.lastUpdatedAt,
    lastSavedAt: business.lastSavedAt,
    submittedAt: business.submittedAt,
  };
}

/**
 * Owned editor document for `getMine` (contract §4.1, §9.5). The owner may see
 * every value of their own listing, so this drops only the server-internal /
 * admin-only fields no owner needs: `ownerId`, the search-maintenance
 * `searchText`, and the `verification` provenance (`verifiedBy`/`verifiedAt`).
 *
 * `status` and the moderation fields (`moderationReason`, `moderatedAt`) are
 * retained so the owner state banners can render. Fields are carried by spread
 * (not re-listed) so later `businesses` additions — e.g. the B3a `tags`/
 * `amenities` arrays — reach the editor without editing this projection.
 */
export function toOwnerEditorDocument(business: BusinessDoc) {
  const { ownerId, searchText, verification, ...fields } = business;
  // Intentionally dropped; referenced so the destructure is not read as dead code.
  void ownerId;
  void searchText;
  return {
    ...fields,
    verification: { isVerified: verification.isVerified },
  };
}
