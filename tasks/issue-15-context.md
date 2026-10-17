# Issue #15 — B6a Admin Directory — Codebase Context

**Prepared by:** explorer subagent (read-only; this is the only file written).
**Repo:** `D:\Dev\dircteshop-1` (graft-indexed).
**Branch state:** dirty worktree (untracked `tasks/*.md`, `pr/`, `dircteshop/`, `CHANGELOG.md`, `FACTORY.md`, `pnpm-workspace.yaml`; `M .gitignore`, `M pnpm-lock.yaml`). Do NOT modify/clean existing files.

---

## 0. Task Contract

| Field | Value |
|---|---|
| TYPE | Codebase exploration + context gathering (read-only + this context file) |
| TARGET | Issue #15 / B6a domain: `/admin` shell, directory, audit; `components/directory/business-card.tsx`; `convex/businesses/**`; `convex/auditLogs` (new); `convex/schema.ts`; authz guard; B3 approval loop; B4 featured feed; tests/scripts |
| GOAL | Map all related files + roles, call/import chains, impact of new admin queries/mutations, patterns to follow, tests needing updates |
| DONE-WHEN | This file exists, cites `path:line`, enumerates plan targets vs reality |

---

## 1. Mandatory docs read — quotes relied on

### `screens/SPEC.md` (referenced; §3-5, §8, §10, §14)
Read via `screens/wayfinder/build/B6-admin-directory.md` and prior context files. Key: admin workspace §10 = approvals queue + moderation actions; roles §3 (only `superAdmin` reaches `/admin`); schema §4; state machine §5; directory §8; tracer-bullet §14.

### `screens/wayfinder/build/B6-admin-directory.md`
- L7-13: full B6 slice — `/admin` overview stats, `/admin/directory` grid+table+map-stub, hard delete behind name-typing deletes business+children, `isFeatured` pinning, Add Business with owner email, `/admin/owners`, `/admin/audit` read-only filterable, `/admin/categories` CRUD, CSV export.
- L8: "Actions: Approve, Request Changes, Reject, Suspend, Restore, Delete — each confirm modal + auditLogs row. **Hard delete only behind type-the-business-name**, deletes business + children. Bulk bar: approve only."
- L3: "Blocked by: B3."

### `screens/wayfinder/prototype/admin-workspace.html` (accepted Variant B — Command Deck)
- L11-12: variant legend — A Ops Console (sidebar + modals) vs **B Command Deck (filter rail + dataset + inline inspector; confirms inline in the inspector)**. B6a adopts **B** (decision #22).
- L346-354 `ACTIONS`: `approve`(to approved, reason:false), `requestChanges`(changesRequested, reason:true, danger:false), `reject`(rejected, reason:true, danger:true), `suspend`(suspended, reason:true, danger:true), `restore`(approved, reason:false), `feature`(reason:false), `delete`(danger, irreversible, reason:false). **Reason matrix** = Request Changes / Reject / Suspend require reason; Approve / Restore / Feature / Delete do not.
- L751-754: inspector action set by status — pending→approve/requestChanges/reject; approved→suspend; suspended→restore; always feature+delete.
- L767-769: inline confirm renders **inside the inspector** (`.insp-step`), not a modal.
- L500-515: reason field (`textarea[data-confirm-reason]`) + delete confirm requires the Delete button enabled by exact-text match.
- L787-798 `deckB()`: `grid-template` = rail + dataset + `.insp` aside; toolbar has Grid/Table seg + disabled `Map · soon` + `Approve N pending` + `Add business`; inline bulk/add confirms sit in the content column.
- L799-816 `viewB()`: top `.cmdbar` with brand + tabs `[overview, directory, owners, audit, categories]` + search + Export CSV + avatar; mobile = `.sheet-overlay .sheet-card` wrapping `inspectorB()` when narrow.
- L389-400: audit rows = actor/action/target/fromStatus/toStatus/reason/at.
- L390-399 audit action labels: Approve, Request changes, Suspend, Restore, Reject, **Feature pin**, **Bulk approve**, Category reassign, CSV export, **Hard delete**.

### `convex/AGENTS.md`
- L11: schema owns `users, categories, businesses, menuGroups, menuItems, serviceOfferings, stylists, orders, bookings, quoteRequests, auditLogs, notifications`.
- Conventions: actions drive transitions (`submitForReview|approve|requestChanges|reject|suspend|restore|reopenAsDraft`) resolved by `resolveTransition`; never accept a raw status; `requireSuperAdmin` fails closed (identity + stamped role + live env whitelist); `requireBusinessOwner` derives from `businesses.ownerId`; `searchText` maintained by mutations; seeds are `internalMutation`; **never edit `convex/_generated/`**; `npx convex dev` in a second terminal for DB.

### `AGENTS.md` (root)
Next.js 16 App Router; design tokens only; `pnpm test` = `node scripts/verify-state-machine.ts && node --test`; Reticle verification required for user-facing changes.

---

## 2. Plan target files — existence check

Legend: ✅ exists (extend) · 🆕 does not exist (net-new) · ⚠️ mismatch.

| Task | Plan target | Reality |
|---|---|---|
| 1 | `convex/businesses/queries.ts` | ✅ (add `listAdminDirectory`) |
| 1 | `convex/businesses/adminProjections.ts` | 🆕 |
| 1 | `convex/schema.ts` (index only if measured) | ✅ (no new index planned yet) |
| 1 | `scripts/admin-directory-query.test.ts` | 🆕 |
| 2 | `convex/auditLogs.ts` | 🆕 (module absent) |
| 2 | `convex/schema.ts` (createdAt index if needed) | ✅ (auditLogs has **no** createdAt index — see §3) |
| 2 | `scripts/admin-audit-query.test.ts` | 🆕 |
| 3 | `convex/businesses/mutations.ts` | ✅ (`moderateListing`, `transition`, `approveSelected`, `createDraft`) |
| 3 | `convex/businesses/moderationPolicy.ts` | ✅ (extend reason/action unions) |
| 3 | `scripts/moderation-policy.test.ts` | ✅ (extend) |
| 4 | `convex/businesses/adminMutations.ts` | 🆕 |
| 4 | `scripts/admin-directory-mutations.test.ts` | 🆕 |
| 5 | `convex/businesses/adminMutations.ts` | 🆕 |
| 5 | `convex/businesses/adminDeletion.ts` | 🆕 |
| 5 | `convex/schema.ts` (`notifications.byBusinessId`) | ✅ schema; **index absent** (see §3) |
| 5 | `scripts/admin-delete-policy.test.ts` | 🆕 |
| 6 | `convex/businesses/adminOwnerActions.ts` | 🆕 |
| 6 | `convex/businesses/adminMutations.ts` (internal) | 🆕 |
| 6 | `scripts/admin-create-draft.test.ts` | 🆕 |
| 7 | `app/admin/admin-shell.tsx` | ✅ (simple header; no tabs) |
| 7 | `app/admin/admin-command-bar.tsx` | 🆕 |
| 7 | `app/admin/page.tsx` | ✅ (B1 placeholder) |
| 8 | `app/admin/directory/{directory-grid,directory-table,directory-filters}.tsx` | 🆕 (dir absent) |
| 8 | `components/directory/business-card.tsx` | ✅ (shared public card) |
| 8 | `components/directory/admin-business-card.tsx` | 🆕 (only if isolating admin fields) |
| 9 | `app/admin/directory/{directory-inspector,directory-inline-confirm,directory-route}.tsx` | 🆕 |
| 9 | `components/ui/sheet.tsx` | ✅ (reuse) |
| 10 | `app/admin/directory/{directory-bulk-bar,directory-bulk-confirm,add-business-form}.tsx` | 🆕 |
| 11 | `app/admin/audit/{page,audit-route,audit-table}.tsx` | 🆕 (dir absent) |
| 12 | `app/admin/directory/page.tsx` | 🆕 |
| 13-15 | route wiring files above | 🆕 |

### 2b. Plan↔reality mismatches / notes to flag

1. **`convex/auditLogs.ts` does not exist.** `auditLogs` is a table only (`schema.ts:205-216`). Audit writes currently happen inline in `mutations.ts:305-315` and `383-393` via `buildModerationAuditLog`. Task 2 creates the module.
2. **`notifications.byBusinessId` index does NOT exist.** `schema.ts:218-233` defines only `byUserId`, `byUserIdAndCreatedAt`, `byUserIdAndReadAt`. The hard-delete cascade (Task 5) needs the new index.
3. **`auditLogs` has no `createdAt` index** (`schema.ts:214-216` → `byActorUserId`, `byTarget` only). Task 2's newest-first cursor query needs a new index (e.g. `byCreatedAt`).
4. **`convex/businesses/{adminProjections,adminMutations,adminDeletion,adminOwnerActions}.ts` do not exist** — all net-new. No `listAdminDirectory`/`listAuditLogs`/featured/delete symbols exist anywhere.
5. **`graft` graph gap:** `convex/schema.ts` and `convex/businesses/queries.ts` are not symbol-indexed (`graft_file_api convex/schema.ts` → "no definitions indexed"). File contents are readable; use `graft grep` line hits + direct reads.
6. **`app/admin/approvals/**` is the existing admin-route reference** (B3b/B3c) — but it uses **Radix Dialog modals** which B6a must NOT copy (inline confirms). Reuse its query/mutation/count-confirmation/pagination/selection *patterns*, not its modal UX.
7. **`components/directory/business-card.tsx` has two public consumers** (`business-results.tsx`, `landing-sections.tsx`); `app/owner/business-card.tsx` is a **different, unrelated** component. Admin density must be discriminated and public densities unchanged.
8. **`@clerk/backend` is already installed** (`package.json:24`, `^3.18.1`) and already imported in `convex/users.ts:2` (`UserJSON`). Task 6's Clerk Backend `getUserList` dependency needs no new package.
9. **No shell navigation exists.** `admin-shell.tsx` renders only "Admin Portal" + `NotificationMenu`; `/admin/approvals` is not linked anywhere. The Command Deck tabs are entirely new.

---

## 3. Backend (Convex) — current state

### Schema — `convex/schema.ts`
- `businesses` L39-93. Relevant fields: `categoryId` L41, `address` L43, `phone/email/website` L44-46, `timezone` L49, `photos` L50, `hours` L51, `status` L52, `verification` L53, `rating/ratingCount` L54-55, `searchText` L63, `ownerId` L64, `lastUpdatedAt` L65, `submittedAt` L66, **`isFeatured` L67**, `moderationReason` L68, `moderatedAt` L69, `lastSavedAt` L70.
- Indexes L72-93: `byStatus`, `byStatusSubmittedAt`, `byStatusCategorySubmittedAt`, **`byStatusFeaturedUpdatedAt` (L82)**, `byStatusVerifiedVerifiedAt`, `byCategoryId`, `byOwnerId`, `searchIndex('searchText', {filterFields:['status','categoryId']})` L90-93.
- Child tables linked by `businessId`: `menuGroups` L95-102, `menuItems` L104-128 (media `imageStorageId` L110), `serviceOfferings` L130-140, `stylists` L142-152 (media `photoStorageId` L146), `orders` L154-173, `bookings` L175-193, `quoteRequests` L195-203.
- `auditLogs` L205-216: `{actorUserId, action, targetType, targetId, fromStatus?, toStatus?, reason?, createdAt}`; indexes `byActorUserId`, `byTarget`.
- `notifications` L218-233: `{userId, type, businessId?, message, reason?, readAt?, createdAt}`.
- `users` L15-21: `{name, externalId, role:'user'|'superAdmin'}` (role stamped only by webhook).
- Storage refs to delete: `businesses.photos[].storageId`, `menuItems.imageStorageId`, `stylists.photoStorageId`.

### Authz — `convex/authz.ts`
- `configuredSuperAdminIds()` L11-18 (parses `SUPER_ADMIN_CLERK_IDS`; empty set = fail closed).
- `requireSuperAdmin(ctx)` L27-47 — identity + stamped `users.role==='superAdmin'` + live env whitelist; throws `Unauthorized`/`Forbidden`. **Every new admin query/mutation must call this.**
- `requireBusinessOwner(ctx, businessId)` L56-74.

### Queries — `convex/businesses/queries.ts`
- Public: `getPublic` L38-85 (approved-only narrow projection), `listDirectory` L194-242, `countDirectory` L259-284, `directoryBaseQuery` L130-158.
- Landing feeds: `featuredForLanding` **L349-362** — reads `byStatusFeaturedUpdatedAt` where `status==='approved' && isFeatured===true`, order desc, take 6. This is **B4's featured feed** (pin/unpin must reflect here). `newestForLanding` L365-376, `verifiedForLanding` L379-392.
- Owner reads: `listMine` L410-425, `getMine` L441-456.
- **Admin queue (B3b/B3c reference):** `projectPendingCards` L484-494, `listPendingApprovals` **L518-570** (`requireSuperAdmin` L527 → `byStatusSubmittedAt`/`byStatusCategorySubmittedAt` index-bounded range → `.paginate`), `getPendingApprovalDetails` L579-596. This is the **pattern to mirror for `listAdminDirectory`**.

### Mutations — `convex/businesses/mutations.ts`
- `createDraft` **L70-111** — blank draft owned by signed-in user; sets all empty defaults (`address:{addressLine1,city,state,country:''}`, `timezone:'America/New_York'`, `status:'draft'`, `verification:{isVerified:false}`, `rating:0`, `ratingCount:0`, `isFeatured:false`, `lastUpdatedAt`, `lastSavedAt`, `searchText`). **Task 6 must reproduce these defaults** while resolving an owner by email.
- `saveDraft` L128-165; `transition` L175-242 (actions `submitForReview|suspend|restore|reopenAsDraft` only; audits nothing; `authorizeAction` L502-513; `assertReasonProvided` L519-525).
- `moderateListing` **L267-331** — `assertModerationReason` → `requireSuperAdmin` → `resolveTransition` → pendingReview guard → atomic patch (status/lastUpdatedAt/moderatedAt/moderationReason/verification stamp on approve) → `auditLogs` insert via `buildModerationAuditLog` → owner notification. **Task 3 extends the action set to Approve/Request Changes/Reject/Suspend/Restore, recording actual `fromStatus`.**
- `approveSelected` **L348-412** — `normalizeBulkApproveIds` (1-25, dedupe) → `requireSuperAdmin` → all pendingReview guard (all-or-none) → per-listing patch + audit + notification. **Task 14 reuses this unchanged.**
- `saveAndResubmit` L430+.

### Moderation policy — `convex/businesses/moderationPolicy.ts` (pure)
- `MODERATION_ACTIONS` L15 (`approve|requestChanges|reject`); `assertModerationReason` L25-36; `normalizeModerationReason` L44-53; `ModerationAuditLog` L56-65; `buildModerationAuditLog` L74-92 (**`fromStatus` hardcoded `pendingReview`** — Task 3 must generalize for suspend/restore actual fromStatus).
- Bulk: `BULK_APPROVE_MIN/MAX` L106-107 (1/25); `normalizeBulkApproveIds` L114-125; `assertAllPendingReview` L133-137.

### State machine — `convex/businesses/helpers.ts`
- `STATUS_TRANSITIONS` L17-24 (verbatim SPEC §5): draft→pendingReview|rejected; pendingReview→approved|changesRequested|rejected; approved→pendingReview|suspended; changesRequested→pendingReview|draft|rejected; rejected→draft|pendingReview; suspended→approved.
- `TransitionAction` L27-34; `TRANSITION_ACTIONS` L49-57 (`approve`/`requestChanges`/`reject`/`suspend`/`restore` → `requiredRole:'superAdmin'`); `TRANSITION_ROLE_OVERRIDES` L66-70; `resolveTransition` L80-108; `buildSearchText` L129-135.
- **No `delete`/`feature` transitions here** — those are not state-machine transitions; they are separate mutations.

### Projections (pure)
- `convex/businesses/moderationProjections.ts`: `toPendingApprovalCard` L23-40 (withholds `ownerId`, `searchText`, `keywords`, moderation internals, `categoryId`); `resolveSubmittedAtRange` L119-143; `toPendingApprovalDetails` L164-196. **Pattern for `adminProjections.ts` (Task 1).**
- `convex/businesses/publicProjections.ts`: `toPublicDirectoryCard` L41-60; `PublicDirectoryResult` L38 (card + `openStatus`).
- `convex/businesses/directoryQuery.ts`: pure B4 search/filter contract.

### Notifications — `convex/notificationHelpers.ts`
- `NOTIFICATION_EVENT_TYPES` L23-29; `buildNotificationContent` L87-105; `planTransitionNotification` L154-200; `moderationNotificationEvent` L207-226; `insertNotification` L266-286 (writes in caller's transaction); `notifyAdminRecipients` L298-324.

### Users — `convex/users.ts`
- `current` L6-11; `isSuperAdmin` query L17-33 (used by layout gate); `upsertFromClerk` internalMutation L35-51; `getCurrentUserOrThrow` L66-70; `getCurrentUser` L72-78; `userByExternalId` L80-85.

### Notifications table query pattern — `convex/notifications.ts`
- `listMine` L42-58 = newest-first cursor pagination via `byUserIdAndCreatedAt` + `.order('desc')` + `.paginate` + explicit projection `toNotificationItem` L22-32. **Pattern to mirror for `listAuditLogs` (Task 2).**

### Categories — `convex/categories.ts`
- `listOrdered` L27-32, `bySlug` L35-43, `listWithCounts` L55-81, `seedCategories` L92-123. Filter dropdowns reuse `listOrdered`.

---

## 4. Admin frontend — current state

### Call chain (existing)
`app/admin/layout.tsx:12-30` (server: Clerk token → `api.users.isSuperAdmin` → `notFound()`; comment L8-11: "Cosmetic 404 gate. Authorization is enforced server-side in Convex") → `AdminShell` (`app/admin/admin-shell.tsx:5-15`) → route children.

- `app/admin/page.tsx:1-8` — B1 placeholder ("Admin overview").
- `app/admin/approvals/page.tsx:8-10` → `ApprovalsRoute` (`approvals-route.tsx:71-79`) → `ApprovalsLoadBoundary` + `ConnectedApprovalQueue`.
- `approvals-route.tsx:169-391` — **the integration reference**: `useConvexAuth` gate L191; `useQuery(listPendingApprovals)` L194-209; `useMutation(moderateListing)` L210; cursor stack L177-178; `goNext`/`goPrevious` L283-300; filters `changeFilters` L269-272; bulk `useBulkApproval` L87-167 (uses `approveSelected` L96, count = `selectedIdsOnPage`, all-or-none error handling); `messageFromError` L32-47.
- `ApprovallsLoadBoundary` (`approvals-load-boundary.tsx:50-83`) — class error boundary; remount-on-retry.

### Shared admin route building blocks (reusable patterns)
- `approval-types.ts:19-29` — frozen `ApprovalCard` projection mirroring the server query; L35 `APPROVAL_PAGE_SIZE = 25`; L46-56 `ApprovalFilters`/defaults (category/priority/time).
- `approval-actions-policy.ts:15-47` — pure client mirror of server reason policy (`actionRequiresReason`, `canSubmitDecision`, `normalizeReason`). **Pattern for a directory action policy module.**
- `approval-pagination.ts`, `approval-selection.ts` (+`.test.ts`), `approval-priority.ts` — pure helpers, `node --test` tested.
- `app/admin/approvals/*.test.ts` — 4 colocated pure tests.

### Shared UI primitives available (no new deps)
`components/ui/`: `sheet.tsx`, `tabs.tsx`, `table.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `select.tsx`, `input.tsx`, `label.tsx`, `checkbox.tsx`, `badge.tsx`, `button.tsx`, `card.tsx`, `skeleton.tsx`, `switch.tsx`, `separator.tsx`, `toggle-group.tsx`. (`components/ui/sheet.tsx` confirmed present.)

### BusinessCard — `components/directory/business-card.tsx`
- `BusinessCardProps` L24-28: `{business: PublicDirectoryResult; category?: BusinessCardCategory; density: 'row'|'mini'}`.
- `BusinessCard` L196-202 dispatches `mini`/`row`. `BusinessRowCard` L136-172; `BusinessMiniCard` L175-194.
- Consumers: `components/directory/business-results.tsx:171` (`density="row"`), `components/directory/landing-sections.tsx:93`. **Admin density must not alter these.**
- `PublicDirectoryResult` (publicProjections.ts:38) includes `_id, name, categoryId, description, address{addressLine1,city,state}, phone?, website?, rating, ratingCount, verification{isVerified}, isFeatured, lastUpdatedAt, openStatus`. **No `status`, no owner** — the admin grid needs an admin projection, not this type.

### Design tokens — `app/globals.css`
- Palette L6-71: `--primary #2563eb`, `--accent #f59e0b`, `--destructive #dc2626`, `--card`, `--muted`, `--surface #53617a`, radii `--radius: 1rem`, shadow scale L52-70. Dark overrides L73+.
- Per issue-14 context: token utilities (`gap-gap`, `rounded-card`, `rounded-control`, `rounded-pill`, `text-card-muted`, `font-display`, `font-label`) are mapped `@theme inline` at `globals.css:97-170`. Use tokens, not raw values.

---

## 5. Call chain + import graph (B6a target)

```
app/admin/layout.tsx (server 404 gate, UNCHANGED)
  └─ AdminShell (app/admin/admin-shell.tsx)  ← Task 7 adds AdminCommandBar tabs
       ├─ /admin/directory  (page.tsx → DirectoryRoute)          ← NEW Tasks 8-10,12-14
       │     ├─ useQuery api.businesses.queries.listAdminDirectory  ← NEW Task 1
       │     ├─ usePaginatedQuery (cursor)                         (mirrors listPendingApprovals)
       │     ├─ DirectoryGrid → BusinessCard (admin density) / admin-business-card  ← NEW Task 8
       │     ├─ DirectoryTable                                       ← NEW Task 8
       │     ├─ DirectoryFilters (name/owner/location, category, status, verification) ← NEW
       │     ├─ DirectoryInspector + DirectoryInlineConfirm          ← NEW Task 9
       │     │     └─ useMutation status/featured/delete             ← NEW Tasks 3-5
       │     ├─ DirectoryBulkBar/BulkConfirm → approveSelected       ← REUSE Task 14
       │     └─ AddBusinessForm → adminOwnerActions action           ← NEW Task 6
       └─ /admin/audit (page.tsx → AuditRoute)                       ← NEW Tasks 11,15
             └─ useQuery api.auditLogs.listAuditLogs                 ← NEW Task 2
```

Import graph notes:
- `authz.ts` ← imported by `mutations.ts:9` and `queries.ts:7`. New admin modules must import `requireSuperAdmin` from `../authz`.
- `helpers.ts` (`resolveTransition`) ← `mutations.ts:17-23`. Task 3 reuses it; never bypass.
- `moderationPolicy.ts` ← `mutations.ts:24-30`. Task 3 extends the action/reason unions here.
- `notificationHelpers.ts` ← `mutations.ts:10-15`. Task 3/5 keep notification parity.
- `publicProjections.ts` ← `business-card.tsx:7` and `queries.ts`. Do not widen it with admin-only fields.
- `notification-menu.tsx` ← `admin-shell.tsx:3`. Preserve on shell rewrite.

---

## 6. Impact of new admin queries/mutations

| New/changed symbol | Reads/writes | Public impact | Notes |
|---|---|---|---|
| `listAdminDirectory` (Task 1) | reads `businesses` + joins `categories`/`users` | none (new admin-only) | Must `requireSuperAdmin`; reject `numItems>25`; narrow projection (no email/ownerId). Mirror `listPendingApprovals` range-before-paginate. |
| `listAuditLogs` (Task 2) | reads `auditLogs` | none | Needs new `createdAt` index; newest-first `.order('desc')`; keep deleted `targetId` (it's a string, not FK). |
| Status actions (Task 3) | writes `businesses` + `auditLogs` + `notifications` | owner sees notices; B3 queue unaffected | Extend `moderateListing`/`moderationActionValidator`; generalize `buildModerationAuditLog.fromStatus`. |
| Featured mutation (Task 4) | writes `businesses.isFeatured`, `lastUpdatedAt` + `auditLogs` | **B4 `featuredForLanding` (queries.ts:349-362) ordering changes** | `byStatusFeaturedUpdatedAt` orders by `lastUpdatedAt` → updating it reorders Trending. Verify approved-only + pin/unpin regression. |
| Hard delete (Task 5) | deletes `businesses` + all child tables + storage; inserts `auditLogs` first | owner's listing vanishes; B4/B3 reads must tolerate missing row | New `notifications.byBusinessId` index needed; `paymentAttempts` has no FK → out of cascade. |
| Admin create (Task 6) | public action (Clerk lookup) → internal mutation inserts `businesses` draft + `auditLogs` | new draft not public (status `draft`) | Reproduce `createDraft` defaults (mutations.ts:70-111); no email persisted; internal mutation not client-callable. |
| `business-card.tsx` admin density (Task 8) | presentation only | **must not change public `row`/`mini`** | Discriminated prop or separate `admin-business-card.tsx`. |

---

## 7. Patterns & conventions to follow

- **Convex boundary:** every new admin query/mutation/action calls `requireSuperAdmin` (`authz.ts:27-47`). `/admin` 404 gate stays in `app/admin/layout.tsx` (never weaken to UI-only).
- **Action-driven state:** never accept a raw status; resolve via `resolveTransition` (`helpers.ts:80-108`); re-check current status server-side (stale guard like `moderateListing` L288-290).
- **Pure-module + `node --test`:** testable logic lives in framework-free modules with type-only Convex imports (`moderationPolicy.ts`, `moderationProjections.ts`, `directoryQuery.ts`, `approval-priority.ts`). Tests are `scripts/*.test.ts` or colocated `app/admin/**/*.test.ts`, using `#!/usr/bin/env node`, `node:assert/strict`, `node:test`; runner `package.json:17`.
- **Narrow projections:** never return raw docs; allowlist fields (see `toPendingApprovalCard` withholding `ownerId`/`searchText`/moderation internals). Admin projection must omit owner email and `ownerId`.
- **Range before paginate:** filters must constrain the index range BEFORE `.paginate`, never post-filter a page (issue-14 §8; `listPendingApprovals` L539-566).
- **shadcn/Radix reused, not recreated:** `Sheet` (mobile inspector), `Tabs`/`CommandBar` (shell), `Table`, `Checkbox`, `Select`, `Input`, `Badge`, `Button`. Inline confirms are custom, **not** `Dialog`.
- **Design tokens only:** tokens in `globals.css`; no hardcoded palette/shadow; `gap-gap`, `rounded-card`, `rounded-control`, `rounded-pill`, `text-card-muted`, `font-display`, `font-label`.
- **Accessibility:** `role="status"/"alert"`, `aria-current`, `aria-labelledby`, focus-first, keyboard-dismissible sheet (existing surfaces do this).
- **Transactions:** status+audit+notification and the delete cascade each commit atomically; a failed write must never report success.

---

## 8. Tests to update / add + verifier

- **New (as planned):** `scripts/admin-directory-query.test.ts` (Task 1), `scripts/admin-audit-query.test.ts` (Task 2), `scripts/admin-directory-mutations.test.ts` (Task 4), `scripts/admin-delete-policy.test.ts` (Task 5), `scripts/admin-create-draft.test.ts` (Task 6).
- **Extend:** `scripts/moderation-policy.test.ts` (already pins `MODERATION_ACTIONS`, `assertModerationReason`, `normalizeModerationReason`, `buildModerationAuditLog`, `normalizeBulkApproveIds`, `assertAllPendingReview` — Task 3 adds suspend/restore/fromStatus).
- **Regression-risk existing pure tests (must stay green):** `scripts/moderation-queue.test.ts`, `scripts/moderation-projections.test.ts`, `scripts/public-directory-query.test.ts`, `scripts/public-directory-projections.test.ts`, `scripts/notifications.test.ts`, `scripts/business-seed.test.ts`, `app/admin/approvals/{approval-actions-policy,approval-priority,approval-selection,approval-pagination}.test.ts`.
- **`scripts/verify-state-machine.ts`** (`package.json:17`, runs first): pins `STATUS_TRANSITIONS`, actor table, restore guard, illegal transitions. Any `helpers.ts`/transition change must keep it green.
- **Gate commands:** `pnpm test`, `pnpm lint`, `pnpm build`; plus `npx convex dev` for runtime behavior and Reticle for user-visible flows.

---

## 9. Risks / gotchas for implementation

- **B3 is an explicit blocker** — confirm `createDraft`, `moderateListing`, `approveSelected`, `resolveTransition` are merged on the branch before building (they are present in this checkout).
- **`fromStatus` hardcoded `pendingReview`** in `buildModerationAuditLog` (moderationPolicy.ts:87) — Suspend/Restore must record the actual current status.
- **`notifications.byBusinessId` and an `auditLogs` createdAt index are new schema additions** — flag for codegen; `convex/_generated/` is regenerated by `npx convex dev`, never hand-edited.
- **`featuredForLanding` ordering:** touching `lastUpdatedAt` on pin reorders Trending (documented trade-off).
- **BusinessCard is public-shared** — an admin variant must not leak admin fields to public queries nor change `row`/`mini` output.
- **Clerk email lookup is server-only** — the public action must authorize before calling Clerk; internal mutation must independently re-check Super Admin and not be client-callable.
- **graft gap** on `convex/schema.ts` and `convex/businesses/queries.ts` (not symbol-indexed) — read files directly.
- **Dirty worktree:** preserve `pnpm-lock.yaml`, `.gitignore`, and all untracked files; write only designated issue-15 files.

---

## 10. Entry points / how it connects

| Location | Connects to |
|---|---|
| `app/admin/layout.tsx:12-30` | Clerk token → `api.users.isSuperAdmin` → `notFound()` 404 gate (B1) |
| `app/admin/admin-shell.tsx:5-15` | `NotificationMenu` + `{children}` (Task 7 replaces header with tab bar) |
| `app/admin/approvals/approvals-route.tsx:169-391` | `listPendingApprovals` + `moderateListing` + `approveSelected` reference wiring |
| `convex/businesses/queries.ts:518-570` | `requireSuperAdmin` → index range → `.paginate` → projection (pattern for Task 1) |
| `convex/notifications.ts:42-58` | newest-first cursor pagination (pattern for Task 2) |
| `convex/businesses/mutations.ts:70-111` | `createDraft` defaults (Task 6) |
| `convex/businesses/mutations.ts:267-331` | `moderateListing` atomic patch+audit+notification (Task 3) |
| `convex/businesses/mutations.ts:348-412` | `approveSelected` all-or-none 1-25 (Task 14 reuse) |
| `convex/businesses/queries.ts:349-362` | `featuredForLanding` B4 feed (Task 4 regression) |
| `components/directory/business-card.tsx:196-202` | public card (Task 8 admin density) |

---

## WORK SUMMARY

| TYPE | TARGET | GOAL | DONE-WHEN | STATUS | EVIDENCE |
|---|---|---|---|---|---|
| Exploration | Issue #15 / B6a domain in `D:\Dev\dircteshop-1` | Map files/roles, call+import chains, impact, patterns, tests; write context file | Context file exists, cites `path:line`, enumerates mismatches | DONE | This file; reads/grep/glob cited above |

**COMPLIANCE (P0):** Task contract formed; context gathered before acting; read-before-edit honored (read-only + one write); graft queried (`file_api`) before reads; no guessing; docs read first; no deletions; design-token rules noted; dependencies mapped.

**Skills activated:** none directly applicable (exploration/documentation task); declared.

**Docs activated:** `tasks/issue-15-plan.md`, `tasks/issue-15-todo.md`, `screens/wayfinder/build/B6-admin-directory.md`, `screens/wayfinder/prototype/admin-workspace.html`, `convex/AGENTS.md`, `AGENTS.md`, `package.json`.

**Tools used:** graft (`file_api`), file reads, grep, glob.

**Violations:** none.
