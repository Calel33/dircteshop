# Issue #84 — Targeted research (fix-github-issue-v4 research node)

Read-only. Answers the seven open questions in `tasks/issue-84-plan.md` §"OPEN QUESTIONS FOR TARGETED RESEARCH" plus the two library behaviors the plan depends on. It does **not** re-derive `tasks/issue-84-context.md` and does not change code.

**Task contract:** TYPE = targeted research · TARGET = OQ-1…OQ-7 + the Convex APIs D2/D4/D7/D8 rely on · GOAL = resolve or explicitly leave open each item with evidence · DONE-WHEN = this file exists with per-item verdicts, evidence, and an adoptable recommendation.

**Stack verified in this environment:** `convex` installed **1.46.0** (`node_modules/convex/package.json`; manifest declares `^1.31.2`), Next 16 / React 19, Node running the harness. All Convex statements below are checked against the installed `.d.ts` and the current docs, not memory.

---

## Verdict table

| OQ | Status | One-line answer | Plan impact |
|---|---|---|---|
| OQ-1 | **RESOLVED** | Index names never enter `_generated`; a plain index backfills synchronously at deploy and is usable immediately. Name `byBusinessIdCreatedAt` is already house-consistent (`orderBlocks`). Retention does **not** depend on it. | Keep D2 plain index. No codegen work beyond `npx convex dev`. |
| OQ-2 | **RESOLVED (with a correction)** | No cycle exists today, but the bigger problem is that an `internalMutation` counter **cannot** count a rejection at all — the throw rolls the write back. Use a leaf plain-helper module. | **Task 5 must be redesigned.** See §Critical finding. |
| OQ-3 | **RESOLVED** | Tests live in `scripts/admin-delete-policy.test.ts` (pure, node --test) + `convex/menus.test.ts:318-345` (handler). A `{code,message}` ConvexError renders fine. | Guard needs a pure predicate + one handler test; the existing table-list assertion stays green. |
| OQ-4 | **RESOLVED** | The resolution is **inline**, not extractable as-is (`orderError`/`projectOrderReceipt` are module-private). Re-implement 5 lines; return `{recorded}` rather than throw. | Small correction to Task 6 (return value instead of typed error). |
| OQ-5 | **RESOLVED — AVAILABLE** | Dev deployment `agile-husky-366` is live (`/version` 200) and the CLI is authenticated (`convex run` returned seeded rows). | Load test can run. Use the harness's own invocation, not `npx tsx`. |
| OQ-6 | **RESOLVED** | `AnalyticsPanel({ section })` only — no `businessId`, no query, no parent data. | Task 9 must thread `businessId` **and** wire `useQuery`. |
| OQ-7 | **RESOLVED** | `notifications` has **no `orderId` field**. Business-keyed, retained independently. | Do **not** add to the per-order retention set. |

---

## Critical finding (not in the plan's question list, but it blocks Task 5)

**D4/Task 5 as written cannot work.** The plan puts `bumpMetricCounter` "at the exact rejection moments" inside `placeOrder`, `orderThrottle` claim functions, and `assertContactNotBlocked`. Those paths all end in a **thrown `ConvexError`**, and a Convex mutation's writes are discarded when it throws.

Evidence:

1. Official docs, *Mutation functions → Transactions*: "All database writes get committed together. **If the mutation writes some data to the database, but later throws an error, no data is actually written to the database.**"
2. Installed API, `node_modules/convex/dist/cjs-types/server/registration.d.ts:102-114`: `MutationCtx.runMutation` "Call a mutation function **within the same transaction** … The mutation runs in a **sub-transaction**, so if it throws an error, all of its writes will be rolled back." So wrapping the bump in `ctx.runMutation(internal.orderMetrics.bump, …)` does **not** rescue it — the sub-transaction is part of the parent.
3. `ctx.scheduler.runAfter(0, …)` does not rescue it either: the same file (`:71-83`) documents it as "run immediately **after this mutation commits**". No commit ⇒ no scheduled function.
4. The repo already encodes this model: `convex/orders.ts:50-51` — "The owner notice is written in the same transaction as the order (plain helper, no `ctx.runMutation`), so neither commits alone." Same pattern in `convex/notificationHelpers.ts:11-13` and `convex/businesses/adminDeletion.ts:14-16`.

Consequence: **every rejection-path counter (throttle_rejected, block_hit, price_changed, item_unavailable, ordering_closed, outside_hours) increments and is immediately rolled back.** Only counters written on a *successful* mutation survive — which is why D7 (`recordReceiptView` as its own mutation) is sound and D4 is not.

Three viable designs:

| | Shape | Pros | Cons |
|---|---|---|---|
| **A (recommended)** | Separate public mutation `orderMetrics.recordOrderRejection({ businessId, code })`, called by the **client** in the `catch` and by the load-test harness on an HTTP error | Minimal diff; zero cost on the success path; mirrors D7; the code is already parsed client-side by `resolveOrderError` (`lib/order-errors.ts:266-288` reads `error.data.code`) | Anonymous ⇒ inflatable/undercountable; counts only callers that report. Must be labelled "client-reported, best-effort" in the runbook |
| **B** | Public **action** `placeOrderTracked` that `ctx.runMutation`s the existing `placeOrder` (separate transaction), catches, bumps in a second mutation, rethrows | Server-observed, not spoofable; counts every caller | Extra action→mutation hop on **every successful order** (pollutes the p95 the issue wants); `basket-panel.tsx:180` moves `useMutation`→`useAction`; harness must POST `/api/action` |
| **C** | No DB counter; derive from log streaming | No schema | No durable, queryable metric; fails the AC. Reject. |

Recommendation: **A for v1** (consistent with the anonymous-counter risk D4 already accepts, and the §4.4 thresholds are explicitly hypotheses), **B only if the Option-C decision must be spoof-proof**. Either way:

- Replace Task 5's "each typed rejection path bumps the right counter exactly once **inside** `placeOrder`" test with a test on `recordOrderRejection` (valid code ⇒ +1; repeat ⇒ +1; unknown code ⇒ rejected/no-op; success path ⇒ 0 bumps).
- Task 10's "counter-vs-dump cross-check" only holds if the harness issues the report calls itself; otherwise the counters read 0 and the assertion must be reframed.
- Counter keys must include the `code` so per-code rates stay separable (the plan already intends this).

---

## OQ-1 — `orderEvents` block and the cost of a plain index

**Exact current block — `convex/schema.ts:292-312`** (verified in the working tree):

```ts
// Append-only audit of order transitions.
orderEvents: defineTable({
  orderId: v.id('orders'),
  businessId: v.id('businesses'),
  actorType: v.union(v.literal('customer'), v.literal('owner'), v.literal('system')),
  actorUserId: v.optional(v.id('users')),
  action: v.union(/* submitted|accepted|declined|cancelled|ready|completed|expired|no_show */),
  fromStatus: v.optional(v.string()),
  toStatus: v.string(),
  reason: v.optional(v.string()),
  createdAt: v.number(),
}).index('byOrderIdCreatedAt', ['orderId', 'createdAt']),
```

- **Name collision: none.** Index names are scoped per table. `byBusinessIdCreatedAt` already exists on `orderBlocks` (`schema.ts:332`, added by T9) and the table is nowhere near the 32-index limit (docs: max 32 indexes/table, max 16 fields/index).
- **Codegen: nothing to regenerate for an index.** Verified: `byBusinessIdStatus` and `byOrderIdCreatedAt` appear in **neither** `convex/_generated/dataModel.d.ts` nor `convex/_generated/api.d.ts`. Index names are not part of generated types. What *does* change `api.d.ts` is the **new tables** (`orderFlags`, `orderMetricCounters`) — so Task 1 still needs one `npx convex dev`, but the index is free.
- **Deploy cost.** Docs (*Database → Indexes*): "Indexes are created in `npx convex dev` and `npx convex deploy`. … the first deploy that defines an index is a bit slower … Convex needs to backfill your index. The more data in your table, the longer it will take." And: "You can feel free to query an index in the same deploy that defines it. Convex will ensure that the index is backfilled before the new query and mutation functions are registered."
- **Staged alternative.** Same page: `.index('by_channel', { fields: ['channel'], staged: true })`. "Staged indexes are a way to create an index on a large table asynchronously **without blocking deploy**." But: "Staged indexes cannot be used in queries until you enable them … Once it is complete, you can enable the index … by removing the `staged` option." Supported by the installed version (`server/schema.d.ts:102-111`).

**Recommendation:** keep **D2's plain index**, matching the precedent comment at `schema.ts:253-255` ("ships plain (synchronous deploy) rather than `staged`; the `orders` table is small enough that the backfill does not need the two-deploy path"). `orderEvents` on the dev deployment is small (proof rows are deleted by `devProof:cleanupProbe`). **If production `orderEvents` is large at release**, the safe move is the documented two-phase (staged → wait for backfill → remove `staged` → deploy), which means the metrics query ships one release after the index — record that in the release note rather than switching design now.

**Retention dependency: none.** D5's job mirrors `orderThrottleCleanup.ts:26-47`, which pages by the implicit `_creationTime` index and `take(RETENTION_BATCH)`; status filtering happens on the `orders` rows it already has. The new `orderEvents` index is **not** needed by retention (it deletes companions by `orderId` via `byOrderIdCreatedAt`).

---

## OQ-2 — Import direction for the counter helper

**No cycle exists today.** Structural facts:

- `convex/orderThrottle.ts` imports only `convex/values`, `./_generated/server`, `./orderCommitPolicy` (graft trace, direction=out). It does **not** import `orders.ts`.
- `convex/orders.ts:38-42` imports `assertContactNotBlocked`, `claimBusinessThrottle`, `claimContactThrottle` from `./orderThrottle`.
- `convex/orderBlocks.ts:11` imports `contactThrottleKeys` from `./orderThrottle`, and **documents the trap explicitly** at `:33-34`: "`./orders` is deliberately not imported: it imports `./orderThrottle`, so a back edge would make a cycle. The error envelope is built inline instead."
- `orderMetrics` / `metricCounter` / `bumpMetric` do not exist anywhere in `convex/` (graft grep: 0 hits), so there is no existing module to collide with.

So the concrete risk is a *latent* one: if the metrics module ever needs anything from `orders.ts` (e.g. `orderError` or `projectOrderReceipt`) **and** `orderThrottle.ts` imports the metrics module, `orders → orderThrottle → orderMetrics → orders` closes. The repo has already been bitten by exactly this shape and codified the rule.

**Recommendation:** create **`convex/metricCounter.ts`** as a leaf module — the plan's pre-planned fallback is the correct primary choice:

- exports a plain `async function bumpMetricCounter(ctx: MutationCtx, businessId: Id<'businesses'>, key: string, delta = 1): Promise<void>` (the `insertNotification` / `cascadeHardDeleteBusiness` ctx-as-argument pattern), plus any pure helper (e.g. rate math) that deserves `node --test`;
- imports **types only** (`./_generated/server`, `./_generated/dataModel`) plus `convex/values` if it throws — no runtime imports of `orders`, `orderThrottle`, `orderBlocks`, or `authz`;
- `orderMetrics.ts`, `orderBlocks.ts`/`orderThrottle.ts`, and `orders.ts` may then import it in any direction without a possible cycle.

With design **A** from the critical finding, `orderThrottle.ts` and `orders.ts` will not import it at all (the report mutation lives in `orderMetrics.ts`), so this is cheap insurance rather than a necessity.

**Do not** implement the helper as an `internalMutation` for rejection paths — see the critical finding.

---

## OQ-3 — Where `adminDeletion` tests live, and admin-UI error rendering

**Tests (three places; there is no `convex/businesses/adminDeletion.test.ts`):**

| File | Kind | Covers |
|---|---|---|
| `scripts/admin-delete-policy.test.ts` | pure, `node --test` | `assertHardDeleteConfirmation` (`:43-62`), **the child-table list asserted as a literal array (`:68-79`)**, audit-row snapshot (`:147-177`) |
| `scripts/admin-deletion-backfill.test.ts` | pure, `node --test` | `backfillAuditTargetNames` (imports `adminDeletion.ts:14`) |
| `convex/menus.test.ts:318-345` | handler, vitest + `convex-test` | end-to-end `hardDeleteBusiness` under `withIdentity({subject:'user_admin'})`, asserting the audit snapshot survives (`:343-344`) |

**Implication for Task 13:** the guard is `ctx`-dependent (it must read `orders.byBusinessId`), so it cannot be covered by the existing pure script tests unless written as a **pure predicate**. Recommended split:

- `adminDeletion.ts`: pure `assertHardDeleteHasNoOrders(orderCount: number): void` throwing `new ConvexError({ code: 'HAS_ORDERS', message: … })`, called from `cascadeHardDeleteBusiness` (or `hardDeleteBusiness`) **before** any deletes; unit-test it in `scripts/admin-delete-policy.test.ts`.
- one handler branch test (with orders ⇒ rejects and **nothing is deleted**; without orders ⇒ cascades as today). `convex/menus.test.ts:318` is the nearest harness, but the seeded business there has no orders — add the negative branch either there or in a new `convex/businesses/adminDeletion.test.ts` using `convexTest(schema, modules)`.
- **The literal assertion at `scripts/admin-delete-policy.test.ts:68-79` stays green** as long as `'orders'` remains in `HARD_DELETE_CHILD_TABLES` — which the refuse-instead-of-delete design keeps (the cascade is only reached for businesses with zero orders). If Task 13 instead *removed* `'orders'` from the list, that test would fail; the guard design avoids touching it.

**Transactional note:** the audit row is inserted *before* the cascade (`adminMutations.ts:94-105`). A guard throw inside the cascade rolls that insert back with the rest of the transaction, so a refusal leaves **no orphan audit row**. This is documented in the file itself (`adminDeletion.ts:14-16`) and follows from the mutation rollback rule.

**Admin-UI rendering: acceptable, no change needed.** Chain verified:

- `app/admin/directory/page.tsx:213-216` catches and calls `messageFromError(e, 'Action failed')`, then **rethrows** so the inline confirm stays open;
- `messageFromError` (`app/admin/directory/page.tsx:14-25`) handles `ConvexError` with **string** data *and* **object** data carrying `message`, so `new ConvexError({ code, message })` renders its `message`;
- `page.tsx:274` → `directory-route.tsx:315` → `directory-inspector.tsx:148` → `directory-inline-confirm.tsx:171` renders `{error}`.

Caveat: today `hardDeleteBusiness` throws plain-string `ConvexError` (`adminMutations.ts:87`, `adminDeletion.ts:53-56`). Introducing an object envelope is compatible with `messageFromError`, but any consumer branching on `typeof data === 'string'` for this mutation would change behaviour — none exists on this path.

---

## OQ-4 — Reusing `getOrderByToken`'s resolution in `recordReceiptView`

**The path is inline and not reusable as-is.** `convex/orders.ts:995-1012`:

```ts
const access = await ctx.db.query('orderAccess')
  .withIndex('byAccessToken', (q) => q.eq('accessToken', args.token)).first();
const order = access === null ? null : await ctx.db.get('orders', access.orderId);
if (access === null || order === null || order.businessId !== access.businessId) {
  throw orderError('ORDER_NOT_FOUND');            // INV-06 scope mismatch folded in
}
```

- `orderError` is **module-private** (`orders.ts:632`, no `export`) and `projectOrderReceipt` is module-private too (`:588`).
- `cancelOrder` **already duplicates this exact block** (`orders.ts:1034-1041`), so the duplication is an accepted house pattern, not a new sin.
- `ORDER_ERRORS` **is** exported from `orderCommitPolicy` (`orders.ts:16` imports it), so a new module can build the same envelope without importing `orders.ts` — which is what `orderBlocks.ts:33-34` does for the same cycle reason.

**Recommendation:** implement the 5-line lookup + the same `order.businessId !== access.businessId` check **inline in `orderMetrics.ts`**, throwing `new ConvexError({ code: 'ORDER_NOT_FOUND', message: ORDER_ERRORS.ORDER_NOT_FOUND.message })`. This touches **no other surface** (no edit to `orders.ts`), which is what Task 6 asks for. Optional follow-up (not this issue): extract `resolveOrderByToken(ctx, token)` into `convex/orderAccess.ts` (already imported at `orders.ts:8`) and use it from all three call sites.

**Correction to Task 6's contract:** do **not** throw for an unknown token. `recordReceiptView` is a fire-and-forget beacon fired post-mount from `ReceiptLive` (`components/order/receipt.tsx:467-478`); a rejected mutation there is an unhandled promise rejection in the browser. Return `{ recorded: boolean }` (`false` on a miss, no write) and assert that shape in the handler test. Keep the "no bump on bad token" assertion; drop "typed error".

---

## OQ-5 — Is a dev deployment + `NEXT_PUBLIC_CONVEX_URL` actually available?

**RESOLVED — yes, verified live in this environment.**

| Check | Result |
|---|---|
| `.env.local` keys | `CONVEX_DEPLOYMENT=dev:agile-husky-366`, `NEXT_PUBLIC_CONVEX_URL=https://agile-husky-366.convex.cloud`, `NEXT_PUBLIC_CONVEX_SITE_URL=https://agile-husky-366.convex.site` |
| Deployment alive | `GET https://agile-husky-366.convex.cloud/version` → **200**, body `20261027T002650Z-8f5d9f6e7831` |
| CLI authenticated | `~/.convex/config.json` present; read-only `node node_modules/convex/bin/main.js run categories:listOrdered` returned real seeded rows |
| Harness prerequisites | `scripts/order-concurrency-proof.ts:1678-1685` requires `NEXT_PUBLIC_CONVEX_URL`; uses the vendored CLI at `:49` for `devProof:seedProbe` (`:1709`) and `cleanupProbe` (`:1779`) |

**Invocation caveat:** the harness's own error text (`:1682`) prescribes `node --env-file=.env.local scripts/order-concurrency-proof.ts`, and its recorded `command` field builds exactly that (`:1689`). The plan's `npx tsx scripts/order-concurrency-proof.ts --scenario load100` is a *different* runner; use the harness's documented form so `NEXT_PUBLIC_CONVEX_URL` is actually populated (Node ≥ 22.6 strips the types).

Also note the run **writes to the shared dev deployment** (probe business/orders, throttle rows in their live windows) and deletes the probe rows in `cleanupProbe`; it is not a sandbox.

---

## OQ-6 — The `AnalyticsPanel` stub contract

`app/owner/business/[id]/editor-section-body.tsx:38-63` (read in full):

```ts
function AnalyticsPanel({ section }: { section: EditorSection }) { … }
```

- **Props: `{ section }` only.** No `businessId` — but `EditorSectionBody` already receives `businessId: Id<'businesses'>` (`:110`) and renders `<AnalyticsPanel section={activeSection} />` at `:153`, so the prop must be added and passed.
- **No parent query.** The file has no `useQuery` import (only `useState`, `:3`); the panel renders `ANALYTICS_STATS` (`:31`) — `'Profile views' | 'Contact clicks' | 'Orders / bookings'` — each with a hardcoded `—` (`:55`) and a stub note (`:46-48`). **Task 9 must wire `useQuery(api.orderMetrics.overview, …)` inside the panel itself.**
- The file is `'use client'` (`:1`), so a Convex React hook is legal here; `orders-panel.tsx` is the sibling precedent for a query-backed panel.
- **Labels change.** `profile_views` / `contact_clicks` are instrumented **nowhere** in the repo (grep over `convex/`, `app/`, `components/` → 0 hits), and the plan puts menu-view/basket funnels out of scope — so the three placeholder labels are replaced by order metrics, not filled in. Record that in the task/runbook.
- **Design tokens already correct** (`bg-muted`, `text-foreground`, `text-muted-foreground`, `rounded-control`, `text-2xl`, `p-4`) — reuse them for the new grid; no token work needed.

---

## OQ-7 — Do `notifications` rows join the retention delete set?

**No — they are keyed independently and must be retained.**

- Schema `convex/schema.ts:384-402`: `{ userId, type, businessId?, message, reason?, readAt?, createdAt }` — **there is no `orderId` field.** Indexes: `byUserId`, `byUserIdAndCreatedAt`, `byUserIdAndReadAt`, `byBusinessId`.
- Writer `convex/notificationHelpers.ts:273-293` inserts exactly those fields; the event type (`:42-47`) has no order reference; the message text (`:61-78`) contains only the business name (`New order for "X".`, `Order for "X" was cancelled.`).
- Nothing in `app/` or `components/` navigates from a notification to `/order/` (only `basket-panel.tsx:359` pushes a receipt URL). So a purged order cannot leave a dangling link.
- Business deletion already removes them by `businessId` (`adminDeletion.ts:39, 229-232`), which is the correct key.

Consequence for D5: retention deletes `orderEvents`, `orderFlags`, `orderAccess`, `orderIdempotency`, `orderExpiry` for the order and **leaves notifications alone**. Historical "new order" notices surviving an archived order are correct: they are business-level history with no FK and no broken UI. Adding notifications to the companion set would delete unrelated notices (a business's notice list is not per-order) — actively wrong.

---

## Library behaviors the plan depends on (verified)

1. **Mutation transactionality / rollback** — docs *Mutation functions → Transactions* + `registration.d.ts:102-114` (sub-transaction rollback). Drives the critical finding above.
2. **`MutationCtx.runMutation` exists but is a sub-transaction** (`registration.d.ts:109-114`), and the type docs themselves say "Often you can extract shared logic into a helper function instead." The repo's house rule is the plain helper (`orders.ts:50-51`, `notificationHelpers.ts:11-13`, `adminDeletion.ts:14-16`).
3. **Staged index syntax** — `.index('name', { fields: [...], staged: true })`; async backfill that does **not** block deploy, but the index is unusable until enabled (`server/schema.d.ts:102-111`, docs *Indexes → Staged indexes*). Plain indexes backfill synchronously and are usable in the same deploy.
4. **Index names are not generated** — absent from `_generated/dataModel.d.ts` and `_generated/api.d.ts` (grep). Only table shape changes force codegen.
5. **`_creationTime` is implicit** — every index is ordered by it after the declared fields (docs), which is why the retention job needs no `createdAt` index.

---

## Sources

Repo (read this session, all paths absolute-relative to `D:\Dev\dircteshop-1`):

- `convex/schema.ts:292-312` (orderEvents), `:384-402` (notifications), `:252-256` + `:329-332` (index precedents), `:253-255` (plain-index comment)
- `convex/orders.ts:995-1012` (`getOrderByToken`), `:1034-1041` (duplicate token block in `cancelOrder`), `:588-647` (private `projectOrderReceipt` / `orderError`), `:1-42` (imports), `:50-51` (plain-helper rationale)
- `convex/orderBlocks.ts:11`, `:33-34` (documented cycle prohibition)
- `convex/orderThrottle.ts:1-324` skeleton + graft import trace (imports `orderCommitPolicy` only)
- `convex/businesses/adminDeletion.ts:31-42` (child tables), `:188-269` (cascade), `:14-16` (rollback comment)
- `convex/businesses/adminMutations.ts:80-107` (`hardDeleteBusiness`, audit-before-cascade)
- `convex/notificationHelpers.ts:24-47, 61-78, 273-293`
- `scripts/admin-delete-policy.test.ts:43-86`, `scripts/admin-deletion-backfill.test.ts:14`
- `convex/menus.test.ts:318-345` (handler-level hard delete)
- `app/admin/directory/page.tsx:14-25, 177-218, 274`; `directory-route.tsx:315`; `directory-inspector.tsx:148`; `directory-inline-confirm.tsx:171`
- `app/owner/business/[id]/editor-section-body.tsx:1-63, 110, 153`
- `components/order/receipt.tsx:467-478`; `components/order/basket-panel.tsx:331-365`; `lib/order-errors.ts:266-288`
- `scripts/order-concurrency-proof.ts:49, 318-336, 1675-1717`
- `.env.local` (keys only: `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`), `node_modules/convex/dist/cjs-types/server/registration.d.ts`, `node_modules/convex/dist/cjs-types/server/schema.d.ts`, `node_modules/convex/package.json`

Official docs (fetched, current):

- https://docs.convex.dev/functions/mutation-functions — "Transactions": writes commit together; a later throw writes nothing. (Also the doc the repo cites at `orders.ts:53`.)
- https://docs.convex.dev/database/indexes — index creation/backfill on deploy; "staged index" syntax and the "cannot be used until enabled" rule; 32-index / 16-field limits; implicit `_creationTime` ordering.
- https://docs.convex.dev/functions/error-handling — mutation errors reject the client promise and roll back optimistic updates.

Live checks: `GET https://agile-husky-366.convex.cloud/version` → 200 `20261027T002650Z-8f5d9f6e7831`; `convex run categories:listOrdered` → seeded rows.

---

## Caveats and gaps

- **OQ-1's production data volume is unknown.** I proved the *mechanics* (plain blocks deploy during backfill, staged does not but is unusable until enabled) and that the dev deployment is small. If production `orderEvents` is large, the plain index lengthens that one release's deploy — a release-planning fact, not a code change.
- **OQ-5 proves the deployment exists and the CLI is authenticated**, not that the currently deployed functions match the working tree. The load-test run itself will surface drift (and the harness writes evidence either way). No local `npx convex dev` watcher was observed running.
- **Design A's spoofability is a real, accepted limitation**, not a solved problem. If §4.4 is going to be decided from these rates, design B (action wrapper) is the only option that measures what the server actually rejected.
- **OCC behaviour on a hot counter doc is not separately re-verified** here; the plan's "upsert-retry acceptable" mitigation stands as an inference from Convex's transactional model, not a cited test.
- **`convex/businesses/adminDeletion.ts` has no handler test of its own today.** Task 13 either extends `convex/menus.test.ts` (cheapest) or creates one; either is new coverage, so budget for it.

## Recommendation to the planner

1. **Rewrite Task 5 (blocking).** Choose design A or B from §Critical finding; delete the "counter increments inside `placeOrder`" assertions. Add `convex/metricCounter.ts` as a leaf plain-helper module regardless.
2. **Task 6:** inline token resolution in `orderMetrics.ts`, own `ConvexError` from `ORDER_ERRORS`, return `{ recorded: boolean }` instead of throwing.
3. **Task 9:** pass `businessId` into `AnalyticsPanel` and wire `useQuery` inside it; replace the three placeholder labels with the order metrics the plan defines.
4. **Task 13:** pure `assertHardDeleteHasNoOrders` + one handler branch test; keep `'orders'` in `HARD_DELETE_CHILD_TABLES`.
5. **Task 10-11:** run the harness as `node --env-file=.env.local scripts/order-concurrency-proof.ts`; the environment is ready, so no OQ-5 blocker needs recording.
6. **Task 14:** exclude `notifications` from the companion set; document the retained-notice behaviour in the runbook.
