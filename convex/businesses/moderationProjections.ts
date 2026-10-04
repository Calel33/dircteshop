import type { Doc } from '../_generated/dataModel';

type BusinessDoc = Doc<'businesses'>;
type CategoryDoc = Doc<'categories'>;
type UserDoc = Doc<'users'>;

/**
 * Super Admin approval-queue card projection (B3b / issue #13 todo #2).
 *
 * `listPendingApprovals` joins each `pendingReview` business with its category
 * and owner, then narrows the triple to exactly what the `/admin/approvals`
 * card renders: image source, identity, submission timestamp, address, contact.
 *
 * Deliberately withheld: `ownerId` (an auth identifier), `searchText`/`keywords`
 * (search maintenance), the moderation internals (`moderationReason`,
 * `moderatedAt`), `verification` provenance, and `categoryId` (the card shows
 * the joined category name, not the reference). Missing category/owner joins
 * fall back to `null` labels rather than leaking a dangling reference. Pure by
 * design — no Convex runtime imports — so it is unit-testable under `node --test`
 * (plan §Testing strategy; SPEC §3 "moderates but never directly edits listing
 * content").
 */
export function toPendingApprovalCard(input: {
  business: BusinessDoc;
  category: CategoryDoc | null;
  owner: UserDoc | null;
}) {
  const { business, category, owner } = input;
  return {
    _id: business._id,
    name: business.name,
    categoryName: category?.name ?? null,
    ownerLabel: owner?.name ?? null,
    submittedAt: business.submittedAt,
    imageStorageId: business.photos[0]?.storageId ?? null,
    address: business.address,
    phone: business.phone,
    email: business.email,
  };
}
