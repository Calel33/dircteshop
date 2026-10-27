# Alignment Report — Issue #79 Order protocol T5 (extended 8-state machine + expiry sweep)

## a. Header

- **Issue:** #79 — T5: extended 8-state machine + expiry sweep.
- **Branch:** `fast/order-protocol-t5-extended-8-state-machine-expiry-sweep`.
- **Status:** Tasks 1–5 implemented and staged (17 files); nothing is committed. The full plan checkpoint ran and passed:
  - `npm run lint` → exit 0, **0 errors**, 13 warnings, all in pre-existing classes (`max-lines`, `complexity`) — including three new `complexity` warnings on `convex/orders.ts` handlers that follow the file's existing handler pattern. No new error was introduced.
  - `npx convex dev --once` → exit 0, `✔ Convex functions ready!`, developing against `agile-husky-366` (dev). This push is what registers the 5-minute cron.
  - `npm test` → node runner `tests 648 / pass 648 / fail 0`; vitest `Test Files 8 passed (8)` / `Tests 112 passed (112)`; the `verify-state-machine.ts` prelude passed.
  - `npm run build` → exit 0, `✓ Compiled successfully`, TypeScript finished, 18/18 static pages.
- **Protocol source:** `docs/order-commitment-protocol.md` §6.1, §6.2, §7.2, §7.3.
- **Plan / AC source:** `tasks/fast-workflow-plan.md`, `tasks/fast-workflow-context.md` §24–29, `tasks/fast-workflow-research.md` (OQ-2..OQ-10).

| Task | Scope | State |
|---|---|---|
| 1 | Pure policy layer: `resolveOwnerDecision`, `EVENT_FOR_ACTION`, reason policy | done |
| 2 | `transitionOrderStatus` 6-action rework, D8 guard, owner event | done |
| 3 | `cancelOrder({token})`, `order_cancelled` notification kind | done |
| 4 | `convex/orderExpiry.ts` + 5-minute cron | done |
| 5 | Projections (`statusReason`, `statusUpdatedAt`) + this document | done |

**Verification commands and result counts**

| Command | Result |
|---|---|
| `pnpm exec vitest run convex/orders.test.ts convex/orderExpiry.test.ts` | `Test Files 2 passed (2)` / `Tests 81 passed (81)` |
| `node --test scripts/notifications.test.ts` | `tests 27` / `pass 27` / `fail 0` |
| `node --test scripts/order-transition-policy.test.ts scripts/order-commit-policy.test.ts scripts/order-policy.test.ts` | `tests 147` / `pass 147` / `fail 0` |
| `pnpm exec tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 — 0 errors, 13 warnings (all pre-existing classes) |
| `npx convex dev --once` | exit 0 — `✔ Convex functions ready!` (dev `agile-husky-366`) |
| `npm test` | node: `tests 648` / `pass 648` / `fail 0`; vitest: `Test Files 8 passed (8)` / `Tests 112 passed (112)` |
| `npm run build` | exit 0 — `✓ Compiled successfully`, TypeScript finished, 18/18 static pages |

## b. Acceptance criterion to test map

Source of each row: `tasks/fast-workflow-context.md` §24 (spec contract), §25 (gaps), §29 (AC to seam index), and `tasks/fast-workflow-research.md` OQ-5 (the two quoted AC sentences). No new AC is invented here.

| # | Acceptance criterion | Test (file > name) | Kind | Status |
|---|---|---|---|---|
| 1 | `accept` then `ready` then `complete` moves `new -> accepted -> ready -> completed`, with one event per step | `convex/orders.test.ts` > `owner protocol: accept, ready, complete each patch status and append one event` | vitest handler | covered |
| 2 | `decline` requires a reason; a missing or blank reason is `REASON_REQUIRED` | `convex/orders.test.ts` > `owner protocol: decline requires a reason and stores it on the order and event`; `scripts/order-transition-policy.test.ts` > `treats a blank reason as missing only when required` | vitest handler + node:test pure | covered |
| 3 | The decline reason is stored on the order row and the event row | `convex/orders.test.ts` > `owner protocol: decline requires a reason and stores it on the order and event` | vitest handler | covered |
| 4 | The decline reason is visible on the receipt and the owner board | `convex/orders.test.ts` > `owner protocol: the decline reason and transition time reach the receipt and the owner board`; `owner protocol: board rows without a stamp fall back to createdAt and a missing reason is null` | vitest handler | covered |
| 5 | Owner `cancel` works from `new`, `accepted`, and `ready`; the reason is required and limited to 1–200 characters | `convex/orders.test.ts` > `owner protocol: cancel covers new, accepted and ready and needs a reason` | vitest handler | covered |
| 6 | A 201-character reason is rejected with the reason limit message and writes nothing | `convex/orders.test.ts` > `owner protocol: decline requires a reason and stores it on the order and event`; `scripts/order-transition-policy.test.ts` > `rejects a trimmed reason past the maximum length` | vitest handler + node:test pure | covered with variance 2 |
| 7 | `noShow` is `ready`-only and stores the default reason `Not picked up` | `convex/orders.test.ts` > `owner protocol: noShow is ready-only and defaults the reason at write time` | vitest handler | covered |
| 8 | All five terminal states reject every action with `ORDER_TERMINAL` | `convex/orders.test.ts` > `owner protocol: the REVISED D1 terminal and decision-conflict matrix` | vitest handler | covered with variance 1 |
| 9 | A conflicting action in a non-terminal state is `INVALID_TRANSITION` | `convex/orders.test.ts` > `owner protocol: non-terminal conflicts stay INVALID_TRANSITION` | vitest handler | covered |
| 10 | Repeating the same action is `{reused: true}` with no second event | `convex/orders.test.ts` > `owner protocol: a double accept reuses the decision without a second event` | vitest handler | covered |
| 11 | Concurrent `accept` + `decline` has one winner; the loser gets `ORDER_ALREADY_DECIDED` | `convex/orders.test.ts` > `owner protocol: a decline observing an accepted order loses (D10)`; `owner protocol: concurrent accept and decline settle one winner and one conflict` | vitest handler | covered with variance 8 |
| 12 | `accept` on an expired order is `ORDER_EXPIRED` | `convex/orders.test.ts` > `owner protocol: accepting a due, unswept order throws ORDER_EXPIRED and writes nothing`; `owner protocol: the REVISED D1 terminal and decision-conflict matrix` | vitest handler | covered |
| 13 | Visitor `cancelOrder({token})` works only from `new`; a wrong token is `ORDER_NOT_FOUND` | `convex/orders.test.ts` > `visitor cancel: a new order becomes cancelled with one customer event and one owner notice`; `visitor cancel: an unknown token is ORDER_NOT_FOUND and writes nothing`; `visitor cancel: a token scoped to another business is ORDER_NOT_FOUND` | vitest handler | covered |
| 14 | Visitor cancel from `accepted`/`ready` is `CANNOT_CANCEL`; from `completed`/`declined`/`no_show` is `ORDER_TERMINAL`; from `expired` is `ORDER_EXPIRED` | `convex/orders.test.ts` > `visitor cancel: the status matrix rejects without touching the order` | vitest handler | covered with variance 6 |
| 15 | Visitor cancel on a due-but-unswept `new` order is `ORDER_EXPIRED` with no write | `convex/orders.test.ts` > `visitor cancel: a due, unswept order is ORDER_EXPIRED with no write` | vitest handler | covered with variance 5 |
| 16 | A repeat visitor cancel is idempotent: no event, no second notice | `convex/orders.test.ts` > `visitor cancel: a repeat is idempotent and never re-notifies` | vitest handler | covered |
| 17 | A legacy `new` order with no expiry row cancels normally | `convex/orders.test.ts` > `visitor cancel: a legacy new order with no expiry row cancels fine (OQ-9)` | vitest handler | covered |
| 18 | The owner gets an `order_cancelled` notice on visitor cancel | `convex/orders.test.ts` > `visitor cancel: a new order becomes cancelled with one customer event and one owner notice`; `scripts/notifications.test.ts` > `exposes exactly the frozen B5 lifecycle event types`, `builds the server-owned message for every event type` | vitest handler + node:test pure | covered |
| 19 | The sweep expires a due `new` order: reason, one `system` event, expiry row deleted | `convex/orderExpiry.test.ts` > `sweep expires a due new order, stamps the reason and appends one system event` | vitest handler | covered |
| 20 | An accepted order never expires; a stale row is deleted, status and ledger untouched | `convex/orderExpiry.test.ts` > `accepted orders never expire: the stale row is deleted, status and ledger untouched` | vitest handler | covered |
| 21 | Legacy `new` orders with no expiry row are never swept | `convex/orderExpiry.test.ts` > `a legacy new order with no expiry row is never swept` | vitest handler | covered |
| 22 | A not-yet-due row is untouched: status `new`, no event, row kept | `convex/orderExpiry.test.ts` > `a not-yet-due row is left alone: status new, no event, row kept` | vitest handler | covered |
| 23 | Duplicate rows expire the order once and are all removed | `convex/orderExpiry.test.ts` > `duplicate rows expire the order once and are all removed` | vitest handler | covered |
| 24 | One sweep is bounded to the 50 earliest-due rows, ascending | `convex/orderExpiry.test.ts` > `one sweep is bounded to the 50 earliest-due rows, ascending` | vitest handler | covered |
| 25 | The cron file registers exactly one 5-minute interval job for the sweep | `convex/orderExpiry.test.ts` > `crons registers exactly one 5-minute expiry sweep` | static assertion | covered with variance 3 |
| 26 | `expireOrder` works when called directly; a missing order clears its orphan row | `convex/orderExpiry.test.ts` > `expireOrder driven directly expires a due order`; `expireOrder on a missing order does not throw and clears its orphan row` | vitest handler | covered |
| 27 | Authz negatives stay green: unauthenticated and non-owner callers are rejected | `convex/orders.test.ts` > `unauthenticated callers cannot read the board or transition an order`; `a non-owner cannot read the board or transition an order` | vitest handler | covered |
| 28 | A cross-business order id is not found | `convex/orders.test.ts` > `owner protocol: another business's order id is invisible (S0 row 15)` | vitest handler | covered |
| 29 | Reason bounds: 1 character and 200 characters accepted, 201 rejected, the trimmed value is measured | `scripts/order-transition-policy.test.ts` > `accepts one character and exactly the maximum length`, `rejects a trimmed reason past the maximum length`, `measures the trimmed value, not the raw one` | node:test pure | covered with variance 2 |
| 30 | The reason vocabulary and the 60-minute expiry reason are fixed | `scripts/order-transition-policy.test.ts` > `pins the reason vocabulary`, `keeps the expiry reason keyed to the 60-minute TTL` | node:test pure | covered |
| 31 | Each owner action maps 1:1 to an `orderEvents.action` literal | `scripts/order-transition-policy.test.ts` > `maps each owner action 1:1 to its orderEvents.action literal` | node:test pure | covered |
| 32 | The 48-cell owner decision table is complete, and the four non-decision actions delegate to the frozen matrix | `scripts/order-transition-policy.test.ts` > `pins the eight statuses and the six owner actions`, `resolves every owner action from every status (48 cells)`, `delegates cancel/ready/complete/noShow to resolveOrderAction`, `the frozen legacy machine and 8 x 8 matrix still hold` | node:test pure | covered with variance 1 |
| 33 | Every move appends one event with the right actor, from/to status, and reason | Rows 1, 3, 13, 19 above assert `actorType`, `actorUserId`, `fromStatus`, `toStatus`, and `reason` | vitest handler | covered |
| 34 | The client sends an action and never a status (INV-11) | `convex/orders.test.ts` > `owner protocol: a wire status is rejected by argument validation (INV-11)` | vitest handler | covered |

**Note on row 4.** The two tests above assert projected values, not keys. The first drives a real decline with the clock advanced past `createdAt`, then checks `statusReason` on the `getOrderByToken` receipt and `statusReason` plus `statusUpdatedAt` on the `listOrders` board row (`statusUpdatedAt !== createdAt`). The second pins the legacy row: a row seeded with `createdAt` only projects `statusUpdatedAt === createdAt` and `statusReason === null`. The earlier receipt key-allowlist assertions remain, but they are not what proves this AC. These tests prove the data seam; no `app/` component reads `statusReason` yet, so rendering the reason on the receipt and owner board remains a separate, still-open UI gap.

## c. Recorded variances

### 1. D1 split and the narrowed terminal matrix

**Statement of record (verbatim):** the blanket terminal AC holds for 4/5 terminal states for `accept`; `(accept, declined)` is the single documented exception, required by the ALREADY_DECIDED AC — and `(decline, ready)` is a second documented exception.

Two resolvers exist, by design:

- `resolveOwnerDecision(status, action)` in `convex/orderPolicy.ts` handles `accept` and `decline`. It returns the narrow override map. Only `(accept, declined)` and `(decline, accepted)` are the race pairs the protocol sentence can produce. `(decline, ready)` is the same loser one step later. `(accept, expired)` is `ORDER_EXPIRED` per `protocol:844` and §7.3 test 16.
- `resolveOrderAction(status, action)` stays byte-identical (the frozen 8x8 matrix). `resolveOwnerDecision` delegates `cancel`, `ready`, `complete`, and `noShow` to it.

The alternative (a single blanket `ORDER_ALREADY_DECIDED` for every terminal pair) was rejected: it fails the explicit AC for seven pairs that no race can produce.

### 2. The 201-character reason has no dedicated code

`validateTransitionReason` returns `too_long`. The handler throws the `REASON_REQUIRED` envelope with `message = 'Keep the reason under 200 characters.'` (`convex/orders.ts` L289–294). The message is pinned by `convex/orders.test.ts` (decline and owner-cancel tests) and the boundary is pinned by `scripts/order-transition-policy.test.ts`.

### 3. Cron cadence is expected, not guaranteed

Interval runs can be skipped when the previous run is still executing (at most one run at a time). The sweep drains at a bounded rate, not a guaranteed rate. One sweep processes at most `SWEEP_BATCH = 50` rows (`convex/orderExpiry.ts` L20, L110).

### 4. The first cron run fires on deploy

`npx convex dev` pushes the cron registration, and the first interval run can start at once. This is a live dev side effect. The sweep is a no-op on rows that are not due. Put one line about this in the PR body.

### 5. D8: no lazy expiry

A due-but-unswept `new` order rejects with `ORDER_EXPIRED` and writes nothing. `transitionOrderStatus` (owner `accept`) and `cancelOrder` (visitor) both behave this way. Only the system sweep writes `expired`. The event ledger stays honest: an `expired` event always has `actorType: 'system'`.

### 6. D4 terminal-cancel mapping alternative

Visitor cancel maps `completed` / `declined` / `no_show` to `ORDER_TERMINAL`, and `expired` to `ORDER_EXPIRED`. The alternative (one `CANNOT_CANCEL` for all closed states) was rejected: `protocol:846` and `protocol:1297` name `ORDER_EXPIRED` explicitly, and `CANNOT_CANCEL` means "customer cancel after `new`" (`protocol:1298`).

### 7. OQ-10: `orders.expiresAt` is deferred

No code writes the field. No projection reads it. `orderExpiry.byOrderId` and `orderExpiry.byExpiresAt` stay the single source of truth. The schema field is not removed.

### 8. D10: the race proof

The in-repo test is winner-then-loser: the winner commits, the loser sees the new status, and the loser gets `ORDER_ALREADY_DECIDED`. `convex-test` serializes top-level transactions, so it cannot reproduce a true parallel OCC race. The real proof runs against a dev deployment with two parallel calls: `docs/order-commitment-protocol.md:1733-1742` (`accept` and `decline` in parallel; `accept` twice; `expire` and `accept` in parallel). Record the Convex request ids and the final rows.

### 9. Optional `accept` / `ready` cell preference

`(accept, ready)` returns `ORDER_TERMINAL`. The parent can change it to `ORDER_ALREADY_DECIDED` without touching any acceptance criterion. That cell is not a race pair the protocol sentence names, so `ORDER_TERMINAL` keeps the decision pair narrow.

### Execution notes (plan deviations)

- **E1 — Task 4 tests live in a new file.** The Task 4 behaviour tests and the static cron test live in `convex/orderExpiry.test.ts`, not in `convex/orders.test.ts`. Tasks 3 and 4 ran in parallel and would have collided in one file. `vitest.config.ts` L13 includes `convex/**/*.test.ts`, so the coverage is the same.
- **E2 — UI optimistic-patch guard.** `app/owner/business/[id]/orders-panel.tsx` L271-277 gained a type-only guard: the optimistic patch runs only for `accept`, `ready`, or `complete`. Widening the mutation action union made `nextOrderStatus`'s frozen `OrderAction` parameter reject the wider type. There is no rendered or behavioural change; the board only offers those three actions.
- **E3 — The photos panel test uses `node:test`.** `app/owner/business/[id]/photos-panel.test.ts` imports `node:test` (L10), and `vitest.config.ts` L13 includes only `convex/**/*.test.ts`. The plan's `pnpm exec vitest run app/owner/business/[id]/photos-panel.test.ts` command cannot work. Verification used `node --test "app/**/*.test.ts"` (142 pass).
- **E4 — Deleted business at notice time.** `cancelOrder` loads the business before it writes the owner notice (`convex/orders.ts` L869-872). A hard-deleted business throws `ORDER_NOT_FOUND` and the whole mutation rolls back. The alternative was a notice with no recipient.
- **E5 — `convex/tsconfig.json` gained `allowImportingTsExtensions: true`.** `npx convex dev --once` failed at HEAD (before this branch's runtime code) with four pre-existing `TS5097` errors (`convex/adminProjections.ts:4`, `convex/orderCommitPolicy.ts:28`, `:35`, `:41`): those modules must keep `.ts` import specifiers because the `node --test` type-stripping suites resolve them at runtime, but Convex's own tsconfig rejected them. The one-line flag is legal because `noEmit` is already set; it has no runtime or Next.js build effect (the flag is typecheck-only). Two further `TS2550` errors were T5's own — `Array.prototype.at(-1)` in `convex/orders.test.ts` under `lib: ["ES2021", "dom"]` — and were rewritten to index access with identical assertions. Proof: `npx tsc --noEmit -p convex/tsconfig.json` exits 0.

## d. Frozen surfaces statement

| Surface | Claim | Evidence |
|---|---|---|
| `scripts/order-commit-policy.test.ts` 8x8 matrix | untouched | `git diff --name-only -- scripts/order-commit-policy.test.ts scripts/order-policy.test.ts` -> empty |
| `scripts/order-policy.test.ts` legacy machine pin | untouched | same command: empty output |
| `ORDER_ACTIONS`, `ORDER_ACTION_TARGET`, `ORDER_ACTION_LABELS`, `nextOrderStatus`, `isLegacyOrderStatus` | untouched | `git diff HEAD --unified=0 -- convex/orderPolicy.ts \| Select-String "ORDER_ACTIONS\|ORDER_ACTION_TARGET\|ORDER_ACTION_LABELS\|nextOrderStatus\|isLegacyOrderStatus"` -> empty. The only hunk is additive: `@@ -271,0 +272,123 @@` after `resolveOrderAction`. |
| `submitOrder`, `getOrderStatus`, `placeOrder`, `getOrderByToken` | bodies untouched | `git diff HEAD --unified=0 -- convex/orders.ts \| Select-String "submitOrder\|getOrderStatus\|placeOrder\|getOrderByToken"` -> one hunk header (`@@ -712,0 +799,96 @@ ... getOrderByToken`, the insertion point of the new `cancelOrder`) and one added doc-comment line. No body line changes. |
| `listOrders` | body untouched | `git diff HEAD --unified=3 -- convex/orders.ts`: the listOrders hunk region ends at `@@ -240,39 +248,114 @@` and only adds code after the closing `});`. |
| `convex/schema.ts` | no change | `git diff --name-only -- convex/schema.ts` -> empty |
| Projections | additive only | `projectOrderRow` L197-198 and `projectOrderReceipt` L412 add two and one field. No existing field, order, or format changed. |

## e. Verification log

Run on 2026-10-25 in `D:\Dev\dircteshop-1` on branch `fast/order-protocol-t5-extended-8-state-machine-expiry-sweep`.

```
pnpm exec vitest run convex/orders.test.ts convex/orderExpiry.test.ts
  Test Files  2 passed (2)
  Tests       81 passed (81)

node --test scripts/notifications.test.ts
  tests 27
  pass 27
  fail 0

node --test scripts/order-transition-policy.test.ts scripts/order-commit-policy.test.ts scripts/order-policy.test.ts
  tests 147
  pass 147
  fail 0

pnpm exec tsc --noEmit
  TSC_EXIT=0
```

The full plan checkpoint was then run in the same tree:

```
npm run lint
  EXIT=0  0 errors, 13 warnings (all pre-existing classes: max-lines, complexity)

npx convex dev --once
  EXIT=0  ✔ Convex functions ready!  (dev: agile-husky-366)

npm test
  verify-state-machine.ts  passed
  node --test  tests 648 / pass 648 / fail 0
  vitest       Test Files 8 passed (8) / Tests 112 passed (112)

npm run build
  EXIT=0  ✓ Compiled successfully  (TypeScript finished, 18/18 static pages)
```

Notes:

- The `pnpm` wrapper prints a pre-existing `tsconfig.json` duplicate-key warning (`allowImportingTsExtensions` declared twice). It does not fail the run.
- The Task 5 diff is `convex/orders.ts` (two projections), `convex/orders.test.ts` (two allowlist arrays plus the three projection/INV-11 tests added to close rows 4 and 34), and this file. Tasks 1–4 remain uncommitted in the same working tree.
- The four plan-checkpoint commands (`npm run lint`, `npx convex dev --once`, `npm test`, `npm run build`) passed as logged above. The working tree is staged (17 files); nothing is committed.
