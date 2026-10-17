# Issue #15 B6a Admin Directory — Research Findings

Date: 2026-10-16 · Scope: B6a Command Deck (Directory + read-only Audit), CSV deferred to B6b
Plan: `tasks/issue-15-plan.md` · Todo: `tasks/issue-15-todo.md` · Prototype: `screens/wayfinder/prototype/admin-workspace.html` (Variant B accepted)

## 1. Installed versions (from `package.json`, not guessed)

| Package | Installed range | Latest (npm, 2026-10-16) | Compat note |
|---|---|---|---|
| `convex` | `^1.31.2` | 1.47.0 | `paginationOptsValidator`, `.paginate()`, `paginationResultValidator` present in 1.31.x; `maximumRowsRead/maximumBytesRead` added later (~1.44.0 changelog) so **not** in installed 1.31.2 — bump `convex` or avoid those args until bumped (see §3). `v.*.optional()` shape change in 1.46.0 only matters if validators are shared across packages — not the case here. |
| `@clerk/backend` | `^3.18.1` | 3.24.0 | `users.getUserList({ emailAddress: [...] })` stable across 3.x. No breaking change to that signature. |
| `@clerk/nextjs` | `^7.9.4` | (7.x line) | `auth()` + `getToken({ template: 'convex' })` + `fetchQuery(api.users.isSuperAdmin)` in `app/admin/layout.tsx:1-30` matches current Clerk+Convex JWT-template pattern. |
| `next` | `16.3.5` | 16.4.2 | App Router `layout.tsx` + `notFound()` cosmetic gate is current. No 16.x breaking change affecting this plan. |
| `react` / `react-dom` | `^19.2.3` | — | React 19, no action. |
| `@tanstack/react-table` | `^8.21.3` | v8 latest / v9 in progress | Plan's table is a **separate row renderer**, not necessarily TanStack Table. If TanStack is used, use `manualFiltering/manualSorting/manualPagination: true` (see §4). Installed dep already satisfies this. |
| `@radix-ui/react-dialog` | `^1.1.15` | — | Present but **must not** be used for B6a confirms — plan mandates inline confirms, no Dialog. |
| `components/ui/sheet.tsx` (vaul `^1.1.2`) | reuse only | — | Mobile bottom-sheet inspector reuses Sheet; do not fork unless proven gap. |

No new package is permitted by plan §Constraints. All B6a needs are covered by the above.

## 2. Third-party APIs in scope (official docs)

### 2.1 Convex paginated queries
- Source: https://docs.convex.dev/database/pagination · API: https://docs.convex.dev/api/interfaces/server.PaginationOptions · source: `convex-js/src/server/pagination.ts`
- Contract: query takes `{ paginationOpts: paginationOptsValidator }` (`convex/server`), calls `.paginate(args.paginationOpts)` unchanged (do not reconstruct — optional `endCursor/id/maximumRowsRead/maximumBytesRead` would be lost), returns `{ page, isDone, continueCursor, splitCursor?, pageStatus? }`. Validate return with `paginationResultValidator(itemValidator)` (added 1.29.0, present in installed range).
- Client: `usePaginatedQuery(api.mod.list, {...args minus paginationOpts}, { initialNumItems: 25 })` → `{ results, status: LoadingFirstPage|CanLoadMore|LoadingMore|Exhausted, loadMore }`. B6a uses cursor history + 25-row pages; filter/search changes reset cursor/selection (matches TanStack manual-pagination reset rule, §4).
- Read budgets: `maximumRowsRead` / `maximumBytesRead` bound rows entering the pipeline **before** filters; over-budget pages return short with `splitCursor` + `pageStatus: SplitRecommended|SplitRequired`. **Not enforced for search queries** — relevant because B6a mixes status/category indexes with owner-name/location matching. Plan's "up to 25 matches, continuation/split explicit" matches this exactly.
- Gotcha (convex-helpers #864, still open discussion): `.filter()` + pagination yields sparse/empty pages because filtering happens post-index-scan; caller must `loadMore` until enough rows or `Exhausted`. B6a's low-selectivity owner/location scan has the same shape — mitigate with selective index first (`byStatusCategorySubmittedAt` / `byStatusSubmittedAt`), bounded `take`, `maximumRowsRead`, and explicit split/continuation handling as the plan already requires. Never load all businesses into the browser.

### 2.2 Convex actions + internal functions + auth in functions
- Actions: https://docs.convex.dev/functions/actions — run in Convex JS env (`fetch` available) or Node (`"use node"` only if SDK needs Node APIs). Clerk Backend SDK via `fetch` works in default env; use Node action only if the SDK requires Node APIs (plan already states this).
- Internal: https://docs.convex.dev/functions/internal-functions — `internalQuery/internalMutation/internalAction` are **not client-callable**; called via `ctx.runQuery/runMutation` (or scheduler/CLI/Dashboard). B6a owner-lookup shape is exactly the documented example: public `action` (auth check → Clerk `getUserList` → `ctx.runMutation(internal.biz.createDraftForOwner, …)`) + `internalMutation` that **re-verifies** Super Admin and resolves the Convex `users` row. No public mutation may accept an `ownerId`.
- Auth: https://docs.convex.dev/auth/functions-auth — `ctx.auth.getUserIdentity()` in query/mutation/**action**; `null` when unauthenticated. Repo `convex/authz.ts:27-47` wraps this correctly: fail-closed on no identity, no `users` row, `role !== 'superAdmin'`, or subject not in live `SUPER_ADMIN_CLERK_IDS` whitelist. Every new B6a query/mutation must call `requireSuperAdmin` (plan Task checkpoint); UI hiding is not authorization (`app/admin/layout.tsx` comment).

### 2.3 Clerk Backend `getUserList({ emailAddress })`
- Source: https://clerk.com/docs/reference/backend/user/get-user-list · SDK source `packages/backend/src/api/endpoints/UserApi.ts`
- Semantics: `emailAddress?: string[]` (≤100), exact-match filter; unknown addresses are **ignored** (not an error). `query?: string` is the partial-match variant — **do not use** for B6a assignment; plan requires exact email path only.
- Implementation consequence (plan Task 6): pass single-element array, then server-validate exactly one returned user, exact email equality (case handling explicit), usable + verified `emailAddressIdentificationStatus`, and an existing synchronized Convex `users` row (`byExternalId`). Fail safely on zero/multiple/unverified/unsynchronized; never invite/create; never persist email; secret stays a Convex server env var. Mutations cannot call third-party APIs, hence the action→internal-mutation split is mandatory, not stylistic.

### 2.4 Convex mutations/transactions + storage deletion
- Atomicity: https://docs.convex.dev/database/writing-data — **the whole mutation is one transaction**; looped `insert/patch/delete` commit together; throw rolls back. `ctx.meta.getTransactionMetrics()` + nested `transactionLimits` guard large cascades.
- Storage: https://docs.convex.dev/file-storage/delete-files — `ctx.storage.delete(storageId)` available in **mutations** (also actions/HTTP actions). Delete DB reference + storage object together; community note (masteringconvex.com/storage/manage-files): storage delete is not documented as part of the DB transaction, so delete storage IDs **last** within the mutation and after the audit insert to minimize inconsistency. Plan order (audit insert → children + files → parent delete, fail-without-partial-commit) is consistent with this.
- Audit-write-then-delete ordering preserves the audit row because `auditLogs` is excluded from the cascade (plan §Data design), matching prototype consequence text (`admin-workspace.html:507`).

### 2.5 Next.js App Router admin gate
- `app/admin/layout.tsx:12-30` is the cosmetic `notFound()` gate (no token → 404; `fetchQuery(api.users.isSuperAdmin)` false → 404). Real boundary is `requireSuperAdmin` in Convex.
- Official: `not-found.js` renders when `notFound()` is thrown in that segment; root `app/not-found.js` is the fallback; `global-not-found.js` (with `globalNotFound` flag) bypasses layouts. Do not rebuild the B1 `/admin(.*)` 404 boundary per plan. Keep `AdminShell` boundary, replace only its page-per-surface feel with the Command Deck command bar.

### 2.6 `BusinessCard` (first-party, no external API)
- `components/directory/business-card.tsx:24-28,196-202`: `BusinessCardProps = { business: PublicDirectoryResult; category?; density: 'row'|'mini' }`, consumers `business-results.tsx` + `landing-sections.tsx`.
- Plan: add **discriminated admin density/projection** (or isolated `admin-business-card.tsx` only if needed); keep `row`/`mini` output unchanged; never send admin-only fields through public queries. Public projection reference: `convex/businesses/publicProjections.ts:41-60` (`toPublicDirectoryCard`).

### 2.7 CSV export — deferred to B6b
- No research needed beyond noting deferral. Prototype `aud_09` CSV row and Categories/Overview/Owners panels are B6b placeholders; B6a Audit tab stays read-only with no export control.

## 3. Breaking changes / version-compat watchlist

- `convex` 1.29.0: `paginationResultValidator`, `v.nullable`, `pick/omit/extend/partial` added — safe to use on `^1.31.2`.
- `convex` ~1.44.0: `maximumRowsRead/maximumBytesRead` added to `PaginationOptions`. **Installed `^1.31.2` predates this** — verify `node_modules/convex/dist` exports before using; if absent, either bump `convex` (preferred, then re-run `npx convex dev` codegen) or implement the read bound with index selection + `take` and add the options at bump time. Do not silently pass unknown validator fields.
- `convex` 1.46.0: `.optional()` on all validators; cross-package validator sharing may need version alignment — not applicable (single package).
- Clerk 3.x `getUserList` signature stable; `@clerk/nextjs` 7.x `auth()` async pattern matches existing layout.
- Next 16.3.5 → 16.4.2: no action for `layout/notFound/fetchQuery` usage.
- Convex guideline (version.convex.dev/v1/guidelines): always pass `args.paginationOpts` through unchanged; cursors are single-query-scoped (a cursor from one query shape cannot be reused on another) — B6a's "search/filter change resets cursor" follows directly.

## 4. Common solutions / best practices (community + docs)

| Requirement | Recommended pattern |
|---|---|
| Grid + Table over same data | **One route-owned page result** (`DirectoryRoute` state) rendered by two presenters; view switch changes presentation only, preserves query/filter/cursor/selection/inspector. If TanStack Table is introduced, set `manualFiltering + manualSorting + manualPagination: true`, feed server-filtered `data`, pass `rowCount/pageCount`, and **reset page index in filter/sort change handlers** (TanStack client-side vs server-side guide; `autoResetPageIndex` defaults false under manual pagination). Never client-filter a server-paginated page (sorts/filters current page only — misleading). |
| Inline confirms (no modal) | Inspector-local confirm step: consequence text + required input + Confirm/Cancel + pending/error; no `Dialog`. Prototype `confirmForm` (`admin-workspace.html:504-517`) is the language reference; production uses `app/globals.css` tokens, not prototype CSS. |
| Reason guards | Request Changes / Reject / Suspend require nonblank reason (becomes `moderationReason` + owner notification); Approve / Restore do not. Validate server-side via `resolveTransition` + `moderationPolicy`; client disable is UX only. Record actual `fromStatus` (Suspend approved-only, Restore suspended-only). |
| Type-name hard delete | Double-gate: client disables until input `=== current name`; **server re-reads and exact-compares** before any write. Audit insert first, then children/storage, then parent, single mutation (all-or-nothing). Dedupe storage IDs; check surviving-record references if B7 sharing is possible. |
| Bulk approve | Approve-only, current-page eligible `pendingReview` IDs, 1–25 unique, exact count in confirm copy, one audit row **per listing** (cf. `convex-audit` component `logMany`, flyweightdev/convex-audit), all-or-none via existing `approveSelected`. No cross-page selection. |
| Audit rows | Narrow projection `{ when/actor/action/target/change/reason }`, newest-first cursor pagination, `action/actor/target-or-reason` filters (cf. `ericmil87/hnbcrm convex/auditLogs.ts` selective-index + over-read pattern, and `convex-audit-log` component `queryByActor/queryByResource/search`). B6a keeps the bespoke `auditLogs` table (no component dependency — plan forbids new deps). Deleted targets remain visible (store `targetId` string + name snapshot, never a dangling doc ref). |
| `isFeatured` pinning | Super Admin mutation writes `isFeatured + lastUpdatedAt + audit` atomically; no-op toggle writes no audit; B4 `byStatusFeaturedUpdatedAt` feed shows only approved + reorders by `lastUpdatedAt`. Unapproved featured rows stay publicly hidden. |
| Admin draft for existing owner | Public action (Clerk lookup) → internal mutation (Convex write) as in §2.2; exact/verified/synchronized checks; audited creation with B3a `createDraft` defaults. |

## 5. Related GitHub issues / PRs / components

- `get-convex/convex-helpers#864` — `filter` + pagination misses results / empty pages; maintainer guidance: selective index first, `loadMore` until filled/`Exhausted`, `maximumRowsRead/maximumBytesRead` exposure. Directly justifies plan's bounded-scan + split/continuation design.
- `flyweightdev/convex-audit` (component) — transactional `audit.log()/logMany()` inside the mutation, per-doc rows for bulk ops, paginated filtered `list()`. Pattern reference only; B6a implements directly (no new dep).
- `convex-audit-log` component (`convex.dev/components/convex-audit-log`) — `logBulk`, `queryByResource/queryByActor/search`, PII redaction, retention. Same status: reference, not a dependency.
- `ericmil87/hnbcrm convex/auditLogs.ts` — selective index per filter (`actor/entity/action/created`), JS post-filters with over-read factor, cursor from `(createdAt, _id)`, enriched actor join. Useful if B6a audit filters outgrow two indexes; start with plan's narrow indexes and add only on measured need.
- No open Convex/Clerk/Next.js blocking bug was found for `paginationOptsValidator`, `internalMutation`, `getUserList({emailAddress})`, or `ctx.storage.delete` at these versions.

## 6. Local source-of-truth map (read before implementation)

- `AGENTS.md` (stack, tracer-bullet, Reticle, Next.js 16 guide) · `convex/AGENTS.md` (ownership, `requireSuperAdmin`, `resolveTransition`, generated-file rule)
- `screens/SPEC.md §3-5, §8, §10, §14` · `screens/wayfinder/build/B6-admin-directory.md` · `screens/wayfinder/build/B3-owner-approval-loop.md` · `screens/wayfinder/build/B4-landing-search.md`
- `screens/wayfinder/prototype/admin-workspace.html` — Variant B Command Deck: rail + dataset + persistent inspector (§210-243), inline confirms with reason/name gates (§499-523), bulk bar/count (§493-498, §518-523), audit panel (§566-579), responsive rail→strip→chips / inspector→bottom-sheet (§235-243, media queries §273-292). **Composition/interaction only; do not copy CSS or in-memory mutations.**
- `convex/schema.ts:39-93` (`isFeatured`, `byStatusFeaturedUpdatedAt`, `searchText` index), `:95-203` children, `:205-216` audit, `:218-233` notifications (no `byBusinessId` yet — Task 5 adds it)
- `convex/authz.ts:27-47` (`requireSuperAdmin`) · `convex/businesses/helpers.ts` (`resolveTransition`) · `convex/businesses/mutations.ts:70-110` (`createDraft`), `:267-330` (moderation), `:348-412` (`approveSelected`)
- `convex/businesses/queries.ts:130-158` (`directoryBaseQuery` — public approved-only; not the admin projection) · `convex/businesses/directoryQuery.ts` (B4 pure helpers) · `convex/businesses/publicProjections.ts:41-60`
- `app/admin/layout.tsx:8-30` (keep) · `app/admin/admin-shell.tsx:1-14` (re-skin, keep boundary) · `app/admin/approvals/approvals-route.tsx:87-167,169-391` (auth query/mutation pattern reference; B6a confirm UX is inline)
- `components/directory/business-card.tsx:13-28,196-202` (+ `business-results.tsx`, `landing-sections.tsx` consumers)
- `design.md` + `app/globals.css` (production tokens) · `convex/_generated/ai/guidelines.md` — recheck at implementation time (absent at planning)

## 7. Risks carried forward (from plan, confirmed by research)

1. Sparse owner/location matches → short pages + read amplification (convex-helpers #864). Mitigation stands: cursor pagination, selective indexes, explicit budgets, measure at 10× seed.
2. `maximumRowsRead/maximumBytesRead` may not exist on installed `convex@^1.31.2` — gate usage on a version check/bump.
3. Clerk lookup availability + Clerk-secret config + not-yet-synchronized users → safe actionable errors; email stays transient/server-only.
4. Large hard-delete cascades vs transaction limits → fail with no partial commit; async cascade needs separate approved design.
5. Shared storage-ID deletion vs B7 sharing invariant → dedupe + surviving-reference check.
6. Shared `BusinessCard` regression → discriminated admin density, public snapshots unchanged.

## Sources

- Convex pagination, actions, internal functions, functions-auth, writing-data, storage deletion, validators changelog (docs.convex.dev, convex-js CHANGELOG, ship.convex.dev 1.46.0, news.convex.dev v25)
- Clerk `getUserList` reference + `UserApi.ts` source (clerk.com/docs, github.com/clerk/javascript)
- TanStack Table v8/vLatest client-vs-server, pagination, column-filtering, table-state guides (tanstack.com/table)
- Next `not-found` / route-groups conventions (nextjs.org/docs/app)
- Community: convex-helpers#864, flyweightdev/convex-audit, convex-audit-log component, hnbcrm auditLogs pattern
- Local: `package.json`, `convex/AGENTS.md`, `convex/schema.ts`, `convex/authz.ts`, `convex/businesses/queries.ts`, `convex/businesses/directoryQuery.ts`, `components/directory/business-card.tsx`, `app/admin/layout.tsx`, prototype `admin-workspace.html`, plan + todo files
