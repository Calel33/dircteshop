# Issue #84 — Context Map: Order protocol T10 (measurement + hardening + runbook)

Read-only exploration. Every claim below was read from the listed `file:line`. No source file was modified.

**Task contract:** TYPE = research/context · TARGET = order-protocol measurement, owner flag, load test, runbook, a11y · GOAL = factual map for the planning node · DONE-WHEN = this file exists with verifiable references.

---

## 1. Repo shape (bounded to this issue)

| Area | Location | Relevance here |
|---|---|---|
| Convex backend | `convex/` (schema, order domain, authz, crons, internal migrations) | metrics query, owner flag mutation, retention/guard |
| Pure policy modules | `convex/orderPolicy.ts`, `convex/orderCommitPolicy.ts`, `convex/orderThrottle.ts` | state/action unions, constants, throttle math |
| Next.js App Router UI | `app/`, `components/` | receipt + board a11y; owner analytics panel stub |
| Dev-deployment harness | `convex/devProof.ts` + `scripts/order-concurrency-proof.ts` | the existing load/concurrency pattern to extend |
| Docs | `docs/order-commitment-protocol.md`, `screens/SPEC.md` §7.1 | spec sections §4.4/§4.5/§6.7/§6.8/§7.2 S5 |
| Tests | `convex/**/*.test.ts` (vitest + `convex-test`), `scripts/**/*.test.ts` (node --test) | correctness + authz negatives |
| Evidence records | `tasks/issue-81-concurrency-evidence.md`, `docs/alignment/issue-*.md` | house format for proof artifacts |

Stack: TypeScript, Node >= 22.6, Next 16.3.5, React 19.2, Convex 1.31.2 (installed 1.46.0), Clerk, Tailwind v4, pnpm.

---

## 2. Relevant files

### 2.1 Implementation (existing, will be extended)

| File | Responsibility | Key lines |
|---|---|---|
| `convex/schema.ts` | all tables/indexes | `orders` table ends L256 (`byBusinessId` L252, `byBusinessIdStatus` L256); `orderAccess` L260-269; `orderIdempotency` L272-280; `orderExpiry` L284-290; **`orderEvents` L293-312** (index `byOrderIdCreatedAt` only, L312); `orderThrottle` L315-319 (`byKey`); `orderBlocks` L322-332; `auditLogs` L364-382; `notifications` L384-402 |
| `convex/orders.ts` | order surface | `ORDER_LIST_LIMIT = 100` L55; `submitOrder` L111; `listOrders` L306 (owner guard L314); `listOrderCounts` L377; `transitionOrderStatus` L451; `getOrderStatus` L560; `placeOrder` L787; `getOrderByToken` L995; `cancelOrder` L1031 |
| `convex/orderEvents` insert sites | append-only ledger writes | transition L535-545; `placeOrder` L945-952; `cancelOrder` L1079; expiry `convex/orderExpiry.ts:79-87` |
| `convex/orderBlocks.ts` | owner abuse controls (T9) | `blockContact` L77-134; `unblockContact` L144-192; `clearContactThrottle` L211+; `listBlocked` L284; each behind `requireBusinessOwnerUser` + one `auditLogs` row, masked `targetName` (`maskedContactLabel` L41-51, `ownerActionError` L54-58) |
| `convex/orderThrottle.ts` | fixed-window counters | `BUSINESS_THROTTLE_WINDOW_MS` L54; `claimBusinessThrottle` L76-120; `contactThrottleKeys` L134-142; `claimContactThrottle` L247-284; `assertContactNotBlocked` L304-323 |
| `convex/orderCommitPolicy.ts` | constants + pure policy | `DEFAULT_TTL_MS = 3_600_000` L57; `CONTACT_THROTTLE_10M = 3` L62; `CONTACT_THROTTLE_24H = 10` L63; `CONTACT_THROTTLE_WINDOW_24H_MS` L70; `BUSINESS_THROTTLE_10M = 60` L71; error catalog `ORDER_ERRORS`, `validateTransitionReason` L1237-1246 |
| `convex/orderPolicy.ts` | state/action unions + resolution | `ORDER_STATUSES` L13; `ORDER_ACTIONS` L37; `ORDER_DB_STATUSES` L186; `ORDER_PROTOCOL_ACTIONS` L198; `ORDER_OWNER_ACTIONS` L292; `resolveOwnerDecision` L352-363 |
| `convex/orderExpiry.ts` | TTL sweep | `SWEEP_BATCH = 50` L20; `expireOrderAt` L47-91; `expireOrder` L94; `sweepExpiredOrders` L102-123 |
| `convex/orderThrottleCleanup.ts` | daily bounded cleanup | `CLEANUP_BATCH = 200` L26; `cleanupStaleThrottleRows` L29-47 |
| `convex/crons.ts` | schedules | 5-min expiry sweep L7; daily throttle cleanup L11-15 |
| `convex/authz.ts` | owner/admin guards | `requireBusinessOwner` L56-59; `requireBusinessOwnerUser` L67-88; `requireSuperAdmin` L27-47 |
| `convex/adminQueries.ts` | aggregate query precedent | `countRows` streaming helper L35-42; `overviewStats` L59-92 |
| `convex/devProof.ts` | run-scoped probe fixtures | `seedProbe` L256, `createProbeOrder` L326, `forceDueExpiry` L363, `dumpProbe` L407 (returns orders/orderEvents/notifications/orderIdempotency/orderThrottle/orderBlocks + counts), `cleanupProbe` L502 |
| `app/owner/business/[id]/orders-panel.tsx` | owner board UI | `OrdersBoard` L405-676; `runTransition` L493-531; `runContactAction` L548-594; `OrdersPanel` L684-700 |
| `app/owner/business/[id]/orders-panel-dialogs.tsx` | owner dialogs | `DECLINE_REASONS = ['Sold out','Unreachable','Too busy','Duplicate','Other']` L49; no-show default L636 |
| `app/owner/business/[id]/editor-section-body.tsx` | section router | `AnalyticsPanel` stub L38-63 (`ANALYTICS_STATS` L31, renders `—` placeholders); `ORDERS_SECTION → <OrdersPanel>` L164-166 |
| `components/order/basket-panel.tsx` | customer commit | `useMutation(api.orders.placeOrder)` L180; submit call L341 |
| `components/order/receipt.tsx` | receipt UI | `StatusStepper` L105-149; `ReceiptView` L170-450; `handleCancel` L212-232; `ReceiptLive` L467-478 |
| `app/order/[token]/page.tsx` | receipt route | `fetchQuery(api.orders.getOrderByToken, { token })` L29 |
| `scripts/order-concurrency-proof.ts` | real-deployment harness | scenario runner L1192-1234; `placeOrderAttempt` L701-884; `dumpProbe` L631-637; `renderEvidence` L1450-1657; `main` L1675-1806 (reads `NEXT_PUBLIC_CONVEX_URL`, runs `devProof:seedProbe`, writes evidence to `tasks/`) |

### 2.2 Tests (patterns to extend)

| File | Coverage |
|---|---|
| `convex/orders.test.ts` | handler suite; harness L16-44 (`convexTest(schema, modules)`, `vi.useFakeTimers({toFake:['Date']})`), `seed()` L69-171, owner identity via `t.withIdentity({subject:'user_owner'})`; basket/commit L847+; owner transitions L2087+; board pagination L2974+ |
| `convex/orderBlocks.test.ts` | owner-only negatives L297-412, audit-row assertions L485-547, hash-only privacy L746-823 |
| `convex/orderThrottle.test.ts` | window limits/reset L140-255, key hygiene L358, cleanup bounds L407-469 |
| `convex/orderExpiry.test.ts` | sweep semantics L146-375, cron registration L429 |
| `scripts/order-commit-policy.test.ts`, `scripts/order-policy.test.ts`, `scripts/order-transition-policy.test.ts` | pure matrices via `node --test` |
| `scripts/card-muted-contrast.test.ts` | existing contrast-token assertion (only a11y-adjacent test found) |

### 2.3 Documentation

| Doc | Relevant sections |
|---|---|
| `docs/order-commitment-protocol.md` | §4.4 escalation thresholds table L658-666 ("what would change the recommendation"); §4.5 measurement plan L668-686 (event list, metric list, privacy); §6.6 thresholds/cost model L1356-1403; §6.7 UX + interaction rules L1405-1445 (**a11y rule L1444**); §6.8 owner workflow incl. **daily checklist L1506-1512**, pause/hours/86 L1487-1493, no-push L1497-1498, business deletion L1504; §7.2 **S5 L1639-1651** (files, schema note, tests, rollout, rollback); §7.3 layers L1669-1678, concurrency L1740-1749; §8.4 production failures L1926-1934; INV-30 L326, E68 L276, E74 L282 |
| `screens/SPEC.md` | §7.1 order-flow decision record L126-151 |
| `docs/alignment/issue-81.md` | T9 delta inventory L12-25 (what already shipped) |
| `tasks/issue-81-concurrency-evidence.md` | evidence artifact format L1-70 (verdict table, scenario tables, OCC fields) |
| `tasks/issue-82-context.md` | prior context-doc format/style |

---

## 3. Current state of each T10 deliverable

### 3.1 Metrics query — does not exist

- No file or symbol matching `metrics|latency|p95|percentile` exists under `convex/` (graft grep over 69 indexed files: no hits).
- The only aggregate query precedent is `convex/adminQueries.ts:59-92` (`overviewStats`): `requireSuperAdmin` first, then `countRows` streaming an index range, never `.collect()`; documented policy is "fail visibly, never a false total" (L20-23).
- `orderEvents` (`schema.ts:293-312`) is the only transition ledger: `{orderId, businessId, actorType, actorUserId?, action, fromStatus?, toStatus, reason?, createdAt}`. **It has no `byBusinessId`/`byBusinessIdCreatedAt` index** — only `byOrderIdCreatedAt` (L312). A per-business aggregate over events either needs a new index (schema change) or a fan-out via `orders.byBusinessId` → per-order event reads.
- `orders` is indexed by `byBusinessId` and `byBusinessIdStatus` only (`schema.ts:252,256`) — no `createdAt` index on `orders`.
- Latency (submit→accept) is derivable only by pairing a `submitted` event with the following `accepted` event per `orderId` (`orderEvents.reason`/`createdAt`), or from `orders.createdAt` vs `orders.statusUpdatedAt` (`schema.ts:239,235`). There is no stored latency field.
- Decline-reason mix is a string group: reasons are written as free text from the coded UI list `DECLINE_REASONS` (`orders-panel-dialogs.tsx:49`), stored on both `orders.statusReason` and the event `reason`.
- Receipt views are **not recorded anywhere**: `app/order/[token]/page.tsx:29` and `components/order/receipt.tsx` only read `getOrderByToken`; there is no customer-side event table and `orderEvents.action` has no `receipt_viewed` member (`schema.ts:298-307`).
- No PII is carried by events today (no phone/email/ip fields), consistent with §4.5 "aggregate only".

### 3.2 Owner fake-order flag — no action exists

- `transitionOrderStatus` accepts `accept|decline|cancel|ready|complete|noShow` only (`orders.ts:455-462`); resolution via `resolveOwnerDecision` (`orderPolicy.ts:352-363`). Issue text and S5 both forbid overloading this union (protocol L1645).
- `orderEvents.action` union is also closed: `submitted|accepted|declined|cancelled|ready|completed|expired|no_show` (`schema.ts:298-307`). Adding `owner_flagged` is a schema union change; the spec's alternative is a new table (`orderFlags`/`orderFeedback`, protocol L1645).
- Owner-flag audit precedent: every owner abuse action writes exactly one `auditLogs` row inside the same transaction (`orderBlocks.ts:120-130,179-188`), with masked `targetName`.
- Denormalized "abuse rate" would need a count of distinct flagged orders ÷ `submitted` events; both are derivable from whichever store is chosen.

### 3.3 Load test — harness exists, but for 4 concurrency scenarios, not 100-way burst

- `scripts/order-concurrency-proof.ts` already: reads `NEXT_PUBLIC_CONVEX_URL` (L1678), seeds via `devProof:seedProbe` (L1709), drives `ConvexHttpClient` mutations with `skipQueue` (`timedHttpMutation` L383-438), captures `convex logs --jsonl` (`startLogCapture` L444-513), joins calls to log records (L543-625), asserts row deltas (L701-884), renders a markdown evidence file, and exits non-zero on failure (L1785-1805).
- Its `dumpProbe` fixture covers one business/one item only (`convex/devProof.ts:114-167`); a 10-business × 100-concurrent test needs either a widened `seedProbe` or a new seed module.
- Idempotency/duplicate protection already proven: same key + same args returns the winner's receipt and writes exactly 1 order/1 event/1 idempotency row (`orders.ts:838-846,889-897`; evidence `tasks/issue-81-concurrency-evidence.md:27-58`).
- Throttle limits that a burst will hit: business 60/10 min (`orderCommitPolicy.ts:71`), contact 3/10 min and 10/24 h (`:62-63`), so 100 concurrent submissions on one business *cannot* all succeed — the test design must account for `TOO_MANY_REQUESTS` as an expected outcome, not a failure.
- OCC observability already exists: `LogRecord.occInfo` / `willRetry` (`scripts/order-concurrency-proof.ts:84-97`) and the BLOCKED verdict when no conflict is observed (L1747-1767).

### 3.4 Runbook — `docs/order-runbook.md` does not exist

- `docs/` contains `validation/`, `migrations/`, `handoffs/`, `bugs/`, `alignment/` only (glob `docs/**/*.md`); no runbook file.
- Source material already in spec: daily checklist (protocol L1506-1512), pause/hours/86 recovery (L1487-1493), throttle false-positive path (L1635, §8.4 L1931, `clearContactThrottle` `orderBlocks.ts:211+`), no-push limitation (L1497-1498), business-deletion warning (L1504), retention example (L282, INV-30 L326).
- **Hard-delete contradiction that the runbook must state or the plan must fix:** `convex/businesses/adminDeletion.ts:31-40` lists `'orders'` in `HARD_DELETE_CHILD_TABLES`, and `cascadeHardDeleteBusiness` deletes every order row (L251-253). It does **not** touch `orderEvents`, `orderAccess`, `orderExpiry`, `orderThrottle`, or `orderBlocks` — so a hard delete destroys order history while orphaning its ledger. Protocol INV-30/E68 require *no cascade* of order history.
- Retention precedent for a bounded delete job: `convex/orderThrottleCleanup.ts:22-47` (`internalMutation`, `take(CLEANUP_BATCH)`, oldest-first via default `_creationTime`, no new index) and `convex/orderExpiry.ts:101-123` (`SWEEP_BATCH`, `byExpiresAt` asc). Cron registration pattern: `convex/crons.ts:7-15`.
- Retention example values in spec: declined/cancelled 90 days, completed 1 year (protocol L282); commented as "not implemented v1".

### 3.5 Accessibility audit — no audit artifact exists

- The binding rule is protocol **§6.7 L1444**: `aria-live="polite"` for status changes; focus to the error summary; errors associated with fields; status as text + icon (not colour alone); honour `prefers-reduced-motion`; stepper is a list with `aria-current="step"`; receipt has logical heading order. Plus §6.7 L1443 (44×44 targets, text-labelled steppers, no hover-only actions).
- Existing a11y idioms already in place (graft grep over `components/order`): `BasketPanelBody` `role="status" aria-live="polite"` (`basket-panel.tsx:410`), `BasketPanelError` `role="alert"` (`:93`), `OrderingPausedBanner` `role="status"` (`basket-controls.tsx:162`), `QuantityStepper` `role="group" aria-label` + `sr-only` (`:26-46`), `StatusStepper` `aria-label="Order status"` + `sr-only (current step)` (`receipt.tsx:113,141`), `ReceiptView` three `aria-labelledby` sections and a polite live region (`:263,275,316,383`).
- Board-side equivalents: `app/owner/business/[id]/orders-panel.tsx` live region `boardStatusLine` L145-150, `aria-busy` on pending dialogs, `BlockContactDialog` labelled textarea (`orders-panel-dialogs.tsx`).
- Only a11y-adjacent automated test is `scripts/card-muted-contrast.test.ts`; there is no axe/jest-axe dependency in `package.json` (devDeps L63-88) and no a11y test runner.
- Manual/E2E path available: Reticle is installed (`@reticlehq/next`, `@reticlehq/react` in devDeps L67-68) with saved flows under `.reticle/flows/elite-next-starter-0991ad35/` (e.g. `b8-direct-item-order.json`); `AGENTS.md` requires a Reticle verdict for user-visible changes.
- No dedicated `/analytics` owner route: analytics lives only as the `AnalyticsPanel` stub inside the editor (`editor-section-body.tsx:38-63,152-154`).

---

## 4. Patterns the implementation must follow

1. **Owner auth first, before any read.** Queries use `requireBusinessOwner(ctx, businessId)` (`orders.ts:314`); mutations that need the actor use `requireBusinessOwnerUser` (`orders.ts:466`, `orderBlocks.ts:85`). Authz negatives are explicit tests (`orderBlocks.test.ts:297-412`).
2. **Error envelope:** protocol path throws `ConvexError({ code, message })` built from `ORDER_ERRORS` (`orders.ts:632-647`, `orderBlocks.ts:54-58`). Legacy `submitOrder` keeps plain-string errors.
3. **Aggregate reads never `.collect()`**; stream with the async iterator helper (`adminQueries.ts:35-42`) or a bounded `.take(n+1)` with a `capped` flag (`orders.ts:382-394`); document any deliberate deviation from the Convex `@convex-dev/aggregate` guidance (`orders.ts:365-375`).
4. **One write + one audit row per owner action, no-op when unchanged** (`orderBlocks.ts:120-130`; `inventory` pattern in `supplyAudit.ts`).
5. **Bounded internal jobs** with a batch constant, oldest-first, no new index unless required, registered in `crons.ts` (`orderThrottleCleanup.ts:22-47`, `crons.ts:11-15`).
6. **Handler tests** use `convexTest(schema, import.meta.glob('./**/*.ts'))`, fake `Date` only, `t.run` for seeding, `t.withIdentity({subject:'user_owner'})` for owner calls (`orders.test.ts:16-44,69-171`).
7. **Evidence artifacts** are markdown with a verdict table, per-scenario assertions, and the command + deployment header (`tasks/issue-81-concurrency-evidence.md:1-16`).
8. **Design tokens only** in UI (`bg-card`, `text-card-muted`, `rounded-control`, `gap-gap`, `text-micro`, `p-card`); no raw hex/px except small details (AGENTS.md rule 10; examples in `editor-section-body.tsx:28-31`).
9. **Docs cite spec sections** (`§6.2.6`, `:1573`) and use "do not fabricate numbers" placeholder style (`editor-section-body.tsx:33-37`).

---

## 5. Constraints and limits

- **Commands** (`package.json:9-22`): `npm run dev`, `npm run build`, `npm run lint` (eslint), `npm test` = `node scripts/verify-state-machine.ts && node --test "app/**/*.test.ts" "lib/**/*.test.ts" "scripts/**/*.test.ts" && vitest run`; `vitest.config.ts:12-14` scopes vitest to `convex/**/*.test.ts` under `edge-runtime`. Convex needs `npx convex dev` in a second terminal (`convex/AGENTS.md`).
- **Generated code is never hand-edited:** `convex/_generated/` (CLI codegen). New functions change `api.d.ts` on codegen.
- **Schema changes have no migration step in S5** except the optional flag table / index (protocol L1645); existing tables ship plain indexes (comment at `schema.ts:253-255` explains why a plain index was acceptable there).
- **Load test target is a dev deployment** and needs `NEXT_PUBLIC_CONVEX_URL` + a seeded probe; the harness shells out to `convex run`/`convex logs` and writes evidence outside the repo's test run (`scripts/order-concurrency-proof.ts:1678-1745`).
- **Throttle ceiling** (60/business/10 min, 3/contact/10 min) makes "100 concurrent successes" impossible for one business — cross-business fan-out or expectation of rejections is required (§3.3).
- **Retention vs hard delete currently conflict** (§3.4) — the doc deliverable must either record the limitation or the plan must add the guard.
- **No a11y dev dependency** (no axe); the audit is a recorded manual/pass artifact, not an automated suite.
- **graft graph is stale** for 3 files (`convex/orderBlocks.ts`, `convex/orders.ts`, `convex/schema.ts` — `graft check` reports STALE); line numbers above were read from the working tree, the graph refreshed on each query.

---

## 6. Dependencies

**Inbound (what depends on the touched surfaces):**

- `listOrders` / `listOrderCounts` → `app/owner/business/[id]/orders-panel.tsx` (`OrdersBoard`, filter bar, counts chips).
- `transitionOrderStatus` → `orders-panel.tsx:493-531`; `blockContact`/`unblockContact`/`clearContactThrottle` → `runContactAction` L548-594.
- `placeOrder` → `components/order/basket-panel.tsx:180,341`; `getOrderByToken` → `app/order/[token]/page.tsx:29` and `components/order/receipt.tsx`.
- `events` ledger → `convex/supplyAudit.ts:6-7` explicitly distinguishes supply toggles (`auditLogs`) from board transitions (`orderEvents`) — a new analytics read must not blur that.
- `orderEvents` also read by `convex/devProof.ts:407-464` (counts) and `convex/orderExpiry.ts:79` (writes).
- Hard delete (`convex/businesses/adminMutations.ts:80-107` → `adminDeletion.ts:188-269`) determines whether order history survives.

**Outbound (what the new work will depend on):**

- `convex/authz.ts` guards; `convex/orderCommitPolicy.ts` constants/error catalog; `convex/orderPolicy.ts` action unions; `convex/schema.ts` indexes.
- `convex/devProof.ts` fixtures (would need widening for 10 businesses).
- Test harness conventions in `convex/orders.test.ts`, `convex/orderBlocks.test.ts`.
- Docs: `docs/order-commitment-protocol.md` §4.4/§4.5/§6.7/§6.8/§7.2 S5 as the normative source.

---

## 7. Unknowns (material to planning only)

1. **Whether `orderEvents` gets a `byBusinessIdCreatedAt` index or metrics fan out per order** — no decision in the repo; both are supported by existing patterns, and the index is the cheaper read but a schema change.
2. **Whether the owner flag is a new table or a widened `orderEvents.action` union** — spec allows either (protocol L1645) and forbids overloading `transitionOrderStatus`; no existing artifact chooses.
3. **How `receipt_viewed` is captured at all** — no customer-side event table exists and receipt reads are anonymous; §4.5 lists the event but nothing in the schema can store it today.
4. **Whether the hard-delete cascade is fixed in this issue or only documented** — INV-30 requires a guard; S5 lists only a "hard-delete guard note". Current code deletes orders (`adminDeletion.ts:36,251-253`).
5. **Retention window values** — spec gives "e.g. 90 days / 1 year" (L282) as an example to decide and record; no repo constant exists.
6. **Whether a load test can run in this environment** — `NEXT_PUBLIC_CONVEX_URL` and a dev deployment are prerequisites; `docs/alignment/issue-81.md:27` records the previous run's 700/183 counts but that evidence came from a live deployment.

---

## 8. Where the a11y audit evidence would live

No existing convention for audit notes under `docs/`. Nearest precedents: `docs/validation/*-report.md` (evidence reports) and `tasks/issue-*-concurrency-evidence.md` (proof artifacts). Either location matches house style; the issue names no path.

---

### Provenance

Read this session: `convex/schema.ts` (200-403), `convex/orders.ts` (100-179, 300-459, 460-589, 770-999), `convex/orderBlocks.ts` (1-240), `convex/orderThrottle.ts` (skeleton), `convex/orderCommitPolicy.ts` (skeleton), `convex/orderPolicy.ts` (skeleton), `convex/orderExpiry.ts` (92-123), `convex/orderThrottleCleanup.ts` (1-47), `convex/crons.ts` (1-17), `convex/adminQueries.ts` (1-120), `convex/orders.test.ts` (1-244), `convex/businesses/adminDeletion.ts` (1-269), `convex/businesses/adminMutations.ts` (60-139), `convex/devProof.ts` (symbol map), `scripts/order-concurrency-proof.ts` (1650-1809 + skeleton), `app/owner/business/[id]/editor-section-body.tsx` (1-179), `components/order/basket-panel.tsx` (160-259), `package.json`, `vitest.config.ts`, `docs/order-commitment-protocol.md` (619-698, 1405-1520, 1625-1704, 1926-1965), `screens/SPEC.md` (119-163), `tasks/issue-82-context.md` (1-120), `tasks/issue-81-concurrency-evidence.md` (1-70), `docs/alignment/issue-81.md` (1-60). Not read: full `order-policy` test bodies, full dialogs file, `screens/wayfinder/build/B12-order-basket.md`.
