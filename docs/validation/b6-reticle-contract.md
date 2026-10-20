# B6 Validation Contract — Reticle (Issue #6 + #15 + #16)

Source of truth for driving this file: the **running app** (Next.js dev server + `npx convex dev`),
via the `reticle_*` MCP tools (`reticle_run { tool, args }`). Only `verified: "yes"` passes.
`"unknown"` / `"no-fault"` are NOT passes.

- Parent: [Issue #6](https://github.com/Calel33/dircteshop/issues/6) — B6: Admin directory management + audit log + CSV export
- Sub-slices: [#15 B6a (directory core — CLOSED)](https://github.com/Calel33/dircteshop/issues/15) · [#16 B6b (overview/owners/audit/categories/CSV — OPEN)](https://github.com/Calel33/dircteshop/issues/16)

## Ground truth used to build this contract (do not re-derive)

| Fact                                                                                                                                        | Source                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Listing action buttons: `Approve`, `Request changes`, `Reject`, `Suspend`, `Restore`, `Feature pin`, `Hard delete`                          | `ACTION_LABELS` — `app/admin/directory/directory-actions-policy.ts:L35-43`      |
| Listing statuses: `draft`, `pendingReview`, `changesRequested`, `approved`, `rejected`, `suspended`                                         | `convex/businesses/helpers.ts:L50-55`                                           |
| Hard delete enabled only when typed name === business name                                                                                  | `canConfirmDelete` — `directory-actions-policy.ts:L31-33`                       |
| Bulk bar = approve-only; confirm modal takes `count`                                                                                        | `DirectoryBulkConfirm` (`directory-bulk-confirm.tsx`), `directory-bulk-bar.tsx` |
| Overview cards: `Total businesses`, `Pending approval` (→ `/admin/approvals`), `Verified active`, `Submissions this month`; no revenue card | `app/admin/admin-overview-cards.tsx:L91-146`                                    |
| Audit page filters: `action`, `actor`, `search`, `from`, `through`; heading `Recent audit activity`                                         | `AuditRoute` props — `app/admin/audit/audit-route.tsx:L19-157`                  |
| CSV header is FROZEN: `name,category,status,owner,rating,createdAt,submittedAt,lastUpdatedAt`                                               | `EXPORT_CSV_HEADER` — `convex/adminExportPolicy.ts:L22-23`                      |
| Export writes audit row with action `exportBusinessesCsv`                                                                                   | `EXPORT_COMPLETION_ACTION` — `adminExportPolicy.ts:L32`                         |
| Non-superAdmin: `requireSuperAdmin` throws `Forbidden`; `/admin` layout renders 404                                                         | `convex/authz.ts:L27-47`, `app/admin/layout.tsx:L21-25`                         |
| No `data-testid` attributes exist in `app/admin/**` — target by `{ role, name }` / text only                                                | grep over `app/admin`, 0 matches                                                |
| Category rows carry live `referenceCount`; delete is blocked while referenced                                                               | `CategoryRow` — `categories-route.tsx:L17-24`                                   |

## Setup

1. `npx convex dev` (terminal 1) + `npm run dev` (terminal 2). Seed: `npm run seed`
   (creates Super Admin + owner + listings; seed fixtures in `convex/businesses/seedFixtures.ts`).
2. Browser signed in as the **Super Admin** account for all admin flows.
3. Two-account note: AC “non-superAdmin gets 404” needs a **second browser profile** signed in as a
   regular user, or sign-out/sign-in mid-flow (marked ⚠ below).
4. ⚠ **Destructive ordering**: flows `F2` (hard delete) and `F8b` (category delete) consume seeded
   data. Run read-only flows (`F3`–`F7`) first, destructive flows last. Every destructive step below
   uses a business/category created earlier in the same flow wherever possible (F2 creates its own).

## Flows

### F1 — `/admin` overview cards render live counts (#16)

**Intent:** overview counts come from real table data and Pending Approval navigates to the queue.

1. `reticle_navigate { url: "<base>/admin" }`
2. `reticle_assert { action: "wait", until: { allOf: [
  { kind: "text", contains: "Total businesses" },
  { kind: "text", contains: "Pending approval" },
  { kind: "text", contains: "Verified active" },
  { kind: "text", contains: "Submissions this month" } ] } }`
3. Negative: `reticle_assert { action: "now", until: { not: { kind: "text", contains: "Revenue" } } }`
4. Click card → `reticle_act_and_wait { target: { role: "link", name: "Pending approval" } (verify exact role via reticle_look {action:"find"} first), action: "click", until: { kind: "route", pathname: "/admin/approvals" } }`

### F2 — Hard delete: type-the-name gate + children + audit row (#15) ⚠ DESTRUCTIVE — RUN LAST

**Intent:** the one irreversible action is gated by typing the exact business name and its audit row lands.

1. Add Business first: navigate `/admin/directory` → open `Add Business` → create
   “Reticle Delete Probe <ms-timestamp>” with owner email → wait for it in the grid.
2. Open the listing → inspector → `reticle_act { steps: [
  { target: { role: "button", name: "Hard delete" }, action: "click", expect: { kind: "text", contains: "Confirm action: Hard delete" } },
  { target: { role: "textbox" } (the typed-name field), action: "fill", value: "WRONG NAME", expect: { kind: "element", query: { role: "button", name: "Hard delete" } } /* confirm stays disabled */ },
  { action: "fill", value: "<exact business name>", expect: { kind: "element", query: { role: "button", name: "Hard delete" } } /* now enabled */ },
  { target: { role: "button", name: "Hard delete" }, action: "click", expect: { kind: "not", ...: { kind: "text", contains: "Reticle Delete Probe" } } } ] }`
3. Persist + audit: navigate `/admin/audit`, filter action — the `delete` audit row naming the probe must appear.

### F3 — Directory grid/table parity + filters preserve state (#15)

**Intent:** both views render the same data; switching views keeps search/filter state.

1. Navigate `/admin/directory`; wait for the search box (`aria-label="Search businesses"`, exact-case).
2. Type a known business-name fragment; note row count.
3. Switch view (Grid ⇄ Table segment control — `SegButton`s in `DatasetToolbar`): count is unchanged.
4. Apply a status filter (`aria-label="Filter by status"`) + category filter (`aria-label="Filter by category"`); switch views again; search text + filter selections survive.

### F4 — Every action confirms + writes its audit row (#15)

For each available action on a suitable listing, the inspector opens the inline confirm first
(`Confirm action: <label>` per `getConsequenceCopy`). Drive on a **scratch** listing, and restore
state afterward where the action is reversible:

| Action          | Pre-state needed        | Expect after confirm                                                     | Revert via        |
| --------------- | ----------------------- | ------------------------------------------------------------------------ | ----------------- |
| Approve         | `pendingReview` listing | status chip → `approved`                                                 | —                 |
| Request changes | `pendingReview`         | status `changesRequested`                                                | owner resubmit    |
| Reject          | `pendingReview`         | status `rejected`                                                        | —                 |
| Suspend         | `approved`              | status `suspended`                                                       | `Restore`         |
| Restore         | `suspended`             | status `approved`                                                        | —                 |
| Feature pin     | `approved`              | pinned state persists after reload (`reticle_navigate { reload: true }`) | Feature pin again |

General step shape (one `reticle_act { steps: [...] }` per action):
`click <Action Label> → expect text "Confirm action: <Action Label>" → fill Reason → click confirm → expect new status text`.
Then `/admin/audit` shows the matching row (actions `approve`, `requestChanges`, `reject`,
`suspend`, `restore`, `feature` per `convex/businesses/adminPolicy.ts` / `adminDeletion.ts`).

### F5 — Bulk bar: approve-only with count confirm (#15)

1. On `/admin/directory`, select ≥2 pending rows (checkbox `aria-label="Select all pending listings on this page"` selects the page).
2. Bulk bar (`aria-label="Bulk actions"`) shows ONLY an approve affordance — assert no delete/reject in the bar.
3. Click approve → confirm modal states the count → confirm → both rows read `approved`.
4. Negative: `/admin/audit` shows one `approve` audit row per business (N rows for N selections).

### F6 — Authz regression: non-superAdmin gets 404 on `/admin(.*)` (#15/#16) ⚠ needs 2nd account

1. ⚠ Sign in as a regular (non-admin) user in a second profile/lease (`reticle_lease { action: "acquire" }` works for this).
2. Navigate `<base>/admin` → expect the app’s 404/not-found surface, never admin content (`Total businesses` etc. must be absent).
3. Spot-check `/admin/directory`, `/admin/audit`, `/admin/categories` → same 404.
4. Backend mirror (already unit-covered in `convex/*` tests): `requireSuperAdmin` throws `Forbidden` — UI contract here is only that no admin data renders.

### F7 — CSV export: frozen columns + completion audit (#16)

1. As Super Admin on `/admin`, trigger `AdminCommandBar` export (`handleExport` → server action `exportBusinessesCsv`).
2. Capture the download (`reticle_observe { action: "network" }` for the action request) and the file.
3. Assert header line is EXACTLY: `name,category,status,owner,rating,createdAt,submittedAt,lastUpdatedAt` (CRLF line endings; RFC 4180).
4. Assert one data row per business; spot-check a name/category/status against the directory.
5. `/admin/audit` shows a row with action `exportBusinessesCsv`, targetName `Business CSV export`.

### F8 — Categories CRUD + reference-blocked delete + ordering (#16)

1. `/admin/categories`: add a category “Reticle Probe Cat” → appears in the ordered list.
2. Delete-block: attempt delete on a category that has businesses → blocked state shows the live
   reference count (text like “reference this category”), NOT a confirm. (An intent for this is
   already owed in the live session — this flow discharges it.)
3. Reassign: move that category’s business to another category (owner editor or directory edit) →
   delete now succeeds.
4. Reorder: move a category up/down (`moveCategory`) → `reticle_navigate { reload: true }` → order persisted.

### F9 — Audit page filters (#16)

1. Navigate `/admin/audit`; wait for heading `Recent audit activity`.
2. Filter by action via the `AUDIT_ACTION_LABELS` select → only matching rows.
3. Actor/date filters (`from`, `through`) → server-applied; note the live-session rule: actor/target
   search applies after a 300ms quiet period (debounce), action applies immediately — an owed intent
   in the current session; assert final filtered state, not intermediate keystrokes.
4. Pagination: Next/Previous (`canGoNext`/`canGoPrevious`) traverses without losing filters.

### F10 — Owners table (#16)

1. `/admin/owners` → table lists users with name, businesses count, role chip (`Super Admin` / owner).
2. Cross-check: an owner owning N directory rows shows count N (compare against `/admin/directory` filtered by that owner).

### F11 — Admin sign-out

1. As Super Admin on `/admin`, open `Account menu` → click `Sign out`.
2. Expect the route to become `/` and the public landing to render.
3. Observe the Clerk sign-out request (`DELETE /v1/client/sessions`) in the network window.
4. Re-open `/admin` in a fresh tab/session → expect the app's 404/sign-in surface, never `Command Deck` or `Account menu`.

## Running the whole contract

- Per flow: drive with `reticle_act { steps }` (last expect = end state) or `reticle_act_and_wait`,
  then `reticle_flow_save { flowName }` so `npx @reticlehq/server gate` covers it.
- After all flows: `reticle_session { action: "yield" }`, then `npx @reticlehq/server gate`.
- Gate must show 0 uncovered for the B6 files it maps (`app/admin/**`, `components/directory/admin-business-card.tsx`).
- Known session state (2026-10-18): gate currently reports 34 recorded flows, 0 covered by recent
  changes, and 5 regressions in non-admin flows (auth/landing) — investigate separately; do not
  weaken those flows to green.

## AC → flow traceability

| Issue AC                                                       | Flow(s)                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| lint/build clean                                               | out of Reticle scope — `pnpm lint && pnpm build`                     |
| every action writes audit row                                  | F4, F5, F7                                                           |
| delete requires typed name, removes business + children        | F2                                                                   |
| bulk approve confirms with count; no other bulk actions        | F5                                                                   |
| isFeatured pins/unpins and persists                            | F4 (Feature pin row)                                                 |
| grid+table same data; view switch preserves search/filters     | F3                                                                   |
| non-superAdmin 404 on /admin(.\*)                              | F6                                                                   |
| overview counts real; Pending Approval navigates               | F1                                                                   |
| audit filterable, shows B6a/B3b rows                           | F9                                                                   |
| category delete blocked→works after reassign; reorder persists | F8                                                                   |
| CSV correct columns                                            | F7                                                                   |
| owners counts correct                                          | F10                                                                  |
| admin sign-out ends the Clerk session and locks /admin         | F11                                                                  |
| design tokens only                                             | out of Reticle scope — code review against `design.md`/`globals.css` |
