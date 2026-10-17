# Issue #15 / B6a Dependency-Ordered Todo

**Scope:** Command Deck shell, functional Directory + Audit tabs, paginated search/filter, guarded actions, existing-owner draft creation, featured pinning, and hard-delete cascade.

**Confirmed scope:** Directory and Audit are functional in B6a. Overview, Owners, Categories, and CSV remain B6b placeholders/deferred. Inline confirmations replace modals. Directory pages are up to 25 matches; bulk approve covers only eligible pending rows on the current page.

**Do not rebuild:** B1 Super Admin 404 gate, B3a `createDraft` defaults, B3 moderation/state machine, B3c `approveSelected`, or B4 featured feed. Do not copy the prototype CSS or store Clerk email in Convex.

## Prerequisites and dependency graph

- **B1:** Preserve `app/admin/layout.tsx` and prove ordinary/non-authenticated users still receive 404 on all `/admin(.*)` routes.
- **B3:** B6a is blocked by B3. Reuse the existing owner draft, moderation/audit/notification behavior, and state-machine contracts. If B3 is incomplete in the target branch, stop and resolve the blocker rather than recreating it.
- **B4:** Reuse `isFeatured` and the featured feed index/query. Featured toggle must not expose unapproved listings publicly.
- **Backend before integration:** Tasks 1–6 define query/mutation contracts. UI-only tasks 7–11 can proceed after the row/action contracts are reviewed. Integration tasks 12–15 depend on the corresponding backend and UI tasks.

```text
B1 404 gate ───────────────────────────────────────────────────────────┐
B3a draft + B3 moderation + B3c approveSelected ──> Tasks 1–6          │
B4 isFeatured feed ───────────────────────────────> Task 4              │
Tasks 1–6 (functionality contracts) ──┬──> Tasks 7–11 (UI-only)         │
                                     └──> Task 12 (directory query/view) │
Tasks 7–10 + Task 12 ──> Task 13 (actions/create) ──> Task 14 (bulk)      │
Tasks 2–7 + Task 11 ──> Task 15 (audit query/UI)                          │
Tasks 1–15 + B1/B3/B4 regressions ──> Task 16 final gate <────────────────┘
```

## Functionality tasks — data, authorization, mutations

### Task 1 — ADD: Paginated Super Admin directory query

- **Description:** Add an admin-only 25-result cursor query with name/owner-name/location search and category/status/verification filters over the full dataset. Join only category name and owner name; return a safe admin projection. Use existing indexes/pagination limits and preserve continuation/split behavior. Do not add owner email or moderation internals to the result.
- **Acceptance:** `requireSuperAdmin` runs in the query; the server rejects `paginationOpts.numItems > 25`; search/filter combination is correct across cursor boundaries; up to 25 matches are returned; projection omits raw documents, owner ID/email, and unnecessary moderation fields; failures/splits are explicit and bounded; no public query behavior changes.
- **Files:** `convex/businesses/queries.ts`, `convex/businesses/adminProjections.ts` (new), `convex/schema.ts` (only if measured query needs a narrowly scoped index), `scripts/admin-directory-query.test.ts` (new).
- **Dependencies:** B3 base schema and B1 authorization. Independent of Tasks 2–6 after the result contract is reviewed.
- **Verify:** `pnpm test`, `pnpm lint`, `pnpm build`; authenticated Convex checks for all filters, owner/location search, cursor boundaries, split/continuation, oversized page rejection, and non-admin denial. Inspect read rows/bytes at 10× seed size.

### Task 2 — ADD: Read-only paginated audit query

- **Description:** Add a Super Admin-only, cursor-paginated audit query for newest-first rows (up to 25 per page) and action/actor/target-or-reason filters. Keep it read-only and preserve business targets even after the business is deleted.
- **Acceptance:** Only `requireSuperAdmin` can read; query returns a narrow projection; action/actor/search filters combine correctly; pagination does not drop records; no mutation path is exposed in the Audit UI contract.
- **Files:** `convex/auditLogs.ts` (new), `convex/schema.ts` (add a created-time index only if needed), `scripts/admin-audit-query.test.ts` (new).
- **Dependencies:** Existing `auditLogs` table from B3. Independent of Task 1.
- **Verify:** `pnpm test`, `pnpm lint`, `pnpm build`; authenticated Convex checks for actor/action/text filters, deleted-target retention, pagination, and non-admin denial.

### Task 3 — UPDATE: Audited status actions for the directory

- **Description:** Extend the existing Super Admin moderation seam to support Approve, Request Changes, Reject, Suspend, and Restore using `resolveTransition`. Keep B3's pending-review guards, verification stamps, notification effects, and audit transaction. Record actual `fromStatus`; enforce the accepted reason policy: Request Changes/Reject/Suspend require a reason; Approve/Restore do not.
- **Acceptance:** No raw status writes; status/action/current-state combinations are validated server-side; each success writes exactly one audit row and existing applicable notification; illegal/stale actions write nothing; B3 queue behavior remains unchanged.
- **Files:** `convex/businesses/mutations.ts`, `convex/businesses/moderationPolicy.ts`, `scripts/moderation-policy.test.ts` (extend).
- **Dependencies:** B3 state machine and moderation API. Independent of Tasks 1, 2, 4–6.
- **Verify:** `pnpm test`, `pnpm lint`, `pnpm build`; authenticated Convex tests for each action, reason matrix, stale status, audit from/to status, verification stamps, and notification parity.

### Task 4 — ADD: Persisted featured pin mutation

- **Description:** Add a Super Admin-only `isFeatured` mutation that sets the requested boolean, updates `lastUpdatedAt`, and writes an audit row in the same transaction. Preserve the existing B4 public projection/index.
- **Acceptance:** Pin/unpin persists after reload; non-admin call is denied; one audit row records each actual change; duplicate no-op toggles do not create misleading audit events; approved featured records appear/order correctly in Trending, while non-approved records remain hidden.
- **Files:** `convex/businesses/adminMutations.ts` (new), `scripts/admin-directory-mutations.test.ts` (new or extend).
- **Dependencies:** B4 `isFeatured` schema/index/feed. Independent of Tasks 1–3, 5–6.
- **Verify:** `pnpm test`, `pnpm lint`, `pnpm build`; authenticated Convex mutation and public B4 feed regression.

### Task 5 — ADD: Type-confirmed business and child hard delete

- **Description:** Add a server-guarded hard-delete mutation that re-reads the target and requires the exact current business name. Insert the audit row first, remove all directly linked business child documents and referenced storage files, then delete the parent. Preserve audit logs and unrelated payment attempts.
- **Acceptance:** Client typing alone is not trusted; wrong/stale name fails with no deletes; linked `menuGroups`, `menuItems`, `serviceOfferings`, `stylists`, `orders`, `bookings`, `quoteRequests`, and `notifications` are deleted; `notifications.byBusinessId` bounds the notification lookup; photos and child media storage IDs are deleted safely; audit row survives; database cascade never partially commits.
- **Files:** `convex/businesses/adminMutations.ts`, `convex/businesses/adminDeletion.ts` (new), `convex/schema.ts` (add `notifications.byBusinessId`), `scripts/admin-delete-policy.test.ts` (new).
- **Dependencies:** B3 `auditLogs`, schema child tables, and B7 storage ownership contract. Independent of Tasks 1–4 and 6 after the audit/delete contract is reviewed.
- **Verify:** `pnpm test`, `pnpm lint`, `pnpm build`; Convex dev fixture with every linked table and media reference; test mismatched name, missing listing, non-admin, preserved audit, and transaction-limit failure. Verify storage ID sharing behavior before deleting a referenced file.

### Task 6 — ADD: Admin-created draft for an existing owner

- **Description:** Add a public Convex action that checks Super Admin, resolves an exact existing email through Clerk Backend `getUserList`, validates the returned user, then invokes an internal draft mutation that reproduces B3a `createDraft` defaults and assigns the synchronized user. Do not expose a public owner-ID mutation; do not invite users or store email. Configure the Clerk Backend secret as a Convex server environment variable.
- **Acceptance:** Name and category are required; draft defaults match B3a; only an existing usable Clerk account with a local `users` row is assignable; unknown/ambiguous/unverified/unsynchronized account fails safely; the public action and internal mutation enforce the Super Admin identity; the internal mutation cannot be called directly by clients; creation is audited; no Clerk email/user data is persisted or returned unnecessarily.
- **Files:** `convex/businesses/adminOwnerActions.ts` (new, external Clerk lookup action), `convex/businesses/adminMutations.ts` (internal mutation), `scripts/admin-create-draft.test.ts` (new).
- **Dependencies:** B3a `createDraft`, Clerk Backend SDK, B1 guard, Convex Clerk secret configuration. Independent of Tasks 1–5 after contract review.
- **Verify:** `pnpm test`, `pnpm lint`, `pnpm build`; authenticated Convex action checks for valid existing, unknown, unverified, unsynchronized, and non-admin cases; verify the internal mutation is not client-callable and the public API cannot accept owner IDs; inspect returned payload for PII minimization.

### Functionality checkpoint — after Tasks 1–6

- [ ] All new server APIs call `requireSuperAdmin`; a UI/client-only check is not accepted.
- [ ] Query/action pure tests pass; Convex dev proves action + audit + notification atomicity.
- [ ] `approveSelected` remains approve-only, current-page/25-ID bounded, all-or-none, and one audit row per listing.
- [ ] Hard-delete audit is retained; each linked child/storage reference is covered.
- [ ] B4 featured query still returns only approved records and sees the updated order.

## UI-only tasks — presentational shell and components

These tasks define typed component contracts and production-token styling. They do not introduce mock persistence or duplicate backend rules. Keep UI behavior state-driven and wire to Convex only in Tasks 12–15.

### Task 7 — UPDATE: Command Deck shell and tabs

- **Description:** Replace the current simple header presentation with the accepted top command bar tabs. Keep the existing notification control and current routes. Show Directory and Audit as active surfaces; label Overview, Owners, and Categories as B6b placeholders. Do not change `app/admin/layout.tsx` authorization.
- **Acceptance:** No page-per-surface sidebar; tabs have clear active/disabled state and keyboard semantics; all admin routes use the same shell; the mobile tab bar wraps/scrolls without hiding the current section; B1 server 404 gate remains untouched.
- **Files:** `app/admin/admin-shell.tsx`, `app/admin/admin-command-bar.tsx` (new), `app/admin/page.tsx`.
- **Dependencies:** Accepted prototype and B1. Independent of Tasks 1–6 at the visual-contract level.
- **Verify:** `pnpm lint`, `pnpm build`; check keyboard navigation and desktop/tablet/mobile layout. Re-run B1 404 tracer after route integration.

### Task 8 — CREATE: Directory grid/table/filter/map presentation

- **Description:** Build the Directory dataset presentation over typed admin rows: shared BusinessCard admin density for Grid, a separate Table row component, shared search/filter controls, and a disabled Map “Coming soon” control. Keep one result collection contract.
- **Acceptance:** Grid and Table render identical IDs/order/status; controls expose search/category/status/verification; no view-specific filtering or duplicated dataset; existing public `row`/`mini` BusinessCard output is unchanged; every color/type/space/radius/shadow uses `app/globals.css` tokens.
- **Files:** `app/admin/directory/directory-grid.tsx` (new), `app/admin/directory/directory-table.tsx` (new), `app/admin/directory/directory-filters.tsx` (new), `components/directory/business-card.tsx`, `components/directory/admin-business-card.tsx` (new, only if required to isolate admin fields).
- **Dependencies:** Task 1's projection contract. Independent of Tasks 9–11.
- **Verify:** `pnpm lint`, `pnpm build`; component-level/pure checks for shared row identity; Reticle visual check after integration; public search and landing regression.

### Task 9 — CREATE: Persistent inspector and inline confirmations

- **Description:** Build the selected-listing inspector and inline confirmation presentation. Include the accepted consequence language, required reason field, exact-name input, busy/error states, and mobile bottom-sheet layout. Do not use a modal.
- **Acceptance:** Inspector has no confirm mode until an action is selected; Request Changes/Reject/Suspend confirm is blocked until reason is nonblank; hard delete confirm is blocked until exact name match; Cancel returns to inspector without mutation; mobile sheet can close with keyboard/focus behavior.
- **Files:** `app/admin/directory/directory-inspector.tsx` (new), `app/admin/directory/directory-inline-confirm.tsx` (new), `app/admin/directory/directory-route.tsx` (new; state interface only), `components/ui/sheet.tsx` (reuse only; do not change unless a proven gap exists).
- **Dependencies:** Tasks 3–5 action contracts and Task 8 row type. The layout can proceed after interface review.
- **Verify:** `pnpm lint`, `pnpm build`; Reticle after integration for reason, wrong-name, cancel, and mobile sheet behavior.

### Task 10 — CREATE: Bulk and Add Business inline surfaces

- **Description:** Build the approve-only current-page bulk bar/count confirmation and inline Add Business form. This task creates presentation only; route wiring is Task 13.
- **Acceptance:** Bulk exposes only Approve, displays the exact eligible current-page count, and has confirm/cancel/error/pending states. Add form has name, category, and owner email; unknown owner/error states are renderable; neither surface uses a modal.
- **Files:** `app/admin/directory/directory-bulk-bar.tsx` (new), `app/admin/directory/directory-bulk-confirm.tsx` (new), `app/admin/directory/add-business-form.tsx` (new).
- **Dependencies:** Tasks 1, 6, and 8 contracts plus the existing B3c bulk-approve API. Independent of Task 5 and Task 11.
- **Verify:** `pnpm lint`, `pnpm build`; presentational checks for count, approve-only control, inline validation and narrow layout.

### Task 11 — CREATE: Read-only Audit tab presentation

- **Description:** Build the Audit route table and action/actor/text filters over a read-only typed page result.
- **Acceptance:** Audit is read-only; rows show when/actor/action/target/change/reason; filters are accessible and compose; deleted targets remain visible; responsive table has a usable narrow layout.
- **Files:** `app/admin/audit/page.tsx` (new), `app/admin/audit/audit-route.tsx` (new), `app/admin/audit/audit-table.tsx` (new).
- **Dependencies:** Task 2 query contract and Task 7 navigation. Independent of Tasks 8–10.
- **Verify:** `pnpm lint`, `pnpm build`; Reticle after query wiring for filters and persistence after route reload.

## Integration and acceptance tasks

### Task 12 — UPDATE: Directory query, filters, pagination, and view state

- **Description:** Connect the Directory route to Task 1's Convex query; own query, filters, cursor history, view mode, selection, and inspector target in one route state. Grid/Table consume the same page result.
- **Acceptance:** Search/filter spans the full dataset; filter/search changes reset cursor and selection; switching Grid/Table preserves all controls and selected row; current page is at most 25 results; Map remains disabled; loading/empty/error/split states are actionable.
- **Files:** `app/admin/directory/page.tsx` (new), `app/admin/directory/directory-route.tsx`, `app/admin/directory/directory-filters.tsx`, `app/admin/directory/directory-grid.tsx`, `app/admin/directory/directory-table.tsx`.
- **Dependencies:** Tasks 1, 7–9. Serial route integration before Tasks 13–14.
- **Verify:** `pnpm test`, `pnpm lint`, `pnpm build`; authenticated Reticle search → filter → Grid/Table switch → page continuation journey; verify same IDs/order and preserved state.

### Task 13 — UPDATE: Wire status, featured, delete, and create flows

- **Description:** Connect inspector status/featured/delete controls to Tasks 3–5, and Add Business to Task 6's public action. Do not optimistically report success before mutation commit.

- **Acceptance:** Each action uses the correct confirm/reason/name gate; successful actions write audit rows; stale/unauthorized/error states remain truthful; Add Business calls the email-resolving action and cannot submit an owner ID.
- **Files:** `app/admin/directory/directory-route.tsx`, `app/admin/directory/directory-inspector.tsx`, `app/admin/directory/directory-inline-confirm.tsx`, `app/admin/directory/add-business-form.tsx`.
- **Dependencies:** Tasks 3–6, 9–10, 12. Directory route changes serialize with Task 12.
- **Verify:** `pnpm test`, `pnpm lint`, `pnpm build`; authenticated Reticle journeys for each action and add flow; query Audit tab after actions and verify durable rows and exact delete cascade.

### Task 14 — UPDATE: Wire approve-only current-page bulk flow

- **Description:** Connect the bulk bar and inline count confirmation to existing `approveSelected` and the current query page only.
- **Acceptance:** Only pending rows from the current page are approved; confirm count is exact; one audit row is written per listing; cancel/no-op/error does not claim success; selection clears only after commit/reactive refresh.
- **Files:** `app/admin/directory/directory-route.tsx`, `app/admin/directory/directory-bulk-bar.tsx`, `app/admin/directory/directory-bulk-confirm.tsx`.
- **Dependencies:** Tasks 8, 10, 12–13 and the existing B3c `approveSelected` contract. Serialize with Task 13 route integration.
- **Verify:** `pnpm test`, `pnpm lint`, `pnpm build`; Reticle count/cancel/confirm/stale-item flow and Audit row count.

### Task 15 — UPDATE: Wire Audit tab to persistent audit query

- **Description:** Connect the Audit route to Task 2's query and top-level command tabs. Ensure the route shows committed rows from all B6a actions, including per-listing bulk rows and deleted targets.
- **Acceptance:** Action/actor/search filters work across pages; no write controls; audit view reflects committed state after navigation/reload; route remains Super Admin-only.
- **Files:** `app/admin/audit/audit-route.tsx`, `app/admin/audit/audit-table.tsx`, `app/admin/admin-command-bar.tsx`.
- **Dependencies:** Tasks 2–7 and 11. The Audit query/UI can be wired independently of Tasks 12–14 after the API contract is reviewed; final end-to-end verification joins the flows.
- **Verify:** `pnpm test`, `pnpm lint`, `pnpm build`; Reticle audit filters, action persistence, deleted target persistence, and ordinary-user 404.

### Task 16 — VERIFY: B1/B3/B4 regressions and final acceptance

- **Description:** Run the complete issue acceptance and record verification evidence. Fix only findings in their owning task; do not add unrelated cleanup.
- **Acceptance:** Lint/build/test pass; grid/table data parity and state preservation pass; all action/audit/delete/bulk/featured/create requirements pass; B1 404, B3 approval notifications/state/audits, and B4 public featured behavior remain correct; design-token and responsive checks pass.
- **Files:** No planned application changes. Add evidence only if the PR process requests it.
- **Dependencies:** Tasks 1–15; final serial gate.
- **Verify:** `pnpm test`, `pnpm lint`, `pnpm build`; authenticated Convex dev checks; Reticle verified end-state journeys on desktop/tablet/mobile; review the final diff for generated files, PII, token violations, and unrelated changes.

## Parallelization and checkpoints

- Tasks 1 and 2 can proceed in parallel after reviewing API contracts.
- Tasks 3–6 can proceed in parallel by owning separate Convex modules/helpers, but serialize edits to `convex/businesses/mutations.ts` and `adminMutations.ts` to avoid conflicts.
- UI-only Tasks 7–11 can proceed after the relevant types/contracts are agreed. Tasks 8–10 share the directory route and should keep component construction separate from route wiring.
- Tasks 12–14 serialize because they integrate the same directory route state. Task 15's Audit components can be built independently after Task 2 and then wired after the shell/commands exist.
- Run `pnpm test`, `pnpm lint`, and `pnpm build` after each vertical integration slice and at Task 16. Reticle verification is required after each changed user-facing slice, not only at the end.

## Open assumptions / risks

- **Assumed:** Exact, verified Clerk email and a synchronized Convex user row are required for assignment; otherwise return an actionable error. No user creation/invite fallback. The Clerk Backend secret is configured only in Convex server environment.
- **Assumed:** Any storage ID referenced by the business is owned by that business. If B7 permits sharing, verify remaining references before deleting the file.
- **Risk:** Full-dataset owner/location search can be read-intensive. Keep reads bounded; inspect real Convex row/byte limits and add a dedicated index only with evidence.
- **Risk:** Large cascades can exceed transaction limits. A failed cascade must not report success; an async deletion workflow would require a separate approved design.
- **Risk:** Shared BusinessCard has existing public consumers. Keep the admin projection discriminated and prove existing public cards are unchanged.

## Completion checklist

- [ ] Every task has acceptance criteria, dependencies, concrete files, and a verification step.
- [ ] B1, B3, and B4 relationships are explicit.
- [ ] UI-only and functionality work are partitioned.
- [ ] Inline confirmation override is applied everywhere; no modal action flow is reintroduced.
- [ ] All API boundaries are server-authorized and return narrow projections.
- [ ] Final full quality and Reticle evidence is recorded before implementation is called done.
