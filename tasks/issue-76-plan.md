# Implementation Plan: Issue #76 — Order protocol T2, schema expand + legacy backfill (expand step)

**Branch:** `fix/issue-76-order-protocol-t2-schema-expand-legacy-backfill-expand-step`
**Normative source:** `docs/order-commitment-protocol.md` §6.2 (data model) + §6.2.9 steps 1–2, 4 (expand + backfill). Field/table/index names are copied verbatim from the protocol — do not rename.
**Product record:** `screens/SPEC.md` §7.1. Prior art (not a spec): `screens/wayfinder/build/B12-order-basket.md`.
**Blocked-by status:** #73 (S0 suite, `convex/orders.test.ts`) and #74 (build/test env) are already in ancestry.

## Feature Description

The "expand" half of expand/contract: an **additive-only** Convex schema change plus an **idempotent legacy backfill**. Six new side tables, optional `orders` fields, a widened 8-state `status` union, and kill-switch fields land with **zero behavior change**. Then every existing order gets an `orderAccess` row (high-entropy token + per-business 6-char reference) and a snapshot-shaped single-line `items[]` with `pricingSource: 'legacyUnknown'` — **no prices fabricated, no `orderExpiry` rows**.

## User Story

As the implementation orchestrator for the order protocol,
I want the expanded schema and a completed, verified backfill in place,
so that T3+ slices (placeOrder, token receipt, expiry sweep, owner controls) can build on settled data without a destructive migration ever being needed.

## Problem Statement

The protocol's later slices require tables and fields that do not exist (`convex/schema.ts:183-203` is the B8 single-item model). Deploying behavior changes before the data model would force a riskier combined migration. The expand step must land first, provably breaking nothing: legacy `submitOrder` (`convex/orders.ts:71-128`), `getOrderStatus` (`orders.ts:211-221`), and the owner board keep working, and history is preserved honestly (the R11 price-rewrite bug must not be reintroduced by the backfill).

## Solution Statement

1. **Schema expand** — copy §6.2.2 verbatim into `convex/schema.ts`: new side tables `orderAccess`, `orderIdempotency`, `orderExpiry`, `orderEvents`, `orderThrottle`, `orderBlocks` with exactly the named indexes; optional `orders` fields (`items[]`, `subtotal`, `pricingSource`, `statusReason`, `statusUpdatedAt`, `expiresAt`, `customerUserId`); `status` widened to the 8-literal union; `menuItemId`/`selections` made optional; `businesses.orderProtocol/acceptingOrders/acceptingOrdersUntil/acceptingOrdersNote`; `menuGroups.isAvailable`; new `orders.byBusinessIdStatus` index. Every new field optional ⇒ legacy rows remain valid and legacy writes keep working.
2. **Type-compat, no behavior change** — widening `status` ripples into `nextOrderStatus` (4-state policy). Add a narrowing type guard in `convex/orderPolicy.ts`; `transitionOrderStatus` keeps the 4-state machine for all reachable data (nothing writes the 4 new states until T3). `listOrders` needs the only projection edit: optional `menuItemId` + the `items[]`-or-legacy fallback.
3. **Backfill** — `convex/migrations/backfillOrderAccess.ts` (internal only): count-gate query, dry-run mode, and a batched (~50) cursor-checkpointed internal mutation that inserts `orderAccess` (CSPRNG token via `crypto.getRandomValues`, 6-char reference from the §6.2.4 alphabet, unique per business with the §6.2.6 retry rule) and patches a one-line `items[]` with `unitPrice`/`lineTotal`/`subtotal` left **undefined** and `pricingSource: 'legacyUnknown'`. Never touches `status`, never sets `expiresAt`, never inserts `orderExpiry`.
4. **Proof** — extend `convex/orders.test.ts`: dual-shape board projection, backfill idempotency, count equality, no-fabricated-price, no-expiry-row, removed-item name fallback, terminal `completed` stays terminal.

## Out of Scope / Non-Goals

- Not included: `placeOrder`, `getOrderByToken`, `cancelOrder`, extended `transitionOrderStatus` actions (`decline`/`cancel`/`noShow`), expiry sweep, `setAcceptingOrders`, `setGroupAvailability`, board filter params, `/order/[token]` UI — all T3+ / S2–S3.
- Not changing: `submitOrder` behavior (still writes legacy fields only), `getOrderStatus` (status+createdAt only), `orderPolicy.ts` transition matrix (still 4-state), the 27 pure policy tests, the S0 10 handler tests' assertions.
- Not writing: any value into `businesses.orderProtocol` (stays undefined = `legacy`), any `orderExpiry` row, any price into backfilled lines.
- No destructive step: nothing dropped, nothing renamed (rollback = additive schema remains).

## Feature Metadata

**Feature Type**: Enhancement (infrastructure slice) · **Estimated Complexity**: Medium
**Primary Systems Affected**: `convex/schema.ts`, `convex/orderPolicy.ts`, `convex/orders.ts`, new `convex/orderAccess.ts`, new `convex/migrations/backfillOrderAccess.ts`, `convex/orders.test.ts`
**Dependencies**: none new (convex, convex-test, vitest already present)

## Related Work

**Implements**: GitHub #76 (T2) · **Epic**: #8 (B8 restaurant vertical)
**Back-references**: #73 (S0 suite — the safety net this must keep green), #74 (env), `tasks/issue-74-research.md`, `tasks/issue-73-context.md`
**Forward-references**: T3 (placeOrder/token/expiry per protocol S1 remainder), S2–S4.

## CONTEXT REFERENCES — read before implementing

- `docs/order-commitment-protocol.md` §6.2.2 (L907–1036) — the exact table/field/index shapes to copy. §6.2.4 (L1046) — constants incl. `TOKEN_BYTES=32`, `REFERENCE_LENGTH=6`, alphabet. §6.2.6 (L1089) — token/reference rules. §6.2.9 (L1113–1137) — migration steps, in-flight orders, rollback.
- `convex/schema.ts` L183–203 (`orders`), L40–71 (`businesses`), L112–119 (`menuGroups`) — edit points.
- `convex/orderPolicy.ts` L12–37 — 4-state machine to preserve; add the guard here (pure module, no runtime imports).
- `convex/orders.ts` L138–172 (`listOrders` — needs fallback edit), L179–200 (`transitionOrderStatus` — guard only), L71–128 (`submitOrder` — untouched).
- `convex/orders.test.ts` L28–140 (`seed`, `validArgs`) — reuse for new tests; S0 = exactly 10 tests.
- `convex/AGENTS.md` — internal mutations for migrations, `_generated` never hand-edited, token-link convention.
- `convex/_generated/ai/guidelines.md` — read first if present (`npx convex ai-files install` otherwise).

## IMPLEMENTATION PLAN

### Phase 1 — Schema expand + type-compat (Task 1)

Everything type-level so the tree is green with zero behavior change. **Checkpoint 1 after this phase: S0 = 10/10, tsc clean.**

### Phase 2 — Backfill + access helpers (Tasks 2–3)

Internal migration module + its tests; dual-shape board tests. **Checkpoint 2: backfill tests green, rerun changes nothing.**

### Phase 3 — Dry run, record, full validation (Task 4)

Recorded dry run, counts, rollback note; full gates (test/lint/tsc/build).

---

## STEP-BY-STEP TASKS

### Task 1 — UPDATE `convex/schema.ts` + UPDATE `convex/orderPolicy.ts` + UPDATE `convex/orders.ts` (type-compat only)

- **IMPLEMENT** (schema.ts): copy §6.2.2 verbatim —
  - `orders`: add optional `items` (`v.optional(v.array(v.object({ menuItemId: v.id('menuItems'), name: v.string(), unitPrice: v.optional(v.number()), quantity: v.number(), selections: v.array(v.object({ optionName: v.string(), choiceName: v.string(), priceAdjustment: v.optional(v.number()) })) , lineTotal: v.optional(v.number()) })))`), `subtotal`, `pricingSource` (`v.optional(v.union(v.literal('snapshot'), v.literal('legacyUnknown')))`), `statusReason`, `statusUpdatedAt`, `expiresAt`, `customerUserId`; widen `status` to the 8-literal union (`new|accepted|ready|completed|declined|cancelled|expired|no_show`); make `menuItemId` and `selections` optional; add `.index('byBusinessIdStatus', ['businessId', 'status'])`.
  - New tables with EXACT names/indexes: `orderAccess{orderId, businessId, accessToken, reference, createdAt}` (`byAccessToken`, `byOrderId`, `byBusinessIdReference`); `orderIdempotency{businessId, key, argsHash, orderId, createdAt}` (`byBusinessIdKey`, `byCreatedAt`); `orderExpiry{orderId, businessId, expiresAt}` (`byExpiresAt`, `byOrderId`); `orderEvents{orderId, businessId, actorType, actorUserId?, action(8-literal), fromStatus?, toStatus, reason?, createdAt}` (`byOrderIdCreatedAt`); `orderThrottle{key, windowStart, count}` (`byKey`); `orderBlocks{businessId, contactHash, reason?, createdByUserId, createdAt}` (`byBusinessIdContactHash`).
  - `businesses`: optional `orderProtocol` (`v.optional(v.union(v.literal('legacy'), v.literal('basket')))`), `acceptingOrders`, `acceptingOrdersUntil`, `acceptingOrdersNote`. `menuGroups`: optional `isAvailable`.
- **IMPLEMENT** (orderPolicy.ts): add `export const ORDER_DB_STATUSES` (the 8-literal tuple) + `export function isLegacyOrderStatus(status): status is OrderStatus` narrowing guard. Do NOT touch `ORDER_STATUSES`, `ORDER_STATUS_TRANSITIONS`, `nextOrderStatus`.
- **IMPLEMENT** (orders.ts): `transitionOrderStatus` — guard `isLegacyOrderStatus(order.status)` first (a non-legacy status cannot exist yet; if seen, reject `Invalid status transition`); `listOrders` — handle optional `menuItemId`, project from `items[]` when present (`itemName = items[0]?.name ?? 'Unavailable item'`, `itemPrice = null` when `pricingSource === 'legacyUnknown'` or the line is unpriced — never the live price for a backfilled row), fall back to the existing live-join only for legacy-only rows (S0 asserts `itemPrice === 1200` there). `submitOrder`/`getOrderStatus`: **no changes**.
- **PATTERN**: optional-field + widened-union additive pattern already used by `menuItems.nutrition` (`schema.ts:146–153`); index-comment style `schema.ts:74–88`.
- **GOTCHA**: regen `_generated` via one `npx convex dev` run before tsc/vitest type checks. `node --test scripts/order-policy.test.ts` must stay green — it pins the 4-state machine.
- **VALIDATE**: `npx tsc --noEmit && pnpm exec vitest run convex/orders.test.ts && node --test scripts/order-policy.test.ts`
- **SATISFIES**: AC1 (schema deployed, all optional, 10/10 S0), AC5 partially (fallback exists).

### Task 2 — CREATE `convex/orderAccess.ts` + CREATE `convex/migrations/backfillOrderAccess.ts`

- **IMPLEMENT** (orderAccess.ts): pure-ish helpers — `createAccessToken()` (32 random bytes → base64url, `crypto.getRandomValues`), `createReference(existing: ReadonlySet<string>)` (6 chars from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, collision retry ≤5 then 7 chars), `insertOrderAccess(ctx, {orderId, businessId})` (internal), `hasOrderAccess(ctx, orderId)`.
- **IMPLEMENT** (backfillOrderAccess.ts): `backfillStatus` (internal query: `{ordersCount, orderAccessCount}` — the count gate); `backfillBatch` (internal mutation, args `{cursor?: string, dryRun?: boolean, limit?: 50}`): paginate `orders` asc from cursor, skip orders with an existing `orderAccess` (`byOrderId`), derive `items[]` = one line (`menuItemId` if present, live `name` or `'(item removed)'`, quantity 1, legacy `selections` as-is, `unitPrice`/`lineTotal` undefined), set `pricingSource: 'legacyUnknown'`, leave `subtotal` undefined; **never** set `expiresAt`, **never** insert `orderExpiry`, **never** patch `status`; dry run counts would-change rows without writing; returns `{processed, inserted, skipped, remaining, nextCursor}`.
- **PATTERN**: internalMutation + `npx convex run` driver per `convex/AGENTS.md` seeds convention; idempotent skip-by-lookup per B6a backfill style (`schema.ts:241–243` comment).
- **GOTCHA**: token/reference generation must run inside the mutation (batch atomicity); if the Convex mutation runtime lacks `crypto.getRandomValues`, fall back to minting tokens in a `node`-side caller — verify on the first batch. Reference uniqueness check uses `byBusinessIdReference` within the same transaction.
- **VALIDATE**: `npx convex run migrations/backfillOrderAccess:backfillStatus` (dry) then vitest tests from Task 3.
- **SATISFIES**: AC2 (gate + idempotent), AC3 (no fabricated price), AC4 (no expiry rows).

### Task 3 — UPDATE `convex/orders.test.ts` — dual-shape + backfill matrix

- **IMPLEMENT**: (a) legacy-only shape: `submitOrder` order → board projects via legacy join (`itemName`, `itemPrice=1200`, selections), `getOrderStatus` unchanged; (b) `items[]` shape: backfilled/inserted order → board projects from `items[]`, `itemPrice=null`, `getOrderStatus` unchanged; (c) backfill: run batch twice → second run changes nothing, `ordersCount === orderAccessCount`, exactly one `orderAccess` per order; (d) backfilled `items[]` has `unitPrice`/`lineTotal`/`subtotal` undefined + `pricingSource='legacyUnknown'` even after the menu price changes (the R11 guard); (e) legacy `new` order has **no** `orderExpiry` row and no `expiresAt`; (f) legacy `completed` order rejects further transition (still terminal); (g) deleted item backfills to `'(item removed)'` with no price; (h) dry run reports counts and writes nothing.
- **PATTERN**: seed/`t.run`/`withIdentity` style of existing tests (`orders.test.ts:28–140`); extend `seed` locally in new tests rather than mutating S0 fixtures.
- **VALIDATE**: `pnpm exec vitest run convex/orders.test.ts`
- **SATISFIES**: AC2–AC6.

### Task 4 — Dry run + migration record + full validation

- **CREATE** `docs/migrations/order-protocol-t2-backfill.md`: dry-run output, before/after counts (`orders` == `orderAccess`), by-status counts, explicit rollback note (**rollback = additive schema remains; no fields/tables dropped; nothing to undo**), the §6.2.9 note that backfill re-runs at flag switch for in-flight orders.
- **IMPLEMENT**: run the real batch loop (`npx convex run ... :backfillBatch` until `remaining === 0`), re-run `backfillStatus` to prove equality.
- **VALIDATE**: `npm test && npm run lint && npx tsc --noEmit && npm run build`
- **SATISFIES**: AC2 (completion gate), AC7 (recorded dry run + rollback note).

## TESTING STRATEGY

- **Handler (vitest + convex-test)**: `convex/orders.test.ts` — existing 10 S0 tests untouched and green; new matrix above (dual shape, idempotency, price-honesty, expiry-absence, terminal, dry run).
- **Pure**: `scripts/order-policy.test.ts` must remain green unchanged (proves the 4-state machine survived).
- **Concurrency**: out of scope here (T3's idempotency races); the only write path added is the backfill, proven idempotent by rerun.

## VALIDATION COMMANDS

1. `npx convex dev` (one run — codegen for `_generated`)
2. `npx tsc --noEmit`
3. `pnpm exec vitest run convex/orders.test.ts` (10 S0 + new)
4. `node --test scripts/order-policy.test.ts`
5. `npm test` · 6. `npm run lint` · 7. `npm run build`
8. `npx convex run migrations/backfillOrderAccess:backfillStatus` (dry → after → equal)

## ACCEPTANCE CRITERIA → task map

| AC | Covered by |
|----|------------|
| 1 schema additive + optional + S0 10/10 | Task 1 + Checkpoint 1 |
| 2 idempotent rerun; counts equal | Tasks 2–4 |
| 3 receipt data shows "not recorded", no fabricated number | Tasks 2–3 (undefined unitPrice/lineTotal/subtotal, `legacyUnknown`) |
| 4 legacy `new` has no `orderExpiry` / `expiresAt` | Tasks 2–3 |
| 5 `completed` terminal; board `items[]`-or-legacy fallback | Tasks 1, 3 |
| 6 handler tests cover both shapes | Task 3 |
| 7 recorded dry run + rollback note | Task 4 |

## OPEN QUESTIONS / ASSUMPTIONS

- **Assumed** (resolved by analysis, flag for reviewer): the widened `status` union is handled at the type layer via `isLegacyOrderStatus`; the 4-state transition matrix and its 27 pure tests do not change in T2. If T3 instead wants the full matrix now, that is a deliberate policy change and belongs to T3's ticket.
- **Assumed**: "receipt data shows price not recorded" (AC3) is proven at the data layer (backfilled `items[]` unpriced + `pricingSource`), since T2 ships no receipt UI and `getOrderStatus` stays status-only.
- No user input needed; ticket + protocol doc settle the rest.

## NOTES (decisions + tradeoffs)

- **Side tables, not inline fields** (§6.2.3): privacy (token off the owner-readable `orders` row) + required-field indexes (a legacy order without an `orderExpiry` row is structurally un-expirable). Cost: multi-table writes later — accepted, protocol-mandated.
- **Type guard over matrix widening**: widening `ORDER_STATUS_TRANSITIONS` now would change policy behavior T3 owns and churn the 27 pinned tests. Guard costs ~10 lines and deletes cleanly in T3. Sacrifices: none at runtime (no new-state writers exist).
- **Batch ≈ 50 + cursor**: bounded transactions, resumable, rerunnable; cheap `byOrderId` skip makes reruns near-free. Sacrifice: more `npx convex run` invocations for large tables — fine at this scale (U6: production count unknown).
- **No backfilled prices — ever**: current menu price would fabricate history (R11). `undefined` + `legacyUnknown` is honest; UI copy ("Total at pickup") arrives in S3.
- **Backfill name uses live item name**: name is not a price; protocol §6.2.9 explicitly says "current `name` or `(item removed)`".

## AMENDMENTS

- (none yet)
