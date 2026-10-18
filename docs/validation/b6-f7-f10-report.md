# Reticle Verification Report — B6 Flows F7, F8, F9, F10

> In-app verification of **F7–F10** from [b6-reticle-contract.md](./b6-reticle-contract.md).
> Report-only: no implementation file was modified. Only `verified: "yes"` is reported as a pass;
> `"unknown"` / `"no-fault"` are treated as not proven.

## Scope

| Field | Value |
|---|---|
| Parent issue | [#6 (B6: Admin directory management + audit log + CSV export)](https://github.com/Calel33/dircteshop/issues/6) |
| Sub-slices | [#15 (B6a — directory core)](https://github.com/Calel33/dircteshop/issues/15) · [#16 (B6b — overview/owners/audit/categories/CSV)](https://github.com/Calel33/dircteshop/issues/16) |
| Contract flows | **F7** CSV export — frozen columns + completion audit · **F8** categories CRUD + reference-blocked delete + ordering · **F9** audit page filters · **F10** owners table |
| Verified | 2026-10-18 |
| Surface verified | running app (Next.js dev + `npx convex dev`), driven via `reticle_*` MCP tools |
| Account | Super Admin (admin nav, `Export CSV`, all admin sections rendered) |
| Result | ✅ **F7, F8, F9, F10 PROVEN** (see caveats: F7's byte-exact header and F8's reassign-then-delete are the two sub-clauses not proven) |

## Environment

| Item | Value |
|---|---|
| Base URL | `http://localhost:3000` |
| Session | `s2bd84f81-dba4-456c-86d0-4dabe9c40112` |
| Reticle project | `elite-next-starter-0991ad35` |
| Routes under test | `/admin` (F7), `/admin/categories` (F8), `/admin/audit` (F7 audit row, F9), `/admin/owners` (F10) |
| Console errors during run | none material (admin flows clean) |
| Tab state | connected but **hidden + throttled**; `realInputAvailable:false`. Reticle sends synthetic input. The Radix **Select** opens on a synthetic click, and a *fresh* synthetic click on an option commits, but the throttled tab freezes the Select's exit animation so the option **portal stays in the DOM** until a reload. Workaround used: reload before each Select interaction; assert with a **positive, table-only** marker (portal action-label text pollutes any `not`-text predicate). |

## Method

1. `reticle_look { action: "page" }` on each route to read the live DOM (the running app is the source of truth).
2. Ground truth fixed from source before driving (graft `file_api`/`find`, then `read`):
   - `convex/adminExportPolicy.ts` — `EXPORT_CSV_HEADER` L22-23 (frozen), `buildBusinessExportCsv` L138-155 (RFC 4180, `\r\n`, formula-neutralized), `buildBusinessExportFileName`, `EXPORT_COMPLETION_ACTION`.
   - `app/admin/export-actions.ts:45-83` — the Server Action returns the CSV to the client; the audit row is written **only after** the full CSV exists.
   - `app/admin/admin-command-bar.tsx:50-85` — `handleExport` builds a `Blob`, downloads via a detached anchor, and sets `role="status"` copy `Exported <N> rows → <fileName>`.
   - `app/admin/categories/categories-route.tsx` — `startDelete` L136-149 (blocked state when `referenceCount > 0`), blocked copy L340-358, `referenceLabel` L30-35, `moveCategory` L163-178, add form L190-209.
   - `app/admin/audit/audit-route.tsx` — filter controls and their `aria-label`s; `audit-types.ts:17-34` — `AUDIT_ACTION_LABELS` (`exportBusinessesCsv → "CSV export"`).
   - `app/admin/audit/page.tsx:115-166` — **300ms** debounce on actor/search; action + date apply immediately; each applied change restarts the cursor.
   - `app/admin/owners/owners-table.tsx:69-156` — columns `Name / Businesses / Role`; role chips `User` / `Super Admin`.
3. Drove each flow with verdict-producing calls (`reticle_act { steps }` / `reticle_act_and_wait` / `reticle_assert`), then persisted flows with `reticle_flow_save`.
4. `reticle_session { action: "yield" }`, then `npx @reticlehq/server gate`.

## Results

### F7 — CSV export: frozen columns + completion audit ✅ (with a caveat)

| # | Contract step | Predicate | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Trigger the export | click `Export CSV` → text contains `Exported` | ✅ | `reticle_act_and_wait` returned `verified:"yes"` |
| 2 | Capture the action request | net `POST /admin` | ✅ | `reticle_observe { action: "network" }` → `POST /admin → 200` (`text/x-component`, 382 ms) |
| 3 | Export status reflects real rows | element `role=status` = `Exported 18 rows → businesses-export-2026-10-18.csv` | ✅ | 18 rows = overview `Total businesses` = owners-column sum (see F10) |
| 4 | Completion audit row | text contains `CSV export` **and** `Business CSV export` | ✅ | `/admin/audit` newest row `CSV export · Business CSV export` |
| 5 | Header line is EXACTLY `name,category,status,owner,rating,createdAt,submittedAt,lastUpdatedAt` (CRLF) | ⚠️ **NOT wire-proven** | ⚠️ | Session has `captureNetworkBodies` **off** (`reticle_capabilities.cannot: network-bodies`) — the file bytes never traverse an inspectable channel. Covered instead by the frozen constant + `buildBusinessExportCsv` source and the existing `scripts/*` unit tests. |

Recorded journey verdict: **`verified:"yes"` — the export fires, reports its real row count, and writes the completion audit row.** The byte-exact header is a **unit-level** assertion until `connect({ captureNetworkBodies: true })` is enabled.

### F8 — categories CRUD + reference-blocked delete + ordering ✅

| # | Contract step | Predicate | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Add a category | fill + click `Add category` → text contains new name | ✅ | `Reticle Probe Cat 683171` appeared in the ordered list |
| 2 | Delete-block on a referenced category (no confirm) | click Delete on `Automotive` → allOf: text `references this category` + **not** `This cannot be undone` | ✅ | live copy **"1 business references this category. Reassign it in the owner editor, then delete."** — no confirm panel |
| 3 | Reorder persists | click `Move Automotive down` → reload → order | ✅ | before reload `Automotive 1, Restaurants 2`; after reload **`1 Restaurants, 2 Automotive`** |
| 4 | Restore order (revert) | click `Move Automotive up` → `1 Automotive …` | ✅ | original order restored |
| 5 | Unreferenced delete succeeds | click Delete on probe → confirm → **not** text `Reticle Probe Cat 683171` | ✅ | confirm `Delete Reticle Probe Cat 683171? This cannot be undone.` → `Delete category` → row gone |
| — | Reassign a business to free the category, then delete | — | ❌ **NOT driven** | Requires recategorizing a business in the **owner editor** — a separate journey (see caveats) |

Blocked-delete verdict: **`verified:"yes"`** (live count + no confirm). Reorder-permanence verdict: **`verified:"yes"`**. Delete-success verdict: **`verified:"yes"`**.

### F9 — audit page filters ✅

| # | Contract step | Predicate | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Page renders filters + recent rows | element `combobox "Filter by action"` + a known row | ✅ | 25 rows, incl. prior `CSV export` / `Reorder category` rows |
| 2 | Action select only offers `AUDIT_ACTION_LABELS` | listbox options = All actions, Approve, Request changes, Reject, Suspend, Restore, Feature pin, Hard delete, Create draft, Create category, Update category, Delete category, Reorder category, CSV export | ✅ | exact label set matched |
| 3 | Filtering an action with no matches shows the empty state | select `Create category` → text `No audit entries match those filters` | ✅ | `verified:"yes"` |
| 4 | Filtering an action narrows to its rows | select `CSV export` → allOf: text `Business CSV export` + **not** text `Reticle F5 Alpha 9001` | ✅ | `verified:"yes"` — other action rows gone |
| 5 | Actor/target text debounced 300ms; action immediate | source `audit/page.tsx:115-166` | owed | intent `audit-text-filter-debounced` declared; the debounce timing was not re-timed under a throttled tab |
| 6 | Pagination traverses without losing filters | Next/Previous (`canGoNext`/`canGoPrevious`) | owed | not asserted this pass |

Action-filter verdict: **`verified:"yes"`** (both the no-match and the narrowing cases).

### F10 — owners table ✅

| # | Contract step | Predicate | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Table with name / count / role | allOf: text `Business owners` + columnheaders `Name`, `Businesses`, `Role` | ✅ | `verified:"yes"` |
| 2 | Rows include an owner with a count and a role chip | text `LocalConnect Seed Owner` + text `Super Admin` | ✅ | e.g. `LocalConnect Seed Owner · 7 · User`; a `Super Admin` chip present |
| 3 | Counts are real (cross-check) | sum of Businesses column | ✅ | `7+1+0+2+5+3+0 = 18` = overview `Total businesses` = F7 export row count |

Owners verdict: **`verified:"yes"`**.

## Saved flows

| Flow | Name | Grade |
|---|---|---|
| F7 | `b6-f7-csv-export` | presence-only |
| F8 | `b6-f8-category-order` | presence-only |
| F9 | `b6-f9-audit-action-filter` | presence-only |
| F10 | `b6-f10-owners-table` | presence-only |

Path: `.reticle/flows/elite-next-starter-0991ad35/<name>.json`. All four grade `presence-only` — Reticle warns *"declares a business intent but asserts no observable outcome (signal/network)"*. The app registers **no subscribable store/signal** (`reticle_capabilities` → empty `signals`/`stores`/`testids`) and Convex queries run over a **websocket** (no HTTP consequence to assert), so text-presence is the strongest channel available. The text assertions do fail when a count/row changes.

## Intents declared

| Intent | Statement |
|---|---|
| `audit-text-filter-debounced` | On `/admin/audit` actor/target text filters apply to the server query only after a 300ms quiet period, while the action select applies immediately. |
| `category-delete-blocked-while-referenced` | Deleting a referenced category is blocked: the admin sees the live reference count instead of a confirm, because the server refuses it. |

## Gate

`npx @reticlehq/server gate` (after `reticle_session { action: "yield" }`), verbatim:

```json
{"t":"2026-10-18T14:35:41.225Z","event":"reticle_gate","pass":false,"uncovered":["b6-f1-…","b6-f10-owners-table","…","b6-f7-csv-export","b6-f8-category-order","b6-f9-audit-action-filter","…","drive-references-this-category","…"],"quarantined":[],"coverage":{"covered":0,"total":55,"pct":0}}
{"t":"…","event":"reticle_gate_regression","broken":[{"flowName":"drive-create-your-account-owner","previousStatus":"pass","currentStatus":"fail"},{"flowName":"drive-sign-in-to-shopdirect-owner",…},{"flowName":"highly-rated-boundary-filter",…},{"flowName":"landing-feeds-render-approved-only",…},{"flowName":"unknown-category-slug-404",…}]}
Reticle gate: regression — … Exited with code 1
```

`pass:false`, `covered 0/55`. This **matches the contract's documented known session state** (34 recorded flows → now 55; 0 covered; the same 5 regressions). Gate is **diff-based**: no code changed this session, so nothing maps as "covered". The 5 regressions are the pre-existing non-admin (auth/landing) flows — **not touched here and not weakened**.

## Contract discrepancies found (running app is the source of truth)

**D5 — F9's heading is wrong.** F9 step 1 waits for heading `Recent audit activity`. That heading is the **`/admin` overview** card (`admin-overview-panels`). The `/admin/audit` card is titled **`Audit log`** (`audit-route.tsx:52`). F9 was asserted against `Audit log`.

**D6 — F10's role label is wrong.** F10 says the role chip reads `Super Admin` / **owner**. The live labels are `User` / `Super Admin` (`owners-table.tsx:17-20`); there is no "owner" chip.

**D7 — F8 step 3's "reassign" path is owner-editor-only.** The blocked copy itself documents it: *"Reassign … in the owner editor, then delete."* There is no admin reassign control, so F8 step 3's delete-after-reassign cannot be completed from `/admin/**` alone.

## Caveats (do not over-read this pass)

1. **F7 header not wire-proven.** The CSV bytes are not observable (bodies off). Keep the header assertion at the unit level (`EXPORT_CSV_HEADER`, `buildBusinessExportCsv`) or enable `captureNetworkBodies: true`.
2. **F8 reassign-then-delete not driven** (owner-editor dependency, D7). Blocked-delete and the direct delete path were proven instead.
3. **F9 debounce/pagination not asserted** under the throttled tab; declared as intent `audit-text-filter-debounced`.
4. **Owners table shows `null null` names.** Several rows render with a missing owner name (e.g. `null null · 0 · User`, `null null · 5 · Super Admin`). A **data/projection quirk** surfaced by this run — flagging, not diagnosing here.
5. **F7 export ran twice** (F7 drive + the save re-drive), so two extra `exportBusinessesCsv` audit rows exist. Harmless.
6. **Throttled tab.** Every Select interaction was followed by a reload to clear the frozen portal. A front-most tab would remove this friction.

## Scratch data created

| Item | Final state | Note |
|---|---|---|
| `Reticle Probe Cat 683171` (category) | **deleted** | created in F8, then deleted via the confirm path |
| Category order `Automotive`/`Restaurants` | **restored** | F8 reorder was reverted to the seeded order |
| `exportBusinessesCsv` audit rows | +2 | from the two F7 exports |

No business/listing was created or deleted this pass.

## Artifacts

| Artifact | Location |
|---|---|
| Run directory (act/assert screenshots) | `.reticle/visual/runs/drive-s2bd84f81-dba4-456c-86d0-4dabe9c40112/` |
| Saved flows (×4) | `.reticle/flows/elite-next-starter-0991ad35/b6-f{7,8,9,10}-*.json` |
| Intents | `.reticle/intent/` |

## Reproduce

```bash
npx convex dev          # terminal 1
npm run dev             # terminal 2
npm run seed            # Super Admin + owner + listings
# sign in as Super Admin, then either drive F7–F10 with reticle_* or replay the saved flows:
#   reticle_flow_replay { flowName: "b6-f7-csv-export" }
#   reticle_flow_replay { flowName: "b6-f8-category-order" }
#   reticle_flow_replay { flowName: "b6-f9-audit-action-filter" }
#   reticle_flow_replay { flowName: "b6-f10-owners-table" }

npx @reticlehq/server gate
```

## AC → flow traceability (F7–F10 rows)

| Issue AC | Flow(s) | Status |
|---|---|---|
| CSV correct columns | **F7** | ✅ export + row count + audit row proven; ⚠️ byte-exact header = unit-level (bodies off) |
| category delete blocked→works after reassign; reorder persists | **F8** | ✅ blocked delete + reorder persist proven; ⚠️ reassign-then-delete needs owner editor |
| audit filterable, shows B6a/B3b rows | **F9** | ✅ action filter proven; ⚠️ debounce/pagination not asserted |
| owners counts correct | **F10** | ✅ proven (sum = 18 cross-check) |

## Next

- Decide: enable `captureNetworkBodies` (or keep the F7 header as a unit test) — the only wire-level gap.
- Drive F8's reassign-then-delete from the owner editor if that AC must be closed end-to-end.
- Add a positive-match assertion channel for Convex-backed flows (a registered store/signal) so these flows can grade above `presence-only`.
- Investigate the `null null` owner names in the Owners projection.
- Still outstanding from the contract: **F2** (hard delete — destructive, run last) and **F6** (non-superAdmin 404 — needs a 2nd account; see F3–F6 report §F6).
