# Implementation Plan — Issue #77: Order protocol T6 — Owner supply toggles + audit

**Implements:** https://github.com/Calel33/dircteshop/issues/77
**Epic / source of truth:** `docs/order-commitment-protocol.md` §6.2.8 (audit contract) + §6.5 (INV-17/18/22, error precedence); `screens/SPEC.md` §7.1 item 6.
**Back-references:** `tasks/issue-77-context.md` (verified anchors — do not re-research); `tasks/issue-77-research.md` (targeted research — **resolved, adopted here**); T2 (#76) already landed: all schema fields exist at HEAD.
**Plan mode:** read-only planning; this file assigns files, approach, order, risks. No code was written.
**Revision note (Amendment 1):** revised in place after targeted research resolved open questions Q1–Q7 and V1–V4. See AMENDMENTS at the bottom and RISKS for the single still-blocked item (Q5).

---

## Feature Description

Owners currently can *have* supply state (`businesses.acceptingOrders`, `acceptingOrdersUntil`, `acceptingOrdersNote`, `menuGroups.isAvailable`, `menuItems.isAvailable` — all enforced in `placeOrder`) but cannot *change* it through server mutations, and nothing records when they do. This ticket adds **two** owner-scoped mutations plus one audited extension of an existing mutation:

- `setAcceptingOrders` — business pause/resume switch (patches `acceptingOrders`, `acceptingOrdersUntil`, `acceptingOrdersNote`; one-tap resume force-clears `until` + note)
- `setGroupAvailability` — menu-group (`isAvailable`, "absent means available")
- item availability audit — **inside the existing `updateItem` mutation** (no new item toggle mutation; §6.2.8 names only two new functions, and `screens/SPEC.md:146` says per-item `isAvailable` is unchanged)

Each patch writes one `auditLogs` row per actual state change, in the same transaction.

## User Story

As a business owner
I want to pause/resume ordering and hide groups/items from ordering
So that customers can only order what I can actually fulfil, and every supply change is auditable.

## Problem Statement

The consume side of the supply protocol is complete (`placeOrder` guards, effective-open predicate, `GROUP_UNAVAILABLE`/`ITEM_UNAVAILABLE`), but the produce side is missing: no mutation writes `isAvailable` on groups, `updateItem` writes `isAvailable` with no audit row (violates INV-22 — and its validator already accepts the field at `convex/menus.ts:61`), and there is no `setAcceptingOrders` at all (`convex/businesses/mutations.ts` exports only the six listing-flow mutations).

## Solution Statement

Mirror the two proven precedents: `moderateListing`'s patch+audit-in-one-transaction shape (`convex/businesses/mutations.ts:350-362`) and `setFeatured`'s no-op short-circuit (`resolveFeaturedChange`, `convex/businesses/adminPolicy.ts:19-32`) adapted for supply. Auth via `requireBusinessOwnerUser` (owner guard + `actorUserId` from `user._id`). A shared pure audit helper keeps the row shape identical across all three toggles. Hours wiring stays out (that is the placeOrder ticket); UI stays out.

## Out of Scope / Non-Goals

- Not included: hours-gate wiring in `placeOrder` (already guarded via `effectiveOpenReason`; any *new* hours work belongs to the placeOrder ticket). Any UI (`app/`, `components/`) — no reads/links/wires of these mutations into screens.
- **Not included: a new `setItemAvailability` mutation.** Research (Q3) confirmed the spec describes exactly two new functions; item availability is toggled through the existing `updateItem`, which gets an audit branch instead.
- Not included: any change to `effectiveOpenReason`/`isEffectiveOpen` (T2's surface) or the `until_passed` predicate — including the Q5 conflict; see RISKS.
- Not included: projections of `acceptingOrdersNote` into `getPublic`/`PublicBusiness`, or a Super-Admin-facing audit query (read side already exists).
- Not changing: `orderEvents` usage (supply toggles never write order events), `placeOrder`, `transitionOrderStatus`, schema/migrations, `updateGroup`.
- Not included: reason-length policy for order transitions (unchanged); we only add a local **200-char** optional note validation (`validateSupplyNote`) — a documented free choice, see Testing Strategy (D6).

## Architecture Decisions

1. **File placement — follow the spec exactly.**
   - `setAcceptingOrders` → `convex/businesses/mutations.ts` (business-scoped mutations and audit precedent live there).
   - `setGroupAvailability` → `convex/menus.ts` (spec §6.2.8/§1571 places it there; `groupInBusiness` helper already scoped correctly). Item audit → also `convex/menus.ts`, inside the existing `updateItem` (V2: it is the live UI path — every editor save sends `isAvailable` via `buildItemPatch`, `menu-panel-helpers.ts:438` — so it cannot be narrowed without a UI change, which is out of scope).
2. **New pure helper file `convex/supplyAudit.ts`** with:
   - `buildSupplyAuditLog({ actorUserId, action, targetType, targetId, targetName, reason })` — mirrors `buildFeaturedAuditLog`'s object-literal shape; **`targetName` is REQUIRED** for all three target types (Q7: mandatory, not stylistic — `resolveLiveBusinessName` returns null for non-business targets, `backfillAuditTargetNames` only rescues `business` rows, and cascade hard-delete removes `menuGroups`/`menuItems`, so a missing snapshot is permanent data loss of legibility); **leaves `fromStatus`/`toStatus` unset** (they are typed as listing statuses).
   - `resolveSupplyChange(previous, next)` → `{ changed: boolean }` no-op guard — a record/tuple comparison (V3), not a literal `resolveFeaturedChange` clone. Normalizing rules: `?? true` for menu booleans ("absent means available"), `?? undefined` for `until`/`note`, trim the note first (blank ⇒ `undefined`, mirroring `validatedDescription`, `convex/menus.ts:97-107`). Menu toggles call it with a single-member record; `setAcceptingOrders` calls it with the full tuple (Decision 6).
   - `validateSupplyNote(reason?)` — trim, optional, ≤**200** chars (D6: no normative limit exists; 200 fits the audit `reason` precedent at `convex/orderCommitPolicy.ts:1125` vs the 500 customer-visible order-note at `convex/orders.ts:50`; 200 chosen for a banner+reason field, documented here, pinned 200/201 in a test).
   Pure ⇒ unit-testable without Convex runtime; one source of truth for the three row shapes.
3. **Item availability: NO new mutation — audit branch inside `updateItem` (Q3, D1).** §6.2.8 requires the *row*, not a third function ("`setAcceptingOrders`, `setGroupAvailability`, and the existing item availability mutation write an `auditLogs` row", `docs/order-commitment-protocol.md:1110`). `updateItem` writes one row only when `isAvailable` is present in the patch **AND differs from the persisted value** (`args.patch.isAvailable !== undefined && args.patch.isAvailable !== item.isAvailable`). The persisted-value comparison is **mandatory, not optional**: `buildItemPatch` always emits `isAvailable`, so without it every name/price edit would manufacture a spurious `orders.itemAvailability.toggled` row — exactly the failure mode `setFeatured` guards against (`adminMutations.ts:29-31`). Adjacent, comment-only: `createItem` accepting `isAvailable` (`?? true`, `menus.ts:538`) is initial state, not a toggle — no row; `deleteItem`/`deleteGroup` remove availability with no row (pre-existing gap, no §6.2.8 action exists — see Notes).
4. **`setGroupAvailability` is standalone, NOT an `updateGroup` argument** — `updateGroup` stays name/description-only; the toggle has its own audit obligation and a cleaner contract as its own function.
5. **Menu writability guard reused — and explicitly NOT extended to the business pause (Q2 resolved).** `assertMenuWritable` (`convex/menus.ts:80-84`) applies to `setGroupAvailability`, matching every existing menu mutation. `setAcceptingOrders` has **no status guard at all**: pause is a server-owned supply state, not owner-editable listing content (`EDITABLE_FIELD_CLASS` excludes it, `businessTypes.ts:101-114`), and `placeOrder` already rejects unapproved listings first (`status !== 'approved'` → `BUSINESS_UNAVAILABLE`, `orders.ts:666-669`, pinned test at `orders.test.ts:1061-1063`), so a paused-but-unapproved business cannot become orderable. Precedent: `setFeatured` — "Any status is pinnable" (`adminMutations.ts:31-32`).
6. **`setAcceptingOrders` contract (Q1/Q4/Q6 resolved):** args `{ businessId, accepting: boolean, until?: number|null, note?: string|null }` — one mutation, nullable clears; no separate resume mutation (repo convention: `imageStorageId` optional-null clear, `menus.ts:65`). Idempotency key = the **full normalized tuple** `(accepting, until, note)` — any member change patches and writes exactly one row; an identical tuple is a no-op with no row. `until`/`note` must audit on their own (V4): the note is customer-visible supply state (`screens/SPEC.md:146`) and is the row's `reason` (`order-commitment-protocol.md:1116`). On `accepting: true`, `until` AND `note` are **force-cleared** (`undefined` in the patch) whatever the args say — the issue body mandates it verbatim; do not throw on a supplied stale note (a retried one-tap resume must stay idempotent).
7. **Return shape:** mirror `setFeatured` — return nothing on both the no-op and write path; tests assert rows through `t.run`, not through a `{ changed }` return (D5; the return value has no caller).
8. **Transaction shape:** each mutation = owner guard → validate → `ctx.db.patch` → `ctx.db.insert('auditLogs', row)` inside the same Convex mutation (single-transaction precedent, `moderateListing` / `approveSelected`).
9. **No schema changes.** All fields exist (`schema.ts:73-76`, `:124`, `:149`, `:360-378`). No index additions (audit reads already indexed).
10. **Convex unset semantics (V1 — resolves plan GOTCHA 1):** there is no `unset` API. Clearing an optional field = **include it as `undefined` in `ctx.db.patch`**; fields not specified are left unchanged; fields set to `undefined` are removed. In-repo precedent: `convex/menus.ts:439-444` ("patch with `undefined` removes it"). **Never use `db.replace`** — it rewrites the whole document and would need every field re-supplied. Types work as-is: `strict` with no `exactOptionalPropertyTypes` (`tsconfig.json:7`), and `PatchValue` maps a key to `T[P] | undefined` exactly where the schema field is optional (`database.d.ts:382-386`, Convex 1.46.0) — `acceptingOrdersUntil`/`acceptingOrdersNote` qualify.

## Feature Metadata

- **Type:** New capability (backend-only). **Complexity:** Low–Medium (2 small mutations + 1 `updateItem` audit branch + 1 helper + tests; highest-risk piece is the `updateItem` persisted-value comparison — get it wrong and every save spams audit rows).
- **Systems:** Convex `businesses` mutations, `menus` mutations, `auditLogs`, handler tests. No schema, no `app/`, no `components/`.
- **Depends on (#76, landed):** schema fields, `placeOrder` guards, `effectiveOpenReason`, `auditLogs` table/indexes.

## Related Work

- Builds on #76/T2 artifacts at HEAD (schema, `placeOrder` enforcement).
- Interfaces with the placeOrder ticket (#T9-ish): it owns hours wiring; this ticket must not touch `effectiveOpenReason` call sites.
- **Spawned follow-up (file before or with implementation):** the §6.4-vs-§6.5 `acceptingOrdersUntil` contradiction — see RISKS item R1. Raise it against T2/#76 or parent epic #8.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

Context pack `tasks/issue-77-context.md` §2 lists exact anchors; the load-bearing ones:

- `convex/schema.ts:73-76,124,149,360-378` — toggle fields + `auditLogs` shape/indexes. Why: row contract.
- `convex/businesses/mutations.ts:339-362` (`moderateListing`) and `:439-475` (`approveSelected`) — patch+audit-in-one-transaction precedent.
- `convex/businesses/adminMutations.ts:34-64` (`setFeatured`) + `convex/businesses/adminPolicy.ts:19-32,41-67` — no-op guard + audit builder shape. **Mirror these.**
- `convex/authz.ts:56-88` — `requireBusinessOwner` / `requireBusinessOwnerUser`.
- `convex/menus.ts:61` (`updateItemPatchValidator` `isAvailable`), `:65` (optional-null clear convention), `:80-84` (`assertMenuWritable`), `:97-107` (`validatedDescription` blank-collapse precedent), `:231-253` (`groupInBusiness`/`itemInBusiness`), `:255-287` (`validatedItemFields`, isAvailable copied at L271-273), `:353-360` (public group projection, `?? true`), `:423-448` (`updateGroup` + clear-with-undefined precedent at `:439-444`), `:538` (`createItem` initial state), `:546-577` (`updateItem` — the audit branch lands here).
- `convex/orderCommitPolicy.ts:992-1004, 1037-1060, 1125-1145` — landed predicate (do not touch), `until_passed`, reason-length precedent.
- `convex/orders.ts:666-685` (`placeOrder` guard order — unapproved rejection precedes supply gates), `:477-507` (`loadBasketCatalog` gates), `:267-365` (`transitionOrderStatus` — INV-17, reads no supply state).
- `convex/orders.test.ts:63-165` (`seed`), `:681-687` (`configureBasket`), `:752-770` (`expectOrderError`), `:1003-1067` (existing pause/until/hours guard test, `:1038-1040` until-closed pin, `:1061-1063` unapproved-first pin), `:1275-1290` (existing `GROUP_UNAVAILABLE` test), `:1575-1587` (`ownerTransition`).
- `convex/businesses/mutations.test.ts:91-123` — owner-vs-other-vs-admin authz test pattern to mirror.
- `convex/categories.test.ts:74-76,114` — audit-row assertion via `t.run(ctx.db.query('auditLogs').collect())` (tests may `collect()`; production code must not).
- `app/owner/business/[id]/menu-panel-helpers.ts:435-441` + `menu-panel.tsx:225` + `menu-panel-item-editor.tsx:353-354` — **why `updateItem` must keep accepting `isAvailable` and why the persisted-value comparison is mandatory** (`buildItemPatch` always emits the field).
- `node_modules/convex/dist/cjs-types/server/database.d.ts:200-217, 226, 382-386` — patch-removes-undefined semantics, Convex 1.46.0 (verified by research V1).
- `convex/_generated/ai/guidelines.md` — Convex API rules (project requirement; read first).

### New Files to Create

- `convex/supplyAudit.ts` — pure audit helpers (decision 2).
- `convex/menus.test.ts` — group toggle + `updateItem` audit handler tests (no menu test file exists).
- `convex/businesses/supply.test.ts` — `setAcceptingOrders` handler tests (or extend `convex/businesses/mutations.test.ts` if the implementer prefers one file — either is acceptable, pick one and stay consistent).

### Relevant Documentation

- `docs/order-commitment-protocol.md:1108-1118` (§6.2.8 audit contract — names exactly two new mutations + item audit), `:1234-1278` (§6.5 INV-17/18/22), `:1287-1290` (error copy), `:1489` (§6.4 pause/resume wording — **conflicts with the landed predicate; see RISKS**), `:1571-1572` (file plan).
- `screens/SPEC.md:146` (§7.1 item 6).
- Convex Writing Data docs — "Fields set to `undefined` are removed" (patch): <https://docs.convex.dev/database/writing-data>.

### Patterns to Follow

- **Naming:** `set<X>` for toggles; audit actions `orders.acceptingOrders.toggled` / `orders.groupAvailability.toggled` / `orders.itemAvailability.toggled`; targetTypes `business` / `menuGroup` / `menuItem` (spec-quoted — do not invent alternatives).
- **Error handling:** throw `Unauthorized`/`Forbidden` via authz helpers; invalid business/behavior via existing `ConvexError` envelopes only where an existing code exists (`ORDERING_CLOSED` etc. belong to order handlers, not these mutations).
- **No-op guard → early return** (`setFeatured` shape), returning nothing.

---

## IMPLEMENTATION PLAN

Phases top-to-bottom. Task 1 is the foundation (shared helper + hardest authz case); Tasks 2–3 are parallelizable menu slices; Task 4 is the end-to-end acceptance gate.

### Phase 1: Foundation + business pause (Task 1)

`convex/` accepts codegen'd imports only after `npx convex dev` regenerates `convex/_generated/` — run codegen before tests reference new mutations.

### Phase 2: Menu supply toggles (Tasks 2–3)

### Phase 3: Acceptance wiring + validation (Task 4)

---

## STEP-BY-STEP TASKS

### Task 1: `convex/supplyAudit.ts` + `setAcceptingOrders` + owner authz/idempotency tests

- **CREATE** `convex/supplyAudit.ts`: `buildSupplyAuditLog` (**required `targetName`**; `fromStatus`/`toStatus` unset), `resolveSupplyChange` (normalized tuple/record comparison per decision 2), `validateSupplyNote` (trim, optional, ≤200 — comment cites the D6 choice). Comment each with spec §6.2.8/§6.5 and issue #77.
- **UPDATE** `convex/businesses/mutations.ts`: ADD `setAcceptingOrders(args: { businessId, accepting: boolean, until?: number|null, note?: string|null })`:
  - `requireBusinessOwnerUser` → validate note (≤200, trim, blank ⇒ absent) → **no `until`-past validation** (R1: accept any finite number; see Testing Strategy) → `resolveSupplyChange` on the normalized (accepting, until, note) tuple → early return (no output) on no-op → else one `ctx.db.patch` → insert one audit row (`orders.acceptingOrders.toggled`, targetType `business`, `targetName` = `business.name`, `reason` = the **persisted** note) in the same transaction.
  - **PATCH SEMANTICS (research-resolved, replaces old GOTCHA 1):** clear `until`/`note` by including them as `undefined` in `ctx.db.patch` (fields set to `undefined` are removed; never `replace`). Precedent `menus.ts:439-444`; types verified for Convex 1.46.0.
  - **RESUME (research-resolved, replaces old GOTCHA 2, Q6):** `accepting: true` force-clears `acceptingOrdersUntil` and `acceptingOrdersNote` to `undefined` in the same patch, regardless of args; do not throw on a supplied stale note. Pin with a test.
  - **No status guard by design (Q2):** allowed on draft/pendingReview businesses; `placeOrder` still rejects those with `BUSINESS_UNAVAILABLE` (pin this).
  - **PATTERN:** `moderateListing` (`mutations.ts:339-362`) + `setFeatured` (`adminMutations.ts:34-64`).
  - **VALIDATE:** `pnpm exec vitest run convex/businesses/supply.test.ts`
- **CREATE** `convex/businesses/supply.test.ts` (or extend `mutations.test.ts`): mirrors `mutations.test.ts:91-123` — owner succeeds; other owner `Forbidden` (second business from `orders.test.ts:63-165` seed); unauthenticated `Unauthorized`; no-op repeat writes no second audit row; real change writes exactly one row with correct action/targetType/targetId/**targetName**/actorUserId/reason and unset `fromStatus`/`toStatus`; note-only edit while paused writes a row (V4); `until`-only edit writes a row; resume force-clears `until`+note (Q6); pause on pendingReview business succeeds AND `placeOrder` still rejects that business (Q2); note 200 ok / 201 rejected.
- **SATISFIES:** AC audit-row + auth-guard + idempotent-repeat criteria for the business switch.

### Checkpoint 1 (after Task 1)

- [ ] `pnpm exec vitest run convex/businesses/supply.test.ts` green
- [ ] `npx tsc --noEmit` clean — helper compiles, patch-with-undefined types verified
- [ ] Review the audit row shape against spec §6.2.8 before building the menu slices on it
- [ ] Follow-up issue for R1 filed (or explicitly scheduled with the parent epic)

### Task 2: `setGroupAvailability` in `convex/menus.ts` + `convex/menus.test.ts`

- **UPDATE** `convex/menus.ts`: ADD `setGroupAvailability({ businessId, groupId, isAvailable: boolean })`:
  - `requireBusinessOwnerUser` (audit needs `actorUserId` from `user._id`) → `assertMenuWritable` → `groupInBusiness` → no-op guard on normalized `group.isAvailable ?? true` → `ctx.db.patch({ isAvailable })` (write `isAvailable: true` explicitly rather than unset — simpler and the projection already defaults) → audit row `orders.groupAvailability.toggled`, targetType `menuGroup`, `targetName` = group name snapshot (**required**, read from the doc already loaded — no extra query).
  - `updateGroup` (`:423-448`) is NOT extended.
- **CREATE** `convex/menus.test.ts` (seed pattern from `orders.test.ts:63-165`; audit assertion from `categories.test.ts:114`): owner toggles group hidden → public read (`:353-360`) reflects it; no-op repeat → no second row; other owner/unauthenticated rejected; pending-review business rejected via `assertMenuWritable`; `targetName` snapshot asserted; row survives a business hard delete with `targetName` intact (Q7).
- **VALIDATE:** `pnpm exec vitest run convex/menus.test.ts`
- **SATISFIES:** AC group availability + audit criteria.

### Task 3: `updateItem` availability audit branch (no new mutation — Q3 resolved)

- **UPDATE** `convex/menus.ts` `updateItem` (`:546-577`): keep the existing patch flow untouched. ADD: if `args.patch.isAvailable !== undefined && args.patch.isAvailable !== item.isAvailable` → after the patch, insert one audit row in the same transaction (`orders.itemAvailability.toggled`, targetType `menuItem`, `targetName` = item name, `reason` = validated/absent; no note arg exists on this path). The persisted-value comparison is mandatory — `buildItemPatch` always sends `isAvailable`, so a name edit must not manufacture a row.
- **DO NOT** add `setItemAvailability`; **DO NOT** narrow `updateItemPatchValidator` (the owner's availability Switch writes through it).
- **CREATE/EXTEND** `convex/menus.test.ts`: edit an item with `isAvailable: false` (changed) → exactly one `orders.itemAvailability.toggled` row; re-save with the same value → no row; save with no `isAvailable` key (e.g. reorder path, `updateItemMutation({ ordering })`) → no row; item name edit alone → no row; toggled-off item is `ITEM_UNAVAILABLE`-ready at `placeOrder` (formally asserted in Task 4.
- **VALIDATE:** `pnpm exec vitest run convex/menus.test.ts convex/businesses/supply.test.ts`
- **SATISFIES:** AC item availability + audit criteria (INV-22 via the existing mutation, per §6.2.8).

### Checkpoint 2 (after Tasks 2–3)

- [ ] `pnpm exec vitest run convex/menus.test.ts convex/businesses/supply.test.ts` green
- [ ] `npm run lint` + `npx tsc --noEmit` clean
- [ ] Every toggle writes ≤1 audit row per real change, 0 on no-op — asserted in tests

### Task 4: Acceptance wiring — order protocol side effects (tests only)

- **UPDATE** `convex/orders.test.ts` (or the new supply test): drive the real mutations (not a raw patch — the existing `:1003-1067`/:1275-1290 tests patch directly; this complements them):
  1. Owner pauses business via `setAcceptingOrders` → `placeOrder` rejects with `ORDERING_CLOSED` (envelope shape via `expectOrderError`, `:752-770`).
  2. Owner resumes via the same mutation → `placeOrder` succeeds; `acceptingOrdersUntil`/`Note` read as `undefined`.
  3. Owner hides group via `setGroupAvailability` → `placeOrder` rejects with `GROUP_UNAVAILABLE`.
  4. Owner toggles item off via `updateItem` (`isAvailable: false`) → rejects with `ITEM_UNAVAILABLE`.
  5. INV-17: with pending order + paused business, `ownerTransition` (`:1575-1587`) still succeeds — pending orders remain workable.
  - **Excluded by design (R1):** no test asserts "past `until` → effectively open" or "past `until` → closed" through the new mutation. Expired-`until` *consume-side* behaviour stays covered by T2's existing pins (`orders.test.ts:1038-1040`, `scripts/order-commit-policy.test.ts:1704-1716`).
- **VALIDATE:** `npm test` (runs `verify-state-machine` + node --test + full vitest), then `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- **SATISFIES:** AC "direct placeOrder rejection" + "pending orders remain workable" end-to-end.

### Checkpoint: Complete

- [ ] Full `npm test`, lint, tsc, build pass
- [ ] All three audit actions appear in `auditLogs` with spec-exact action/targetType values
- [ ] No `app/`/`components/` diff in the change set
- [ ] Documentation comment citing §6.2.8/§6.5/#77 present on each new export
- [ ] R1 follow-up issue linked in the ticket

---

## TESTING STRATEGY

- **Unit (pure):** optional quick `node --test` coverage for `resolveSupplyChange`/`validateSupplyNote` in `scripts/` is a stretch goal, not required — handler tests already pin behaviour.
- **Handler tests (convex-test, edge-runtime):** authz matrix (owner / other owner / admin-not-owner / anon), idempotent no-op → no audit row, real change → exactly one row, authz-safe audit reads via `t.run` + `collect()`.
- **Edge cases:** note at 200/201 chars; `until` — **accept any finite number** (including a past one; the mutation is a *setter*, not a scheduler; R1 governs expired-`until` semantics and is deliberately not asserted here). Toggling on a business whose listing is draft/pendingReview: pause succeeds (decision 5, Q2) — pin both the row and that `placeOrder` still rejects. `updateItem` saving `isAvailable` equal to the persisted value → no audit row. Resume with stale `until`/`note` args supplied → they are force-cleared, no second resume needed (Q1/Q6 idempotency).
- **convex-test pitfall (V1):** convex-test's `patch` merges the value in, so a cleared key can survive as an own property with value `undefined`. Assert clearing with `expect(doc.field).toBeUndefined()` or `toEqual` — **not** `toStrictEqual`, `Object.keys(...)`, or the `in` operator.
- **Note-length rationale (D6):** no normative limit exists (candidates: 200 for audit `reason` at `orderCommitPolicy.ts:1125`, 500 for the customer-visible order note at `orders.ts:50`). 200 is chosen for this banner+reason field; documented here so the choice is reviewable, pinned at 200/201.
- **Order-protocol integration:** Task 4 list above.

## VALIDATION COMMANDS

1. `npx convex dev` — codegen (needed before tests call new mutations; never hand-edit `_generated`).
2. `pnpm exec vitest run convex/businesses/supply.test.ts convex/menus.test.ts convex/orders.test.ts`
3. `npm run lint` · `npx tsc --noEmit` · `npm run build`
4. `npm test` — full gate.

## ACCEPTANCE CRITERIA (from issue, made testable)

- [ ] `setAcceptingOrders` active → direct `placeOrder` rejected (`ORDERING_CLOSED`) via the real mutation, not a raw patch (Task 4.1)
- [ ] One-tap resume (accepting: true) clears pause + `until` + note in the same transaction (Task 4.2)
- [ ] Pending orders remain workable while paused (Task 4.5, INV-17)
- [ ] Each real toggle writes one correct `auditLogs` row (with mandatory `targetName` snapshot); identical repeat writes none
- [ ] Group toggle feeds `GROUP_UNAVAILABLE` at commit (Task 4.3); item toggle through `updateItem` feeds `ITEM_UNAVAILABLE` (Task 4.4)
- [ ] Non-owner calls are rejected for all three paths (Unauthorized / Forbidden)
- [ ] Every toggle is enforced in the handler (INV-18) — no client-trusted state
- [ ] No UI changes; no hours-gate changes; no schema changes
- [ ] Known non-backend gap acknowledged (D8): the new audit actions render as raw strings and are absent from the admin audit filter dropdown until a UI ticket adds labels (`audit-types.ts:17`, `audit-route.tsx:75`, fallback `audit-table.tsx:59`)

---

## RISKS

- **R1 (BLOCKER — open product decision; do not fix inside #77): `acceptingOrdersUntil` semantics.** The issue AC and `docs/order-commitment-protocol.md:1489` (§6.4) say a *passed* `until` is "effectively open" (auto-resume), while the landed T2 predicate (`orderCommitPolicy.ts:997,1047`) and §6.5's error table (`:1287`) treat a passed `until` as **closed** (`until_passed` → `ORDERING_CLOSED`), pinned by two test files (`orders.test.ts:1038-1040`, `scripts/order-commit-policy.test.ts:1704-1716`). This is a genuine repo-vs-issue contradiction, all four artifacts current at HEAD.
  - **Mitigation adopted in this plan:** (a) `setAcceptingOrders` does **not** reject past `until` (rejecting would lock in the closed-forever reading at the mutation boundary and make the AC's own bullet unwritable); (b) the T2 predicate is **not** touched; (c) #77 writes **no** test asserting past-`until`-open through the real mutation; (d) a **follow-up issue** is raised against T2/#76 or epic #8 naming both doc lines and both test files; (e) if a guard is ever added, the boundary is `until < now` — `until === now` is already closed per the existing test, so `<=` would wrongly reject an already-closed value.
- **R2 (medium):** `updateItem` audit branch depends on the persisted-value comparison; a miss means every editor save writes a spurious audit row. Mitigation: Task 3 tests pin the unchanged-value and reorder (no-key) cases explicitly.
- **R3 (low):** Tasks 2–3 share one new test file — if parallelized, coordinate the seed fixture first.
- **R4 (low):** convex-test's patch-merge quirk can make cleared fields appear as keys with `undefined` values in assertions (V1). Mitigation: use `toBeUndefined()`/`toEqual` only (Testing Strategy).
- **R5 (low):** `targetName` depends on the call site passing the already-loaded doc's `name`; no extra query required because guards/helpers load the document (`groupInBusiness`/`itemInBusiness`, `requireBusinessOwnerUser`). Mitigation: required input type + one snapshot test per target type + hard-delete survival test (Q7).

## RESOLVED RESEARCH OUTCOMES (was: OPEN QUESTIONS)

All plan open questions are now resolved and adopted above; nothing below is open coding guidance, it is recorded for traceability:

1. **Q1 — one mutation, nullable clears** (adopted: Decision 6). No separate resume mutation; repo nullable-clear convention exists (`menus.ts:65`).
2. **Q2 — pause allowed on non-approved listings; no status guard** (adopted: Decision 5). `placeOrder` rejects unapproved first (`orders.ts:666-669`); `setFeatured` precedent for status-agnostic flags; `acceptingOrders*` is not in `EDITABLE_FIELD_CLASS` (server-owned, not moderation content).
3. **Q3 — item path: NO `setItemAvailability`; audit inside `updateItem` only** (adopted: Decision 3 / Task 3 rewrite). Spec names exactly two new mutations (`order-commitment-protocol.md:1110,1572`); `screens/SPEC.md:146` says per-item `isAvailable` unchanged; `updateItem` is the live UI path sending the field on every save.
4. **Q4 — full normalized tuple idempotency** (adopted: Decision 6 + Decision 2 normalization). Note-only and until-only changes audit (V4); identical tuples are silent no-ops.
5. **Q5 — until validation: BLOCKED, folded into R1.** Do not reject any finite `until`; do not touch the predicate; no past-`until` test in #77; raise the follow-up.
6. **Q6 — resume force-clears `until` + note** (adopted: Decision 6 / Task 1). Issue body mandates it verbatim.
7. **Q7 — `targetName` always snapshotted** (adopted: Decision 2, required input). Non-business targets have no read-side fallback and are never backfilled; cascade deletes the targets.
8. **V1 — Convex unset:** `ctx.db.patch` with `undefined` removes optional fields; no `unset` API; never `replace` (adopted: Decision 10 / Task 1).

## NOTES

- The context pack's §7 numbers differ slightly from the acceptance list (this plan resolves #6 by design — handler tests assert rows via `t.run`, never the Super-Admin query surface).
- **Accepted pre-existing gaps (D7, no action in #77, one comment each where adjacent):** `createItem` accepts `isAvailable` (`?? true`, `menus.ts:538`) — initial state, not a toggle, so no audit row (a row there would also break "first write is the creation"); `deleteItem`/`deleteGroup` remove availability with no audit row — no §6.2.8 action exists for deletion; outside this ticket.
- **Audit UI note (D8):** the three new actions will render as raw strings (`orders.acceptingOrders.toggled` etc.) and stay out of the admin audit filter dropdown until a UI ticket adds labels. Not a backend gap; do not overstate "audit is visible".
- Alternatives rejected: a dedicated `setItemAvailability` mutation (spec does not describe a third function; would duplicate the toggle the UI already drives through `updateItem`); restricting `isAvailable` out of `updateItem` (breaks the owner's availability Switch without a UI change — out of scope); extending `updateGroup` with `isAvailable` (dilutes a narrow contract, complicates audit); a generic "setSupply" mutation (loses per-target type safety).
- Sequencing risk: Tasks 2–3 share one new test file — if parallelized, coordinate the seed fixture first (also R3).
- Confidence: **9/10** one-pass success; residual risk concentrated in R1 (externalized to a follow-up) and the `updateItem` comparison (R2, heavily pinned).

## AMENDMENTS

- **Amendment 1 (research revision, in place):** Adopted all resolved findings from `tasks/issue-77-research.md`: Q1/Q4/Q6 (one mutation, nullable until/note, tuple idempotency, resume force-clear), Q2 (no status guard on pause), Q3 (dropped `setItemAvailability`; audit inside `updateItem` with mandatory persisted-value comparison), Q7 (`targetName` required), V1 (patch-with-undefined unset semantics replaces GOTCHA 1; never `replace`), V3 (normalized record comparison in `resolveSupplyChange`), D5 (mutations return nothing), D6 (note limit 200, documented), D7/D8 (pre-existing gap + audit-UI notes added). Q5 folded into RISKS (R1) as an explicit blocker with mitigation and a mandated follow-up issue; until-rejection and the past-until test removed from Tasks 1/4 and the Testing Strategy. No other plan content changed beyond what evidence required.
