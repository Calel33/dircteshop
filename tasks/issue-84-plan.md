# Implementation Plan: Issue #84 — Order protocol T10: Measurement + hardening + runbook

Plan node output for fix-github-issue-v4. Spec source of truth: `docs/order-commitment-protocol.md` (§4.4 thresholds :658-666, §4.5 measurement plan :668-686, §6.7 UX/a11y :1405-1445, §6.8 owner workflow :1447-1513, §7.2 S5 :1639-1651, E68 :276, E74 :282, INV-30 :326) and `screens/SPEC.md` §7.1 (:126-151). Factual repo map with file:line provenance: `tasks/issue-84-context.md` — **do not re-research it; this plan builds on it.**

**REVISION 2 (post-targeted-research):** every finding in `tasks/issue-84-research.md` (OQ-1…OQ-7 + the blocking mutation-transactionality finding) has been adopted below; the plan's original open-question list is closed. Material changes vs. revision 1: **D4/Task 5 redesigned (blocking)** — rejection counters move from in-mutation bumps to a client-reported public mutation `recordOrderRejection` (research §Critical finding, design A); `recordReceiptView` returns `{ recorded }` instead of throwing (OQ-4); `AnalyticsPanel` gets `businessId` + its own `useQuery` (OQ-6); hard-delete guard is a pure predicate + one handler branch test, `'orders'` stays in `HARD_DELETE_CHILD_TABLES` (OQ-3); load-test invocation is `node --env-file=.env.local scripts/order-concurrency-proof.ts` and the environment is verified ready (OQ-5); `notifications` are excluded from retention companions (OQ-7); plain index kept, codegen only needed for the new tables (OQ-1).

Blocked by #80 (T8 customer UI), #81 (T9 throttle/block metrics + hardened expiry) — both assumed merged; this plan builds only on surfaces they shipped.

## User story

As an owner and the team, I want instrumented close-out of the order protocol (metrics, owner fake-order flag, load-test evidence, runbook, a11y audit) so that "is this working?" is answered with data and the Option C (deposits/SMS) decision in §4.4 becomes evidence-based. No customer-facing change.

## Out of scope / non-goals

- Not building Option C (S6) — only restating its triggers.
- No charts/dashboard framework — the existing `AnalyticsPanel` stub in the owner editor is filled with text stats only.
- No push/SMS/notification infra (documented as a v1 limitation in the runbook).
- No redesign of `transitionOrderStatus`, throttle math, or expiry (T8/T9 shipped).
- No menu-view/basket-start conversion funnel events (§4.5 lists it; instrumentation the customer menu path is a separate customer-facing change — recorded as a limitation; the stub's `profile_views`/`contact_clicks` labels are replaced, not filled, per OQ-6 — they are instrumented nowhere).
- No bulk data export (INV-25).
- No spoof-proof server-side rejection counting (design B) in v1 — design A is client-reported, best-effort; escalation path documented in Risks.

## Architecture decisions

Each decision names the alternative rejected and the tradeoff. The context doc's §3 current-state and §7 unknowns were resolved in the research doc and adopted here.

### D1 — Owner fake-order flag: dedicated `orderFlags` table (not `orderEvents.owner_flagged`) — unchanged by research

§7.2 S5 (:1645) allows either. **Chosen: new `orderFlags` table** in a new `convex/orderFlags.ts` module. Rationale: the abuse-rate metric (owner-flagged ÷ submissions) is the number that decides Option C; a mis-flag must be correctable, which a closed append-only event ledger cannot do without a compensating event. A dedicated table gets flag/unflag with an `active` flag, one `auditLogs` row per action (exact `orderBlocks.ts:120-130,179-188` precedent), and never touches the transition action union (`ORDER_ACTIONS`, `orderPolicy.ts:37`) or the `orderEvents.action` union (`schema.ts:298-307`) — neither is overlaid (issue constraint). Tradeoff: one more table + one more module vs. metric correctness.

### D2 — Metrics read over `orderEvents` with a new `byBusinessIdCreatedAt` index — kept, research-confirmed (OQ-1)

**Chosen: plain `.index('byBusinessIdCreatedAt', ['businessId','createdAt'])` on `orderEvents`.** Research confirmed: index names never enter `_generated` (verified absent from `dataModel.d.ts`/`api.d.ts`), the name is house-consistent (`orderBlocks` already has `byBusinessIdCreatedAt`, `schema.ts:332`), a plain index backfills synchronously at deploy and is queryable in the same deploy, and **retention (D5) does not depend on it** — the retention job pages by implicit `_creationTime` like `orderThrottleCleanup.ts:26-47`. Dev-deployment `orderEvents` is small (probe rows cleaned by `cleanupProbe`), so backfill cost is negligible here. If **production** `orderEvents` turns out to be large at release, the documented two-phase path (`.index(name, { fields, staged: true })` → wait for backfill → remove `staged` → deploy, ship metrics query one release later) is the release note — not a design change now (kept in Risks).

### D3 — Latency from event pairing, not `orders.statusUpdatedAt` — unchanged by research

p50/p95 of submit→accept is derived by pairing each order's `submitted` event with its next `accepted` event, streaming the new index bounded (`take` cap constant, documented). `orders.statusUpdatedAt` - `createdAt` only works for orders *frozen* in `accepted`. Tradeoff: slightly more streaming read logic vs. correct latencies for every order.

### D4 — REDESIGNED (blocking): rejection/telemetry counters via client-reported `recordOrderRejection` public mutation (research design A)

The original design — `bumpMetricCounter` called at each typed-rejection site inside `placeOrder` / `orderThrottle` claims / `assertContactNotBlocked` — **cannot work**: those paths end in a thrown `ConvexError`, and Convex mutations discard all writes when they throw (docs "Mutation functions → Transactions"; sub-transaction rollback per `registration.d.ts:102-114`; `ctx.scheduler.runAfter` never fires without a commit). Verified against the installed `convex@1.46.0` types. **Chosen (research design A): new public mutation `orderMetrics.recordOrderRejection({ businessId, code })`** — called fire-and-forget by the client in its `catch` (the code is already parsed client-side by `resolveOrderError`, `lib/order-errors.ts:266-288`) and by the load-test harness on its own HTTP errors. Counters live in the still-new `orderMetricCounters` table, one doc per `(businessId, code)`; keys include the code so per-code rates stay separable.

- Counter writes happen in their **own transaction** (a successful mutation), so they commit — the only transactional soundness option besides a wrapper action.
- Valid `code` values are a **closed const list** in `orderCommitPolicy.ts` (`REJECTION_CODES`: `throttle_rejected`, `block_hit`, `price_changed`, `item_unavailable`, `ordering_closed`, `outside_hours`); unknown codes are a no-op, not a write vector.
- Receipt-view counter (D7) shares the table via `recordReceiptView`.
- Alternatives rejected: **B** (public action `placeOrderTracked` wrapping `ctx.runMutation(placeOrder)` — server-observed and spoof-proof, but it adds an action→mutation hop to *every* successful order, polluting the p95 the issue measures, and moves `basket-panel.tsx:180` to `useAction`; escalate to B only if the Option-C decision must be spoof-proof — recorded as an explicit escalation path in Risks); **C** (derive from log streaming — no durable queryable metric, fails the AC). The "each typed rejection path bumps exactly once inside `placeOrder`" style of assertion is gone: tests now target `recordOrderRejection` directly.
- Tradeoff: anonymous ⇒ inflatable/undercountable; counts only callers that report. Mitigations: closed code list, per-code keys, load-test harness reports its own rejections (so the measured denominator cross-check is real under one observer), runbook labels the metric **"client-reported, best-effort"**, and §4.4 thresholds are explicitly hypotheses. This risk-theoretic acceptance is consistent with the anonymous-counter exposure D7 already takes.

### D5 — Retention: implemented bounded job, spec examples recorded as decided values — amended by OQ-7

E74 (:282) gives "e.g." values and says "not implemented v1"; the issue says "decide and record". **Chosen: record decided values in the runbook AND implement the bounded retention internal mutation + daily cron** (§7.2 S5 :1647 lists "retention job dry run"). Values: declined/cancelled/expired/no_show terminals deleted at **90 days**; completed at **365 days**. Companion rows deleted **with** the order: `orderEvents`, `orderFlags`, `orderAccess`, `orderIdempotency`, `orderExpiry`. **`notifications` are EXCLUDED** (OQ-7: `notifications` has no `orderId` field — it is business/user-keyed, retained independently; adding it would delete unrelated notices, actively wrong); the runbook documents that order notices survive purged orders. `orderThrottle`/`orderBlocks` keep their own cleanup/scope. Constant home: `orderCommitPolicy.ts`. Job pattern: `orderThrottleCleanup.ts:22-47`. Tradeoff: dead receipt links after retention — documented in the runbook. Bounded, status-age-scoped, dry-run-flagged; deletion is product retention per spec, not repo cleanup (NO-DELETION rule honored).

### D6 — Hard-delete guard: implemented as a pure predicate + one handler branch test (amended by OQ-3)

Current code contradicts INV-30/E68: `adminDeletion.ts:31-40` hard-deletes every order row (:251-253) while orphaning event ledgers. **Chosen: guard `cascadeHardDeleteBusiness` to refuse when the business has any orders**, split per OQ-3: pure `assertHardDeleteHasNoOrders(orderCount: number)` in `adminDeletion.ts` throwing `ConvexError({ code: 'HAS_ORDERS', message })`, unit-tested in the existing pure suite `scripts/admin-delete-policy.test.ts` (where the literal child-table assertion at :68-79 already lives — **`'orders'` stays in `HARD_DELETE_CHILD_TABLES`** so that assertion stays green; the cascade is only reached for order-free businesses); one handler branch test (with orders ⇒ refused, nothing deleted; without ⇒ cascades as today) either in `convex/menus.test.ts`'s harness (:318-345) or a new `convex/businesses/adminDeletion.test.ts`. A guard throw rolls the audit insert back (mutation transactionality), so a refusal leaves **no orphan audit row**. Admin-UI rendering verified compatible: `messageFromError` (app/admin/directory/page.tsx:14-25) handles object `ConvexError` data. Plus the runbook note.

### D7 — Receipt views via public `recordReceiptView` incrementing the counter — amended by OQ-4

Receipt is an anonymous token route (`app/order/[token]/page.tsx:29`). **Chosen: public mutation `orderMetrics.recordReceiptView({ token })`** that resolves the token **inline** (the `orders.ts:995-1012` resolution is module-private and `cancelOrder` already duplicates it verbatim at :1034-1041, so duplication is accepted house style): `orderAccess.byAccessToken` → `orders` get → the `businessId` match check, throwing `ConvexError({ code: 'ORDER_NOT_FOUND', message: ORDER_ERRORS.ORDER_NOT_FOUND.message })` (`ORDER_ERRORS` is exported from `orderCommitPolicy`) — **no edit to `orders.ts`**. **Contract correction (OQ-4): returns `{ recorded: boolean }`, never throws to the client on a bad token** (it is a fire-and-forget post-mount beacon from `ReceiptLive`; a thrown mutation there is an unhandled browser rejection; `{ recorded: false }` and no write on a miss). No PII, no order-row writes. Called once per tab (effect + ref). Optional follow-up (NOT this issue): extract `resolveOrderByToken` into `convex/orderAccess.ts` for all three call sites.

### D8 — Load test: extend the existing proof harness, rejections are expected outcomes, harness self-reports (amended by OQ-5 + D4)

`scripts/order-concurrency-proof.ts` already: env `NEXT_PUBLIC_CONVEX_URL` (:1678), `devProof:seedProbe` (:1709), `timedHttpMutation` with `skipQueue` (:383-438), log capture + OCC join (:444-625), evidence renderer (:1450-1657). **Chosen: add a 100-way burst scenario (`load100`) across 10 seeded businesses** (widened `seedProbe`), `TOO_MANY_REQUESTS` treated as an expected, counted outcome, distinct contact hashes per submission, duplicate-key subset re-proving idempotency (INV-04). **D4 amendment: the harness issues `recordOrderRejection` calls itself for each expected rejection/contact-block result it observes**, so the counter-vs-dump cross-check measures one observer's behavior rather than reading zeros; assertions: zero duplicate orders, p95 latency, OCC retry observation, rejection-report counts matching observed HTTP outcomes, counter deltas via `dumpProbe` (:407). **Environment (OQ-5): verified ready** — dev deployment `agile-husky-366` live, `.env.local` populated, CLI authenticated runs `convex run`. Invoke as the harness prescribes: `node --env-file=.env.local scripts/order-concurrency-proof.ts` (NOT `npx tsx` — Node ≥ 22.6 strips types and the harness's own recorded `command` field builds exactly this form, :1689). The run writes probe rows to the shared dev deployment and cleans up via `cleanupProbe`.

### D9 — `convex/metricCounter.ts` leaf module (adopted from OQ-2)

**Chosen: create `convex/metricCounter.ts` as a leaf module** regardless of import need: exports a plain `bumpMetricCounter(ctx, businessId, key, delta = 1)` helper in the ctx-as-argument house style (`insertNotification`/`cascadeHardDeleteBusiness`; **plain helper, NOT an internalMutation for rejection paths** — see D4) plus any pure rate-math helper; imports **types only** (`./_generated/server`, `./_generated/dataModel`) plus `convex/values` if it throws — no runtime imports of `orders`/`orderThrottle`/`orderBlocks`/`authz`. Verified facts: no import cycle exists today (`orderThrottle.ts` imports only `orderCommitPolicy`; the cycle prohibition is codified at `orderBlocks.ts:33-34`), and with design A `orders.ts`/`orderThrottle.ts` will not import it at all — `orderMetrics.ts` consumes it — so this is cheap cycle insurance. (Critically, an *internalMutation* counter cannot count a rejection even wrapped in `ctx.runMutation` — sub-transaction rollback.)

## Dependencies (build order)

schema (D2, D4 counters table, D1 orderFlags) → `metricCounter.ts` leaf + public report mutations (`recordOrderRejection`, `recordReceiptView`) + client error-path wiring → owner flag → metrics query → analytics UI → load test (needs counters + widened seed + self-reporting) → runbook/retention/guard (independent, parallel with phase 4) → a11y audit + final gate (last).

## Tasks

Format per planning-and-task-breakdown. All tasks inherit the read-before-write and graft rules; every task cites `tasks/issue-84-context.md` sections for the exact file:line anchors instead of repeating them.

---

### Phase 1 — Schema foundation

#### Task 1: Add `orderEvents.byBusinessIdCreatedAt` index + `orderFlags` + `orderMetricCounters` tables
- **UPDATE** `convex/schema.ts`: add plain index `byBusinessIdCreatedAt` on `orderEvents` (businessId, createdAt) — mirrors `orderBlocks.byBusinessIdCreatedAt` naming (`schema.ts:332`) and the plain-index precedent comment (`schema.ts:253-255`); add `orderFlags` table `{ businessId, orderId, actorUserId, active, createdAt, unique(byOrderId) }` with index `byBusinessIdCreatedAt`; add `orderMetricCounters` table `{ businessId, code, value, unique(byBusinessIdCode) }` for upsert (keys include the rejection code, D4).
- **GOTCHA (OQ-1):** index names never enter `_generated` — codegen is needed only because of the **new tables**; run `npx convex dev` once so `api.d.ts` picks up `orderFlags`/`orderMetricCounters`. Never hand-edit `convex/_generated/` (context §5).
- **VALIDATE:** `npx convex dev` once (codegen), then `npm test` — existing suites must stay green (schema is additive).
- **SATISFIES AC:** D2/D4/D1 prerequisites.

Checkpoint: schema additive, tests green, codegen clean.

---

### Phase 2 — Owner fake-order flag slice (D1)

#### Task 2: `convex/orderFlags.ts` — `flagOrder` / `unflagOrder` owner actions
- **CREATE** `convex/orderFlags.ts`: two mutations, **MIRROR** `orderBlocks.ts` patterns exactly — `requireBusinessOwnerUser` guard first (`orderBlocks.ts:85`), error envelope via `ORDER_ERRORS` + `ownerActionError` (`orderBlocks.ts:54-58`), **idempotent** re-flag/un-flag of already-current state is a no-op success (INV-21 spirit; `orderBlocks.ts:120-130`), exactly **one** `auditLogs` row per actor action with masked order reference (`maskedContactLabel` precedent `orderBlocks.ts:41-51`), `active` boolean on `orderFlags` (unflag = `active:false`, never delete).
- **IMPORTS:** `convex/authz.ts`, `convex/orderCommitPolicy.ts` (add `FLAG_REASONS` coded list there: `Fake order`, `Wrong number`, `Duplicate`, `Prank`, `Other`).
- **VALIDATE:** `npm test -- orderFlags` + lint.
- **SATISFIES AC:** owner fake-order flag action exists, owner-only, does not overload transition union.

#### Task 3: `convex/orderFlags.test.ts` — authz negatives + audit + idempotency
- **CREATE** tests **MIRROR** `orderBlocks.test.ts:297-412` (owner-only negatives) and `:485-547` (audit-row assertions): non-owner → Forbidden; unauthenticated → Forbidden; flag on another business's order → Forbidden; re-flag idempotent (no second row/no second audit); un-flag clears `active`; flag persists through owner decisions (accepted then flagged still counts for abuse rate); missing order → typed `NOT_FOUND`.
- **VALIDATE:** `npm test -- orderFlags`.
- **SATISFIES AC:** non-owner → Forbidden.

#### Task 4: Owner board UI — flag button + dialog
- **UPDATE** `app/owner/business/[id]/orders-panel.tsx` (add `runFlagAction` **MIRROR** `runContactAction` :548-594) and `app/owner/business/[id]/orders-panel-dialogs.tsx` (flag dialog with coded reasons, **MIRROR** decline dialog; design tokens only — rule 10).
- **GOTCHA:** user-visible change → **Reticle verdict required** (AGENTS.md): drive the flag flow on the dev app before calling the task done; the flag action never touches `orderEvents`/transition actions.
- **VALIDATE:** Reticle `verified:"yes"` on the flag flow + lint.
- **SATISFIES AC:** flag action is owner-only and reachable.

Checkpoint: owner can flag/unflag from the board with audit rows; authz proven.

---

### Phase 3 — Telemetry counters (D4, D7, D9)

#### Task 5 (REWRITTEN): `metricCounter.ts` leaf helper + client-reported `recordOrderRejection` + client error-path wiring
- **CREATE** `convex/metricCounter.ts` (D9): leaf module, plain `bumpMetricCounter(ctx, businessId, key, delta = 1)` (upsert-with-clamp on the `orderMetricCounters` doc, ctx-as-argument style), types-only imports, no runtime imports of `orders`/`orderThrottle`/`orderBlocks`/`authz` (OQ-2 confirmed no cycle exists today; this prevents the latent `orders → orderThrottle → orderMetrics → orders` shape).
- **CREATE** `convex/orderMetrics.ts` with public mutation `recordOrderRejection({ businessId, code })` (D4 design A): validate `code` against the new closed `REJECTION_CODES` const in `orderCommitPolicy.ts` (unknown code → no-op success, no write vector); anonymous (no auth guard — rejection paths include anonymous throttled customers); `bumpMetricCounter` for `(businessId, code)`; no order writes, no PII.
- **UPDATE** `components/order/basket-panel.tsx` (`placeOrder` call + catch, :341): on a typed order error, fire-and-forget `recordOrderRejection` **exactly once per failed attempt** (ref-guarded so UI retries don't double-count), using the `businessId` already in the panel's basket context and the code parsed by `resolveOrderError` (`lib/order-errors.ts:266-288`); the beacon must never surface UI errors (swallow rejects).
- **GOTCHA:** counter bumps commit — they run in their own mutation transaction; never call `bumpMetricCounter` inside a transaction that throws. Do **not** wire increments into `placeOrder`/`orderThrottle`/`assertContactNotBlocked` server paths (research §Critical finding: those writes roll back).
- **UPDATE** append `convex/orderMetrics.test.ts` cases for `recordOrderRejection`: valid code ⇒ +1; repeat ⇒ +1; unknown code ⇒ no-op; success path ⇒ 0 bumps (assert via direct counter reads). Handler-side unit test of the pure rate/key math if it lives in `metricCounter.ts`.
- **VALIDATE:** `npm test -- orderMetrics` (partial) + lint.
- **SATISFIES AC:** throttle-hit/block-hit counts per 1,000 submissions + PRICE_CHANGED/ITEM_UNAVAILABLE/ORDERING_CLOSED/OUTSIDE_HOURS rates are measurable (client-reported, best-effort — labelled in Task 12's runbook).

#### Task 6 (amended): `recordReceiptView` public mutation + receipt wiring
- **ADD** to `convex/orderMetrics.ts`: public mutation accepting `{ token }`, **inline** token resolution per OQ-4 (orderAccess `byAccessToken` → orders get → scope-match check; build the envelope from the exported `ORDER_ERRORS` — no edit to `orders.ts`), bumps `receipt_viewed` for the order's business via `bumpMetricCounter`, **no PII**, no order row writes.
- **CONTRACT (OQ-4):** returns `{ recorded: boolean }` — `{ recorded: false }` and no write on unknown/mismatched token; **never throws client-facing errors** (fire-and-forget beacon).
- **UPDATE** `components/order/receipt.tsx` (`ReceiptLive` :467-478): fire once per tab (effect + ref); swallow rejects.
- **VALIDATE:** handler test: bad token ⇒ `{recorded:false}`, no bump; valid token ⇒ +1; repeat +1 (documented: dedupe is per-tab only — aggregate-only constraint).
- **SATISFIES AC:** receipt-view metric.

---

### Phase 4 — Metrics query + owner analytics panel

#### Task 7: `convex/orderMetrics.ts` `overview` owner-scoped query
- **CREATE** query `overview({ businessId, windowDays })` for business owners, **MIRROR** `adminQueries.ts:59-92` (authz first, `countRows` streaming helper :35-42, never `.collect()`). Aggregates over `orderEvents` via the new `byBusinessIdCreatedAt` index inside the window, bounded `take` constant (`METRICS_WINDOW_EVENT_LIMIT`, documented — the deliberate deviation from the `@convex-dev/aggregate` guidance is already accepted, `orders.ts:365-375`):
  - submissions count (from `submitted` events; denominator for all rates),
  - latency p50/p95: pair each order's `submitted` with next `accepted` event (D3) — pure `percentile(sorted[], q)` helper,
  - decline rate + reason mix grouped by `reason` string (`DECLINE_REASONS` labels),
  - cancellation count by `actorType` (customer vs owner),
  - throttle-hit and block-hit **per 1,000 submissions** (from `REJECTION_CODES` counters ÷ submissions × 1000 — never divide by zero, `0` not NaN, "fail visibly" per `adminQueries.ts:20-23`),
  - owner-flagged count and **abuse rate = flagged ÷ submissions** (D1),
  - basket size distribution: line-count/unit-count/subtotal buckets from `orders.byBusinessId` rows in-window,
  - receipt views (counter),
  - per-code rejection rates (counter ÷ submissions), each labelled client-reported.
  - contact data never appears: counters/events carry ids + reason codes only (INV-25).
- **VALIDATE:** codegen + lint.
- **SATISFIES AC:** all metrics exist; no-contact-data invariant.

#### Task 8: `convex/orderMetrics.test.ts` — seeded correctness + authz negatives
- **CREATE** tests **MIRROR** `orderBlocks.test.ts` harness conventions (`convexTest(schema, glob)`, fake `Date` only, `t.withIdentity({subject:'user_owner'})` — `orders.test.ts:16-44,69-171`): seed orders/events/counters/flags; assert exact aggregates (submissions, p50/p95 known values, reason mix incl. `Other` free text, counter rates, abuse rate, zero-division → 0 with counts reported); owner-scope negatives: unauthenticated → Forbidden, second business's owner → Forbidden, non-owner (`subject:'user_other'`) → Forbidden; terminal-only statuses never emit latency; same-createdAt pair row seeds correctly.
- **VALIDATE:** `npm test -- orderMetrics`.
- **SATISFIES AC:** metrics correct on seeded dataset, owner-scoped authz proven.

#### Task 9 (amended): Fill `AnalyticsPanel` stub with real metrics — thread `businessId`, wire `useQuery` (OQ-6)
- **UPDATE** `app/owner/business/[id]/editor-section-body.tsx` (:38-63 per OQ-6 verified contract): `AnalyticsPanel({ section })` takes only `section` today and has no parent query (no `useQuery` import in the file) — so **add `businessId: Id<'businesses'>` to its props** (passed from `EditorSectionBody`, which already receives it at :110 and renders the panel at :153) and **wire `useQuery(api.orderMetrics.overview)` inside the panel itself** ('use client' file, sibling precedent `orders-panel.tsx`).
- **LABELS (OQ-6):** replace the three placeholders (`Profile views`/`Contact clicks`/`Orders / bookings` — instrumented nowhere) with the order-metric names from Task 7 (submissions, p50/p95, decline rate + reason mix, throttle/block per 1k, abuse rate, rejection rates, receipt views) as a text-stat grid; "—" when the window has no data; no charts. The already-correct token set (`bg-muted`, `text-muted-foreground`, `rounded-control`, `text-2xl`, `p-4`) is reused; no token work needed.
- **GOTCHA:** user-visible → Reticle verdict on the analytics section; board regression via `npx @reticlehq/server gate --since <ref>`.
- **SATISFIES AC:** metrics are owner-visible (S5 rollout "internal dashboard").

Checkpoint: metrics query + analytics panel proven on handler tests and Reticle verdicts.

---

### Phase 5 — Load test (needs counters + self-reporting + widened seed)

#### Task 10 (amended): Widen seed + add burst scenario + harness self-reporting
- **UPDATE** `convex/devProof.ts`: widen `seedProbe` (:114-167, currently 1 business/1 item) to seed **10 businesses** (run-scoped names, distinct approved open businesses) and per-order distinct contact inputs available to the script.
- **UPDATE** `scripts/order-concurrency-proof.ts`: add scenario **`load100`** — 100 concurrent `placeOrder` calls across the 10 businesses (10 per business, inside the 60/10-min cap), distinct contact hashes per call, ~10 replaying the same idempotency key (INV-04), concurrent enough to observe OCC; capture p50/p95 via `timedHttpMutation` (:383-438), OCC retries via `LogRecord.occInfo` (:84-97). **D4 amendment: on each expected rejection (`TOO_MANY_REQUESTS` / typed codes), the harness itself calls `recordOrderRejection` with the seeded businessId + observed code**, so counter deltas are cross-checked against the harness's own observed outcomes via `dumpProbe` (:407) — without this, counters read 0 and the cross-check is meaningless. Block-hit sample via the client-side report of `CONTACT_BLOCKED`.
- **VALIDATE:** script self-asserts (fail non-zero on duplicates, unexpected error classes, or missing log capture), invoked as the harness prescribes (**OQ-5**): `node --env-file=.env.local scripts/order-concurrency-proof.ts --scenario load100` — NOT `npx tsx`.
- **SATISFIES AC:** 100 concurrent commits, zero duplicate orders, OCC/throttle behavior + counter cross-check recorded.

#### Task 11 (amended): Run the load test and write the evidence record
- **CREATE** `tasks/issue-84-loadtest-evidence.md` **MIRROR** `tasks/issue-81-concurrency-evidence.md:1-70`: command + deployment (`dev:agile-husky-366`) + date header, verdict table, per-scenario tables incl. p95 latency, OCC retries, throttle-rejection counts, and the **counter-vs-observed-outcome cross-check** (harness-reported increments vs `dumpProbe` counters).
- **GOTCHA (OQ-5):** environment verified ready (deployment live, CLI authenticated, `.env.local` populated) — no blocker is expected; the no-fabrication house rule still applies if the run surfaces deployment drift (deploy first, then re-run). Note the run writes probe rows to the shared dev deployment (cleaned by `cleanupProbe`).
- **SATISFIES AC:** load-test evidence artifact with real numbers.

Checkpoint: evidence exists with real (not invented) numbers.

---

### Phase 6 — Runbook, retention, hard-delete guard (independent of Phases 4–5)

#### Task 12: `docs/order-runbook.md` — the operator + team document
- **CREATE** covering, each anchored to the protocol where normative:
  1. **Daily checklist** (five items, one screen — protocol :1506-1512 verbatim adapted).
  2. **Recovery paths**: pause + resume (:1487-1489), hours edit (:1490), 86 / un-86 stale items (:1491-1492).
  3. **Throttle false-positive path**: owner `clearContactThrottle` (`orderBlocks.ts:211+`), what the customer sees, escalation if it recurs.
  4. **Retention policy (D5 values)**: 90d terminals / 365d completed; companion rows deleted with the order; **notifications explicitly NOT companions** (OQ-7) — order notices survive purged orders by design (business-level history, no FK, no broken UI); throttle/block rows per their own cleanup; dead-receipt-link caveat; how to raise/lower.
  5. **Hard-delete guard note (D6)**: refuse on orders; archive instead; INV-30/E68 anchor.
  6. **"v1 has no push/SMS"** limitation (:1497-1498) with the compensating daily-checklist habit.
  7. **§4.4 escalation thresholds restated (:658-666) with exact metric names from Task 7** (abuse rate from flags, reason-mix percentages, call time — **not instrumented**, owner interview per §4.5 :684) — and a **"client-reported, best-effort" caveat on rejection/view counters** (D4 design A limitation, per research).
  8. No-PII note (INV-25); "fail visibly, never a false total" reading guidance.
- **VALIDATE:** human review pass; every § reference resolves; metric names match Task 7's key names.
- **SATISFIES AC:** runbook exists with daily checklist, recovery paths, retention policy, hard-delete guard note, no-push limitation, §4.4 restatement.

#### Task 13 (amended): Hard-delete guard — pure predicate + handler branch test (OQ-3)
- **UPDATE** `convex/businesses/adminDeletion.ts`: pure `assertHardDeleteHasNoOrders(orderCount: number): void` throwing `ConvexError({ code: 'HAS_ORDERS', message }: …)`, called from `cascadeHardDeleteBusiness` **before any deletes** via an `orders.byBusinessId` take-1 count. Keep `'orders'` in `HARD_DELETE_CHILD_TABLES` (research OQ-3: the literal assertion in `scripts/admin-delete-policy.test.ts:68-79` must stay green; the cascade is only reached for order-free businesses). Remove nothing else.
- **UPDATE** tests: unit-test the pure predicate in `scripts/admin-delete-policy.test.ts` (pure, `node --test`); add the handler branch test — with orders ⇒ refused and **nothing deleted**; without orders ⇒ cascades as today — in `convex/menus.test.ts`'s existing handler harness (:318-345, seeded business there has no orders so the positive branch is already exercised) or a new `convex/businesses/adminDeletion.test.ts` (either adds new coverage — budgeted).
- **GOTCHA:** the guard throw rolls the audit insert back with the transaction (no orphan audit row); typed `{code,message}` envelope renders fine in the admin UI (`messageFromError`, `app/admin/directory/page.tsx:14-25`).
- **VALIDATE:** `npm test`.
- **SATISFIES AC:** hard-delete guard exists, not just documented.

#### Task 14 (amended): Retention job — companions exclude `notifications` (OQ-7)
- **CREATE** `convex/orderRetention.ts`: internalMutation (bounded `RETENTION_BATCH`, oldest-first via implicit `_creationTime`, no new index — `orderThrottleCleanup.ts:26-47` pattern), status-scoped: terminal orders older than 90d (declined/cancelled/expired/no_show) and completed older than 365d; delete the order + companions (`orderEvents`, `orderFlags`, `orderAccess`, `orderIdempotency`, `orderExpiry`) in one txn; **do NOT touch `notifications`** (no `orderId` field — business-keyed, retained independently; OQ-7); `dryRun` flag returning counts without delete for the (:1647) target.
- **ADD** daily cron in `convex/crons.ts` (:7-15 pattern); constants in `orderCommitPolicy.ts` (`RETENTION_TERMINAL_DAYS_MS` = 90d, `RETENTION_COMPLETED_DAYS_MS` = 365d, `RETENTION_BATCH`).
- **UPDATE** tests: dry-run deletes zero; wet run deletes only in-scope order + its five companion kinds, never a completed order under 365d, never a non-terminal order, never another business's data, and **leaves notifications intact**.
- **VALIDATE:** `npm test`.
- **SATISFIES AC:** retention recorded AND operating, matching the runbook text (Task 12).

Checkpoint (docs + hardening): runbook reviewed, guard tested, retention job proven bounded.

---

### Phase 7 — A11y audit + final gate

#### Task 15: Accessibility audit record
- **CREATE** `docs/validation/issue-84-a11y-audit.md`: recorded manual **keyboard** pass + **screen-reader** pass over the **owner board** (type/add/remove with keyboard, both dialogs, live regions `boardStatusLine` `orders-panel.tsx:145-150`) and the **receipt** stepper/status/live regions (`receipt.tsx:113-149,263-383`), each §6.7 :1444 rule checked individually, confirmed idioms in inventory (context §3.5), and the pass environment (browser + SR name) recorded, matching `docs/validation/*-report.md` formatting.
- **VALIDATE:** the audit table itself; any fix surfaces a follow-up task (audit findings stay un-silenced).
- **SATISFIES AC:** a11y audit notes recorded for board + receipt flows.

#### Task 16: Full verification gate
- RUN: `npm test` + `npm run lint` + `npm run build` + Reticle gate (`npx @reticlehq/server gate --since <ref>`).
- **SATISFIES AC:** closed-out with evidence.

## Checkpoints

1. After Task 1 — additive schema only, codegen + suite green before anything builds on it.
2. After Task 4 — flag slice reproducible end-to-end from the board, authz proven.
3. After Task 9 — metrics query + owner panel mutually consistent; counters commit only via report mutations, never on success paths.
4. After Task 14 — runbook/retention/guard block coherent with the code it documents.
5. Final — a11y record + full verification gate.

## TESTING STRATEGY (consolidated)

- **Handler** (`vitest` + `convex-test`, edge runtime): every new mutation/query — authz negative first, then behavior — mirroring `orderBlocks.test.ts` conventions; plus positive/negative branches of `recordOrderRejection`/`recordReceiptView`; fake `Date` only.
- **Pure** (`node --test`): the hard-delete predicate joins `scripts/admin-delete-policy.test.ts`; rate-math helpers in `metricCounter.ts` get a `node --test` row if extracted there.
- **Concurrency** (real deployment, Tasks 10-11): extends the proof-harness pattern; rejections are expected outcomes; harness self-reports rejection counters for the cross-check.
- **E2E**: Reticle verdicts on the two user-visible changes (flag button, analytics panel).

## VALIDATION COMMANDS

- `npm test` (pure matrix + handler suites)
- `npm run lint` / `npm run build`
- `npx convex dev` once for codegen after `schema.ts` table additions
- `npx @reticlehq/server gate --since <ref>`
- `node --env-file=.env.local scripts/order-concurrency-proof.ts --scenario load100` (Tasks 10-11; harness-prescribed form; environment verified ready)

## RISKS AND MITIGATIONS

| Risk | Impact | Mitigation |
|------|--------|------------|
| Design A rejection counters are client-reported and spoofable/undercountable | Medium | closed `REJECTION_CODES` const (no arbitrary keys written), fire-and-forget single-attempt reporting, harness self-reports (one-observer cross-check), runbook labels "client-reported, best-effort"; **explicit escalation path**: §4.4 decision requires spoof-proof numbers ⇒ implement design B (`placeOrderTracked` action wrapper) as a follow-up before acting on the thresholds |
| Production `orderEvents` volume unknown ⇒ plain-index deploy backfill stalls a release | Medium | dev deployment is small (probe cleanup); if production table is large, use the documented two-phase staged-index path and ship the metrics query one release later (release note, not a design change) |
| Deployed dev functions may not match the working tree at load-test time (OQ-5 caveat) | Low | OQ-5 verified the environment; the harness writes evidence either way — deploy the working tree, re-run, never fabricate |
| Hot counter doc under report storm (OCC) | Low | Convex auto-retries mutating transactions; counter writes are isolated single-doc mutations outside success-critical writes; load test observes the behavior directly (inference flagged unverified at Task 10) |
| Receipt/report beacons surface errors in the browser as unhandled rejections | Low | `{ recorded: false }` contract (OQ-4) + swallow-all rejects + ref-guards in the client wiring (Tasks 5-6) |
| Anti-PII violations sneak into metric names/keys (INV-25) | Medium | keys are fixed codes from consts (`REJECTION_CODES`, `DECLINE_REASONS`, `FLAG_REASONS`); audit the diff for `phone`/`email`/`name` |
| Retention job deleting the wrong rows | High | dry-run default flag, status+age scope, batch bound, wet-run tests for completed-under-365d, non-terminal stays, and notifications-intact assertions |
| `adminDeletion.ts` guard touches an admin surface — regression elsewhere | Medium | pure predicate unit-tested (OQ-3), both-branch handler test, `'orders'` kept in `HARD_DELETE_CHILD_TABLES` so the existing literal assertion stays green, orphan-audit impossible (rollback verified) |
| Load test writes to the shared dev deployment (probe rows/live window counters) | Low | scoped probe names + `cleanupProbe`; run recorded as affecting the dev deployment only |
| `orderEvents` pairing miscounts fast-success orders or window-edge boundaries | Low | pair per order-id within take-bound; explicit same-createdAt-pair seed test |
| a11y audit surfaces fixes that stall | Low | audit records findings only — follow-ups become tasks |
| Design-token hook lint on new UI code (flag dialog, analytics panel) | Low | token-only reusing the panel's existing correct tokens (OQ-6) |

## OPEN QUESTIONS → CLOSED (all seven resolved in `tasks/issue-84-research.md`; adopted above)

OQ-1 plain index kept, codegen only for new tables · OQ-2 no cycle; leaf `metricCounter.ts`; rejection bumps must be mutation-report, never internalMutation · OQ-3 tests live in pure suite + `menus.test.ts` harness; predicate split; `{code,message}` renders in admin UI · OQ-4 inline resolution; `{ recorded: boolean }` not throws · OQ-5 environment ready; harness invocation `node --env-file=.env.local …` · OQ-6 panel takes only `section`; thread `businessId` + wire `useQuery` inside; labels replaced · OQ-7 notifications excluded from companions.

**Remaining unresolved items (folded into Risks, none blocking):** (1) Design-A spoofability vs. the Option-C decision → escalation path in Risk row 1; (2) production `orderEvents` volume → Risk row 2; (3) deployment-drift at load-test time → Risk row 3; (4) OCC behavior on a hot counter doc is inferred, not test-cited → Risk row 4 (observed at Task 10). **No blockers.**

## ASSUMPTIONS (recorded, not silently guessed)

- #80 and #81 are merged and shipped; the implementation builds on the shipped T8/T9 surfaces exactly as mapped.
- A dev deployment exists and is ready for the Reticle and load-test runs — **verified** (OQ-5), not assumed.
- Retention values (90d/365d) are a decision recorded in code + runbook text (D5).
- The owner flag reason list is short and coded until real owner behavior argues otherwise.
- Client-reported rejection counts are accepted as best-effort for v1 (D4 design A), consistent with the anonymous `recordReceiptView` exposure and the "hypotheses" caveat on §4.4 thresholds.

## COMPLETION CHECKLIST

- [ ] All 16 tasks completed in order, each with its own validation command passing
- [ ] No regressions: full `npm test` / lint / build clean at Task 16
- [ ] Every acceptance criterion of Issue #84 has a task that satisfies it (traceable per SATISFIES notes)
- [ ] Evidence records exist: load-test file (with counter cross-check), a11y file, Reticle verdicts, retention dry-run test
- [ ] Runbook labels the client-reported counter limitation and the notifications-retained behaviour
