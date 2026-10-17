# Issue #15 B6a — Frozen Shared Contracts (orchestrator)

Authority: both tracks (backend coder + frontend-ui) implement against this file. It freezes
cross-track interfaces only — internal implementation choices stay with each track.
Deviations require orchestrator approval; if a frozen item is technically impossible, HALT and report.

Source of truth: `tasks/issue-15-plan.md`, `tasks/issue-15-todo.md`, `tasks/issue-15-context.md`,
`tasks/issue-15-research.md`, `screens/wayfinder/prototype/admin-workspace.html` (Variant B).
Modals → inline everywhere. No new packages. No `convex/_generated/` hand edits.

## A. Action matrix (frozen — prototype L751-754)

| Current status | Available status actions |
|---|---|
| `pendingReview` | `approve`, `requestChanges`, `reject` |
| `approved` | `suspend` |
| `suspended` | `restore` |
| any status | featured toggle (`setFeatured`), hard delete |

Reason matrix (frozen — prototype L346-354): `requestChanges`, `reject`, `suspend` REQUIRE a
non-blank reason; `approve`, `restore` never carry one. Hard delete instead requires the exact
current business name typed. Featured toggle carries no reason input.

## B. Backend surface (Tasks 1-6) — frozen names/signatures

### B1. `convex/businesses/queries.ts` — `listAdminDirectory` (Task 1)

```ts
// requireSuperAdmin first. Reject paginationOpts.numItems > 25 (ConvexError).
// Filters constrain the read; search matches name / owner name / location
// (addressLine1, city, state) case-insensitively as substring, across the full dataset.
// Sparse matches may return shorter-than-25 pages with a valid continueCursor
// (mirror the documented chunked-window pattern in listDirectory L176-192 /
// MAX_DIRECTORY_PAGE_CHUNKS); never post-filter silently dropping records.
args: {
  paginationOpts: paginationOptsValidator,
  search?: string,            // trimmed; empty/undefined = no filter
  categoryId?: Id<'categories'>,
  status?: ListingStatus,
  isVerified?: boolean,
  isFeatured?: boolean,       // true = featured only; false = non-featured only; undefined = no constraint
}
// Returns { page: AdminDirectoryRow[], isDone, continueCursor } (+ passthrough
// of splitCursor/pageStatus if the runtime provides them). page is authoritative.
```

Amendment (orchestrator-approved, issue #15 B6a saved-view filter): `isFeatured?: boolean`
is an exact tri-state filter mirroring `isVerified` — `true` = featured only, `false` =
non-featured only, `undefined` = no constraint. `status` + `isFeatured` plans onto the existing
B4 `byStatusFeaturedUpdatedAt` index; featured alone has no index and is rechecked on the
scanned window. No new index (§B5); `scripts/admin-directory-query.test.ts` pins the plan +
matcher behavior.

### B2. `convex/businesses/adminProjections.ts` (Task 1, new)

```ts
export type AdminDirectoryRow = {
  _id: Id<'businesses'>;
  name: string;
  description: string;
  status: ListingStatus;
  isFeatured: boolean;
  isVerified: boolean;
  categoryName: string | null;   // joined; null when category row missing
  ownerName: string | null;      // joined from users; null when users row missing
  email: string | null;          // the listing's contact email (businesses.email); null when absent
  createdAt: number;             // Convex system _creationTime; no schema field
  address: { addressLine1: string; city: string; state: string };
  phone: string | null;
  website: string | null;
  rating: number;
  ratingCount: number;
  lastUpdatedAt: number;
  submittedAt: number | null;
};
```
Amendment (orchestrator-approved, issue #15 B6a): the row carries the listing's contact
`email` (admin-only; same precedent as the approvals details projection) and `createdAt`
(`_creationTime`). `ownerEmail` stays out: `users` rows carry no email and the plan forbids
adding one, so there is no owner email to project. UI-track mirror must rename its `ownerEmail`
row field to `email` (directory-types.ts L14; row consumer directory-inspector.tsx L64) —
`app/admin/directory/page.tsx` L248 fails the cross-track type check until it does.
No `ownerId`, no user email (`ownerEmail`), no `searchText`, no moderation internals in the row.

### B3. `convex/auditLogs.ts` — `listAuditLogs` (Task 2, new module)

```ts
// requireSuperAdmin first. Newest-first (byCreatedAt desc). Reject numItems > 25.
// Read-only. Filters refine the scanned window; shorter pages + continueCursor
// are legitimate. Rows survive target deletion.
args: {
  paginationOpts: paginationOptsValidator,
  action?: string,   // exact match on auditLogs.action
  actor?: string,    // case-insensitive substring over actor name (users.name join)
  search?: string,   // case-insensitive substring over targetName/targetId/reason
}
// Returns { page: AuditLogRow[], isDone, continueCursor } (+ passthrough split fields).

export type AuditLogRow = {
  _id: Id<'auditLogs'>;
  at: number;                    // createdAt
  action: string;
  actorName: string | null;      // users.name via actorUserId; null if missing
  targetType: string;
  targetId: string;
  targetName: string | null;     // stored snapshot ?? live business name ?? null
  fromStatus: ListingStatus | null;
  toStatus: ListingStatus | null;
  reason: string | null;
};
```

### B4. Audit action values (frozen; schema keeps `action: v.string()`)

Existing B3 values stay: `approve`, `requestChanges`, `reject`. New B6a values:
`suspend`, `restore`, `feature`, `delete`, `createDraft`. No aggregate bulk row — `approveSelected`
keeps writing one `approve` row per listing, unchanged.

| value | UI label | payload notes |
|---|---|---|
| `approve` | Approve | from=`pendingReview`, to=`approved` (from = prior status generalized) |
| `requestChanges` | Request changes | reason = normalized reason |
| `reject` | Reject | reason |
| `suspend` | Suspend | from=`approved`, to=`suspended`, reason |
| `restore` | Restore | from=`suspended`, to=`approved`, no reason |
| `feature` | Feature pin | reason = `pinned` \| `unpinned` (direction); no statuses |
| `delete` | Hard delete | from = prior status, reason `undefined`; `targetName` snapshot REQUIRED |
| `createDraft` | Create draft | to=`draft`; targetName snapshot |

### B5. Schema additions (Task 2/5; codegen after)

- `auditLogs`: add `.index('byCreatedAt', ['createdAt'])` and optional `targetName: v.optional(v.string())`.
- `notifications`: add `.index('byBusinessId', ['businessId'])`.
- `businesses`: NO new index unless measured evidence requires it (record measurement in evidence).
- Run `npx convex codegen` after schema edits (verified working, exit 0). Never hand-edit `convex/_generated/`.

### B6. `convex/businesses/mutations.ts` — `moderateListing` extended (Task 3)

```ts
args: {
  businessId: Id<'businesses'>,
  action: 'approve' | 'requestChanges' | 'reject' | 'suspend' | 'restore',
  reason?: string,
}
```
- Reason policy per §A; `assertModerationReason` / `normalizeModerationReason` extended
  (suspend requires + stores reason; restore clears).
- Guard order: reason → `requireSuperAdmin` → load → `resolveTransition` → current-status guard
  (approve/requestChanges/reject: `pendingReview`; suspend: `approved`; restore: `suspended`).
- `buildModerationAuditLog` generalized: input gains `fromStatus` (actual) + optional `targetName`,
  single row via `moderationPolicy.ts`.
- Approve keeps the verification stamp; suspend/restore do not touch verification.
- Notification parity: approve/requestChanges/reject keep `moderationNotificationEvent`; suspend/restore
  write the same owner notice as the existing `transition()` path (`planTransitionNotification`).
- Illegal/stale actions write nothing. B3 queue behavior unchanged.

### B7. `convex/businesses/adminMutations.ts` — new (Tasks 4/5/6)

```ts
// Task 4: requireSuperAdmin. No-op (same value) = no write, no audit. Otherwise patch
// isFeatured + lastUpdatedAt=now and one audit row {action:'feature',
// reason:'pinned'|'unpinned', targetName}. Any status is pinnable; public feed stays approved-only.
export const setFeatured = mutation({ args: { businessId: Id<'businesses'>, isFeatured: boolean } });

// Task 5: requireSuperAdmin. Re-read business; typed name must EXACTLY match current name
// (else ConvexError, zero writes). One transaction: insert audit row FIRST
// {action:'delete', fromStatus: prior, targetName}, delete children via adminDeletion.ts
// (menuGroups, menuItems, serviceOfferings, stylists, orders, bookings, quoteRequests,
// notifications via byBusinessId) + referenced storage (business photos, menuItems.imageStorageId,
// stylists.photoStorageId; dedupe ids; verify no surviving reference before deleting a shared file),
// then delete parent. Failure = no partial commit, never reports success.
export const hardDeleteBusiness = mutation({ args: { businessId: Id<'businesses'>, confirmName: string } });

// Task 6: internalMutation. NOT client-callable. Independently enforces Super Admin
// (check Convex docs/guidelines.md whether ctx.auth identity propagates into internal
// mutations called from an action; if not, verify the passed actor's users row
// role==='superAdmin' AND externalId ∈ configuredSuperAdminIds()). Confirms the owner
// users row exists, reproduces createDraft defaults (mutations.ts L89-109), audits
// {action:'createDraft', toStatus:'draft', targetName}. No email persisted.
export const createDraftForOwner = internalMutation({
  args: { name: string, categoryId: Id<'categories'>, ownerUserId: Id<'users'>, actorUserId: Id<'users'> },
});
```

### B8. `convex/businesses/adminOwnerActions.ts` — new public action (Task 6)

```ts
// requireSuperAdmin BEFORE Clerk. Clerk Backend getUserList({ emailAddress: [email] })
// (exact match; unknown addresses are ignored, not errors). Validate exactly one usable match:
// exact email equality, verified address status, and an existing users row via byExternalId.
// Unknown/unverified/unsynchronized/ambiguous → safe actionable ConvexError, no PII. No invite,
// no email persistence. Then ctx.runMutation(internal.businesses.adminMutations.createDraftForOwner, ...).
// Clerk secret: Convex server env var CLERK_SECRET_KEY; never in client code.
export const createDraftForOwner = action({ args: { name: string, categoryId: Id<'categories'>, ownerEmail: string } });
// Returns { draftId: Id<'businesses'> } only. Name and category required.
```

### B9. Reuse unchanged

`approveSelected` (1-25 dedupe, all-or-none, per-listing audit+notification), `createDraft`,
`resolveTransition`, `requireSuperAdmin`, `listPendingApprovals`, B4 `featuredForLanding`,
`publicProjections.ts` (do not widen). No new packages.

## C. Client api paths (frozen — UI wiring phase)

- `api.businesses.queries.listAdminDirectory`
- `api.auditLogs.listAuditLogs`
- `api.businesses.mutations.moderateListing` · `api.businesses.mutations.approveSelected`
- `api.businesses.adminMutations.setFeatured` · `api.businesses.adminMutations.hardDeleteBusiness`
- `api.businesses.adminOwnerActions.createDraftForOwner`
- `api.categories.listOrdered` · `api.users.isSuperAdmin`

## D. UI-owned mirror files (frontend-ui track; mirrors approval-types.ts pattern)

- `app/admin/directory/directory-types.ts` — frozen `AdminDirectoryRow` mirror + `DirectoryViewMode`
  ('grid'|'table'), page size `DIRECTORY_PAGE_SIZE = 25`, filter state type.
- `app/admin/directory/directory-actions-policy.ts` — pure client mirror of §A (availability by
  status, reason requirements, action labels + consequence copy). No Convex imports.
- `app/admin/audit/audit-types.ts` — frozen `AuditLogRow` mirror + action label map (§B4).
- UI never imports from `convex/**` in phase 1 (presentational only; wiring is Tasks 12-15).

## E. File ownership (phase 1, no overlap)

- coder track: `convex/**` (schema, auditLogs.ts, businesses/{queries,mutations,moderationPolicy,
  adminProjections,adminMutations,adminDeletion,adminOwnerActions}.ts), `convex/_generated/**`
  (codegen output only), `scripts/admin-*.test.ts` (new), `scripts/moderation-policy.test.ts` (extend).
- frontend-ui track: `app/admin/**`, `components/directory/**`; `components/ui/**` reuse only
  (modify only on a proven gap; document it). Public BusinessCard `row`/`mini` output must not change
  (consumers: `components/directory/business-results.tsx`, `components/directory/landing-sections.tsx`).
- Neither track edits the other's files. Neither commits. Neither touches unrelated dirty files
  (`.gitignore`, `pnpm-lock.yaml`, other `tasks/*`).

## F. Verification (per track, this node)

- coder: `pnpm test` (report raw totals; `pnpm test` = verify-state-machine.ts then node --test),
  `pnpm lint` (scoped to changed files if pre-existing failures — record baseline), `pnpm build`.
  Plan-mandated new tests ARE required: `scripts/admin-directory-query.test.ts`,
  `scripts/admin-audit-query.test.ts`, `scripts/admin-directory-mutations.test.ts`,
  `scripts/admin-delete-policy.test.ts`, `scripts/admin-create-draft.test.ts`; extend
  `scripts/moderation-policy.test.ts`. Debug failures per debugging-and-error-recovery skill.
- frontend-ui: `pnpm lint`, `pnpm build`; responsive + keyboard checks per task acceptance.
- Reticle end-to-end journeys: deferred to the integration/validation phase (no dev-server session in
  this implementation node); state this explicitly in the return.
- Task 16 regression gate: orchestrator runs `pnpm test`, `pnpm lint`, `pnpm build` after both tracks.

## G. Phase-2 wiring (Tasks 12-15) — frozen decisions

1. **Paging = manual cursor stack, NOT `usePaginatedQuery`.** Server rejects `numItems > 25`; `usePaginatedQuery`'s accumulated `numItems` grows past 25 on loadMore. Mirror `app/admin/approvals/approvals-route.tsx` (its L177-178 stack + L283-300 goNext/goPrevious + L32-47 `messageFromError`). Cursor stack starts `[null]`; Next pushes `continueCursor` (when `!isDone`), Back pops; filter/search change resets the stack to `[null]`.
2. **`app/admin/directory/page.tsx`** (new, 'use client'): `useConvexAuth` gate; filters state (search debounced ~300ms, categoryId, status, isVerified); `useQuery(api.businesses.queries.listAdminDirectory, { paginationOpts: { numItems: 25, cursor }, ...filters })`; categories via `useQuery(api.categories.listOrdered)` mapped to `{_id, name}`; mutations `moderateListing` / `setFeatured` / `hardDeleteBusiness` / `approveSelected`; action `createDraftForOwner` via `useAction`; `eligibleCount` = current-page rows with `status === 'pendingReview'`; `isMobile` via `@/hooks/use-mobile`; renders `DirectoryRoute`.
3. **Route contract changes:** `hasMore/onLoadMore` → `canGoNext/canGoPrevious/onNext/onPrevious` (Back/Next controls, Load-more removed); `onAction: (action, { reason?, confirmName? }) => Promise<void>`; `onSubmitAdd: (data) => Promise<void>` (route closes the add form on resolve; error stays via addState).
4. **Confirm threading:** `DirectoryInlineConfirm.onConfirm` emits `{ reason?, confirmName? }`; inspector awaits `onAction` and closes the confirm ONLY on success — `actionState.error` stays visible inside the open confirm; delete uses `confirmName`.
5. **State hygiene:** bulk selection cleared + bulk confirm closed whenever `rows` identity changes (covers filter change, page navigation, post-mutation refresh); deleted row hides the inspector via the `rows.find` null result. No optimistic success.
6. **Audit wiring:** `app/admin/audit/page.tsx` + `audit-route.tsx` use the same manual cursor stack against `api.auditLogs.listAuditLogs`; filters `{action?, actor?, search?}`; Back/Next; loading/empty/error states.
7. **Verification for the wiring pass:** `npx eslint app/admin components/directory`, `npx tsc --noEmit`, `pnpm build` — raw outputs required. Reticle deferred to the validation node (one-line reason).
