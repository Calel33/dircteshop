# Task list — Issue #77: Order protocol T6 (owner supply toggles + audit)

**Plan:** `tasks/issue-77-plan.md` (Amendment 1 — research adopted) · **Context:** `tasks/issue-77-context.md` · **Research:** `tasks/issue-77-research.md`
Execute top to bottom. Run codegen (`npx convex dev`) before any test references a new mutation.

## Task 1: Foundation — `convex/supplyAudit.ts` + `setAcceptingOrders` + authz/idempotency tests

- [ ] CREATE `convex/supplyAudit.ts` — `buildSupplyAuditLog` (spec §6.2.8 row shape; **required `targetName`**; leave `fromStatus`/`toStatus` unset), `resolveSupplyChange` (normalized record/tuple no-op guard per V3/Q4), `validateSupplyNote` (trim, optional, ≤200 — documented choice, D6)
- [ ] UPDATE `convex/businesses/mutations.ts` — ADD `setAcceptingOrders({ businessId, accepting, until?: number|null, note?: string|null })`: `requireBusinessOwnerUser` → validate note → **tuple no-op guard** → patch → one `auditLogs` row, same transaction
  - Clear semantics (V1, replaces old GOTCHA): clear `until`/`note` by including them as `undefined` in `ctx.db.patch` — fields set to `undefined` are removed; **never `db.replace`**
  - Resume (Q6): `accepting: true` force-clears `acceptingOrdersUntil` + `acceptingOrdersNote` in the same patch, regardless of args; no throw on stale args
  - **No status guard** (Q2): allowed on draft/pendingReview businesses
- [ ] CREATE `convex/businesses/supply.test.ts` — owner / other-owner Forbidden / unauthenticated Unauthorized; repeat no-op → no second audit row; real change → exactly one row (action `orders.acceptingOrders.toggled`, targetType `business`, required `targetName`, `actorUserId`, `reason`=note); note-only edit writes a row (V4); until-only edit writes a row; resume force-clears both fields (Q6); pendingReview business pause succeeds AND `placeOrder` still rejects that business (Q2)
- [ ] Verify note 200 ok / 201 rejected. **`until`: accept ANY finite value — no past-future validation, no past-`until` test in this ticket (Q5 blocker → plan R1 / follow-up issue)**

**Acceptance:** `pnpm exec vitest run convex/businesses/supply.test.ts` green; `npx tsc --noEmit` clean; R1 follow-up issue filed or scheduled.

### ✓ Checkpoint 1 — helper + pause switch solid before menu slices

- [ ] Tests green, tsc clean, audit row shape vs spec §6.2.8 re-checked
- [ ] Follow-up issue for the §6.4-vs-predicate `until` conflict (plan R1 / Q5) filed or explicitly scheduled on epic #8

## Task 2: `setGroupAvailability`

- [ ] UPDATE `convex/menus.ts` — ADD `setGroupAvailability({ businessId, groupId, isAvailable })`: `requireBusinessOwnerUser` → `assertMenuWritable` → `groupInBusiness` → no-op guard vs normalized `isAvailable ?? true` → patch → audit row (`orders.groupAvailability.toggled`, targetType `menuGroup`, **required `targetName`**=group name from already-loaded doc)
- [ ] `updateGroup` left name/description-only
- [ ] CREATE `convex/menus.test.ts` — toggle reflects in public group projection (`menus.ts:353-360`); no-op repeat → no row; authz rejects; pendingReview business rejected; `targetName` snapshot asserted; row survives business hard delete with `targetName` intact (Q7)

**Acceptance:** `pnpm exec vitest run convex/menus.test.ts` green.

## Task 3: `updateItem` availability audit branch (NO new mutation — Q3 resolved)

- [ ] UPDATE `convex/menus.ts` `updateItem` — audit row ONLY when patch contains `isAvailable` AND it differs from the persisted value (comparison mandatory: `buildItemPatch` always sends the field; INV-22). Action `orders.itemAvailability.toggled`, targetType `menuItem`, required `targetName`=item name
- [ ] **Do NOT add `setItemAvailability`; do NOT narrow `updateItemPatchValidator`** (spec names two new mutations only; `screens/SPEC.md:146` unchanged; the owner's Switch writes through `updateItem`)
- [ ] Extend `convex/menus.test.ts` — changed `isAvailable` → exactly one row; same-value save → no row; save with no `isAvailable` key (reorder path) → no row; name-only edit → no row; toggled-off item is `ITEM_UNAVAILABLE`-ready

**Acceptance:** `pnpm exec vitest run convex/menus.test.ts convex/businesses/supply.test.ts` green; `npm run lint` + `npx tsc --noEmit` clean.

### ✓ Checkpoint 2

- [ ] ≤1 audit row per real change, 0 on no-op — asserted for all three paths
- [ ] Clearing assertions use `toBeUndefined()`/`toEqual`, not `toStrictEqual`/`Object.keys`/`in` (convex-test patch-merge quirk, V1)

## Task 4: Acceptance wiring (tests only, drive real mutations)

- [ ] UPDATE `convex/orders.test.ts` (or supply test):
  - [ ] pause via `setAcceptingOrders` → `placeOrder` rejects `ORDERING_CLOSED` (envelope via `expectOrderError`)
  - [ ] resume via same mutation → `placeOrder` succeeds; `until`/`note` read as `undefined` (`toBeUndefined`)
  - [ ] hide group via `setGroupAvailability` → `GROUP_UNAVAILABLE`
  - [ ] toggle item off via `updateItem` `{ isAvailable: false }` → `ITEM_UNAVAILABLE`
  - [ ] INV-17: pending order + paused business → `ownerTransition` still succeeds
  - [ ] **Excluded (Q5/R1): no test asserts past-`until`-open (or closed) through the new mutation; expired-`until` consume-side behaviour stays with T2's pins**
- [ ] Full gate: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`

### ✓ Checkpoint: Complete

- [ ] All issue ACs met (see plan ACCEPTANCE CRITERIA)
- [ ] No `app/`/`components/` diffs; no schema changes; spec-citing comments on new exports
- [ ] R1 follow-up issue linked in ticket #77
