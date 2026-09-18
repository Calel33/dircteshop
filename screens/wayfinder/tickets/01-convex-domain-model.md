# Ticket: Pin the Convex domain model — businesses, categories, and the approval state machine

Parent: [map.md](../map.md)
Labels: wayfinder:research — **RESOLVED**

## Question

Read the template's `convex/schema.ts`, `convex/users.ts`, `convex/paymentAttempts.ts`, and `convex/http.ts` (fetch from https://github.com/Calel33/template-app tree master). Then design the v1 Convex schema for LocalConnect:

- `businesses` table: fields per spec §Core Product Model (name, category, description, address, phone, email, website, photos, hours, status, verification, rating, ratingCount, services, credentials, ownerId, lastUpdatedAt, submittedAt) — with Convex searchIndex on name/keywords and index on status/category/owner.
- `categories` table (taxonomy: name, slug, icon, ordering, parentCategory?).
- The listing approval state machine: draft → submitted/pendingReview → approved/verified | changesRequested | rejected | suspended — which transitions exist, who can fire them, and how status is enforced server-side (Convex function-level guards).
- How the exemplar vertical content (restaurant menu items, salon services/stylists) attaches to a business — same-table JSON blobs vs separate tables; recommend one.

## Resolution

Full research findings with citations at `research/convex-domain-model.md` (asset). Key decisions:

- **Template reality:** `convex/schema.ts` has only `users {name, externalId}` (index `byExternalId`) + `paymentAttempts` (userId: `v.optional(v.id('users'))`). `convex/users.ts` has `getCurrentUserOrThrow` / `upsertFromClerk` / `deleteFromClerk`; Clerk identity resolved via `ctx.auth.getUserIdentity()` → `users.byExternalId`. Convex dep is `^1.31.2`. No role field exists anywhere — Super Admin role is net-new.
- **Schema:** businesses use `categoryId: v.id('categories')`, nested `address` object (with optional lat/lng for later map use), normalized weekly `hours` object, `photos[]` referencing `_storage` IDs, `verification {isVerified, verifiedAt, verifiedBy}`, `rating`+`ratingCount`, `ownerId: v.id('users')`. Search: single `searchText` string projection maintained by mutations (`name + keywords + description`), `searchIndex` with `filterFields: ['status','categoryId']`; regular indexes `byStatus`, `byCategoryId`, `byOwnerId`.
- **Vertical content: SEPARATE TABLES, not JSON blobs** — `menuGroups` / `menuItems` (customization options nested per item), `serviceOfferings` / `stylists` (many-to-many via `serviceOfferingIds` array in v1). Grounded in Convex index/search behavior: business-scoped indexes, independent editability, small updates.
- **State machine:** 6 statuses (`draft, pendingReview, approved, changesRequested, rejected, suspended`), explicit allow-list of transitions, owner vs Super Admin per transition (full transition table in the research asset). Public visibility = `status === 'approved'` only. Server-side enforcement: mutations accept an *action*, never a client-supplied status.
- **Left open for later tickets:** Super Admin role storage (→ ticket 02), rejection reasons / change-request messages / audit log (→ ticket 07), rating scale, photo limits, whether approved-listing edits re-trigger review (→ tickets 06/07).
