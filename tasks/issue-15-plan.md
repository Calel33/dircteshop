# Implementation Plan: Issue #15 — B6a Admin Directory

## Task contract

- **Type:** Planning/specification only; no application code.
- **Target:** B6a of parent #6, `tasks/issue-15-plan.md` and `tasks/issue-15-todo.md`.
- **Goal:** Deliver secure admin directory search/filter, grid/table, moderation actions, audit visibility, featured pinning, existing-account assignment, and guarded hard deletion within the accepted Command Deck.
- **Done when:** The plan records the confirmed scope, backend and UI boundaries, dependency order, files, test/verification steps, risks, and B1/B3/B4 regression checks; the accompanying todo partitions UI-only work from functionality work.

## Problem definition

### Goal and users

As a **Super Admin**, manage business listings from one operational directory: find records by business name, owner name, or location; narrow by category, status, and verification; inspect a listing; run a guarded action; and verify the result in the audit feed. Admin-created drafts assign to an existing account by email. Public visitors continue to see only approved listings, and B4's featured feed continues to use `isFeatured`.

Primary user: the configured Super Admin. Secondary users are business owners who receive the existing B3/B5 moderation and status effects. Public visitors are regression stakeholders for the B4 Trending feed.

### Constraints and success measures

- Inherit the existing TypeScript / Next.js 16 App Router / React 19 / Tailwind CSS v4 / Clerk / Convex / shadcn-ui / pnpm single-app modular monolith. Do not add a service or package.
- B6a is blocked by B3. Reuse the B3a `createDraft` domain defaults, B3 moderation state machine, and B3c `approveSelected` atomic 1–25 approval contract. Do not rebuild the B1 `/admin(.*)` 404 boundary.
- B4 owns the public `isFeatured` feed and index. B6a updates the same field and must prove the feed responds to pin/unpin.
- The accepted #22 Variant B Command Deck overrides page-per-surface sidebar and modal UX. Confirmations are inline in the inspector; the selected record inspector stays persistent on desktop and becomes a mobile bottom sheet.
- Clarified with the requester: functional B6a tabs are Directory and read-only Audit; Overview, Owners, and Categories remain visibly identified B6b placeholders. CSV export is B6b. Directory list pages contain up to 25 matching rows, search/filters cover the full dataset server-side, and bulk approve is limited to eligible `pendingReview` rows on the current page.
- Clarified with the requester: Add Business assigns only an existing Clerk account by a trusted server-side exact email lookup. Do not invite/create a Clerk account and do not persist owner email in Convex. Directory owner search/display uses owner name.
- Clarified with the requester: hard delete removes all business-linked Convex children and referenced Convex Storage files, while retaining the audit row written before deletion.
- Success is the issue's acceptance plus `pnpm test`, `pnpm lint`, `pnpm build`, authenticated Convex checks, and Reticle evidence for changed user-facing flows. No numeric uptime, traffic, latency, or throughput target was supplied; do not invent one.

### Existing B3/B4 foundation — reuse, do not rebuild

- `convex/businesses/mutations.ts:70-110` creates a blank draft for the signed-in owner and requires name/category. Admin creation must preserve the same draft defaults while resolving an existing owner.
- `convex/businesses/mutations.ts:267-330` contains the B3b pending-review moderation mutation with a server-derived actor, reason policy, status transition, notification, and audit write.
- `convex/businesses/mutations.ts:348-412` contains B3c `approveSelected`: atomic approve-only action for 1–25 current-page IDs, one audit row per listing, and owner notifications.
- `convex/businesses/helpers.ts` owns legal status transitions. Never accept a raw client status.
- `convex/authz.ts` owns fail-closed Super Admin authorization. Every new Convex query/mutation must call `requireSuperAdmin`.
- `convex/schema.ts:39-93` already contains `businesses.isFeatured`, `byStatusFeaturedUpdatedAt`, and the public `searchText` index. Do not add owner email to this public search field.
- `convex/schema.ts:95-203` defines vertical and workflow records linked by `businessId`; `schema.ts:205-216` defines audit rows; `schema.ts:218-233` defines business-linked notifications.
- `convex/businesses/queries.ts:130-158` is the current public directory base-query pattern. Its public result is approved-only and is not an admin projection.
- `app/admin/layout.tsx:8-30` verifies the server-side identity and `users.isSuperAdmin`, then returns `notFound()` for missing/non-admin users. Keep it unchanged; UI hiding is not authorization.
- `app/admin/admin-shell.tsx:1-14` is the existing client shell. Replace its page-per-surface feel with the accepted Command Deck tabs; retain the shell boundary and notification menu.
- `components/directory/business-card.tsx:13-28,196-202` is the shared public BusinessCard (`row`/`mini`, `PublicDirectoryResult`). Its current consumers are `components/directory/business-results.tsx` and `components/directory/landing-sections.tsx`. Adding an admin density must preserve both public variants and avoid sending admin-only fields to public queries.
- `app/admin/approvals/approvals-route.tsx:87-167,169-391` is the current authenticated Convex query/mutation and count-confirmation pattern; reuse where appropriate, but the B6a confirmation UX is inline, not a Dialog.

## Scope

### Included

- `/admin/directory` in the Command Deck: server-filtered, cursor-paginated directory; 25 matching rows per page; name/owner-name/location search; category/status/verification filters; Grid and Table over the same query result and state; Map disabled as “Coming soon.”
- Grid uses the shared BusinessCard in an admin density; table is a separate row renderer.
- Persistent inspector with the prototype's listing summary and all supported listing actions.
- Inline consequence + Confirm/Cancel for all actions. Request Changes, Reject, and Suspend require a nonblank moderation reason; Approve and Restore do not. Hard delete additionally requires exact business-name typing and clearly states child/file deletion and audit ordering.
- Bulk approve only, with exact count confirmation and current-page scope. Reuse `approveSelected`; one audit row per approved listing.
- Persisted `isFeatured` pin/unpin with an audit row and a `lastUpdatedAt` update so B4's `byStatusFeaturedUpdatedAt` ordering reflects the change.
- Add Business draft with name, required category, and owner email. Resolve one existing Clerk account server-side; fail on unknown/ambiguous/unusable account; no account creation or email persistence.
- Read-only, filterable Audit tab (action, actor, target/reason search), including per-listing bulk records.
- Command Deck responsive behavior: tablet filter rail becomes a horizontal strip; mobile rail becomes chips and inspector becomes a bottom sheet.

### Out of scope / non-goals

- B6b Overview implementation, Owners view, Categories CRUD, CSV export, or other B6 surfaces. The shared tab bar may show these as clearly labeled placeholders; do not invent their behavior.
- Modal confirmations, sidebar navigation, a Kanban/board surface, or a working Map.
- Bulk actions other than approve; cross-page selection; approval of non-`pendingReview` records.
- Inviting/creating Clerk users, storing user email in Convex, or searching directory by owner email.
- Admin editing of business profile content, new public search semantics, analytics, or notification redesign.
- New infrastructure/dependencies or manual edits to generated Convex files.

## Feature metadata

- **Feature type:** Enhancement / admin capability.
- **Estimated complexity:** High — cross-layer authorization, filtered cursor query, existing moderation semantics, atomic destructive cascade, Clerk lookup, responsive UI, and public B4 regression.
- **Primary systems:** `app/admin/**`, `components/directory/business-card.tsx`, `convex/businesses/**`, `convex/auditLogs.ts` (new), Clerk Backend SDK, existing audit/notification tables.
- **Dependencies:** B1 guard; B3a draft flow and B3 moderation; B3c bulk approval; B4 featured feed. No new package.
- **Implements:** GitHub issue #15, B6a of parent #6.
- **Back-reference:** `screens/SPEC.md §3-5, §8, §10, §14`; `screens/wayfinder/build/B6-admin-directory.md`; accepted prototype in `screens/wayfinder/prototype/admin-workspace.html`; accepted decision in parent #6 comment / issue #22.

## Architecture decisions

1. **Keep the modular monolith.** Next.js owns the Command Deck; a public Convex action performs the server-only Clerk lookup and invokes an internal create mutation. Convex owns authorization, business state, audit writes, and projections. This minimizes delivery and operational cost and inherits the existing reactive data flow. Trade-off: Convex and Clerk remain shared runtime dependencies; the Clerk secret must be configured in Convex; no separate admin service is justified for this MVP.
2. **Share the shell, preserve route contracts.** Use the same Command Deck chrome across `/admin`, `/admin/directory`, and `/admin/audit`; keep the documented route URLs and existing server-layout 404 gate. This preserves bookmarkable App Router surfaces without restoring a sidebar. Route navigation may reset the selected inspector record; grid/table switching must not reset query/filter/page state.
3. **Use cursor pagination and server-side filtering.** `listAdminDirectory` accepts a Convex cursor, up to 25 matching records, search text, category, status, and verification. The server enforces `numItems <= 25`, joins a narrow owner/category projection, and applies owner-name/location matching before returning rows. Use existing indexes and pagination/read limits; do not load all businesses into the browser. A scan may return fewer than 25 rows at end-of-data or a read-limit split, with a continuation cursor. This favors bounded reads and exact cross-page search over a denormalized search field; trade-off: low-selectivity owner/location search can read more candidate rows. Measure row/byte reads and add an admin-only index only if evidence requires it.
4. **Keep email transient and server-only.** A public Convex action authenticates/authorizes the request, calls Clerk `getUserList({ emailAddress: [...] })`, validates an exact usable match, then invokes an internal mutation with the Clerk external ID. The internal mutation cannot be called directly by a client and re-checks the Super Admin identity before resolving the existing Convex user row. This avoids duplicate PII storage and avoids a new identity service; trade-off: Add Business depends on Clerk Backend API availability, a Convex Clerk secret, and can fail if a Clerk user has not yet synchronized to Convex.
5. **Extend, do not bypass, the B3 state machine.** All status actions resolve to legal server-side transitions; no client status patches. Preserve B3 notifications and audit semantics. Audit `fromStatus` must reflect the actual current status for Suspend/Restore. Use the reason matrix settled by the prototype. Reuse existing `approveSelected` for current-page bulk approval, preserving its all-or-nothing 25-ID bound.
6. **Make irreversible delete one guarded operation.** The UI requires exact name typing, and the server mutation independently compares the typed string with the current business name. In one Convex mutation, insert the hard-delete audit row first, delete all directly linked business children and referenced storage files, then remove the business. Preserve audit evidence. Transactional database writes favor consistency over partial availability; trade-off: an unusually large child set can hit Convex transaction read/write limits and must fail safely rather than partially delete.
7. **Reuse the existing featured feed contract.** Set `isFeatured` through a Super Admin mutation, audit the toggle, and update `lastUpdatedAt`; B4 already indexes approved/featured/update time. This keeps one source of truth; trade-off: the feature toggle moves the listing in Trending order as well as changing its pin.
8. **Use production design tokens, not prototype CSS.** Reuse `app/globals.css` Tailwind color, font, spacing, radius, and shadow tokens and the responsive conventions. The prototype settles composition and interaction, not token values. This optimizes consistency/accessibility over pixel-copying standalone prototype CSS.

## Data and API design

### Persisted data

- No new user email field. `users` remains `{name, externalId, role}`.
- Reuse `businesses.isFeatured`, `status`, `verification`, existing timestamps, and `auditLogs`.
- New audit actions cover the directory status actions, featured toggle, hard delete, and admin draft creation. Bulk approve writes one audit row per listing, not one aggregate row.
- Delete business-linked `menuGroups`, `menuItems`, `serviceOfferings`, `stylists`, `orders`, `bookings`, `quoteRequests`, and `notifications`; add `notifications.byBusinessId` so a cascade does not scan the full notification table. Delete referenced storage IDs from business photos and child media. Do not delete `auditLogs`; `paymentAttempts` has no business foreign key and is outside this cascade.

### Convex and Clerk contracts

- **`listAdminDirectory` query:** `requireSuperAdmin`; accepts `paginationOpts` and optional `search`, `categoryId`, `status`, and verification state; rejects `numItems > 25`; returns a narrow admin-only row (business fields needed by grid/table/inspector, category name, owner name), page metadata, and continuation/split status. Search must match business name, owner name, and location across the whole result set, not just the current browser page. Never return raw documents, moderation internals not needed by the inspector, or user email.
- **`listAuditLogs` query:** `requireSuperAdmin`; cursor-paginated, newest first, filterable by action/actor and target/reason search; read-only.
- **Status mutation:** accepts an action, optional reason, and business ID; derives actor/status on the server, validates current status and required reason, writes status/verification/metadata, existing applicable notification, and one audit row atomically. Approve is pending-only; suspend is approved-only; restore is suspended-only.
- **`approveSelected`:** reuse existing 1–25 unique IDs, current-page only, pending-only, all-or-none mutation and per-listing audit/notification writes.
- **Featured mutation:** accepts business ID and desired boolean; guarded by `requireSuperAdmin`; writes `isFeatured`, `lastUpdatedAt`, and audit atomically.
- **Hard delete mutation:** accepts business ID and typed confirmation name; re-reads the business, validates exact current name, inserts audit first, removes its linked child records/storage objects, then deletes the business. A failure must not report success or leave a partial database cascade.
- **Owner lookup action + internal draft mutation:** the public Convex action accepts name, category ID, and owner email; checks authenticated Super Admin status before calling Clerk; validates an exact verified email match; then invokes an internal mutation with owner and actor IDs. The internal mutation independently verifies Super Admin, confirms the Convex user row exists, applies the same empty draft defaults as `createDraft`, and audits creation. No public mutation accepts an owner ID, and the internal mutation cannot be called directly by a client. The Clerk secret is server-side Convex configuration only; no email or raw Clerk record is persisted/returned.

### Client contracts

- One `DirectoryRoute` owns query/filter/cursor/view/selection/inspector/action state. Grid and table render the same current page. Switching Grid/Table changes presentation only and preserves search, filters, page cursor, selection, and inspector target.
- Search and filter changes reset the cursor traversal and current-page selection. Bulk count is the number of eligible `pendingReview` records on the current page; no cross-page selection.
- Confirmation is inline: consequence text, any required reason/name input, Confirm, Cancel, pending/error states. No Radix Dialog for action confirmation. Destructive confirmation remains disabled until the exact current name matches.
- Inspector stays alongside the dataset on desktop. At tablet the rail becomes a horizontal filter strip; at mobile filters become chips and the inspector is a bottom sheet with focus/close behavior.
- The audit surface has no mutation controls. It reflects committed Convex audit rows only.

## Relevant documentation

### Local source of truth — read before implementation

- `AGENTS.md` — project stack, tracer-bullet method, pnpm validation, Reticle requirements, Next.js 16 guide requirement.
- `convex/AGENTS.md` — backend ownership, fail-closed authorization, transitions/actions, generated-file rule, Convex docs requirement.
- `screens/SPEC.md §3-5, §8, §10, §14` — roles/404 behavior, schema, state machine, featured feed, admin requirements, build dependency order.
- `screens/wayfinder/build/B3-owner-approval-loop.md` and `B4-landing-search.md` — B3/B4 dependencies and verification.
- `screens/wayfinder/build/B6-admin-directory.md` — full B6 parent slice; B6b scope is explicitly deferred here.
- `screens/wayfinder/prototype/admin-workspace.html` — accepted Variant B Command Deck, inline confirms, reason/name guards, count semantics, and responsive layout. Do not copy standalone CSS or in-memory mutations.
- `design.md` and `app/globals.css` — production token source and design mapping.
- `package.json` — `pnpm test`, `pnpm lint`, `pnpm build` scripts.
- `convex/_generated/ai/guidelines.md` was not present at planning time. Recheck before Convex implementation; if still absent, follow the official Convex docs below and established repository patterns.

### Official implementation references

- [Convex Actions](https://docs.convex.dev/functions/actions) — actions can call third-party APIs, access caller identity, and invoke queries/mutations; use a Node action only if the SDK requires Node APIs.
- [Convex internal functions](https://docs.convex.dev/functions/internal-functions) — internal mutations are not callable directly by clients and are suitable for the post-lookup write.
- [Convex auth in functions](https://docs.convex.dev/auth/functions-auth) — access the authenticated identity inside actions; verify caller authorization inside the server boundary.
- [Clerk Backend `getUserList()`](https://clerk.com/docs/reference/backend/user/get-user-list) — exact email lookup via `emailAddress`; validate the returned user/email/verification rather than trusting an external response.
- [Convex paginated queries](https://docs.convex.dev/database/pagination) — cursor pagination, `paginationOptsValidator`, `maximumRowsRead` / `maximumBytesRead`, and split handling.
- [Convex mutations and transactions](https://docs.convex.dev/functions/mutation-functions) — database writes in a mutation commit atomically; errors roll them back; mutations cannot call third-party APIs.
- [Convex Storage deletion](https://docs.convex.dev/file-storage/delete-files) — `ctx.storage.delete(storageId)` is available in a mutation.

## Testing strategy

### Pure/unit coverage

- Directory query: combined category/status/verification filters; search by business name, owner name, city/state/address; cursor continuation through nonmatching rows; page/view changes preserve or reset exactly as specified; narrow projection excludes email, owner ID, and moderation internals.
- Moderation: valid and invalid status transitions; reason matrix; no double audit/notification; accurate from/to statuses; approval stamps verification; stale pending approval rejected.
- Bulk: approve only, 1–25 unique current-page IDs, exact count; stale/non-pending ID fails all-or-none with no partial business/audit writes.
- Featured: pin/unpin persists, writes an audit row, updates `lastUpdatedAt`, and remains visible only under the existing public approved/featured policy.
- Delete: exact current-name match required server-side; audit insert precedes deletes; every linked table and referenced storage ID is covered; audit evidence remains; a failed operation never reports success or leaves a partial database cascade.
- Admin creation: blank draft defaults match `createDraft`; category/name validation; exact existing Clerk email maps to the correct Convex user; unknown, multiple, unverified, or unsynchronized account returns a safe error; the public API cannot bypass the email lookup by supplying an owner ID; no account/email is persisted.

### Integration/manual checks

- Use a running Convex dev deployment and a Super Admin account to verify list filters across multiple pages, Grid/Table parity and preserved controls, each action, inline reason/delete confirms, bulk count/scope, feature persistence, owner lookup, and Audit rows.
- Use an ordinary authenticated account and an unauthenticated session to verify `/admin`, `/admin/directory`, and `/admin/audit` remain 404 through the existing B1 gate; also call guarded Convex functions to verify server authorization.
- Delete a fixture with every supported child type, business photos, menu item image, and stylist image; confirm business/children/files are removed and the audit row remains.
- Pin/unpin an approved fixture and verify B4 Trending reflects it in the expected `lastUpdatedAt` order; verify unapproved featured records remain absent publicly.
- Run Reticle over the changed user journeys: filter → switch view → inspect → confirm an action → confirm durable audit state; delete with wrong/right name; bulk count/cancel/confirm; add business to existing owner; audit filter. Verify responsive desktop/tablet/mobile states and finish each journey at its requested end state.

## Validation commands

Run after each completed backend/UI integration slice and at final acceptance:

```bash
pnpm test
pnpm lint
pnpm build
```

For Convex-backed behavior, start `npx convex dev` in its own terminal as required by `convex/AGENTS.md`; do not infer database behavior from pure tests alone. For user-visible changes, drive and record Reticle verified flows per root `AGENTS.md`. Do not edit `convex/_generated/**` manually.

## Risks and assumptions

| Item | Impact | Mitigation / disposition |
|---|---|---|
| Directory search joins owner data and scans candidates for name/location while maintaining full-dataset search. | Sparse matches can increase reads and produce shorter pages. | Use cursor pagination, existing status/category/verification indexes where useful, explicit row/byte limits, and split/continuation handling. Measure at 10× the current seeded business count; add a dedicated admin search index only if measurements justify its maintenance cost. |
| Exact `ownerEmail` is not stored in Convex. | Clerk lookup can fail or return an account that has not reached the local users table; the Convex action also requires a server-side Clerk secret. | Resolve only in a public action that checks Super Admin, call an internal mutation that cannot be invoked directly, validate exact email and a usable verified address, and reject unknown/ambiguous/unsynchronized users; never create an account. |
| The client can call Convex directly. | A client could request more than the UI's 25-row page. | Reject `numItems > 25` at the query boundary and test oversized calls; UI page size is not the server boundary. |
| A single listing may have many linked records or storage objects. | A one-mutation cascade can reach Convex transaction limits. | Test the largest realistic fixture and inspect read/write metrics. On limit failure, fail with no partial database mutation; an asynchronous cascade would require a separate approved design and is not silently introduced here. |
| Storage IDs could be referenced by more than one record. | Deleting a shared file could break another business. | Verify the B7 ownership invariant; deduplicate IDs within the cascade and do not delete IDs referenced by another surviving record if sharing is possible. |
| `BusinessCard` is public-projection-only and used on public results/landing. | An admin variant can broaden props and regress public rendering or leak admin data. | Use a discriminated admin density/projection; keep public densities unchanged, keep the query admin-only, and test both existing public consumers. |
| B3 is an explicit blocker. | Work may duplicate or conflict with incomplete B3 state-machine/audit semantics. | Start implementation only after B3 is complete/merged; reuse its mutation and tests, do not bypass `resolveTransition`, `requireSuperAdmin`, or `approveSelected`. |
| Numeric load/SLO is unknown. | Absolute latency/availability guarantees cannot be claimed. | Treat as v1 MVP; use 25-row pages and bounded reads, collect Convex read metrics, and document measured results rather than inventing targets. |

## Architecture validation

- **10× load:** Current fixture size and production data volume are not specified. At 10× the seeded sample, cursor pages cap result payloads at 25; filters still scan candidates, so low-selectivity searches are the first likely bottleneck. Check Convex row/byte read limits; add indexes/denormalization only from measured evidence.
- **Single points of failure:** Convex is the data/auth/audit boundary; Clerk is identity and the one-time owner lookup dependency. Fail closed on either authorization or lookup errors. Normal directory browsing does not depend on Clerk Backend API after the owner name projection is loaded.
- **Consistency vs availability:** Prefer one transaction for status + notification + audit and one guarded transaction for delete; if any required write fails, do not show success. Bulk approval stays all-or-none.
- **Maintainability:** UI state stays in the directory route; business state/authorization stays in Convex; email resolution stays in a narrow authenticated Convex action plus an internal mutation; shared public card behavior stays explicitly separated from admin density.
- **New developer:** Follow `app/admin/layout.tsx` → `AdminShell` → directory/audit route → guarded Convex query/mutation → `authz.ts` and business moderation helpers. The task list names each slice and evidence.
- **Trade-off summary:** Bounded pagination and transactional audit improve reliability and safety at the cost of extra query logic and writes. Avoiding a persisted admin search/email field reduces data duplication/PII exposure but costs read amplification. Reusing Clerk and Convex avoids new vendors/cost, but keeps their availability in the path.

## Open questions / assumptions

No blocking product questions remain after requester clarification of B6a tabs, existing-owner email behavior, delete cascade, and directory page/bulk scope.

- **Assumed:** An eligible existing owner email must match exactly and be verified; the owner must already have a synchronized `users` row. If not, creation fails safely; there is no invite or automatic user upsert. Configure the Clerk Backend secret in Convex without exposing it to the client.
- **Assumed:** Storage IDs referenced by a business are business-owned; implementation must check for references from surviving records before deleting if the B7 implementation permits sharing.
- **Assumed:** Directory pages return up to 25 matches; a final page or bounded scan can be shorter and still expose a continuation cursor when more candidates remain.
- **Assumed:** No numeric SLO or production-volume target was supplied; validate against 10× the current seeded dataset and record actual query reads.

## Next steps

1. Review this plan and `tasks/issue-15-todo.md` before implementation.
2. Confirm B3 is complete and the current branch contains the expected `createDraft`, moderation, and `approveSelected` contracts.
3. Implement backend contracts first; review projections, state transitions, transaction safety, and the owner email action before wiring UI.
4. Build the Command Deck and presentational UI, then integrate one vertical slice at a time with tests, lint, build, Convex checks, and Reticle evidence.
5. Re-run B1 404 and B4 Trending regressions before calling B6a complete.
