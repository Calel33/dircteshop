# Order Commitment Protocol

**Repository:** `D:\Dev\dircteshop-1`
**Branch:** `fix/issue-73-order-protocol-t1-land-s0-handler-regression-suite-protocol-doc`
**HEAD:** `723a7f3`
**Date:** 2026-10-20
**Brief:** `prompts/003-order-commitment-protocol.md`
**Status:** Design and verification plan complete. One tested slice added (staged on the issue branch, not yet committed): `convex/orders.test.ts` (10 handler-level tests). **No production behavior changed.**

> **Reading key.** "Today" means the code at HEAD `723a7f3`. "B12" means `screens/wayfinder/build/B12-order-basket.md`, an untracked design record. B12 is **prior art, not a decision**; this report tests its premises and disagrees with it where the evidence or the code says so. "Proposed" means this report's recommendation.

**Contents:** [1. Ground truth](#1-ground-truth-with-citations) · [2. Actors and journeys](#2-actors-capabilities-and-journeys) · [3. Edge cases](#3-edge-case-and-abuse-matrix) · [4. Research](#4-research-findings) · [5. Options](#5-options-and-recommendation) · [6. Protocol](#6-protocol-specification) · [7. Plan and tests](#7-phased-plan-and-test-plan) · [8. Risks and decisions](#8-risks-resolved-decisions-and-what-is-not-verified) · [9. Evidence](#9-evidence-log) · Appendices A–B

---

## Verdict

The current order flow is a **single-item request**, not a commitment protocol. It works for the narrow happy path: an anonymous visitor customizes one menu item, submits name plus phone or email, the order is stored as `new`, and the owner advances it through `accepted → ready → completed` (`convex/orders.ts:71-200`). It does not support multiple items, quantities, cancellation, rejection, expiry, a durable receipt, a price snapshot, idempotent retry, any business-level or group-level supply switch, an opening-hours gate, or any abuse control. Those are not polish gaps; they are the missing parts of the protocol.

B12 describes the right problem and much of the right shape, but it is not implemented. The schema, state machine, public UI, owner board, and tests are still B8's single-item model (`convex/schema.ts:183-203`, `convex/orderPolicy.ts:12-37`). B12 also contains a schema contradiction (it says legacy fields remain, then omits them from the proposed table at `B12-order-basket.md:77-120`) and relies on an unverified 24% statistic (`B12-order-basket.md:249`). It cannot be treated as an approved specification.

**Recommendation: Option B, Balanced** — guest multi-item basket, server-side pricing and validation, idempotent commit, durable token receipt, explicit failure states, owner accept/decline/cancel, item/group/business/hours kill switches, per-contact and per-business throttles, and an append-only order event log. **No deposit or account wall in v1.** The owner's explicit "accept = I verified this order" step is the fraud screen, but it is a hypothesis to measure, not a proven control. Option C (deposit/verification/reputation) is deferred until the measured fake-order rate justifies its conversion cost.

**What was actually added:** a permanent handler-level regression suite at `convex/orders.test.ts` (10 tests, all passing, staged on the issue branch). It drives the real Convex handlers and `requireBusinessOwner` through `convex-test`; it changes no runtime behavior. This is slice 0 of the plan and the safety net for the schema expand. The scratch characterization suite that reproduced the gaps was moved out of the repository to `C:\Users\calvi\AppData\Local\Temp\opencode\orders.gap.test.ts`; nothing was deleted from the repository.

### Definition of Done — honest status

| DoD item                                                                                      | Verdict                                      | Evidence                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A competent engineer can implement slice 1 from the spec without asking a clarifying question | **PASS**                                     | §7.2 specifies files, functions, schema, errors, tests, rollout, rollback                                                                                                                                                                                                                                       |
| Every P0 invariant has a passing test                                                         | **FAIL**                                     | 27 pure policy + 10 handler tests pass, but they prove today's 4-state policy and authz/availability only. The proposed P0s (idempotency, server pricing, token receipt, terminal states, kill switches) are not implemented, so they have no passing test. §6.3 names every test that must accompany them.     |
| Authorization and kill switches are proven by direct backend calls, not just UI               | **PARTIAL — authz PASS, kill switches FAIL** | Authz negatives pass at the handler seam (`convex/orders.test.ts`). No kill switch exists to test (`acceptingOrders`, group availability, hours gate absent).                                                                                                                                                   |
| The abuse mechanism is costed: deterrence, friction, measurement                              | **PASS (estimates labeled)**                 | §6.6; owner-call time and thresholds are hypotheses, not measured facts                                                                                                                                                                                                                                         |
| Every material claim is cited; every uncertainty labeled                                      | **PASS**                                     | Repo claims carry `file:line`; external claims carry URL, title, date/access date, passage. §8.3 lists 18 `UNVERIFIED` items (U1–U18); §8.2 records 16 resolved implementation decisions (Q1–Q16).                                                                                                              |
| Lint, typecheck, build, and tests pass; one E2E flow verified or `UNVERIFIED`                 | **PARTIAL — build/typecheck green, E2E `UNVERIFIED`** | Lint passes (0 errors, 4 pre-existing warnings). 527 Node tests (which include the 27 order-policy tests) + 10 handler tests pass. Typecheck and build are green on this tree as of the 2026-10-20 review (`tsc --noEmit` exit 0; `pnpm build` exit 0, compiled successfully) — the earlier failures were an incomplete `node_modules`, since repaired. E2E is still `UNVERIFIED` (no Reticle session). |

The overall DoD is therefore **not met**. The brief explicitly permits the design-plus-plan deliverable, and the stop conditions justify not making a schema-changing landing: the checkout is broken, the dev server cannot compile, the tree contains unrelated uncommitted user work, and the product decisions below are working defaults, not validated by a running implementation. Claiming a green implementation would be false.

> **Landing update (2026-10-20 code review).** The environment the FAIL verdicts below describe (incomplete `node_modules`) has since been repaired. On the current tree: typecheck exit 0, production build exit 0 (18/18 routes), lint 0 errors, and the full test suites pass. The build/typecheck rows are kept verbatim below as the historical record of that earlier run. The DoD still stands at not-met for this deliverable: the protocol itself is not implemented and E2E is `UNVERIFIED` — those, not the environment, are what the verdict tracks.

---

# 1. Ground truth, with citations

## 1.1 Current-state map

| Layer                             | Entry point                                   | Function / route                                                                                                                | Table(s)                                            | State change                                                       | Guard                                                                                                                                                                                                                                                |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public profile page               | `GET /business/[id]`                          | `app/business/[id]/page.tsx:58-91`; `getPublic` (`convex/businesses/queries.ts:49-61`)                                          | `businesses`, `categories`                          | none                                                               | Approved listing only: `queries.ts:58-60` returns `null` for any status other than `approved`                                                                                                                                                        |
| Menu read                         | `GET /business/[id]` (client subscription)    | `menus.listForBusiness` (`convex/menus.ts:369-383`)                                                                             | `businesses`, `menuGroups`, `menuItems`, `_storage` | none                                                               | Approved listing only: `menus.ts:374-376`; public projection omits `businessId`, `imageStorageId`, `ordering` (`menus.ts:346-367`)                                                                                                                   |
| Order panel mount                 | Vertical module `orderingPanel`               | `app/business/[id]/page.tsx:78-88`; `OrderingPanel` (`components/profile/ordering-panel.tsx:325-335`)                           | none                                                | none                                                               | Vertical config, not authorization                                                                                                                                                                                                                   |
| Item selection                    | `#order-<itemId>` hash, or the "Order" button | `components/profile/ordering-panel.tsx:160-215`; `components/profile/ordering-panel-sections.tsx:99-101`; `menu-tabs.tsx:82-96` | none                                                | UI view `browse → customize`                                       | Client-side only; unavailable items render "Unavailable" (`menu-tabs.tsx:83-89`)                                                                                                                                                                     |
| Client validation                 | Submit in customizer                          | `ordering-panel.tsx:235-249`; `ordering-panel-helpers.ts:190-212`                                                               | none                                                | none                                                               | Reuses `convex/orderPolicy.ts` validators; still bypassable by a direct mutation call                                                                                                                                                                |
| Commit                            | `submitOrder` mutation                        | `convex/orders.ts:71-128`                                                                                                       | `orders`, `notifications`                           | insert `orders` with `status: 'new'`; insert owner `notifications` | Approved business (`orders.ts:33-42`); item belongs to business and `isAvailable` (`orders.ts:45-55`); contact valid (`orders.ts:85-92`); selections valid (`orders.ts:102-105`); note ≤500 (`orders.ts:57-64`); selections ≤32 (`orders.ts:96-100`) |
| Visitor receipt                   | `OrderConfirmation`                           | `components/profile/ordering-panel-sections.tsx:405-507`; `getOrderStatus` (`convex/orders.ts:211-221`)                         | `orders`                                            | none                                                               | **None**; order id is the handle; projection returns only `status` + `createdAt` (`orders.ts:219`)                                                                                                                                                   |
| Owner board                       | `/owner/business/[id]` orders section         | `app/owner/business/[id]/orders-panel.tsx:224-...`; `listOrders` (`convex/orders.ts:138-172`)                                   | `orders`, `menuItems`                               | none                                                               | `requireBusinessOwner` (`orders.ts:141`, `authz.ts:56-74`)                                                                                                                                                                                           |
| Owner transition                  | Accept / Ready / Complete button              | `orders-panel.tsx:109-158`; `transitionOrderStatus` (`convex/orders.ts:179-200`)                                                | `orders`                                            | `new → accepted → ready → completed`                               | `requireBusinessOwner` (`orders.ts:186`); order must belong to the business (`orders.ts:188-191`); action must resolve through `nextOrderStatus` (`orders.ts:193-196`)                                                                               |
| Owner notification                | Same transaction as commit                    | `insertNotification` (`convex/orders.ts:119-124`; `notificationHelpers.ts:24-31,60-75`)                                         | `notifications`                                     | insert `new_order`                                                 | Recipient is server-derived from `businesses.ownerId`; client supplies no recipient                                                                                                                                                                  |
| Cancellation / rejection / expiry | **Does not exist**                            | —                                                                                                                               | —                                                   | —                                                                  | —                                                                                                                                                                                                                                                    |
| Amendment / reorder               | **Does not exist**                            | —                                                                                                                               | —                                                   | —                                                                  | —                                                                                                                                                                                                                                                    |
| Scheduled jobs                    | **None for orders**                           | —                                                                                                                               | —                                                   | —                                                                  | —                                                                                                                                                                                                                                                    |

## 1.2 The happy path, end to end

1. The public page fetches an **approved** business (`convex/businesses/queries.ts:49-61`). The restaurant vertical includes `menuTabs` and `orderingPanel`, so the menu and the order panel render (`app/business/[id]/page.tsx:78-88`).
2. `menus.listForBusiness` returns the public groups and items only for an approved business (`convex/menus.ts:369-383`). Each public item carries `price`, `customizationOptions`, and `isAvailable` (`menus.ts:355-367`).
3. Clicking "Order" changes the hash to `#order-<itemId>`; the panel resolves it and opens the customizer (`components/profile/ordering-panel.tsx:160-215`).
4. The client validates the contact block and selections with the same pure helpers the server uses (`ordering-panel-helpers.ts:190-212`; `convex/orderPolicy.ts:85-152`).
5. `submitOrder` loads the business and item, rejects an unapproved business or unavailable/foreign item, validates contact, note, and selections, inserts the order with `status: 'new'`, and inserts an owner notification **in the same transaction** (`convex/orders.ts:71-128`).
6. The panel stores the returned order id in component state and renders `OrderConfirmation` (`ordering-panel.tsx:268-274,292-293`). The receipt subscribes to `getOrderStatus` by id and shows a four-step stepper (`ordering-panel-sections.tsx:405-507`).
7. The owner opens the orders section; `listOrders` returns the 100 newest orders for the business, joins each to its **live** menu item, and the board offers the one legal next action (`convex/orders.ts:138-172`; `orders-panel.tsx:109-158`).
8. `transitionOrderStatus` resolves the action server-side and patches the status (`convex/orders.ts:179-200`). There is no cancellation, rejection, expiry, amendment, or audit row.

## 1.3 What was reproduced

The reproduction used the real handlers, not the UI, through `convex-test`. The scratch suite drove `api.orders.submitOrder`, `api.orders.listOrders`, `api.orders.transitionOrderStatus`, and `api.orders.getOrderStatus` against an in-memory Convex backend seeded with two approved businesses, two menu groups, and two items.

| #   | Scenario                                   | What actually happened                                                                                              | Exact evidence                                                                                                                  |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Happy path                                 | Order persisted with `status: 'new'`; one `new_order` notification for the owner; public status returned `new`      | Scratch test "HAPPY PATH…" passed; permanent test `convex/orders.test.ts` "anonymous visitor submits…" passes                   |
| R2  | Owner advances the order                   | `accept → ready → complete` all succeeded; final status `completed`                                                 | Permanent test "the owner board returns the order and the owner can advance it" passes                                          |
| R3  | Item unavailable                           | Mutation rejected with `This item is not available for ordering.`                                                   | `convex/orders.ts:51-53`; permanent test "an unavailable item is rejected server-side" passes                                   |
| R4  | Business unapproved                        | Mutation rejected with `This business is not accepting orders.`                                                     | `convex/orders.ts:38-40`; permanent test "an unapproved business is rejected server-side" passes                                |
| R5  | Foreign menu item                          | Mutation rejected with the same item error; no menu data leaked                                                     | `convex/orders.ts:51-53`; permanent test "another business's menu item…" passes                                                 |
| R6  | **Double submission**                      | `Promise.all` of two identical `submitOrder` calls produced **two distinct order ids and two rows**                 | Scratch test "FAILURE 2…" passed; the handler has no idempotency key or uniqueness check (`orders.ts:71-128`)                   |
| R7  | Unauthenticated board read / transition    | `listOrders` and `transitionOrderStatus` threw `Unauthorized`                                                       | `authz.ts:57-60`; permanent test "unauthenticated callers…" passes                                                              |
| R8  | Non-owner board read / transition          | Threw `Forbidden`                                                                                                   | `authz.ts:67-70`; permanent test "a non-owner…" passes                                                                          |
| R9  | Illegal transition                         | `new → ready` threw `Invalid status transition`                                                                     | `orderPolicy.ts:26-37`; permanent test "an illegal transition is rejected" passes                                               |
| R10 | Terminal state                             | A `completed` order rejected `accept` with `Invalid status transition`                                              | Permanent test "a terminal order rejects every further transition" passes                                                       |
| R11 | **Price history rewrite**                  | After the owner changed the menu price from 1200 to 9900, `listOrders` returned `itemPrice: 9900` for the old order | `orders.ts:135-136,149-153,161`; scratch test "GAP: a menu price edit…" passed                                                  |
| R12 | **No cancellation or decline**             | `api.orders` had no `cancelOrder`; `decline` was not an accepted action                                             | `orderPolicy.ts:15`; `orders.ts:183`; scratch test "GAP: no cancellation…" passed                                               |
| R13 | **No opening-hours gate**                  | A business with `hours: {}` accepted an order                                                                       | `orders.ts:81-127` never reads `hours`/`timezone`; scratch test "GAP: ordering cannot be paused…" passed                        |
| R14 | **No business pause / group availability** | `'acceptingOrders' in business` was `false`; `'isAvailable' in menuGroup` was `false`                               | `schema.ts:40-71` (businesses), `schema.ts:112-119` (menuGroups); scratch test R13                                              |
| R15 | **Receipt handle is not a lookup**         | The confirmation showed the last six characters of the id; no query or route accepts that code                      | `ordering-panel-helpers.ts:231-234`; `orders.ts:211-221` takes the full id; scratch test "GAP: the confirmation handle…" passed |

The permanent suite now pins the behavior that must survive the protocol change: anonymous commit, owner notification, owner transition, unavailable item, unapproved business, cross-business item, Unauthorized, Forbidden, illegal transition, terminal state, and the status-only public projection. It does **not** pin the gaps as desired behavior.

## 1.4 What is true today

1. **The unit of commitment is one menu item.** `orders` stores one `menuItemId` and one `selections[]` (`convex/schema.ts:183-203`). There is no quantity and no second line.
2. **The status machine is forward-only and has one terminal state.** `new → accepted → ready → completed`; `ORDER_STATUS_TRANSITIONS.completed = null` (`convex/orderPolicy.ts:12-37`). There is no `declined`, `cancelled`, or `expired`.
3. **A client never sends a status.** It sends `accept | ready | complete`; the server resolves the target (`convex/orderPolicy.ts:19-37`; `convex/orders.ts:179-196`). This is the right pattern and should be preserved.
4. **The public write surface validates business, item, contact, note, and selections server-side.** `submitOrder` checks an approved business (`orders.ts:33-42`), an available item owned by that business (`orders.ts:45-55`), contact (`orders.ts:85-92`), note length (`orders.ts:57-64`), selection count (`orders.ts:96-100`), and selection semantics (`orders.ts:102-105`). The UI mirrors the same pure validators (`ordering-panel-helpers.ts:190-212`).
5. **The order and its owner notification commit atomically.** `insertNotification` is a plain helper called in the same mutation, not `ctx.runMutation` (`orders.ts:119-124`; `notificationHelpers.ts` header).
6. **The visitor is anonymous.** There is no Clerk requirement on the order path and no `customerUserId` on `orders`. The visitor supplies a name and at least one of phone/email (`orderPolicy.ts:116-152`).
7. **There is no durable visitor handle.** The order id is the only handle; the displayed "code" is the last six characters of the id and is never looked up (`ordering-panel-helpers.ts:231-234`; `orders.ts:211-221`). `getOrderStatus` takes the full id.
8. **The confirmation is component state.** A refresh remounts `OrderingPanelBody` with `view: 'browse'` and `confirmation: null`; the receipt is gone (`ordering-panel.tsx:136,145,292-293`).
9. **There is no price snapshot.** `orders` stores no price, name, or line total (`schema.ts:183-203`; `orders.ts:107-117`). `listOrders` joins to the live item and returns its current `price` (`orders.ts:149-153,161`); the code comment admits it (`orders.ts:135-136`).
10. **The owner board does not render price at all.** `listOrders` returns `itemPrice` (`orders.ts:161`), but `app/owner/business/[id]/orders-panel.tsx` never references `itemPrice` (verified by search). The owner sees the customer, item name, selections, contact, note, time, and status — not the ticket value.
11. **The owner has exactly one supply switch: per-item `isAvailable`.** `menuItems.isAvailable` exists (`schema.ts:141`) and is enforced at submit (`orders.ts:51`). `menuGroups` has no availability flag (`schema.ts:112-119`); `businesses` has no `acceptingOrders` (`schema.ts:40-71`).
12. **Opening hours are not enforced on orders.** The pure evaluator exists and is used by directory "Open now" (`convex/businesses/publicHours.ts:157-176`), but `submitOrder` never reads `business.hours` or `business.timezone` (`orders.ts:81-127`). A business with no configured hours is treated as orderable, which happens to be the B12 default for incomplete profiles (`B12-order-basket.md:164-168`), but by accident rather than by policy.
13. **There is no cancellation, rejection, or expiry.** The action union is `accept | ready | complete` (`orderPolicy.ts:15`; `orders.ts:183`). A prank or unreachable order can sit in `new` forever; the board has no decline control (`orders-panel.tsx:122-158`).
14. **There is no idempotency.** The client sets `isSubmitting` only after validation and relies on React state to block a second click (`ordering-panel.tsx:235-249`). The mutation has no idempotency key or duplicate check (`orders.ts:71-128`). Two direct calls create two orders (R6).
15. **There is no throttle, block list, or velocity check.** No order-related table, index, or counter exists (`schema.ts:183-203`). A bot can call the public mutation repeatedly.
16. **The owner board is a capped, unfiltered list.** `listOrders` takes the newest 100 orders for the business (`orders.ts:21,143-147`) and filters nothing. `orders` has only `byBusinessId` (`schema.ts:203`). Completed history can push older `new` orders out of the window.
17. **Owner authorization is real and derived from ownership.** `requireBusinessOwner` requires a Clerk identity, a `users` row with that subject, and `businesses.ownerId === user._id` (`authz.ts:56-74`). `listOrders` and `transitionOrderStatus` both call it (`orders.ts:141,186`), and the transition additionally checks the order's `businessId` (`orders.ts:188-191`).
18. **The public status projection deliberately exposes only status and creation time.** `getOrderStatus` is unauthenticated and returns `{ status, createdAt }` (`orders.ts:211-221`); the code comment acknowledges that Convex ids are not documented as unguessable (`orders.ts:202-209`). This is a small leak, not a PII leak, because the projection is narrow.
19. **The existing test suite does not cover the order handlers.** `scripts/order-policy.test.ts` pins the pure policy (27 tests); `scripts/verify-state-machine.ts` pins the **listing** state machine (6 statuses, 11 actor rows, 5 owner rows), not orders. There was no `convex/orders.test.ts` before this report's slice 0.
20. **The spec and the code disagree.** `screens/SPEC.md` §7 describes a basket revised by B12 (`screens/SPEC.md:121`), and B12 is untracked prior art, but the code is still B8 single-item. This is a spec/implementation gap, not a hidden feature.

## 1.5 What is unknown

| ID  | Unknown                                                                                                         | Why it matters                                                               | Check needed                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| U1  | Real production order volume, fake-order rate, no-show rate, and cancellation rate                              | Every abuse threshold and the A/B/C choice depend on base rates              | Instrument submissions, declines by reason, cancellations, and owner verification time; no analytics exist today                     |
| U2  | Whether any production business has configured opening hours                                                    | The hours gate must not silently stop trade for incomplete profiles          | Query `businesses` for `hours` with any day; dev data shows mostly `{}`                                                              |
| U3  | Whether any real staff role exists or is needed                                                                 | The owner may not be the person watching the board                           | Product decision; `users.role` is only `user                                                                                         | superAdmin` (`schema.ts:20`), and owner is derived from `businesses.ownerId` (`authz.ts:56-74`) |
| U4  | Whether Convex document ids are guessable in practice                                                           | Today's public status query treats the id as a capability                    | Convex does not document ids as unguessable (`orders.ts:205-208`); use a high-entropy token for the new receipt regardless           |
| U5  | Whether the owner will actually call to verify every order                                                      | The fraud screen is an operator behavior, not a code guarantee               | Measure time-to-accept and decline reasons; sample audit                                                                             |
| U6  | Exact production row count for the `orders` migration                                                           | Determines one-pass vs batched backfill                                      | `npx convex data orders --limit 1` on the target deployment; production data is not visible from this checkout                       |
| U7  | Whether the Next.js middleware will intercept a new `/order/[token]` route                                      | A Clerk redirect would break the anonymous receipt                           | Read `middleware.ts` matcher and test the route; not resolved here                                                                   |
| U8  | Whether the receipt token in the URL leaks through referrers or logs                                            | Token is the only capability                                                 | Set `Referrer-Policy: no-referrer`, avoid third-party embeds, redact tokens in logs; test                                            |
| U9  | Whether `Intl.DateTimeFormat` handles every DST edge case for opening periods                                   | A wrong open/closed decision blocks or allows orders                         | The evaluator uses an IANA timezone and `formatToParts` (`publicHours.ts:51-74`); add DST-boundary tests (spring forward, fall back) |
| U10 | Whether a multi-item basket actually changes conversion or average order value here                             | The brief asserts the need; external food-ordering basket data was not found | Instrument basket size and conversion before/after; treat as a product hypothesis                                                    |
| U11 | Whether `@edge-runtime/vm` and the other empty packages can be restored without stopping the running dev server | Blocks the repository's own test/typecheck/build commands                    | Stop the stale dev server (user-owned), then `pnpm install`; not done here                                                           |
| U12 | Whether the "24%" Baymard figure cited by B12 is real                                                           | B12 uses it to argue against account walls                                   | Only the 18% figure is verifiable on the current Baymard page; treat 24% as unverified (see §4)                                      |

---

# 2. Actors, capabilities, and journeys

## 2.1 Actor and capability map

| Actor                      | Goal                                       | Current capability                                                              | Current authorization check                                                                                 | What the actor should be allowed to do                                                                                                                                                           | What the actor must not do                                                                                   |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Anonymous visitor**      | Order food without an account              | Browse approved listings/menus; submit one item; view status by full order id   | No auth on `submitOrder` or `getOrderStatus`; `listForBusiness` checks approved status (`menus.ts:374-376`) | Compose a multi-item basket; submit a guest order with name + one contact channel; receive a durable token receipt; view and cancel **that** order while `new`; see clear closed/sold-out states | Read another order's PII; cancel after acceptance; change prices; enumerate orders                           |
| **Authenticated customer** | Same as visitor, optionally with history   | Same as anonymous; Clerk identity is not stored on orders                       | None on the order path (Clerk exists elsewhere)                                                             | Same guest capabilities; optionally link orders to the Clerk user for future history; no extra authority                                                                                         | Use identity to bypass throttle or read others' orders                                                       |
| **Owner**                  | Fill capacity without fake demand or chaos | List own orders; accept/ready/complete; edit menu; toggle per-item availability | `requireBusinessOwner`: identity + `users` row + `businesses.ownerId` (`authz.ts:56-74`)                    | Accept/decline/cancel own orders; toggle item, group, and business ordering; see audit; block a contact; see full order details incl. contact and price                                          | Read another business's orders; edit a committed order's lines; bypass terminal states; see super-admin data |
| **Staff**                  | Work the board when the owner is away      | **Does not exist**                                                              | No staff table, no staff role                                                                               | If added: accept/ready/complete/decline/cancel and view orders for one business; not toggle ordering or manage staff                                                                             | Act across businesses; escalate to owner settings                                                            |
| **Super admin**            | Moderate listings and support the platform | Moderate listings, categories, owners, audit; **no order access**               | `requireSuperAdmin` (`authz.ts:27-47`)                                                                      | In v1: no order PII access. A future support path must be explicit, scoped, and audited                                                                                                          | Browse order PII by default; impersonate an owner                                                            |
| **System**                 | Keep state consistent                      | Clerk webhook updates `users`; no order scheduler                               | Internal functions only                                                                                     | Expire stale `new` orders; write system events; never accept/decline on behalf of a human                                                                                                        | Read PII for analytics without aggregation                                                                   |
| **Attacker / bot**         | Free food, disruption, data, or attention  | Can call the public mutation directly, unlimited                                | Only the validators in `submitOrder`                                                                        | Be rate-limited, blocked, and screened by owner verification                                                                                                                                     | Create unlimited orders; read PII; enumerate tokens                                                          |

**Identity is not capability.** A Clerk login changes _who_ the actor is, not _what_ they may do on the order path. The owner capability is derived from `businesses.ownerId` (`authz.ts:56-74`), not from a `users.role` flag. The visitor capability is a **bearer token** bound to one order, not a "visitor role." This distinction drives the authorization matrix in §6.4.

## 2.2 What "visitor role" should mean

The brief warns not to accept the phrase at face value. The evidence supports **anonymous guest checkout with a token capability**, not an account wall and not a role flag:

- The product already has anonymous orders by design (`convex/AGENTS.md`: "Anonymous visitor workflows (`orders`, `bookings`, `quoteRequests`) use token links, not Clerk accounts"). The order path is the exception: it has no token.
- `bookings` already models a token handle (`schema.ts:214,223`), so the pattern is established in the same backend.
- Forced account creation is a measurable conversion tax: 18% of shoppers in Baymard's reason breakdown cite "the site wanted me to create an account" (`baymard.com/lists/cart-abandonment-rate`, last updated 2025-09-22). This is e-commerce evidence, not food-ordering evidence, so it is directional, not dispositive.
- The functional need — "let me come back to my order" — is met by a high-entropy token link, not by a login.

**Capability ladder for v1:** (1) browse → (2) compose locally → (3) commit as guest → (4) hold the receipt token → (5) cancel while `new`. Clerk identity is optional and grants no additional order authority. Owner capability is a separate ladder derived from business ownership.

## 2.3 Journeys

For each journey: **user expectation → current behavior → desired behavior → invariant.** Invariant IDs refer to §6.3.

| #   | Journey                                               | User expectation                                             | Current behavior                                                                       | Desired behavior                                                                                                      | Invariant                 |
| --- | ----------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| J1  | One item                                              | Customize, submit, get a receipt                             | Works (`orders.ts:71-128`)                                                             | Same, with server price snapshot and a durable token receipt                                                          | INV-01, INV-04, INV-05    |
| J2  | Multiple distinct items with quantities and modifiers | One order for the table, one form                            | **Impossible**: one `menuItemId`, no quantity (`schema.ts:183-203`)                    | Basket of 1–20 lines, each quantity 1–20, each with independent selections; one contact block                         | INV-01..03, INV-10        |
| J3  | Add more after starting                               | Add another item without losing the first                    | Starting a new item resets the model and form (`ordering-panel.tsx:183-189`)           | Local basket persists per business; add/edit/remove lines before commit                                               | INV-03, INV-20            |
| J4  | Revise before commit                                  | Change quantity or modifiers, see the total                  | No basket; must restart                                                                | Editable basket with live subtotal and explicit "Review order"                                                        | INV-01, INV-02            |
| J5  | Abandon                                               | Leave without creating an order                              | No server write; component state is lost                                               | No server write; local basket may survive refresh; a "clear basket" action                                            | INV-10 (no order created) |
| J6  | Reorder                                               | Order the same thing again                                   | "Place another order" resets to browse (`ordering-panel-sections.tsx:502-504`)         | v1: reset and re-compose; "reorder from receipt" is deferred                                                          | INV-20                    |
| J7  | Item sells out mid-order                              | Be told before committing; keep the rest                     | Server rejects the whole submit with `This item is not available…` (`orders.ts:51-53`) | Line-level `ITEM_UNAVAILABLE`, keep the basket, mark the line, let the user remove it                                 | INV-10, INV-19            |
| J8  | Ordering closes mid-order                             | Be told; do not lose the basket                              | No gate; order is accepted at any time (`orders.ts:81-127`)                            | `ORDERING_CLOSED`/`OUTSIDE_HOURS`, keep the basket, show the business phone                                           | INV-10, INV-18, INV-19    |
| J9  | Duplicate submit                                      | One order, one notification                                  | **Two orders** (R6)                                                                    | Same idempotency key returns the original order; no second notification                                               | INV-04                    |
| J10 | Cancel                                                | Cancel before the kitchen starts                             | **Impossible**                                                                         | Visitor cancels via token only while `new`; owner can cancel `new`/`accepted`/`ready` with a reason                   | INV-07, INV-08            |
| J11 | No-show                                               | The order does not sit forever                               | Sits in `new` forever                                                                  | Expire `new` after TTL (default 60 min), or owner declines; after `ready`, owner marks `no_show`; terminal, no charge | INV-09, INV-15            |
| J12 | Abusive actor                                         | Not affect real customers                                    | Unlimited public writes                                                                | Per-contact and per-business throttles; block list; owner verification; typed errors                                  | INV-14, INV-16            |
| J13 | Staff accept/reject                                   | A trusted employee can work the board                        | No staff model; owner only                                                             | v1: owner only. Future: scoped staff capability, audited                                                              | INV-07                    |
| J14 | Owner toggles supply/demand                           | Stop orders without hiding the menu or losing pending orders | Only per-item `isAvailable`                                                            | Item, group, business pause, hours gate; pending orders unaffected; audit                                             | INV-17, INV-18            |
| J15 | Price change after adding                             | Pay the price I was shown, or be told                        | Client total is local; server stores no price; board shows live price                  | Server recomputes; `expectedSubtotal` mismatch → `PRICE_CHANGED` with the new total; commit only after re-confirm     | INV-01, INV-13, INV-19    |
| J16 | Two tabs / stale session                              | One order, not two                                           | Two tabs can both submit; two orders                                                   | Idempotency key per commit attempt; token receipt is the source of truth                                              | INV-04                    |
| J17 | Network loss after write                              | Retry safely                                                 | Retry creates a duplicate                                                              | Reuse the idempotency key; server returns the original order                                                          | INV-04                    |

---

# 3. Edge-case and abuse matrix

## 3.1 How to read the matrix

**Severity**

- **P0** — integrity, privacy, cross-tenant access, money/trust, or the business cannot stop a harmful order. A P0 failure means the protocol is not safe to ship.
- **P1** — operational failure that causes lost orders, stuck state, wrong totals, or a support burden. Ship-blocking for the full protocol, but not a security incident.
- **P2** — confusing or inaccessible behavior with a workaround. Can follow the core slices.

**Columns.** _Current_ is the behavior at HEAD `723a7f3`, with a citation where it is not obvious. _Desired_ is the target invariant. _Control_ names the enforcement point (server guard, state machine, index, UI, audit). _Invariant_ refers to the canonical list in §3.3.

## 3.2 Matrix

| ID  | Category      | Actor           | Trigger                                   | Current                                                              | Desired                                                                                                                                                   | Sev | Control                        | Invariant              |
| --- | ------------- | --------------- | ----------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------ | ---------------------- |
| E01 | Composition   | Visitor         | One item, one selection                   | Works                                                                | Works; one line with quantity 1                                                                                                                           | P1  | `placeOrder`                   | INV-01                 |
| E02 | Composition   | Visitor         | Two different items                       | Impossible: one `menuItemId` (`schema.ts:183-203`)                   | Two lines in one order; one contact block; one subtotal                                                                                                   | P0  | Basket + server validation     | INV-03                 |
| E03 | Composition   | Visitor         | Same item twice with different modifiers  | Impossible                                                           | Two lines allowed; identical line + identical selections may be merged by UI, but server accepts both                                                     | P1  | Line validation                | INV-03                 |
| E04 | Composition   | Visitor         | Quantity 0 / 21 / 1000                    | No quantity field                                                    | Reject `QUANTITY_INVALID`; quantity 1–20                                                                                                                  | P1  | Validator                      | INV-03                 |
| E05 | Composition   | Visitor         | 21 lines / 101 total units                | No cap                                                               | Reject `BASKET_TOO_LARGE`; 20 lines, 100 units                                                                                                            | P1  | Validator                      | INV-03                 |
| E06 | Composition   | Visitor         | Empty basket                              | No basket                                                            | Reject `BASKET_EMPTY` at the handler, not just the UI                                                                                                     | P1  | Validator                      | INV-03                 |
| E07 | Composition   | Visitor         | Item price is `undefined`                 | Allowed; no total shown                                              | Line with `unitPrice: null`; order subtotal `null`; never a partial sum                                                                                   | P1  | Server pricing                 | INV-02                 |
| E08 | Composition   | Visitor         | Price changed after adding                | Client total may be stale; no server comparison                      | `PRICE_CHANGED` with `actualSubtotal`; user re-confirms; no order created                                                                                 | P0  | `expectedSubtotal` check       | INV-01, INV-19         |
| E09 | Composition   | Visitor         | Menu price edited after commit            | Old order shows the **new** price (R11)                              | Snapshot name/unitPrice/lineTotal; old order unchanged                                                                                                    | P0  | Snapshot at commit             | INV-13                 |
| E10 | Composition   | Visitor         | Item deleted after commit                 | `listOrders` falls back to "(item removed)"                          | Snapshot renders; no live join needed for display                                                                                                         | P1  | Snapshot                       | INV-13                 |
| E11 | Composition   | Visitor         | Multi-business cart                       | Impossible; no cart                                                  | **Rejected by design** in v1: one business per order; error `MULTI_BUSINESS_BASKET`                                                                       | P1  | Basket scope                   | INV-03                 |
| E12 | Composition   | Visitor         | Note 501 chars / control chars            | ≤500 enforced server-side (`orders.ts:57-64`)                        | Same; trim; reject control chars; no HTML interpretation                                                                                                  | P2  | Validator + React escaping     | INV-03                 |
| E13 | Composition   | Visitor         | Reorder                                   | "Place another order" resets (`ordering-panel-sections.tsx:502-504`) | v1: reset and re-compose; receipt does not prefill                                                                                                        | P2  | UI                             | INV-20                 |
| E14 | Composition   | Visitor         | Abandoned local basket                    | Lost on unmount                                                      | Optional localStorage per business; no server write; clear action                                                                                         | P2  | UI                             | INV-20                 |
| E15 | Identity      | Visitor         | Guest checkout, no Clerk                  | Works                                                                | Works; no account wall; optional `customerUserId` if already signed in                                                                                    | P0  | Public mutation                | INV-10                 |
| E16 | Identity      | Visitor         | Reads another order by id                 | `getOrderStatus` returns status+createdAt for any id                 | New receipt requires a 256-bit token; old id query can be retired or kept status-only                                                                     | P0  | Token lookup                   | INV-05, INV-06         |
| E17 | Identity      | Visitor         | Guesses the 6-char code                   | Code is not a lookup at all (`helpers.ts:231-234`)                   | Code is per-business, not a global capability; lookup requires token                                                                                      | P1  | Token + reference scope        | INV-05                 |
| E18 | Identity      | Visitor         | Cross-tenant token                        | No token exists                                                      | Token maps to one order; never return another order's PII                                                                                                 | P0  | `byAccessToken`                | INV-06                 |
| E19 | Identity      | Visitor         | Shared device / token in URL              | No token; id in component state                                      | Receipt is a bearer link; "copy link" + "remove from this device"; no token in logs/referrer                                                              | P1  | UI + headers                   | INV-05, INV-25         |
| E20 | Identity      | Owner           | List another business's orders            | `Forbidden` (`authz.ts:67-70`)                                       | Same; keep the `order.businessId` check                                                                                                                   | P0  | `requireBusinessOwner` + match | INV-07                 |
| E21 | Identity      | Non-owner       | Transition an order                       | `Forbidden`                                                          | Same; staff future requires explicit grant                                                                                                                | P0  | `requireBusinessOwner`         | INV-07                 |
| E22 | Identity      | Super admin     | Read order PII                            | No order access                                                      | **Denied by default**; future support path must be audited                                                                                                | P0  | No admin query                 | INV-07, INV-25         |
| E23 | Identity      | Staff           | Accept/reject                             | No staff model                                                       | v1: owner only; future scoped staff capability                                                                                                            | P1  | Deferred                       | INV-07                 |
| E24 | Identity      | Attacker        | Enumerates order ids                      | Public status only (low leak)                                        | Token receipt; no id-based PII; rate-limit receipt reads                                                                                                  | P1  | Token + throttle               | INV-05                 |
| E25 | State         | Visitor         | Double click / retry                      | **Two orders** (R6)                                                  | Same idempotency key returns original; no second notification                                                                                             | P0  | Idempotency doc/index          | INV-04                 |
| E26 | State         | Visitor         | Two tabs submit the same basket           | Two orders                                                           | Each tab has its own key; the UI shares one key per commit attempt; second tab gets `IDEMPOTENCY_CONFLICT` if args differ, or the same order if identical | P0  | Idempotency                    | INV-04                 |
| E27 | State         | Visitor         | Cancel while `new`                        | No cancel                                                            | Token cancel; status `cancelled`; receipt + owner board update                                                                                            | P0  | `cancelOrder`                  | INV-08                 |
| E28 | State         | Visitor         | Cancel after `accepted`                   | No cancel                                                            | `CANNOT_CANCEL`; call the business                                                                                                                        | P1  | State guard                    | INV-08                 |
| E29 | State         | Owner           | Decline a prank order                     | No decline                                                           | Decline from `new` with reason; terminal                                                                                                                  | P0  | Transition action              | INV-08, INV-16         |
| E30 | State         | Owner           | Cancel after accept                       | No cancel                                                            | Cancel from `new`/`accepted`/`ready` with reason; terminal                                                                                                | P1  | Transition action              | INV-08                 |
| E31 | State         | Owner           | Accept an expired order                   | No expiry                                                            | `ORDER_EXPIRED`; no resurrection                                                                                                                          | P1  | Expiry + guard                 | INV-15                 |
| E32 | State         | Owner           | Double-click accept                       | Second call errors `Invalid status transition`                       | Idempotent repeat returns success; conflicting action errors                                                                                              | P1  | Idempotent repeat check        | INV-21                 |
| E33 | State         | Owner + visitor | Visitor cancels while owner accepts       | No cancel; race impossible today                                     | One wins atomically; loser gets `ORDER_ALREADY_DECIDED`; no split state                                                                                   | P0  | OCC + guard                    | INV-09, INV-21         |
| E34 | State         | Owner           | Accept → item deleted                     | Board still shows fallback name                                      | Snapshot renders; accept/ready still possible                                                                                                             | P1  | Snapshot                       | INV-13                 |
| E35 | State         | Owner           | Complete → further action                 | `Invalid status transition`                                          | Terminal; explicit `ORDER_TERMINAL`                                                                                                                       | P1  | State machine                  | INV-09                 |
| E36 | State         | System          | Expire a `new` order                      | No expiry                                                            | TTL 60 min; `expired`; event; receipt updates                                                                                                             | P1  | Scheduled internal mutation    | INV-15                 |
| E37 | State         | System          | Expire an `accepted` order                | N/A                                                                  | Never; only `new` expires                                                                                                                                 | P1  | Guard                          | INV-15                 |
| E38 | Supply        | Owner           | Item sold out                             | Rejected at submit (`orders.ts:51-53`)                               | Rejected with `ITEM_UNAVAILABLE`; line-level UI; basket preserved                                                                                         | P0  | Server check                   | INV-10, INV-19         |
| E39 | Supply        | Owner           | Whole group sold out                      | No group flag                                                        | `GROUP_UNAVAILABLE`; group shown unavailable; basket preserved                                                                                            | P0  | `menuGroups.isAvailable`       | INV-10, INV-18         |
| E40 | Supply        | Owner           | Pause all orders                          | No flag                                                              | `ORDERING_CLOSED`; menu browse-only; pending orders unaffected; optional auto-resume                                                                      | P0  | `businesses.acceptingOrders`   | INV-10, INV-17, INV-18 |
| E41 | Supply        | Owner           | Close for the day                         | No hours gate                                                        | `OUTSIDE_HOURS`; no order; phone shown                                                                                                                    | P1  | `openStatusAt`                 | INV-10, INV-18         |
| E42 | Supply        | Owner           | Hours `{}` / incomplete                   | Accepted (by accident)                                               | Skip the gate when no periods are configured; do not silently stop trade                                                                                  | P1  | Explicit no-hours policy       | INV-10                 |
| E43 | Supply        | Owner           | DST / overnight period                    | Evaluator exists; orders ignore it                                   | Test spring-forward/fall-back and overnight; correct local wall clock                                                                                     | P1  | `publicHours.ts` + tests       | INV-10                 |
| E44 | Supply        | Owner           | Holiday / special hours                   | No schema support                                                    | **Out of scope v1**; document; owner pauses manually                                                                                                      | P2  | Manual pause                   | INV-18                 |
| E45 | Supply        | Owner           | Empty menu                                | Panel shows "No menu items" (`ordering-panel-sections.tsx:82-85`)    | `MENU_EMPTY`; no order; owner prompted to add items                                                                                                       | P2  | Server check                   | INV-10                 |
| E46 | Supply        | Owner           | Accidental pause                          | No pause                                                             | Pause is visible, timestamped, audited; auto-resume optional; one-tap resume                                                                              | P1  | Audit + banner                 | INV-22                 |
| E47 | Supply        | Owner           | Forgot to un-86 an item                   | `isAvailable` persists until toggled                                 | Persist, but show "Sold out since <time>" in the owner menu; daily reminder in operations                                                                 | P1  | UI + ops                       | INV-18                 |
| E48 | Abuse         | Bot             | 1,000 direct submissions                  | Unlimited                                                            | Per-contact + per-business throttle; `TOO_MANY_REQUESTS`; recovery window                                                                                 | P0  | Throttle docs                  | INV-14                 |
| E49 | Abuse         | Prankster       | Fake but plausible phone                  | Accepted; owner must call                                            | Accepted; owner calls; decline `Unreachable`; block contact                                                                                               | P1  | Owner verification + block     | INV-16                 |
| E50 | Abuse         | Prankster       | Rotates phone numbers                     | No defense                                                           | Per-business throttle + owner verification; residual risk documented                                                                                      | P1  | Layered controls               | INV-14                 |
| E51 | Abuse         | Competitor      | Floods with fake orders                   | Unlimited                                                            | Throttle + block + owner verification; audit; no public accusation                                                                                        | P1  | Layered                        | INV-14                 |
| E52 | Abuse         | Attacker        | Scripts `placeOrder` with a fake `status` | N/A                                                                  | Client cannot send status; action-only API                                                                                                                | P0  | Action validators              | INV-11                 |
| E53 | Abuse         | Attacker        | Injects HTML/script in note/name          | React escapes; no server sanitization                                | Keep escaping; reject control chars; do not render raw HTML                                                                                               | P1  | React + validator              | INV-25                 |
| E54 | Abuse         | Attacker        | Oversized payload                         | Convex validator limits                                              | Caps on lines, quantity, selections, note, name, contact                                                                                                  | P1  | Validators                     | INV-03                 |
| E55 | Abuse         | Attacker        | Replays a captured request                | No signing; public mutation                                          | Idempotency key prevents duplicate; token is bearer; HTTPS only; rate limit                                                                               | P1  | Idempotency + throttle         | INV-04                 |
| E56 | Abuse         | Attacker        | Guesses idempotency keys                  | Keys are client UUIDs, scoped to business                            | 128-bit UUID; same key + different args → conflict; no cross-business read                                                                                | P2  | Scoped index                   | INV-04                 |
| E57 | Abuse         | Attacker        | Scrapes PII from receipts                 | No token today; id returns status only                               | Receipt masks contact; full contact only to owner                                                                                                         | P0  | Projection                     | INV-06, INV-25         |
| E58 | Abuse         | Staff           | Snoops customer contacts                  | No staff model                                                       | v1 owner-only; future staff audit; no export                                                                                                              | P1  | Authz + audit                  | INV-07, INV-25         |
| E59 | Abuse         | Owner           | Colludes / fake-completes to game metrics | No metrics                                                           | Metrics are operational, not payouts; audit events; no financial incentive in v1                                                                          | P2  | Audit                          | INV-22                 |
| E60 | Operator      | Owner           | No one watches the board                  | Orders sit `new` forever                                             | Expiry + age badge; no push in v1; document "keep the tab open"                                                                                           | P1  | Expiry + UI                    | INV-28                 |
| E61 | Operator      | Owner           | Accepts the wrong order                   | No confirmation                                                      | Accept sheet shows reference, items, contact; explicit "verified" action                                                                                  | P1  | UI                             | INV-21                 |
| E62 | Operator      | Owner           | Declines without a reason                 | No decline                                                           | Reason required; receipt shows it; weekly review                                                                                                          | P1  | Validator + audit              | INV-16                 |
| E63 | Operator      | Owner           | Item sells out after accept               | No path                                                              | Call customer; cancel with `Sold out`; no line edits                                                                                                      | P1  | Operator workflow              | INV-08                 |
| E64 | Operator      | Owner           | Customer unreachable                      | No path                                                              | Decline `Unreachable` from `new`; after accept, cancel with reason                                                                                        | P1  | Operator workflow              | INV-16                 |
| E65 | Operator      | Owner           | Business suspended mid-order              | No order impact                                                      | Pending orders remain readable/actionable; public ordering closed; receipt works                                                                          | P1  | Status check only on create    | INV-17                 |
| E66 | Operator      | Owner           | Ownership transfer                        | `ownerId` changes; old owner loses access                            | Existing orders stay with the business; new owner sees them; audit                                                                                        | P1  | `requireBusinessOwner`         | INV-07, INV-22         |
| E67 | Operator      | Owner           | Menu/group deleted                        | Orders still readable via snapshot                                   | Snapshot; no cascade delete of orders                                                                                                                     | P0  | Snapshot + no cascade          | INV-13                 |
| E68 | Operator      | Owner           | Business deleted                          | Hard delete exists in admin (`authz`/`businesses` admin mutations)   | **Do not cascade-delete orders** without a retention decision; block hard delete if orders exist or archive                                               | P1  | Admin guard                    | INV-30                 |
| E69 | Operator      | Owner           | Pause while orders pending                | N/A                                                                  | Pause affects new orders only; pending can be accepted/declined/completed                                                                                 | P1  | Guard only on create           | INV-17                 |
| E70 | Operator      | Owner           | Auto-resume at wrong time                 | N/A                                                                  | Use `acceptingOrdersUntil`; compute effective open; show "Paused until"; test boundary                                                                    | P2  | Time check                     | INV-18                 |
| E71 | Operator      | Owner           | Phone/email both absent                   | Validator requires one (`orderPolicy.ts:116-152`)                    | Keep; normalize; no order without a contact                                                                                                               | P0  | Validator                      | INV-24                 |
| E72 | Privacy       | Owner           | Export all customer data                  | No export                                                            | No bulk export in v1; per-order view only; audit                                                                                                          | P1  | No query                       | INV-25                 |
| E73 | Privacy       | System          | Logs contain phone/name                   | Console logs not audited                                             | No PII in logs; structured ids only; redact tokens                                                                                                        | P0  | Logging policy                 | INV-25                 |
| E74 | Privacy       | System          | Retain cancelled orders forever           | Orders persist                                                       | Define retention (e.g., 90 days for declined/cancelled; 1 year completed); not implemented v1                                                             | P2  | Document                       | INV-30                 |
| E75 | Accessibility | Visitor         | Screen reader / keyboard                  | Some labels, focus handling in panel (`ordering-panel.tsx:272-276`)  | `aria-live` status, focus to errors, labeled quantity buttons, 44px targets, no color-only                                                                | P2  | UI tests                       | INV-26                 |
| E76 | Accessibility | Visitor         | Reduced motion                            | Stepper animations                                                   | Honor `prefers-reduced-motion`                                                                                                                            | P2  | CSS                            | INV-26                 |
| E77 | Recovery      | Visitor         | Network drops after submit                | Retry duplicates                                                     | Persist idempotency key until success; retry returns original; receipt link                                                                               | P0  | Idempotency + UI               | INV-04, INV-19         |
| E78 | Recovery      | Visitor         | Server error after write                  | Client shows error; order exists                                     | Error envelope includes a recoverable `orderId`/token when the write succeeded; UI reconciles                                                             | P1  | Error contract                 | INV-19                 |
| E79 | Recovery      | Operator        | Convex transient failure on accept        | Button error; retry                                                  | Idempotent accept; retry safe; status reconciling                                                                                                         | P1  | Idempotent transition          | INV-21                 |
| E80 | Recovery      | Operator        | Board stale after another device acts     | Optimistic update may diverge                                        | Realtime query reconciles; conflicting action shows `ORDER_ALREADY_DECIDED`                                                                               | P1  | Realtime + guard               | INV-21                 |
| E81 | State         | Owner           | Customer never picks up a `ready` order   | No path; order sits `ready` forever                                  | Owner marks `no_show` only from `ready`; terminal; reason defaults to `Not picked up`; counted separately from `completed`                                | P1  | Transition action + metrics    | INV-09, INV-16         |

## 3.3 Canonical P0/P1 invariants

These are the testable sentences. Every slice that implements one must add its test in the same change. A P0 invariant without a passing test blocks release.

| ID         | Sev | Invariant (must hold for every order)                                                                                                                                                                                                                                                   | Enforced by                                     |
| ---------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **INV-01** | P0  | `subtotal` equals the sum of server-computed `lineTotal` for every line at commit; the server ignores any client-supplied price; all money is integer cents.                                                                                                                            | `priceBasket`; `placeOrder`; `expectedSubtotal` |
| **INV-02** | P0  | If any line has no price, `subtotal` is `null`; the server never returns a partial sum, and the UI says "Total at pickup".                                                                                                                                                              | `priceBasket`                                   |
| **INV-03** | P0  | 1–20 lines; each quantity 1–20; total units ≤100; ≤32 selections per line; name ≤80; note ≤500; one business per order.                                                                                                                                                                 | `validateBasket`                                |
| **INV-04** | P0  | A repeat of the same `(businessId, idempotencyKey)` with the same canonical args returns the original order and creates no second order or notification; different args → `IDEMPOTENCY_CONFLICT`.                                                                                       | throttle/business doc + `byIdempotencyKey`      |
| **INV-05** | P0  | `accessToken` is ≥128 bits from a CSPRNG, is not derived from the order id, and is never logged or placed in a referrer.                                                                                                                                                                | `createAccessToken`; headers; logging           |
| **INV-06** | P0  | A token resolves to exactly one order; no token can read another order or list orders; the receipt projection masks contact data.                                                                                                                                                       | `getOrderByToken`                               |
| **INV-07** | P0  | Only the business owner (or an explicitly granted staff member in a future slice) can list or transition that business's orders; super admin has no order PII access in v1.                                                                                                             | `requireBusinessOwner` + `order.businessId`     |
| **INV-08** | P0  | A visitor cancels only via token and only while `new`; an owner cancels only from `new`/`accepted`/`ready` with a reason; only the owner can mark `no_show`, and only from `ready`; every other attempt is refused.                                                                     | `cancelOrder`; `transitionOrderStatus`          |
| **INV-09** | P0  | `completed`, `declined`, `cancelled`, `expired`, and `no_show` are terminal; no action can leave them.                                                                                                                                                                                  | `nextOrderStatus`                               |
| **INV-10** | P0  | No order is created unless the business is approved, ordering is open, the time is within configured hours (or no hours are configured), every line's item and group are available, every line belongs to the business, contact is valid, caps hold, and the expected subtotal matches. | `placeOrder` guard chain                        |
| **INV-11** | P0  | The client sends actions (`accept`, `decline`, `cancel`, `ready`, `complete`, `noShow`), never a raw status; the server resolves the target.                                                                                                                                            | action validators; `nextOrderStatus`            |
| **INV-12** | P1  | Every transition appends an `orderEvents` row with actor type, actor user id (if any), action, from/to, reason (if any), and timestamp.                                                                                                                                                 | `appendOrderEvent`                              |
| **INV-13** | P1  | `items[].name`, `unitPrice`, `lineTotal`, and `selections` are immutable after commit; a menu edit or delete cannot rewrite an order.                                                                                                                                                   | snapshot at commit                              |
| **INV-14** | P1  | Per-contact and per-business throttles reject excess submissions with `TOO_MANY_REQUESTS` and `retryAfterMs`; the limit recovers after the window.                                                                                                                                      | `claimThrottle`                                 |
| **INV-15** | P1  | Only `new` orders expire, after the configured TTL (default 60 minutes); accepted orders never auto-expire; expiry is terminal.                                                                                                                                                         | `expireOrder`                                   |
| **INV-16** | P1  | Owner decline/cancel requires a reason of 1–200 characters; `no_show` defaults to `Not picked up`; the receipt shows the reason; a blocked contact receives a generic refusal, not a block disclosure.                                                                                  | transition validator; block check               |
| **INV-17** | P1  | Pausing ordering or closing hours does not cancel or mutate pending orders; the owner can still accept/decline/complete them, and receipts still work.                                                                                                                                  | create-only guard                               |
| **INV-18** | P1  | Kill switches are enforced on direct backend calls, not only in the UI; a business that is not approved is never orderable; "hidden menu + open ordering" is forbidden.                                                                                                                 | `placeOrder` guards                             |
| **INV-19** | P1  | A stale client gets a typed error (`ITEM_UNAVAILABLE`, `GROUP_UNAVAILABLE`, `ORDERING_CLOSED`, `OUTSIDE_HOURS`, `PRICE_CHANGED`, `BUSINESS_UNAVAILABLE`) and keeps its basket for correction.                                                                                           | error envelope; UI                              |
| **INV-20** | P2  | The receipt survives refresh and bookmark; the URL contains only the token; the page has no third-party embeds and sends `Referrer-Policy: no-referrer`.                                                                                                                                | receipt route                                   |
| **INV-21** | P1  | Repeating the same action is a no-op success; a conflicting action returns `ORDER_ALREADY_DECIDED`; concurrent accept/decline has one winner.                                                                                                                                           | transition guard; OCC                           |
| **INV-22** | P1  | Owner toggles (accepting orders, group availability, item availability) write an audit row with actor, action, target, and optional reason.                                                                                                                                             | `auditLogs`                                     |
| **INV-23** | P1  | The owner board filters by status, defaults to `new`, sorts oldest first within the filter, cannot starve `new` behind completed history, and cursor-paginates `new` so it never silently truncates.                                                                                    | `byBusinessIdStatus` index                      |
| **INV-24** | P1  | Name is 1–80 characters; phone is 7–20 digits after normalization; email is a basic valid address; at least one channel is required.                                                                                                                                                    | `parseContact`                                  |
| **INV-25** | P1  | No phone, email, name, note, or token is written to application logs or analytics; order events store ids and reason codes, not free-text PII.                                                                                                                                          | logging policy                                  |
| **INV-26** | P2  | Status changes are announced (`aria-live`), focus moves to errors, quantity controls are labeled, targets are ≥44px, and status is not conveyed by color alone.                                                                                                                         | UI tests                                        |
| **INV-27** | P2  | Every error code has one user-facing message and one recovery action; no raw Convex error text reaches the customer.                                                                                                                                                                    | `messageForOrderError`                          |
| **INV-28** | P1  | An unaccepted order shows its age and is visible above completed history; expiry prevents indefinite holds; v1 has no push, which is documented to the owner.                                                                                                                           | board + expiry                                  |
| **INV-29** | P1  | The public menu is returned only for an approved business; no owner-only fields leak; an unavailable item remains visible as sold out but cannot be ordered.                                                                                                                            | `listForBusiness` + `publicItem`                |
| **INV-30** | P2  | A retention policy exists for orders, events, throttle rows, and blocks; hard-deleting a business does not silently cascade-delete order history.                                                                                                                                       | admin guard + documented policy                 |

## 3.4 Why the P0s are P0

- **INV-01/02/13** protect the customer and the owner from a silent price rewrite. The current code already demonstrates the failure: a menu edit changes an old order's displayed price (R11). In a real dispute, the owner and customer would see different numbers and neither would have a snapshot.
- **INV-04** prevents duplicate food and duplicate owner work. The current code creates two orders from two identical calls (R6). With no payment, the cost is wasted food and a broken trust signal, not a chargeback — still P0 for the business.
- **INV-05/06/07** are the privacy and cross-tenant boundary. Today the public status query is narrow, but the moment a receipt shows items or a name, an id-based handle becomes a PII surface. The token must exist before the receipt does.
- **INV-08/09** are the termination boundary. Without them, a prank order has no end state, the board can only move forward, and the owner cannot recover. The absence of decline is the single most important operational gap.
- **INV-10/18** are the supply boundary. A direct mutation must not bypass a sold-out item, a paused business, or closed hours; the UI is not a security control.
- **INV-11** keeps the state machine server-owned. The current pattern is already right; the risk is regression when the action union grows.

---

# 4. Research findings

## 4.1 Source standard

- **Repo claims** carry `file:line` and were read at HEAD `723a7f3`.
- **External claims** carry the URL, page title, publication/update date when the page states one, the access date when it does not, and a copied passage. Vendor documentation is first-party evidence of **how that vendor's product works**, not independent evidence that the mechanism works for this marketplace.
- **Fact** means the source directly states it. **Inference** means this report applies it. **UNVERIFIED** means no adequate source was found; it is not a guess dressed as a fact.
- No statistic in this report is invented. Where a number is an engineering estimate or a proposed threshold, it is labeled **estimate** or **hypothesis**.

**Access dates:** all pages below were accessed 2026-10-20 unless the page states a different date.

## 4.2 Findings

### F1. Cart abandonment is high on average, and the average is an aggregate, not a food-ordering rate

**Source:** Baymard Institute, _50 Cart Abandonment Rate Statistics 2026_, last updated 2025-09-22, https://baymard.com/lists/cart-abandonment-rate.

> "70.22% – average documented online shopping cart abandonment rate"
>
> "Based on the data we collected, we've calculated the average cart abandonment rate of 70.22%. This value is an average calculated based on 50 different studies containing statistics on ecommerce shopping cart abandonment."

**Context:** 50 studies, different years and methods; the page itself warns about "large fluctuations in the actual abandonment rates." **Confidence:** high that this is Baymard's aggregate; low that it transfers as a point estimate to local food pickup. **Applicability:** direction only — checkout friction matters, but do not use 70.22% as this product's baseline.

### F2. Account creation is one named abandonment reason; cost and total-price visibility are bigger

**Source:** same Baymard page.

> "our latest quantitative study of reasons for abandonment found that 42% of US online shoppers have abandoned a cart because 'I was just browsing / not ready to buy'."
>
> "However, if we ignore the 'just browsing' segment, and instead look at the remaining reasons for abandonments we get the following distribution:
>
> - 40% Extra costs too high (shipping, tax, fees)
> - 20% Delivery was too slow
> - 19% I didn't trust the site with my credit card information
> - 18% The site wanted me to create an account
> - 17% Too long / complicated checkout process
> - 17% Website had errors / crashed
> - 13% Returns policy wasn't satisfactory
> - 12% I couldn't see / calculate total order cost up-front
> - 10% The credit card was declined
> - 9% There weren't enough payment methods
> - 7% I don't know"

**Applicability:** (a) guest checkout is justified; (b) show the total, including any fee, before commit; (c) do not add an account wall as a "fraud control" without measuring the conversion cost; (d) 18% is the account reason, **not** the 24% figure B12 cites.

### F3. DoorDash separates "Busy" (slow down) from "Pause" (stop), and pause is scoped by duration and channel

**Source:** DoorDash Help Center, _How to Manage Your Store Status and Availability_, undated, accessed 2026-10-20, https://help.doordash.com/en-us/merchants/article/what-is-my-store-status.

> "If your kitchen is running behind, you can slow or pause incoming orders by tapping on the menu icon on the top left corner."
>
> "### If you select Busy
> You can choose how much additional prep time is added to your orders.
>
> ### If you select Pause
>
> You can select how long orders will be paused, and on which channels."

**Applicability:** two different needs — "slow down" and "stop" — and a pause should carry a duration and a scope. This app has one pickup channel, so channel scope collapses; duration remains. "Busy" could be a future prep-time estimate, but v1 has no prep-time promise, so only pause is in scope.

### F4. DoorDash's own operations guidance treats inaccurate hours, unmarked sold-out items, and slow confirmation as avoidable cancellations

**Source:** DoorDash Help Center, _Navigating Operations Quality Reporting in the Merchant Portal_, updated 2026-10-20, https://help.doordash.com/en-us/merchants/article/merchant-portal-operations-quality.

> "Avoidable cancellation reasons include:
>
> - Store closed (incorrect times listed)
> - Too busy
> - Item out of stock
> - Staff requested cancellation
> - No confirmation
> - Extreme Dasher wait time
> - Menu data mismatch
> - Technical error on a POS or tablet"

> "How to improve
>
> - Keep store hours accurate in the Portal, POS, or tablet
> - Mark items out of stock as soon as they're unavailable
> - Use Busy Kitchen Status instead of pausing when possible
> - Confirm orders as quickly as possible
> - Set clear Dasher pickup instructions"

**Applicability:** the protocol's kill switches and accept step map directly to the first four controls. The metric is not "orders submitted"; it is **avoidable cancellations and time-to-confirm**. This is why the owner board should show age and why decline reasons must be coded.

### F5. Uber Eats pauses are time-bounded and often end at end of day

**Source:** Uber Help, _Pausing new orders_, undated, accessed 2026-10-20, https://help.uber.com/merchants-and-restaurants/article/pausing-new-orders?nodeId=42e66554-9875-4ca4-93f9-59f497120949.

> "Select the amount of time you would like to pause"
>
> "NOTE: Pausing only lasts until the end of the day."
>
> "If you cancel an order and select 'kitchen closed' as the reason, you'll see a prompt to pause new orders for the day. If you tap 'Pause new orders', you won't receive new orders while your kitchen is closed."

**Applicability:** a pause without an end is an operational trap. v1 should store an optional `acceptingOrdersUntil` and compute effective open; "rest of day" is a useful preset. The "cancel with kitchen closed → prompt to pause" flow is a good operator pattern, not a v1 requirement.

### F6. Owner presence is a hard dependency: a backgrounded app receives no orders

**Source:** Uber Eats Merchant Academy, _Accepting orders on Uber Eats_, undated, accessed 2026-10-20, https://merchants.ubereats.com/us/en/academy/orders/.

> "If the app is minimized or in the background, you won't receive orders."
>
> "When your Orders app is open, a sound and a flashing green light alerts you to every new order. Tap anywhere on the screen to accept and then view it."
>
> "Tapping Confirm moves the order to 'In progress' and notifies your customer."

**Applicability:** an owner board is not a guarantee that a human is watching. The app must show unaccepted age, expire stale orders, and document that v1 has no push/SMS. This is a limitation, not a solved problem.

### F7. "86" is a global availability switch that persists until manually reversed

**Source:** Toast, _86 an Item on the POS or Toast Web_, last updated 2026-10-06, https://support.toasttab.com/en/article/86-an-Item.

> "When you run out of an item, you can 86 it to mark it as out of stock so guests can't order it on the POS, online, or through third-party channels."
>
> "Note: An item stays out of stock, or 86'd, until you mark it back in stock."

**Applicability:** one availability flag must apply to **all** ordering surfaces; channel-specific availability creates oversell. The persistence is a feature and a risk: the owner must remember to un-86. Show "sold out since <time>" in the owner menu and include it in the daily open checklist.

### F8. Square's sold-out behavior hides the item from checkout; a scheduled reset remains orderable for future dates

**Source:** Square Support Center, _Mark items and modifiers as sold out_, undated, accessed 2026-10-20, https://squareup.com/help/us/en/article/8430-mark-items-and-modifiers-as-sold-out.

> "By default, marking items or modifiers as sold out hides them from checkout so they don't appear as selectable options."
>
> "If you mark an item as sold out and schedule a time to reset to available, the item remains orderable for future pickup or delivery dates on your ordering profile ... Customers can still place orders for dates after the scheduled reset time."

**Applicability:** this app is **ASAP pickup only** in v1. A scheduled reset must not make the item orderable before the reset; there is no future-date order to except. If scheduling is added later, this exception must be designed deliberately.

### F9. Pickup settings are a system, not a single "open" switch

**Source:** Square Support Center, _Set up pickup options for your online ordering profile_, undated, accessed 2026-10-20, https://squareup.com/help/us/en/article/8608-set-up-pickup-options-for-your-online-ordering-profile.

> "You can customize the following settings for orders placed through your online ordering profile from your Square Dashboard:
>
> - Prep time
> - Lead time
> - Pickup time
> - Curbside pickup
> - Scheduled downtime
> - Order timing
> - Show pickup time to customers
> - Cut off time
> - Order scheduling
> - Order limit per pickup window
> - Large order limit
> - Ticket printing
> - Pickup instructions"

**Applicability:** v1 deliberately implements only two of these: opening hours and a manual pause. Prep-time promises, lead time, scheduled downtime, and per-window limits are real needs but require a scheduling model this app does not have. Do not fake them with copy.

### F10. Idempotency keys are the standard retry-safety mechanism, with parameter comparison

**Source:** Stripe API Reference, _Idempotent requests_, undated, accessed 2026-10-20, https://docs.stripe.com/api/idempotent_requests.

> "The API supports idempotency for safely retrying requests without accidentally performing the same operation twice. When creating or updating an object, use an idempotency key. Then, if a connection error occurs, you can safely repeat the request without risk of creating a second object or performing the update twice."
>
> "A client generates an idempotency key, which is a unique key that the server uses to recognize subsequent retries of the same request. How you create unique keys is up to you, but we suggest using V4 UUIDs, or another random string with enough entropy to avoid collisions. Idempotency keys are up to 255 characters long. Avoid using sensitive data (for example, email addresses or personal identifiers) as idempotency keys."
>
> "The idempotency layer compares incoming parameters to those of the original request and errors if they're not the same to prevent accidental misuse."
>
> "For API v1, you can remove keys from the system automatically after they're at least 24 hours old."

**Applicability:** use a client-generated UUID, compare a canonical parameter hash, return the original order on a match, error on a mismatch, and keep keys at least 24 hours. Do not use the phone/email as the key.

### F11. Tock recommends a 10–15% deposit for reservations, not pickup orders

**Source:** Tock, _Best Practices for Deposit Experiences_, undated, accessed 2026-10-20, https://tock.zendesk.com/hc/en-us/articles/5912341029140-Best-Practices-for-Deposit-Experiences.

> "Collecting a small deposit (10 to 15% of your predicted check average) can significantly reduce no-show rates. This guide offers best practices to follow when offering deposit reservations."
>
> "Reminder emails and text messages help reduce no-shows and last minute cancellations, and are enabled by default."

**Context:** reservations with a predicted check average and a party size; a deposit is charged at booking. **Confidence:** first-party vendor guidance, not an independent study. **Applicability:** supports deposit reservations as a plausible control, **not** a pickup-order deposit. The reminder channel is also absent from this app.

### F12. The reservation no-show model supports a penalty as high as the meal price, but it is a model

**Source:** Jaelynn Oh and Xuanming Su, _Pricing Restaurant Reservations: Dealing with No-Shows_, SSRN, written 2012-10-31, posted 2012-11-02, https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2169567.

> "Reservation no-shows lead to wasted capacity in restaurants. In this paper we consider two remedies: to punish no-shows by charging fees and to encourage show-ups by giving discounts."
>
> "The result of our model suggests that restaurants should charge a no-show penalty as high as the price of meal while giving a discount to reservation customers."
>
> "Our results are consistent with the current practice of some high-end restaurants selling non-refundable tickets for their prix-fixe menus where ticket holders lose the face value of the ticket when they fail to show up."

**Context:** an analytical queueing/advance-selling model, not an empirical field experiment. **Applicability:** a deposit or penalty can be optimal for **reservations** where capacity is wasted; pickup food has different economics (the meal is not held for a time slot in the same way, and the customer often prepays or pays at pickup). This is why C is not the default.

### F13. Checkout contact design: one channel, and an account wall suppresses accelerated checkout

**Source:** Shopify Help Center, _Editing the checkout form options_, undated, accessed 2026-10-20, https://help.shopify.com/en/manual/checkout-settings/checkout-form-options.

> "Select which contact method customers can use to checkout. You can choose from the following options:
>
> - Phone number or email
> - Email"
>
> "There's no option to require both an email address and a phone number as the contact method."
>
> "If the option to require customers to sign in to their customer account before checking out is activated, then accelerated checkout options such as Apple Pay aren't displayed in the online store cart to prevent any checkouts from bypassing the sign-in requirement."

**Applicability:** requiring both phone and email adds friction without a proven fraud benefit; one reachable channel plus owner verification is the smaller change. An account wall can also remove one-tap payment, which is a conversion cost.

### F14. Application-level rate limiting is transactional and can fail closed

**Source:** Convex, _Rate Limiter_, undated, accessed 2026-10-20, https://www.convex.dev/components/rate-limiter.

> "Configurable for fixed window or token bucket algorithms."
>
> "Transactional evaluation: all rate limit changes will roll back if your mutation fails."
>
> "Fails closed, not open: avoid cascading failure when traffic overwhelms your rate limits."

**Applicability:** either the Convex component or a small throttle table works. This report chooses a table because the same document can serialize idempotency and throttle checks for a business without adding a component dependency. The component is the better choice if the app already uses components or needs sharding; that is an implementation preference, not a correctness difference.

### F15. Signaling: cheap signals do not separate; one-shot actors do not invest in reputation

**Source:** Michael Spence, _Job Market Signaling_, _Quarterly Journal of Economics_ 87(3), August 1973, pp. 355–374, DOI 10.2307/1882010. PDF: https://www.sfu.ca/~allen/Spence.pdf.

> "If the incentives for veracity in reporting anything by means of a conventional signaling code are weak, then one must look for other means by which information transfers take place."
>
> "This essay is about markets in which signaling takes place and in which the primary signalers are relatively numerous and in the market sufficiently infrequently that they are not expected to (and therefore do not) invest in acquiring signaling reputations."

**Applicability:** a checkbox ("I promise this is real") is a cheap signal; it does not separate a prankster from an honest customer. A phone number that a human answers is costlier to fake. The owner's call is a **screening** device, not a cryptographic guarantee. A one-shot prankster has no reputation to lose, so reputation systems do not bind them; a block list and a throttle do.

### F16. Quality uncertainty can unravel a market; screening institutions are the response

**Source:** George A. Akerlof, _The Market for "Lemons": Quality Uncertainty and the Market Mechanism_, _Quarterly Journal of Economics_ 84(3), August 1970, pp. 488–500, DOI 10.2307/1879431. Abstract reproduced at https://link.springer.com/chapter/10.1007/978-1-349-24002-9_9.

> "This paper relates quality and uncertainty. The existence of goods of many grades poses interesting and important problems for the theory of markets."
>
> "On the one hand, the interaction of quality differences and uncertainty may explain important institutions of the labor market. On the other hand, this paper presents a struggling attempt to give structure to the statement: 'Business in under-developed countries is difficult'; in particular, a structure is given for determining the economic costs of dishonesty."

**Applicability:** if owners cannot distinguish real from fake demand, they may stop accepting online orders or impose deposits on everyone, which drives away honest customers. The protocol's job is to keep the market from unraveling: make verification cheap for the owner, make abuse costly for the prankster, and preserve a low-friction path for the honest majority.

### F17. Vendor prank controls: targeted block is available; global callback validation taxes every customer

**Source:** Order Online, Inc., _What are my options for dealing with fake orders?_, last updated 2023-01-20, https://www.onlineordering.help/article/98-what-are-my-options-for-dealing-with-fake-orders.

> "For the Block or Discard future orders for this customer setting, there are 3 ways to handle the order - 'Flag Only,' 'Block Orders,' or 'Discard Orders.'"
>
> "This allows the customer to fully place the order and the order will go to the restaurant. The Order Sheet will show a huge message at the top that says that the customer's email, phone number, or delivery address is flagged, and the restaurant may want to call the customer to confirm the order before they make the food or process the order."
>
> "If you are getting fake/fraudulent orders, you can require customers to validate their callback number before they can place their order. This requires the customer to receive a call or text message and enter in a confirmation code at checkout. Please remember that this would apply to ALL orders – no customers would be excluded."

**Applicability:** a targeted block list is cheaper than universal verification; universal callback validation is a last resort because it taxes every honest customer and requires SMS/voice infrastructure. v1 uses the owner's call plus a block list; SMS verification is C.

### F18. No credible public base rate for fake/prank orders was found

**UNVERIFIED: [reason: no public dataset or peer-reviewed prevalence estimate for fake pickup orders in small local marketplaces was located; vendor pages describe controls, not base rates.]**

This matters more than any single control. The entire A/B/C choice depends on a number this report cannot supply. The recommendation is therefore **measure first, then escalate**. An owner interview or two weeks of coded declines is worth more than another vendor page.

### F19. B12's 24% figure is not the Baymard figure

B12 cites a "4,384-respondent" study and a 24% account-abandonment figure (`B12-order-basket.md:249`). The current Baymard page states 18% for "The site wanted me to create an account" and 19% for trust. **UNVERIFIED: [reason: B12 does not provide a URL or page for the 24% figure; the current Baymard page does not contain it.]** The report should use 18% with the Baymard citation, or omit the number.

### F20. Vendor dates

DoorDash's store-status page, Uber Eats' pause and academy pages, Square's help pages, Stripe's reference, Tock's guide, Shopify's guide, and Convex's component page are **undated**; the access date is 2026-10-20. DoorDash's operations-quality page states "Updated: October 20, 2026". Toast states "Last updated: Oct 6, 2026". Baymard states "Last updated: September 22, 2025". Do not present an access date as a publication date.

## 4.3 Fact, inference, and what the evidence does not support

| Type           | Statement                                                                                                                    | Status                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Fact           | Baymard's 50-study aggregate is 70.22%; account creation is 18% of non-browsing abandonment reasons                          | Verified on the page (F1–F2)                     |
| Fact           | DoorDash, Uber Eats, Toast, and Square all expose item/group/business/time availability as separate operational controls     | Verified in vendor docs (F3–F9)                  |
| Fact           | Stripe compares idempotency parameters and retains keys at least 24h                                                         | Verified (F10)                                   |
| Fact           | Tock recommends 10–15% deposits for reservations; Oh & Su model a no-show penalty up to the meal price                       | Verified (F11–F12)                               |
| Fact           | Shopify allows phone **or** email, not both, and an account wall hides accelerated checkout                                  | Verified (F13)                                   |
| Fact           | Spence: cheap signals do not transfer information when veracity incentives are weak; one-shot actors do not build reputation | Verified (F15)                                   |
| Fact           | Akerlof: quality uncertainty can create institutions and market unraveling                                                   | Verified (F16)                                   |
| Inference      | Owner phone verification is a costlier signal than a checkbox and is the right v1 screen                                     | This report; not directly tested                 |
| Inference      | A refundable deposit is weak screening; a non-refundable deposit is a tax on honest customers                                | This report's mechanism analysis (§4.4)          |
| Inference      | A per-business throttle document can serialize idempotency and throttle checks                                               | This report's design; needs a concurrency test   |
| **UNVERIFIED** | Fake/prank order prevalence in this market                                                                                   | No public base rate (F18)                        |
| **UNVERIFIED** | No-show prevalence in this market                                                                                            | No public base rate; the report does not use one |
| **UNVERIFIED** | The 24% account-abandonment figure in B12                                                                                    | B12 has no URL; Baymard says 18% (F19)           |
| **UNVERIFIED** | Multi-item baskets increase conversion or average order value here                                                           | No local data; product hypothesis                |
| **UNVERIFIED** | A deposit reduces pickup no-shows without hurting conversion                                                                 | Reservation evidence only; no pickup study found |

## 4.4 Mechanism design: what actually changes behavior

### Players, actions, information

- **Customer** chooses {order honestly, order as a prank, not order}. The customer knows their own type; the owner does not.
- **Owner** chooses {accept without verification, call then accept/decline, decline, pause}. The owner knows the order contents and contact, not the customer's type.
- **Platform** chooses the rules: what is required to submit, what the owner sees, what is throttled, what is blocked, what is recorded.
- **Information asymmetry:** the customer knows whether they will show/pay/answer; the owner sees only a name and a contact. This is Akerlof's quality-uncertainty problem in miniature.
- **One-shot vs repeat:** a prankster is usually one-shot; an honest local customer is repeat. Spence's one-shot signaler does not invest in reputation, so a reputation system does not bind the prankster. A phone that answers is a current-cost signal; a token receipt is a claim ticket, not a reputation.

### Payoffs (a simple model)

Let:

- `v` = honest customer's value of the meal; `p` = price; `c` = ordering time cost; `k` = expected cancellation cost.
- `d` = prankster's disruption payoff; `e` = effort to place a fake order; `s` = expected sanction/screening cost.
- Honest orders iff `v ≥ p + c + E[k]`.
- Prank orders iff `d ≥ e + s`.

Without screening, `s ≈ 0`: a fake name and a fake phone are free. With owner verification, `s = q·(cost of maintaining a reachable phone + risk of being identified/blocked)`, where `q` is the probability the owner actually calls. The owner calls iff `L·P(prank | order) ≥ c_v`, where `L` is the loss from a fake order (food cost + time + reputation) and `c_v` is the verification cost.

**Implications:**

1. If the base rate `P(prank)` is low, a rational owner skips the call. The platform must lower `c_v` (show the number, one-tap call, a short script, a one-tap decline reason) or raise `L` (block repeat offenders, track wasted food).
2. A **refundable** deposit `D` is a transfer, not a cost if the customer shows; it screens on liquidity/time preference, not on intent. It is weak screening.
3. A **non-refundable** deposit is a cost. It deters the prankster only if `D > d - e`; it deters the honest customer if `D > v - p - c`. For a $12 pickup meal, a $2 deposit may be below the prankster's disruption payoff and above a price-sensitive customer's surplus. That is why C is not the default.
4. **Universal callback validation** raises `e` for everyone, including the honest majority; the vendor page says so explicitly (F17). It is a last resort.
5. **Targeted block** raises `s` for repeat offenders without taxing first-time honest customers. It requires the owner to recognize the offender; it does not stop a new phone number.
6. **Throttle** raises `e` for scripted abuse and bounds the damage per window; it does not stop a determined human with many numbers.
7. **Owner verification** is the only control that directly checks the customer's intent at the moment of commitment. It is labor, not magic.

### Incentive compatibility and moral hazard

- The owner's accept action is **not** a guarantee of verification. The UI can prompt and record, but it cannot force a call. Treat "accept = verified" as an **operator norm**, measure it, and audit a sample. Do not encode it as a security invariant.
- The owner may accept without calling to avoid friction; the platform cannot observe the call. The best it can do is make the call one tap, show the number prominently, and review decline reasons.
- The customer may cancel after the owner starts; the owner bears the food cost. v1 has no payment, so the only remedy is a block/cancel record and a conversation. This is a known limitation, not a solved incentive problem.

### What would change the recommendation

| Observation (2–4 weeks)                                                             | Action                                                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Fake/abusive orders < 0.5% of submissions; owner call time > 30s/order              | Stay on B; optimize the accept flow; do not add deposits                              |
| Fake/abusive orders 0.5–2%; `Unreachable` declines < 5%                             | B is sufficient; tighten throttle/block, not deposits                                 |
| Fake/abusive orders > 2% for 2 consecutive weeks, or food-cost loss > 2% of revenue | Pilot C: verified phone (SMS) or a small non-refundable deposit; measure conversion   |
| Owner cannot sustain calls at volume                                                | Add staff role or auto-accept for trusted repeat customers (C), not a blanket deposit |
| Honest customers abandon at the verification step                                   | Remove friction; target only flagged contacts; do not universalize                    |

These thresholds are **hypotheses**, not evidence. They are deliberately conservative and must be revised with real data.

## 4.5 Measurement plan

**Events (no PII):** `order_submitted`, `order_accepted`, `order_declined` (reason code), `order_cancelled` (actor), `order_expired`, `receipt_viewed`, `basket_abandoned`, `throttle_rejected`, `block_hit`, `price_changed`, `item_unavailable_at_submit`, `ordering_closed_at_submit`, `owner_accept_latency_ms`.

**Metrics:**

- Submission → accept latency (p50, p95).
- Decline rate and reason mix (`Sold out`, `Unreachable`, `Too busy`, `Duplicate`, `Other`).
- Fake/abusive rate, defined as owner-flagged orders ÷ submissions (requires an owner flag).
- Cancellation rate by actor and state.
- Throttle hits per 1,000 submissions; block hits.
- Conversion: menu view → basket start → submit (per business).
- Basket size and subtotal distribution.
- Receipt views and repeat orders by token.
- Support tickets tagged "fake order", "can't cancel", "wrong price".

**Design:** two-week baseline, then two-week post-launch; interrupted time series per business; no A/B at small volume. Interview 3–5 owners after two weeks: "How many calls did you make? How long? Which orders did you decline? What did you do when you couldn't reach someone?"

**Privacy:** aggregate only; no contact data in analytics; retention policy in §6.2.

## 4.6 What the evidence does not support

- **"Deposits reduce pickup no-shows."** The evidence is for reservations (F11–F12); pickup is a different commitment. Do not claim it.
- **"Account creation reduces fake orders enough to justify the conversion cost."** No evidence; Baymard shows 18% abandon for account creation (F2), and Shopify shows an account wall can suppress accelerated checkout (F13).
- **"A checkbox is a commitment device."** Signaling theory says a costless signal does not separate types (F15).
- **"Multi-item baskets increase revenue here."** No local data; this is a product hypothesis (U10).
- **"24% of shoppers abandon because of account creation."** The verified figure is 18% (F19).
- **"Fake orders are X% of orders."** No base rate (F18).

---

# 5. Options and recommendation

## 5.1 Three genuine options

The options differ in **what the customer can commit to**, **what the owner can stop**, and **what the platform can prove**. They are not cosmetic variants of the same build.

| Dimension            | **A — Minimal**                                                                    | **B — Balanced (recommended)**                                                                            | **C — Strong**                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Customer unit**    | One item, one set of selections (today)                                            | 1–20 lines, quantities 1–20, one business                                                                 | B + scheduled pickup slot or delivery window                                                           |
| **Pricing**          | No server total; owner sees live price                                             | Server recomputes; snapshot; `expectedSubtotal` mismatch → re-confirm                                     | B + tax/fees/prepayment                                                                                |
| **Receipt**          | Token link (add)                                                                   | Token link + reference + masked contact                                                                   | B + account history + SMS/email updates                                                                |
| **States**           | `new → accepted → ready → completed` + `declined`, `cancelled`, `expired` (7)      | Base 7 + `no_show` (8 total), with actor-specific cancel rules                                            | B + refund states                                                                                      |
| **Owner controls**   | Decline/cancel; per-item availability                                              | Item, group, business pause, hours, optional auto-resume, block list                                      | B + staff roles, prep-time promises, capacity limits                                                   |
| **Abuse**            | Owner call + manual block (no code)                                                | Per-contact + per-business throttle, block list, expiry, audit                                            | B + verified phone (SMS/voice), deposit, reputation, device/IP signals                                 |
| **Identity**         | Guest only                                                                         | Guest + optional Clerk link (no extra authority)                                                          | Account required or strongly encouraged; verified phone                                                |
| **Migration**        | No schema change except token/state fields                                         | Expand/contract; legacy `submitOrder` preserved                                                           | B + payment/refund schema                                                                              |
| **Build estimate**   | **4–6 dev days** (estimate, ±50%)                                                  | **12–18 dev days** (estimate, ±50%)                                                                       | **25–40 dev days + payment/compliance** (estimate, ±50%)                                               |
| **Operational cost** | Owner calls every order; no throttle means spam can flood the board                | Owner calls new orders; block/throttle reduces repeat abuse; ~15–30 sec/order (hypothesis)                | SMS/deposit support, refunds, disputes, reconciliation                                                 |
| **Conversion risk**  | Low change, but no basket; duplicate/price gaps remain                             | Basket is neutral-to-positive; call happens **after** commit, so checkout is not blocked; guest preserved | Deposit/SMS **before** commit; account wall; measured conversion loss unknown and potentially material |
| **Residual risk**    | Duplicate orders, price rewrite, no pause/group/hours gate, no no-show state, spam | Determined prankster with many numbers; owner labor; no push                                              | Payment fraud/chargebacks, refund disputes, false negatives, accessibility of SMS                      |
| **Evidence fit**     | Fixes termination/receipt only                                                     | Fits every verified operational pattern (F3–F10, F13–F17)                                                 | Reservation deposit evidence (F11–F12) is not pickup evidence; account cost (F2)                       |
| **Reversibility**    | High                                                                               | High: each slice flagged/expand-only                                                                      | Low: payment/refund state is hard to unwind                                                            |

**Estimate basis:** the ranges are engineering estimates for this codebase (Convex + Next.js, one developer familiar with the code), not measured velocities. They exclude review, design, and the blocked environment repair. Treat them as relative size, not a quote.

## 5.2 Recommendation: B, Balanced

**B is the smallest option that closes every P0 in §3 without introducing a payment rail, an SMS vendor, or an account wall.** It also matches the verified operational patterns:

- **Item/group/business/time controls** are how DoorDash, Uber Eats, Toast, and Square actually run supply (F3–F9). B implements the subset this app can support without a scheduling model.
- **Idempotency + server pricing + snapshot** are standard commit integrity (F10 and R6/R11). They are not optional polish.
- **Token receipt + explicit terminal states** are the minimum for a customer to trust the commitment and for the owner to recover from a prank (R12/R15).
- **Guest checkout** is supported by the account-abandonment evidence (F2) and by the existing product decision for anonymous workflows (`convex/AGENTS.md`).
- **Owner verification is the fraud screen**, made explicit and cheap, not assumed (F15–F17). B does not pretend a checkbox is a control.
- **Throttle + block + expiry** bound the damage without taxing every honest customer (F17). Universal SMS/callback validation is C.
- **No deposit** because the evidence is reservation-specific (F11–F12) and the payment rail does not exist.

### Why not A

A fixes the two most visible failures (no decline/cancel, no receipt) but leaves four P0/P1 gaps that the brief explicitly asks to close: duplicate submit (R6), price rewrite (R11), no business/group/hours gate (R13/R14), and no multi-item composition (E02). It is only defensible if the product **decides** that multi-item ordering and supply switches are out of scope. The brief does not.

### Why not C now

- There is no payment rail; adding one brings refunds, disputes, chargebacks, tax, and reconciliation. That is a different product.
- The deposit evidence is for reservations with a predicted check average (F11–F12), not pickup.
- Universal callback/SMS verification taxes every honest customer; the vendor page says it applies to all orders and excludes no one (F17).
- An account wall is a known conversion cost (F2), and Shopify shows it can suppress accelerated checkout (F13).
- C is the right **escalation** if the measured fake/abuse rate crosses the threshold in §4.4. Build the measurement in B so the decision is evidence-based.

### What B deliberately does not solve

- A determined prankster who rotates phone numbers and answers plausibly. B raises cost and bounds volume; it does not eliminate the attack.
- An owner who accepts without calling. B prompts, records, and audits; it cannot force the call.
- A customer who cancels after the owner starts. B records the cancellation and the reason; without payment, the owner's only remedy is a block and a conversation.
- A business with no one watching the board. B expires stale orders and shows age; it does not add push/SMS.

These are stated so the recommendation is not oversold.

## 5.3 Explicit departures from B12

B12 is prior art, not a decision. This report agrees with its problem statement and most of its controls, and disagrees or corrects the following:

| B12 position                                                                                                                                                     | This report                                                                                                                    | Why                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| "Amends B8's single-item model" and keeps `menuItemId`/`selections` in prose, but the schema snippet replaces them with `items[]` (`B12-order-basket.md:77-120`) | Keep legacy fields **optional** during expand; add `items[]` alongside; dual-write; backfill; contract only after verification | The contradiction would break in-flight orders and `submitOrder` consumers. Expand/contract is the safe path.            |
| One-step migration "pre-launch" (`B12-order-basket.md:195-199`)                                                                                                  | Batched, idempotent backfill with checkpoints; no destructive step in the first deploy                                         | The app is running against a dev deployment; the tree has uncommitted user work; a one-step migration is not reversible. |
| 24% account abandonment from a 4,384-respondent study (`B12-order-basket.md:249`)                                                                                | Use 18% from Baymard with a URL, or omit the number                                                                            | 24% is unverified; the current Baymard page states 18% (F19).                                                            |
| "Accept means verified" (implied as a control, `B12-order-basket.md:251`)                                                                                        | Make it an explicit operator action, prompt, audit, and measured norm; do not treat it as a security guarantee                 | The owner can accept without calling; the platform cannot observe the call.                                              |
| No block list in the data model                                                                                                                                  | Add `orderBlocks` keyed by hashed contact                                                                                      | Targeted block is cheaper than universal verification and is supported by vendor practice (F17).                         |
| Throttle shape (per contact + global)                                                                                                                            | Keep the shape; add a per-business serialization document for idempotency + throttle                                           | A single business doc makes the duplicate check and the rate check atomic, without a component.                          |
| `menuGroups.isAvailable` + `businesses.acceptingOrders`                                                                                                          | Keep both; add `acceptingOrdersUntil` and an explicit no-hours policy                                                          | Time-bounded pause avoids a forgotten pause; no-hours must not silently stop trade.                                      |
| Token receipt                                                                                                                                                    | Keep; require ≥128-bit CSPRNG, masked contact, `Referrer-Policy: no-referrer`, and no token in logs                            | B12 notes the risk but does not specify the masking/referrer/log rules.                                                  |
| Staff roles                                                                                                                                                      | Defer; owner-only v1                                                                                                           | No staff table/role exists; adding one expands authz and audit scope.                                                    |

## 5.4 Deliberately out of scope for v1

| Not built                                   | Why                                                                                              | When it could return                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Customer accounts / order history           | Guest checkout is the conversion-preserving default; a token receipt is enough                   | If repeat-rate data justifies it (C)              |
| Deposits / payments / refunds               | No payment rail; reservation evidence does not transfer to pickup; refund state is a new product | If measured fake/abuse > threshold (C)            |
| SMS/email notifications                     | Requires a vendor, templates, consent, and deliverability; v1 board is realtime                  | C, or a separate notification slice               |
| Staff roles                                 | No staff model; owner-only is the current authz                                                  | When a business has staff and asks                |
| Scheduled pickup slots / prep-time promises | Needs a scheduling and capacity model; Square shows how much is involved (F9)                    | After v1, as a separate protocol                  |
| Multi-business cart                         | Splits fulfillment, cancellation, and communication; one business per order is simpler           | Only with a marketplace checkout rework           |
| Stock counts / reservations                 | `isAvailable` is a boolean; counts need concurrency and restock rules                            | If oversell persists after 86                     |
| Tax/fees                                    | No payment; adding fees changes the total and the price-mismatch contract                        | With payments                                     |
| Delivery                                    | Out of product scope                                                                             | —                                                 |
| Reputation / trusted-customer fast lane     | One-shot pranksters do not build reputation; needs history and identity                          | C                                                 |
| Per-channel availability                    | Only one pickup channel exists                                                                   | If delivery/channel partners are added            |
| Holiday/special hours                       | `hoursValidator` is weekly only (`businessTypes.ts:25-33`); a manual pause covers the need       | A later hours model                               |
| Menu visibility flag                        | A hidden menu that still takes orders is a trap; approval status is the visibility control       | If an unlisted/QR-only menu is a real requirement |
| Line edits after commit                     | Creates pricing/kitchen coordination and audit complexity; cancel + re-place is clearer          | Not planned                                       |
| Auto-accept                                 | Removes the verification screen                                                                  | Only for trusted repeat customers (C)             |
| Analytics dashboard / CSV export            | Measurement can start with events and queries; export is a privacy risk                          | After metrics prove useful                        |

## 5.5 Product decisions and working defaults

These are the product decisions and working defaults this report uses. The 2026-10-20 grill session resolved the implementation/operational questions in §8.2 without changing them; they remain the v1 working set.

| Decision                           | Default in this report                                               | Why                                                                                               | Impact if changed                                                            |
| ---------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Guest checkout vs account required | **Guest**                                                            | F2, F13; existing anonymous workflow decision                                                     | Account wall likely lowers conversion; C                                     |
| Basket scope                       | **One business per order**                                           | Fulfillment/cancellation are per business                                                         | Multi-business checkout needs split orders and a new total model             |
| Deposit in v1                      | **No**                                                               | F11–F12 are reservations; no payment rail                                                         | C; adds refund/dispute states                                                |
| Staff role in v1                   | **No**                                                               | No staff table/role; authz is owner-only                                                          | Adds schema, invitations, scoped audit                                       |
| Hours gate when `hours` is empty   | **Skip the gate**                                                    | Avoid silently stopping trade for incomplete profiles; B12 agrees (`B12-order-basket.md:164-168`) | A strict gate would reject orders for businesses that never configured hours |
| TTL for `new`                      | **60 minutes**                                                       | Long enough for a busy owner; short enough to free the board                                      | Shorter → more expired orders; longer → stale holds                          |
| Customer cancel after accept       | **No** (call the business)                                           | The kitchen has started; no refund model                                                          | If allowed, need a cost/refund policy and owner notification                 |
| Owner cancel after accept          | **Yes, with reason (from `accepted` or `ready`)**                    | Operational reality (sold out, unreachable)                                                       | If no, the order is stuck                                                    |
| Line edits after commit            | **No**                                                               | Pricing/kitchen coordination; audit complexity                                                    | If yes, need a new amendment state and re-pricing                            |
| Menu visibility switch             | **No**                                                               | Hidden + open is a trap; approval status gates visibility                                         | If needed, add `menuVisible` and decide hidden-but-orderable                 |
| Owner verification mandatory       | **No** (prompt + audit)                                              | A checkbox is cheap talk; forcing a checkbox is theater                                           | If mandatory, define the evidence and the audit, not just a tick             |
| Admin order access                 | **No**                                                               | Privacy; support path must be scoped and audited                                                  | If yes, add a break-glass role with audit                                    |
| Auto-resume after pause            | **Optional `acceptingOrdersUntil`**                                  | Prevents forgotten pauses; Uber Eats pauses end at end of day (F5)                                | If no, add an owner reminder instead                                         |
| Price mismatch behavior            | **Reject + show new total**                                          | Customer protection; no silent overcharge                                                         | If accept silently, trust/chargeback risk                                    |
| Throttle limits                    | **3/10 min, 10/24 h per contact; 60/10 min per business** (defaults) | Bounds scripted abuse without blocking a normal rush                                              | Tune with measured false positives                                           |
| Reference length                   | **6 chars, per business, not a global lookup**                       | Human-readable phone reference; token is the capability                                           | Longer = fewer collisions; shorter = easier phone read                       |
| Receipt contact display            | **Masked**                                                           | Token leak should not expose full PII                                                             | If full, the token becomes a PII bearer                                      |

---

# 6. Protocol specification

## 6.1 State machine

### States

| State       | Meaning                                                      | Terminal? | Who can put an order here                                                                                  |
| ----------- | ------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------- |
| `new`       | Committed by the customer; not yet acknowledged by the owner | No        | `placeOrder`                                                                                               |
| `accepted`  | Owner verified and accepted; kitchen may start               | No        | Owner `accept`                                                                                             |
| `ready`     | Food is ready for pickup                                     | No        | Owner `ready`                                                                                              |
| `completed` | Handed to the customer                                       | **Yes**   | Owner `complete`                                                                                           |
| `declined`  | Owner refused before accepting                               | **Yes**   | Owner `decline` (reason required)                                                                          |
| `cancelled` | Customer or owner cancelled                                  | **Yes**   | Visitor `cancel` (only from `new`, token); owner `cancel` (from `new`/`accepted`/`ready`, reason required) |
| `expired`   | Not accepted within the TTL                                  | **Yes**   | System `expire` (only from `new`)                                                                          |
| `no_show`   | Customer did not pick up a `ready` order                     | **Yes**   | Owner `noShow` (only from `ready`)                                                                         |

`no_show` is deliberately separate from `cancelled`: it is an operational outcome that matters for future deposits and for the owner's metrics. It is not a customer cancellation. The customer cannot set it.

### Transitions

| From                                                           | Action     | Actor           | Guard                                                          | To          | Side effects                                                                                                                         | Error on failure                                      |
| -------------------------------------------------------------- | ---------- | --------------- | -------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| —                                                              | `submit`   | Visitor         | All `placeOrder` guards (§6.4)                                 | `new`       | Insert order, `orderAccess`, `orderIdempotency`, `orderExpiry`, event `submitted`, owner `new_order` notification                    | See §6.5/§6.7 codes                                   |
| `new`                                                          | `accept`   | Owner           | `requireBusinessOwner`; order belongs to business; not expired | `accepted`  | Patch status + `statusUpdatedAt`; event `accepted`; delete the `orderExpiry` row                                                     | `ORDER_EXPIRED`, `ORDER_ALREADY_DECIDED`, `FORBIDDEN` |
| `new`                                                          | `decline`  | Owner           | Owner; reason 1–200                                            | `declined`  | Patch status + reason; event `declined`; delete the `orderExpiry` row; optional owner notification                                   | `REASON_REQUIRED`, `ORDER_ALREADY_DECIDED`            |
| `new`                                                          | `cancel`   | Visitor (token) | Token matches; status `new`                                    | `cancelled` | Patch status + reason `Cancelled by customer`; event `cancelled`; delete the `orderExpiry` row; owner notification `order_cancelled` | `CANNOT_CANCEL`, `ORDER_EXPIRED`                      |
| `new`                                                          | `cancel`   | Owner           | Owner; reason 1–200                                            | `cancelled` | Patch status + reason; event `cancelled`; delete the `orderExpiry` row                                                               | `REASON_REQUIRED`                                     |
| `accepted`                                                     | `ready`    | Owner           | Owner                                                          | `ready`     | Patch status; event `ready`                                                                                                          | `INVALID_TRANSITION`, `ORDER_ALREADY_DECIDED`         |
| `accepted`                                                     | `cancel`   | Owner           | Owner; reason 1–200                                            | `cancelled` | Patch status + reason; event `cancelled`; delete any stale `orderExpiry` row                                                         | `REASON_REQUIRED`                                     |
| `ready`                                                        | `complete` | Owner           | Owner                                                          | `completed` | Patch status; event `completed`                                                                                                      | `INVALID_TRANSITION`                                  |
| `ready`                                                        | `noShow`   | Owner           | Owner; reason optional (default `Not picked up`)               | `no_show`   | Patch status + reason; event `no_show`                                                                                               | `INVALID_TRANSITION`                                  |
| `ready`                                                        | `cancel`   | Owner           | Owner; reason 1–200                                            | `cancelled` | Patch status + reason; event `cancelled`; delete any stale `orderExpiry` row                                                         | `REASON_REQUIRED`                                     |
| `new`                                                          | `expire`   | System          | `orderExpiry.expiresAt <= now`; status `new`                   | `expired`   | Patch status + reason `Not accepted within 60 minutes`; event `expired`; delete the expiry row                                       | no-op if already decided                              |
| `completed` / `declined` / `cancelled` / `expired` / `no_show` | any        | —               | —                                                              | —           | Reject                                                                                                                               | `ORDER_TERMINAL`                                      |

**Idempotent repeats.** Repeating the **same** action when the order is already in its target state is a success with `reused: true` and no new event. This covers double-click and OCC retry. Repeating a **different** action in a non-terminal state is `INVALID_TRANSITION`; in a terminal state it is `ORDER_TERMINAL`. A concurrent `accept` and `decline` has one winner; the loser gets `ORDER_ALREADY_DECIDED`.

**No implicit transitions.** There is no timer that moves `accepted → ready`, no "auto-complete after N minutes," and no status change from a menu edit. The only timer is expiry from `new`.

**No client status.** `transitionOrderStatus` accepts `action`, never `status` (`INV-11`). The server resolves the target from the current status.

**Compensation.** v1 has no money. Declining, cancelling, expiring, or no-showing does not issue a refund. If a payment is added later, the refund policy must be attached to each terminal transition; the state machine already gives it a clean seam.

### Diagram

```
                 accept                ready                complete
  new ─────────────────────▶ accepted ────────▶ ready ───────────────▶ completed
   │  │                         │                  │
   │  │ decline                 │ cancel           │ cancel / noShow
   │  ▼                         ▼                  ▼
   │ declined                 cancelled          cancelled / no_show
   │
   │ cancel (token, only new)
   ▼
 cancelled

  new ──expire (TTL)──▶ expired
```

## 6.2 Data model

### 6.2.1 Current model (for comparison)

```ts
// convex/schema.ts:183-203 (current)
orders: defineTable({
  businessId: v.id('businesses'),
  menuItemId: v.id('menuItems'),
  customerName: v.string(),
  contactPhone: v.optional(v.string()),
  contactEmail: v.optional(v.string()),
  selections: v.array(v.object({ optionName: v.string(), choiceName: v.string() })),
  note: v.optional(v.string()),
  status: v.union(
    v.literal('new'),
    v.literal('accepted'),
    v.literal('ready'),
    v.literal('completed')
  ),
  createdAt: v.number(),
}).index('byBusinessId', ['businessId']);
```

There is no price, token, reference, reason, expiration, event, idempotency, throttle, or block. `menuGroups` has no availability flag (`schema.ts:112-119`); `businesses` has no ordering pause (`schema.ts:40-71`).

### 6.2.2 Proposed model (expand)

```ts
// Proposed additions — additive only in the first deploy.
orders: defineTable({
  businessId: v.id('businesses'),

  // New committed lines. Optional during expand; required by placeOrder.
  items: v.optional(v.array(v.object({
    menuItemId: v.id('menuItems'),
    name: v.string(),
    unitPrice: v.optional(v.number()),       // integer cents; undefined = unpriced
    quantity: v.number(),                     // 1..20
    selections: v.array(v.object({
      optionName: v.string(),
      choiceName: v.string(),
      priceAdjustment: v.optional(v.number()), // integer cents; default 0
    })),
    lineTotal: v.optional(v.number()),        // unitPrice + adjustments, × quantity
  }))),
  subtotal: v.optional(v.number()),           // undefined if any line is unpriced
  pricingSource: v.optional(v.union(v.literal('snapshot'), v.literal('legacyUnknown'))),

  // Customer-entered fields (unchanged names for compatibility)
  customerName: v.string(),
  contactPhone: v.optional(v.string()),
  contactEmail: v.optional(v.string()),
  note: v.optional(v.string()),

  // State
  status: v.union(
    v.literal('new'), v.literal('accepted'), v.literal('ready'),
    v.literal('completed'), v.literal('declined'), v.literal('cancelled'),
    v.literal('expired'), v.literal('no_show')
  ),
  statusReason: v.optional(v.string()),
  statusUpdatedAt: v.optional(v.number()),    // fallback to createdAt for legacy rows
  expiresAt: v.optional(v.number()),           // display only; the sweep uses orderExpiry
  customerUserId: v.optional(v.id('users')),   // optional link; never an authority

  createdAt: v.number(),

  // Legacy fields kept during expand; submitOrder still writes them.
  menuItemId: v.optional(v.id('menuItems')),
  selections: v.optional(v.array(v.object({ optionName: v.string(), choiceName: v.string() }))),
})
  .index('byBusinessId', ['businessId'])
  .index('byBusinessIdStatus', ['businessId', 'status']),

// A bearer capability and a human reference, separate from the order so a broad
// owner query or a future export cannot accidentally expose the token.
orderAccess: defineTable({
  orderId: v.id('orders'),
  businessId: v.id('businesses'),
  accessToken: v.string(),   // 32 random bytes, base64url; 256 bits
  reference: v.string(),     // 6 chars, unique per business, not a capability
  createdAt: v.number(),
})
  .index('byAccessToken', ['accessToken'])
  .index('byOrderId', ['orderId'])
  .index('byBusinessIdReference', ['businessId', 'reference']),

// Idempotency is scoped to a business; keys are not global.
orderIdempotency: defineTable({
  businessId: v.id('businesses'),
  key: v.string(),           // client UUID, 16..64 chars
  argsHash: v.string(),      // SHA-256 hex of canonical args
  orderId: v.id('orders'),
  createdAt: v.number(),
})
  .index('byBusinessIdKey', ['businessId', 'key'])
  .index('byCreatedAt', ['createdAt']),

// A required-field expiry schedule. Legacy rows are never inserted here, so an
// optional `orders.expiresAt` cannot pull them into the sweep.
orderExpiry: defineTable({
  orderId: v.id('orders'),
  businessId: v.id('businesses'),
  expiresAt: v.number(),
})
  .index('byExpiresAt', ['expiresAt'])
  .index('byOrderId', ['orderId']),

// Append-only audit of order transitions.
orderEvents: defineTable({
  orderId: v.id('orders'),
  businessId: v.id('businesses'),
  actorType: v.union(v.literal('customer'), v.literal('owner'), v.literal('system')),
  actorUserId: v.optional(v.id('users')),
  action: v.union(
    v.literal('submitted'), v.literal('accepted'), v.literal('declined'),
    v.literal('cancelled'), v.literal('ready'), v.literal('completed'),
    v.literal('expired'), v.literal('no_show')
  ),
  fromStatus: v.optional(v.string()),
  toStatus: v.string(),
  reason: v.optional(v.string()),
  createdAt: v.number(),
}).index('byOrderIdCreatedAt', ['orderId', 'createdAt']),

// Fixed-window counters. Contact keys are hashes; business keys are ids.
orderThrottle: defineTable({
  key: v.string(),           // "contact:<businessId>:<sha256>:10m" | "contact:<businessId>:<sha256>:24h" | "business:<id>:10m"
  windowStart: v.number(),
  count: v.number(),
}).index('byKey', ['key']),

// Owner-managed block list. The contact is hashed at rest.
orderBlocks: defineTable({
  businessId: v.id('businesses'),
  contactHash: v.string(),   // SHA-256 of normalized phone/email
  reason: v.optional(v.string()),
  createdByUserId: v.id('users'),
  createdAt: v.number(),
}).index('byBusinessIdContactHash', ['businessId', 'contactHash']),

// Existing tables, additive fields:
businesses: defineTable({
  // ...existing fields...
  acceptingOrders: v.optional(v.boolean()),       // default true when undefined
  acceptingOrdersUntil: v.optional(v.number()),   // optional auto-resume timestamp
  acceptingOrdersNote: v.optional(v.string()),    // e.g. "Back at 5"
  orderProtocol: v.optional(v.union(v.literal('legacy'), v.literal('basket'))), // default legacy
}),

menuGroups: defineTable({
  // ...existing fields...
  isAvailable: v.optional(v.boolean()),           // default true when undefined
}),
```

### 6.2.3 Why the token, idempotency key, and expiry live in side tables

- **Privacy:** `orders` is read by the owner board, admin tooling, and future exports. Keeping the bearer token off that row reduces the chance it is returned by a broad query or log.
- **Index correctness:** `orderAccess`, `orderIdempotency`, and `orderExpiry` have **required** indexed fields, so the lookups do not depend on optional-field index semantics or on every legacy row being backfilled before the index is usable. In particular, a legacy `new` order has no `orderExpiry` row, so the sweep cannot expire it by accident.
- **Separation:** the token is a capability; the order is a record; the expiry row is a schedule. A token rotation, revocation, or expiry-policy change can be made without rewriting the order row.

Convex does not enforce unique indexes. Uniqueness is enforced in the mutation transaction. The critical section is: (1) fast-path idempotency lookup, so a retry does not consume a throttle slot; (2) read/patch the per-business throttle document, which is the serialization write; (3) re-check idempotency, because a concurrent transaction may have inserted while this one waited; (4) contact throttle/block checks; (5) the remaining guards and the insert. The re-check is what makes check-then-insert safe under OCC retry. S1 enforces the business limit and uses the same row for serialization; S4 adds the contact throttle and block list.

### 6.2.4 Constants

| Constant                  | Value               | Notes                                                    |
| ------------------------- | ------------------- | -------------------------------------------------------- |
| `MAX_LINES`               | 20                  | Server validator                                         |
| `MAX_QUANTITY_PER_LINE`   | 20                  | Server validator                                         |
| `MAX_TOTAL_UNITS`         | 100                 | Sum of quantities                                        |
| `MAX_SELECTIONS_PER_LINE` | 32                  | Matches today's `MAX_SELECTIONS` (`orders.ts:25`)        |
| `MAX_NAME`                | 80                  | Trim; reject control chars                               |
| `MAX_NOTE`                | 500                 | Matches today (`orders.ts:57-64`)                        |
| `MAX_PHONE_DIGITS`        | 20                  | Normalize to digits; keep a leading `+` only for display |
| `MIN_PHONE_DIGITS`        | 7                   | Reject obviously incomplete numbers                      |
| `MAX_EMAIL`               | 254                 | Basic shape check                                        |
| `DEFAULT_TTL_MS`          | 60 × 60 × 1000      | Configurable per deployment/business later               |
| `IDEMPOTENCY_TTL_MS`      | 24 × 60 × 60 × 1000 | Stripe's minimum retention (F10)                         |
| `TOKEN_BYTES`             | 32                  | 256 bits, base64url                                      |
| `REFERENCE_LENGTH`        | 6                   | Alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (32 chars)   |
| `CONTACT_THROTTLE_10M`    | 3                   | Per hashed contact                                       |
| `CONTACT_THROTTLE_24H`    | 10                  | Per hashed contact                                       |
| `BUSINESS_THROTTLE_10M`   | 60                  | Per business                                             |
| `MONEY`                   | integer cents       | No floats; `Number.isInteger`                            |
| `MAX_ORDER_VALUE`         | 100000              | $1,000 cap before unpriced lines; abuse bound            |

**Money units (decision, T8).** `menuItems.price` and `customizationOptions[].priceAdjustment` are stored as
**integer cents**, the same unit as `orders.items[].unitPrice` and `orders.subtotal`. The owner editor
accepts a decimal dollar value and multiplies by 100 on save; every display surface divides by 100.
`formatPrice` (in `lib/order-format.ts` and `components/profile/ordering-panel-helpers.ts`) is the single
display boundary. No conversion happens in `placeOrder` or `submitOrder` — `unitPrice = item.price`
already. Seed fixtures (`convex/businesses/seedFixtures.ts`) store cents (e.g. `price: 1450` = $14.50).

### 6.2.5 Pricing algorithm

For each line, in order:

1. Load the item and its group. Reject if missing, `businessId` mismatch, item unavailable, or group unavailable.
2. Validate every required option has exactly one choice; reject unknown options/choices and duplicate option names.
3. `unitPrice = item.price` (integer cents or `undefined`).
4. `adjustment = sum(selectedOption.priceAdjustment ?? 0)`.
5. `lineTotal = unitPrice === undefined ? undefined : (unitPrice + adjustment) * quantity`.
6. `subtotal = any lineTotal undefined ? undefined : sum(lineTotal)`.
7. Reject if `subtotal` is defined and > `MAX_ORDER_VALUE`.
8. Compare `expectedSubtotal`:
   - If both are defined and differ → `PRICE_CHANGED` with `actualSubtotal`.
   - If the client sent a number and the server has `undefined` → `PRICE_UNAVAILABLE` ("This item has no price; confirm at pickup").
   - If the client sent `null` and the server has a number → `PRICE_CHANGED` with `actualSubtotal` (the client must re-confirm; do not silently charge).
   - If both are `null`/`undefined` → accept.
9. Snapshot `name`, `unitPrice`, `lineTotal`, and the selected `optionName`/`choiceName`/`priceAdjustment` into `items[]`.

The server never reads a price from the request. The request contains only ids, quantities, and selections.

### 6.2.6 Access token and reference

- **Token:** `crypto.getRandomValues(new Uint8Array(32))`, base64url. Do not derive it from the order id, timestamp, or contact. Store it only in `orderAccess`. Never log it. The receipt URL is `/order/<token>`; the page sends `Referrer-Policy: no-referrer` and has no third-party embeds.
- **Reference:** 6 characters from a 32-character alphabet that omits ambiguous `0/O/1/I`. Unique per business (`byBusinessIdReference`), retry up to 5 on collision, then 7 characters. It is a phone/handoff reference, **not** a lookup capability; the owner can search within their business, the public cannot.
- **Receipt projection:** business name and phone, items (name, quantity, selections), subtotal or "Total at pickup," status, reason, timestamps, masked contact (`***-0100`, `a***@example.com`). No full contact, no customer user id, no token echoed in JSON.

### 6.2.7 Order events

Every transition inserts one `orderEvents` row **in the same transaction** as the status patch. The event is append-only: no update/delete mutation is exposed. The owner board reads events for the detail view; the customer receipt does not expose actor ids.

`submitted` is written by `placeOrder` with `actorType: 'customer'` and no `actorUserId` (anonymous) or the linked user id if authenticated. `expired` is `actorType: 'system'`. `declined`/`cancelled`/`no_show` carry the reason. `accepted`/`ready`/`completed` carry the owner's user id.

### 6.2.8 Ownership toggles and audit

`setAcceptingOrders`, `setGroupAvailability`, and the existing item availability mutation write an `auditLogs` row with:

- `actorUserId` = owner's user id,
- `action` = `orders.acceptingOrders.toggled` | `orders.groupAvailability.toggled` | `orders.itemAvailability.toggled`,
- `targetType` = `business` | `menuGroup` | `menuItem`,
- `targetId` = the id,
- `reason` = the optional note.

The order board's own transitions use `orderEvents`; the supply toggles use `auditLogs`. Two logs, two purposes: order history vs. configuration history.

### 6.2.9 Migration: expand / backfill / switch / contract

**Step 0 — freeze a backup and record the counts.** On the target deployment, record `orders` count, `orders` by status, and `menuItems` count. Do not run a destructive migration.

**Step 1 — schema expand (additive).** Add optional fields, new tables (`orderAccess`, `orderIdempotency`, `orderExpiry`, `orderEvents`, `orderThrottle`, `orderBlocks`), and new indexes. Deploy. Existing code keeps working because every new field is optional and `status` widens. `submitOrder` still writes the legacy fields. No behavior change.

**Step 2 — backfill `orderAccess` and `items[]`, not prices.**

- For every order without an `orderAccess` row: generate token + reference, insert `orderAccess`.
- Derive `items[]` as one line: `menuItemId` (if present), current `name` or `(item removed)`, quantity 1, legacy `selections`, `unitPrice: undefined`, `lineTotal: undefined`; set `pricingSource: 'legacyUnknown'`; leave `subtotal` undefined.
- **Do not** use the current menu price. The historical price is unrecoverable; pretending it is the current price repeats the R11 bug in the backfill.
- **Do not** set `expiresAt` on legacy orders and **do not** create `orderExpiry` rows for them. Retroactively expiring `new` orders would change behavior; the owner can decline them.
- Batch 50, checkpoint by `_creationTime`/id, idempotent (skip if `orderAccess` exists). Log counts, not PII.

**Step 3 — deploy the new backend behind a per-business flag.** Add `businesses.orderProtocol: 'legacy' | 'basket'` (optional, default `legacy`) or an equivalent feature flag. Deploy `placeOrder` (which inserts `orderExpiry`), `getOrderByToken`, `cancelOrder`, the extended `transitionOrderStatus`, `setAcceptingOrders`, `setGroupAvailability`, `expireOrder`, `sweepExpiredOrders` (which queries `orderExpiry.byExpiresAt`), and the block/throttle helpers. The legacy `submitOrder` remains untouched and callable. `placeOrder` rejects any business whose flag is not `basket`; missing/unknown = `legacy`. The public UI reads the flag from `getPublic`; a business on `legacy` keeps the old panel.

**Step 4 — verify the backfill.** Every order has exactly one `orderAccess`; token lookup works for a sample; legacy `new` orders still appear on the board; a legacy order's receipt shows "Price not recorded / Total at pickup," not a fabricated number.

**Step 5 — pilot.** Enable `basket` for 1–3 businesses. Re-run the `orderAccess`/`items[]` backfill for each business at switch so legacy orders created after S1 get receipts. Run the handler and E2E suites. Watch decline reasons and accept latency for two weeks.

**Step 6 — expand.** Enable by default for new businesses; keep the flag for rollback. Do not remove legacy fields. A contract step (make legacy fields unread, then remove) requires a separate approval and a retention decision.

**In-flight orders.** Legacy orders remain valid at every step. `listOrders` projects `items[]` when present and falls back to the legacy join when not. `getOrderStatus` (id-based) remains for old receipts; the new token receipt is additive. A legacy order that is `new` can be declined/cancelled through the new owner actions (the status union accepts the target). A legacy order that is `completed` stays terminal. Because legacy orders have no `orderExpiry` row, the sweep cannot expire them.

**Rollback.** Set the business flag back to `legacy`; the old panel and `submitOrder` still work. The additive schema can remain. If a new-order bug is found, disable `basket` for all businesses; new orders already created remain readable via token and the owner board. No data is deleted.

## 6.3 Invariants, enforcement seams, and test mapping

The canonical invariant statements are **INV-01..INV-30 in §3.3**. This section fixes where each P0 is enforced and which test layer must prove it. A P0 with no test is a release blocker.

| Invariant                   | Enforcement seam                                                                                    | Test layer            | Test name / file                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| INV-01 server price         | `priceBasket` called only by `placeOrder`; request has no price field                               | Pure + handler        | `order-commit-policy.test.ts` pricing matrix; `orders.test.ts` "server ignores a client price"                              |
| INV-02 unpriced total       | `priceBasket` returns `undefined` if any line is unpriced; serializer returns `null`                | Pure + handler        | `order-commit-policy.test.ts`; `orders.test.ts` "unpriced line yields a null subtotal"                                      |
| INV-03 caps                 | `validateBasket` before any DB write                                                                | Pure + handler        | `order-commit-policy.test.ts` boundary matrix                                                                               |
| INV-04 idempotency          | `claimBusinessThrottle` + `orderIdempotency` check in one mutation                                  | Handler + concurrency | `orders.test.ts` `Promise.all` same key; different args conflict                                                            |
| INV-05 token entropy        | `createAccessToken` (CSPRNG); no id derivation; logging test                                        | Unit + review         | `order-commit-policy.test.ts` length/charset; grep for token in logs                                                        |
| INV-06 token scope          | `getOrderByToken` query by token; defense check `order.businessId === access.businessId`            | Handler               | `orders.test.ts` wrong token / cross-business                                                                               |
| INV-07 owner authority      | `requireBusinessOwner` + `order.businessId` check on every owner mutation                           | Handler               | Existing 10 tests + new mutation negatives                                                                                  |
| INV-08 cancel authority     | `cancelOrder` token + status; `transitionOrderStatus` owner + status + reason                       | Handler               | `orders.test.ts` visitor cancel `new`, reject `accepted`; owner cancel `new`/`accepted`/`ready`; no-show owner-only `ready` |
| INV-09 terminal             | `nextOrderStatus` returns `null`; terminal set                                                      | Pure + handler        | `order-commit-policy.test.ts` all 8×9 pairs                                                                                 |
| INV-10 create guards        | `placeOrder` guard chain; no other public create                                                    | Handler               | Every kill-switch test calls `placeOrder` directly                                                                          |
| INV-11 action-only          | Validators accept `action`, not `status`; `nextOrderStatus`                                         | Pure + typecheck      | Schema/type; handler rejects unknown action                                                                                 |
| INV-12 events               | `appendOrderEvent` in every transition                                                              | Handler               | Count events for each transition; no event on idempotent repeat                                                             |
| INV-13 snapshot             | `items[]` written at commit; no live join for new orders                                            | Handler               | Edit price/item after commit; order unchanged                                                                               |
| INV-14 throttle             | `claimThrottle` on contact + business keys                                                          | Handler               | N+1 rejects; window reset                                                                                                   |
| INV-15 expiry               | `expireOrder` internal mutation; `orderExpiry.byExpiresAt`; delete the row on accept/decline/cancel | Handler + scheduler   | Expire new; accepted no-op; terminal; legacy has no row                                                                     |
| INV-16 reason               | `decline`/`cancel`/`noShow` validators; receipt projection                                          | Pure + handler        | Decline/cancel: missing/blank/201-char reason rejected; no-show: default reason applied                                     |
| INV-17 pause vs pending     | Create-only guard; transitions do not read `acceptingOrders`                                        | Handler               | Pause then accept/decline pending                                                                                           |
| INV-18 kill switches        | Direct handler calls, not UI                                                                        | Handler               | Paused/group/item/hours each rejects                                                                                        |
| INV-19 stale client         | Error envelope with code + recovery                                                                 | Handler + UI          | Price mismatch, item sold out, closed                                                                                       |
| INV-20 receipt durability   | `/order/[token]` server-rendered; no third-party embeds                                             | E2E                   | Refresh/bookmark; referrer header                                                                                           |
| INV-21 operator idempotence | Repeat check before `nextOrderStatus`; OCC                                                          | Handler + concurrency | Double accept success; accept+decline one winner                                                                            |
| INV-22 toggle audit         | `auditLogs` insert in each toggle mutation                                                          | Handler               | Audit row per toggle                                                                                                        |
| INV-23 board filter         | `byBusinessIdStatus` index; query order                                                             | Handler               | Old `new` not starved by completed                                                                                          |
| INV-24 contact              | `parseContact` pure                                                                                 | Pure + handler        | Boundary matrix                                                                                                             |
| INV-25 no PII logs          | Review + redaction helper; no `console.log(contact)`                                                | Review + grep         | Log audit                                                                                                                   |
| INV-26 accessibility        | UI tests / manual                                                                                   | E2E                   | Keyboard + screen reader script                                                                                             |
| INV-27 error copy           | `messageForOrderError` map                                                                          | Pure + UI             | Every code has a message                                                                                                    |
| INV-28 offline              | Age badge + expiry                                                                                  | UI + handler          | Age visible; TTL                                                                                                            |
| INV-29 public menu          | `listForBusiness` approved check; `publicItem` projection                                           | Handler               | Unapproved returns null; no private fields                                                                                  |
| INV-30 retention            | Documented policy + admin guard                                                                     | Review                | Hard-delete guard test                                                                                                      |

## 6.4 Authorization and capability matrix

### Checks

| Check                                            | What it proves                                              | Where                                         |
| ------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------- |
| `requireOrderToken(ctx, token)`                  | The caller holds a valid bearer token for exactly one order | `getOrderByToken`, `cancelOrder`              |
| `requireBusinessOwner(ctx, businessId)`          | Clerk identity + `users` row + `businesses.ownerId`         | Every owner query/mutation (`authz.ts:56-74`) |
| `requireBusinessOrder(ctx, businessId, orderId)` | Owner check **and** `order.businessId === businessId`       | `listOrders` detail, every transition         |
| `getIdentityOrNull(ctx)`                         | Optional Clerk link; never an authority                     | `placeOrder` (`customerUserId`)               |
| `requireBasketProtocol(business)`                | `orderProtocol === 'basket'`; missing/unknown = `legacy`    | `placeOrder`                                  |
| Internal function                                | Not callable from a client                                  | `expireOrder`, backfill                       |
| `requireSuperAdmin(ctx)`                         | Platform moderation only; **not** order PII                 | Existing admin tools                          |

**No role flag grants order access.** A `users.role` of `superAdmin` does not open the owner board. Ownership is the only owner capability. A future staff capability must be an explicit grant table with a business scope, not a global role.

### Matrix

Legend: ✅ allowed; ❌ denied; ⚠️ allowed only under the stated condition.

| Action                         | Anonymous visitor            | Authenticated customer | Owner                               | Staff (future)   | Super admin       | System                |
| ------------------------------ | ---------------------------- | ---------------------- | ----------------------------------- | ---------------- | ----------------- | --------------------- |
| Browse an approved menu        | ✅                           | ✅                     | ✅                                  | ✅               | ✅ (as public)    | —                     |
| Create an order (`placeOrder`) | ✅ rate-limited              | ✅ rate-limited        | ✅ as a customer                    | ✅ as a customer | ✅ as public only | ❌                    |
| View receipt by token          | ✅ token                     | ✅ token               | ✅ token/board                      | ✅ board         | ❌                | ✅ internal           |
| List a business's orders       | ❌                           | ❌                     | ✅ `requireBusinessOwner`           | ✅ scoped grant  | ❌                | ❌                    |
| View full contact / PII        | ❌ (masked receipt)          | ❌ (masked receipt)    | ✅ own business                     | ✅ scoped        | ❌                | ❌                    |
| Edit basket before commit      | ✅ local                     | ✅ local               | ✅ local                            | ✅ local         | ✅ local          | —                     |
| Edit committed lines           | ❌                           | ❌                     | ❌ (cancel/re-place)                | ❌               | ❌                | ❌                    |
| Cancel as customer             | ✅ token, `new` only         | ✅ token, `new` only   | ✅ as customer                      | ✅ as customer   | ❌                | ❌                    |
| Cancel as owner                | ❌                           | ❌                     | ✅ `new`/`accepted`/`ready`, reason | ✅ scoped        | ❌                | ❌                    |
| Accept                         | ❌                           | ❌                     | ✅ `new`                            | ✅ scoped        | ❌                | ❌                    |
| Decline                        | ❌                           | ❌                     | ✅ `new`, reason                    | ✅ scoped        | ❌                | ❌                    |
| Ready                          | ❌                           | ❌                     | ✅ `accepted`                       | ✅ scoped        | ❌                | ❌                    |
| Complete                       | ❌                           | ❌                     | ✅ `ready`                          | ✅ scoped        | ❌                | ❌                    |
| No-show                        | ❌                           | ❌                     | ✅ `ready`                          | ✅ scoped        | ❌                | ❌                    |
| Expire                         | ❌                           | ❌                     | ❌                                  | ❌               | ❌                | ✅ scheduled internal |
| Toggle item availability       | ❌                           | ❌                     | ✅ own menu                         | ❌ v1            | ❌                | ❌                    |
| Toggle group availability      | ❌                           | ❌                     | ✅ own menu                         | ❌ v1            | ❌                | ❌                    |
| Toggle business ordering       | ❌                           | ❌                     | ✅ own business                     | ❌ v1            | ❌                | ❌                    |
| Clear a contact throttle       | ❌                           | ❌                     | ✅ own business, audited            | ❌               | ❌                | ❌                    |
| Block / unblock a contact      | ❌                           | ❌                     | ✅ own business                     | ❌               | ❌                | ❌                    |
| View order events              | ✅ via receipt (status only) | ✅ via receipt         | ✅ board                            | ✅ scoped        | ❌                | ❌                    |
| View configuration audit       | ❌                           | ❌                     | ✅ own business                     | ✅ scoped        | ❌                | ❌                    |
| Export orders                  | ❌                           | ❌                     | ❌ v1                               | ❌               | ❌                | ❌                    |
| Delete an order                | ❌                           | ❌                     | ❌                                  | ❌               | ❌                | ❌                    |

**Why super admin is denied order PII.** The current admin role can moderate listings, categories, and owners; it has no order surface. Adding one creates a high-value PII target and a support-impersonation risk. If support needs access later, add a named break-glass capability with a reason, a time limit, and an audit row; do not reuse `superAdmin`.

**Why the owner cannot edit committed lines.** Once accepted, the kitchen has started and the price is committed. Line edits would require a new amendment state, re-pricing, re-confirmation, and a new audit trail. Cancel + re-place is simpler and keeps the history honest. This is a deliberate v1 limitation.

## 6.5 Supply, visibility, and kill switches

### Effective-open predicate

```ts
const configuredHours = hasAnyOpeningPeriod(business.hours); // any day with > 0 periods
const effectiveOpen =
  business.status === 'approved' &&
  (business.acceptingOrders ?? true) &&
  (business.acceptingOrdersUntil === undefined || now < business.acceptingOrdersUntil) &&
  (configuredHours ? openStatusAt(business.hours, business.timezone, now).isOpen : true);
```

`openStatusAt` is the existing pure evaluator (`convex/businesses/publicHours.ts:120-176`); it handles an IANA timezone, overnight periods, and `Intl` wall-clock formatting. It does **not** model holidays, special hours, or scheduled downtime; those are out of scope v1 and must be a manual pause.

### The 2×2 visibility/ordering matrix

| Listing status                                  | Ordering effective             | Public menu                   | Order button              | Direct `placeOrder`                 | Pending orders                                      | Receipt |
| ----------------------------------------------- | ------------------------------ | ----------------------------- | ------------------------- | ----------------------------------- | --------------------------------------------------- | ------- |
| Approved                                        | Open                           | Visible                       | Enabled                   | Accepted                            | Unaffected                                          | Works   |
| Approved                                        | Closed (pause / hours / until) | **Visible, browse-only**      | Disabled + banner + phone | `ORDERING_CLOSED` / `OUTSIDE_HOURS` | Unaffected; owner can accept/decline/ready/complete | Works   |
| Not approved (draft/pending/suspended/rejected) | Any                            | **Hidden** (`getPublic` null) | None                      | `BUSINESS_UNAVAILABLE`              | Unaffected; owner can still work them               | Works   |
| Hidden + open                                   | —                              | **Forbidden**                 | —                         | —                                   | —                                                   | —       |

**No `menuVisible` flag in v1.** Menu visibility is the listing's approval status, which is admin-owned. The owner's demand switch is `acceptingOrders` (plus hours). A separate "hide the menu but keep ordering" state is a UX trap and a support burden; if an unlisted/QR-only menu becomes a real requirement, add `menuVisible` with an explicit decision about hidden-but-orderable. Until then, "hidden + open" is not a state the code can represent.

### Item and group matrix

| Item        | Group       | Ordering / hours | Public display                                       | Direct `placeOrder`              |
| ----------- | ----------- | ---------------- | ---------------------------------------------------- | -------------------------------- |
| Available   | Available   | Open             | Orderable                                            | Accepted                         |
| Unavailable | Available   | Open             | "Sold out" (existing pattern, `menu-tabs.tsx:83-89`) | `ITEM_UNAVAILABLE`               |
| Available   | Unavailable | Open             | Group shown "Currently unavailable"; items disabled  | `GROUP_UNAVAILABLE`              |
| Unavailable | Unavailable | Open             | "Currently unavailable"                              | `GROUP_UNAVAILABLE` (group wins) |
| Any         | Any         | Paused           | Browse-only banner                                   | `ORDERING_CLOSED`                |
| Any         | Any         | Closed hours     | Browse-only banner                                   | `OUTSIDE_HOURS`                  |

**Supply-error precedence in `placeOrder`:** business approved → pause/until → hours → group → item → selections → price. If two supply switches are off, the earliest in this list is the error; this keeps the message stable and avoids leaking a detailed supply state. Contact/caps validation and throttling are separate: pure input validation runs before the business throttle write; the throttle limit is checked at that write; the idempotency fast-path and re-check bracket the write (§6.2.3).

### Precedence and invariants

- **INV-17:** a pause or closed hours never mutates pending orders. The owner can still accept/decline/ready/complete/no-show them. The guard is on **create only**.
- **INV-18:** every switch is enforced in the handler. The UI disables the button for clarity, but a direct mutation gets the same error.
- **INV-19:** the UI keeps the basket and the customer's contact fields when a submit fails; it does not reset the form. The error banner names the recovery action.
- **INV-22:** every owner toggle writes an `auditLogs` row. The board banner shows the pause note and time, not the actor's name (the audit view has it).

### Errors

| Code                         | When                                                        | Customer message (exact)                                                       | Recovery                  |
| ---------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| `BUSINESS_UNAVAILABLE`       | Not approved / deleted / no public record                   | "This business isn't available right now."                                     | Back to directory         |
| `MENU_UNAVAILABLE`           | Approved but no published menu / all items removed          | "This business hasn't published a menu yet."                                   | Call the business         |
| `MENU_EMPTY`                 | No orderable items                                          | "There's nothing available to order right now."                                | Call the business         |
| `ORDERING_CLOSED`            | `acceptingOrders` false, `until` passed, or not on `basket` | "This business isn't accepting orders right now. Call {phone}."                | Call; retry later         |
| `OUTSIDE_HOURS`              | Configured hours closed                                     | "This business is closed right now. Call {phone} or check its hours."          | Call; retry when open     |
| `GROUP_UNAVAILABLE`          | Group flag false                                            | "One of the menu sections you picked is unavailable. Refresh the menu."        | Refresh; remove section   |
| `ITEM_UNAVAILABLE`           | Item flag false / deleted                                   | "One of the items you picked is sold out. Refresh the menu."                   | Refresh; remove line      |
| `BASKET_EMPTY`               | 0 lines                                                     | "Add at least one item before sending your order."                             | Add item                  |
| `BASKET_TOO_LARGE`           | >20 lines / >100 units                                      | "This order is too large to send here. Call the business."                     | Call                      |
| `QUANTITY_INVALID`           | 0, 21, non-integer                                          | "Choose a quantity between 1 and 20."                                          | Fix quantity              |
| `SELECTION_INVALID`          | Missing required / unknown choice / >32                     | "Check the options for {item}; one is missing or no longer available."         | Re-select                 |
| `CONTACT_INVALID`            | Name/phone/email fail                                       | "Add a name and a phone or email so the business can reach you."               | Fix contact               |
| `NOTE_TOO_LONG`              | >500                                                        | "Keep the note under 500 characters."                                          | Shorten                   |
| `PRICE_CHANGED`              | `expectedSubtotal` mismatch                                 | "Prices changed while you were ordering. Review the new total and send again." | Show old/new; re-confirm  |
| `PRICE_UNAVAILABLE`          | Client expected a number; server has none                   | "One item has no price listed. Confirm the total with the business."           | Call / remove             |
| `ORDER_VALUE_TOO_HIGH`       | Subtotal > $1,000                                           | "This order is too large to send online. Call the business."                   | Call                      |
| `IDEMPOTENCY_CONFLICT`       | Same key, different args                                    | "This order was already sent with different details. Refresh your order."      | Refresh                   |
| `TOO_MANY_REQUESTS`          | Contact/business throttle                                   | "Too many order attempts. Try again in {n} minutes or call the business."      | Wait / call               |
| `ORDER_NOT_ACCEPTED`         | Blocked contact (generic)                                   | "We can't accept this order online. Please call the business."                 | Call                      |
| `ORDER_NOT_FOUND`            | Bad/expired token                                           | "We couldn't find that order. Check the link or call the business."            | Call                      |
| `ORDER_EXPIRED`              | Action on expired                                           | "This order expired before it was accepted. Place a new order."                | Re-order                  |
| `CANNOT_CANCEL`              | Customer cancel after `new`                                 | "This order can no longer be cancelled online. Call the business."             | Call                      |
| `INVALID_TRANSITION`         | Wrong action for state                                      | "That action isn't available for this order anymore. Refresh."                 | Refresh                   |
| `ORDER_TERMINAL`             | Any action on terminal                                      | "This order is already closed."                                                | —                         |
| `ORDER_ALREADY_DECIDED`      | Conflicting concurrent action                               | "Someone already updated this order. Refresh the board."                       | Refresh                   |
| `REASON_REQUIRED`            | Decline/cancel without reason                               | (Owner UI) "Add a short reason before continuing."                             | Add reason                |
| `FORBIDDEN` / `UNAUTHORIZED` | Auth failure                                                | "You don't have access to this order."                                         | Sign in / contact support |
| `INTERNAL`                   | Unexpected                                                  | "Something went wrong. Try again or call the business."                        | Retry                     |

**Error envelope.** Use `ConvexError` with an object payload:

```ts
throw new ConvexError({
  code: 'PRICE_CHANGED',
  message: 'Prices changed while you were ordering. Review the new total and send again.',
  actualSubtotal: 2450,
});
```

The client `messageForOrderError` accepts a string (legacy) or an object; it returns `data.message` for the user and switches on `data.code` for recovery (focus the total, refresh the menu, show `retryAfterMs`). It never renders raw `err.message` from an unexpected error.

**Channel scope.** There is one pickup channel. There are no per-channel switches; adding delivery or third-party channels later requires a channel dimension on availability and pause. Do not fake per-channel behavior with one global flag.

**Time-window controls.** v1 has opening hours (weekly periods) and `acceptingOrdersUntil` (auto-resume). It does **not** have scheduled pickup slots, prep-time promises, lead time, or per-window order limits. Square's settings show how much those require (F9); they are a separate protocol.

## 6.6 Commitment and abuse mechanism (chosen controls)

### The control stack

| Control                     | Mechanism                                                        | Who bears the cost                         | Stops                                          | Does not stop                                 | Evidence                       |
| --------------------------- | ---------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- | --------------------------------------------- | ------------------------------ |
| **Guest checkout**          | No account required; optional Clerk link                         | Platform (no account conversion)           | Account abandonment                            | Fake contact                                  | F2, F13                        |
| **Explicit owner accept**   | Owner sees contact, calls/emails, then chooses "Accept verified" | Owner ~15–30 sec/order (hypothesis)        | Unreachable/prank orders that the owner checks | Owner who skips the call; plausible prankster | F15–F17                        |
| **Server price + snapshot** | Recompute from menu; store name/price; reject mismatch           | Platform                                   | Silent overcharge; price rewrite               | Menu data wrong at source                     | R11, F10                       |
| **Idempotency key**         | Same key + same args → original order                            | Platform                                   | Double click, retry, two tabs                  | Deliberate new key                            | F10                            |
| **Per-contact throttle**    | 3/10 min, 10/24 h per business+contact                           | Platform; false positives on shared phones | Scripted spam from one contact                 | Rotating contacts                             | F14; thresholds are hypotheses |
| **Per-business throttle**   | 60/10 min                                                        | Platform                                   | A single business being flooded                | Distributed flood across businesses           | F14                            |
| **Block list**              | Owner blocks hashed phone/email per business                     | Owner ~10 sec; support                     | Repeat offender with the same contact          | New contact                                   | F17                            |
| **Expiry**                  | `new` expires after 60 min                                       | Platform                                   | Indefinite stale holds                         | Owner who ignores the board                   | F6                             |
| **Audit + metrics**         | `orderEvents`, `auditLogs`, coded reasons                        | Platform/owner review                      | Silent drift; unmeasured verification          | Determined operator                           | F4, F15                        |
| **No deposit (v1)**         | —                                                                | —                                          | —                                              | Determined prankster                          | F11–F12 are reservations only  |

### Why this stack and not a deposit

The customer's commitment is **information + a reachable contact + the owner's screening**, not money. A deposit would add a payment rail, refund/dispute states, and a pre-commit friction that the evidence does not justify for pickup (F11–F12). The stack above is the smallest set that (a) makes the order atomic, (b) gives the owner a way to refuse, (c) bounds scripted abuse, and (d) produces the data needed to decide whether C is warranted.

**Refundable vs non-refundable deposit.** If C is piloted later:

- A refundable deposit is a transfer; it screens on liquidity/time, not intent. It is weak.
- A non-refundable deposit is a cost; it deters only if `D > d - e` and does not deter honest orders if `D < v - p - c` (see §4.4).
- A hold on a card (no charge) may be a middle ground, but it still requires a payment rail and a dispute policy; it is not v1.

### Thresholds and defaults

| Control               | Default        | Rationale                                                                | Tuning signal                                                                   |
| --------------------- | -------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Contact 10-min limit  | 3              | A normal customer rarely submits 4 orders in 10 minutes; a group may     | If `Unreachable`/throttle false positives > 1% of legitimate orders, raise to 5 |
| Contact 24-hour limit | 10             | Bounds a persistent harasser without blocking a family lunch + dinner    | If repeat customers hit it, raise or scope by business                          |
| Business 10-min limit | 60             | A small kitchen cannot produce 60 orders in 10 minutes; a bot can        | If a real rush hits it, raise or add a queue                                    |
| TTL                   | 60 min         | Owner has time to call; stale `new` does not sit all day                 | If p95 accept latency > 30 min, shorten or add staff                            |
| Block scope           | Per business   | One owner's bad actor may be another's regular; avoid global accusations | If cross-business abuse is common, add a platform-level flag with review        |
| Idempotency retention | 24 h           | Stripe's minimum; covers retries and two-tab confusion                   | If retries after 24h are common, extend                                         |
| Token lifetime        | Order lifetime | Receipt should work for history; masked contact limits leak              | If a token leaks, add rotation/revocation (not v1)                              |

All thresholds are **policy defaults**, not measured optima. They live in one constants module so they can be changed with a test update, not scattered through handlers.

**Implementation note — official rate limiter.** The Convex guidelines recommend `@convex-dev/rate-limiter` for per-key quotas and warn that hand-rolled counters can race and lose quota on rollback (`convex/_generated/ai/guidelines.md:80`; F14). This spec deliberately uses the transactional `orderThrottle` row for three reasons: it is the same row that serializes the idempotency check-then-insert; a failed order should not consume a quota slot; and the contact key is scoped by business, which the component's generic key model would still need to encode. The trade-off is real: the counter is a hand-rolled fixed window, and if the component can express the same keys with the same transactional semantics, it should replace this table. Until then, the concurrency test (U7) and the rollback behavior are part of the acceptance gate, not assumptions.

### False positives, appeals, and privacy

- **Shared phone:** a family or office may legitimately place several orders from one number. The 3/10 min limit can block the fourth. Mitigation: the owner can clear the contact throttle for their business (audited), or the customer calls. Measure the rate; if it is material, raise the limit or add a "same household" note.
- **Block evasion:** a new phone/email bypasses the block; the per-business throttle and owner verification remain. This is residual, not solved.
- **No block disclosure:** a blocked contact receives `ORDER_NOT_ACCEPTED` with a generic message. Do not say "you are blocked"; it invites retaliation and leaks the list.
- **Appeals:** the message tells the customer to call the business. The owner can unblock or clear the throttle. There is no platform appeal in v1.
- **PII at rest:** throttle keys use `SHA-256(normalizedContact)`; blocks store the hash, not the raw contact. The order still stores the contact (the owner needs it). A pepper is optional; if used, rotating it resets all blocks/throttles, so document that.
- **Logs:** no contact, name, note, or token in logs. `orderEvents` stores reason codes and owner-authored reasons, not the customer's note. The receipt masks contact.

### Cost model (estimates, not measured)

| Cost            | A Minimal                                        | B Balanced                                             | C Strong                                         |
| --------------- | ------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------ |
| Build           | 4–6 dev days                                     | 12–18 dev days                                         | 25–40 dev days + payment/compliance              |
| Owner per order | Call every order; no throttle, so spam can flood | Call new orders (~15–30 sec, hypothesis); block repeat | Call/verify only exceptions; SMS/deposit support |
| Support         | High: duplicate/price complaints, no cancel      | Medium: throttle/block questions, receipt links        | High: refunds, disputes, SMS failures            |
| Conversion      | No basket; duplicate/price gaps                  | Basket neutral/positive; call after commit             | Deposit/SMS before commit; unknown loss          |
| Storage         | Negligible                                       | Negligible (a few small rows/order)                    | Payment records + reconciliation                 |

The dominant cost is **owner attention**, not storage. B is designed to keep that attention focused: one call per new order, one-tap decline reasons, a board sorted by age, and no duplicate work.

### Residual risk statement

B does **not** guarantee that every accepted order is real. It guarantees that:

1. A fake order cannot be created twice by a retry.
2. A fake order cannot bypass a sold-out item, a paused business, or closed hours.
3. The owner can decline/cancel it, and the customer can cancel while it is new.
4. The owner sees the contact and a reference, and can block a repeat contact.
5. Every transition is recorded, so the rate can be measured.

That is the honest boundary of a no-payment, guest-checkout protocol.

## 6.7 Customer UX states and copy

The customer should always know four things: **what state the order is in**, **what happens next**, **what they can do**, and **how to reach the business**. Errors are inline, persistent, and preserve the basket.

| State                      | Trigger                                          | What the customer sees                                           | Actions                            | Copy (use or adapt)                                                                            |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Menu empty                 | Approved business, no orderable items            | Empty menu panel                                                 | Call                               | "There's nothing available to order right now. Call {business}."                               |
| Composing                  | Basket has 0–20 lines                            | Item list, basket summary, subtotal or "Total at pickup"         | Add, edit quantity, remove, review | "Your order" / "Review order"                                                                  |
| Item sold out (before add) | `isAvailable === false`                          | "Sold out" chip; no add button                                   | Choose another                     | "Sold out"                                                                                     |
| Group unavailable          | Group flag false                                 | Section shown with a banner; items disabled                      | Choose another                     | "This section is unavailable right now."                                                       |
| Ordering paused            | `acceptingOrders` false / until passed           | Browse-only banner; order buttons disabled                       | Call; retry later                  | "Ordering is paused. Call {phone} to order."                                                   |
| Outside hours              | Configured hours closed                          | Browse-only banner; hours shown if available                     | Call; retry                        | "Closed right now. Call {phone} or check the hours."                                           |
| Submitting                 | Mutation in flight                               | Button "Sending…", disabled; basket locked                       | Wait                               | "Sending your order…"                                                                          |
| New receipt                | `placeOrder` returned                            | Reference, items, total, status "Order received", masked contact | Cancel while new; call; copy link  | "Order received. The business will call you to confirm."                                       |
| Accepted                   | Owner accepted                                   | Status "Accepted"; stepper                                       | Call; no cancel                    | "Accepted. The kitchen is preparing your order."                                               |
| Ready                      | Owner marked ready                               | Status "Ready for pickup"; address/phone                         | Call; directions                   | "Ready for pickup."                                                                            |
| Completed                  | Owner completed                                  | Status "Completed"                                               | Place another                      | "Completed. Thanks for ordering."                                                              |
| Declined                   | Owner declined                                   | Status "Not accepted"; reason label                              | Call; place another                | "The business couldn't accept this order. Reason: {reason}."                                   |
| Cancelled (customer)       | Customer cancelled                               | Status "Cancelled"; no cancel button                             | Place another                      | "Your order was cancelled."                                                                    |
| Cancelled (owner)          | Owner cancelled                                  | Status "Cancelled"; reason label                                 | Call                               | "The business cancelled this order. Reason: {reason}."                                         |
| Expired                    | TTL passed in `new`                              | Status "Expired"; no cancel                                      | Place another                      | "This order expired before the business accepted it. Place a new order."                       |
| No-show                    | Owner marked no-show                             | Status "Not picked up"                                           | Call if this is a mistake          | "This order was marked as not picked up. Call {phone} if this is a mistake."                   |
| Price changed              | `PRICE_CHANGED`                                  | Old total vs new total; "Review and send again"                  | Re-confirm; remove lines           | "Prices changed while you were ordering. New total: {amount}."                                 |
| Too many requests          | `TOO_MANY_REQUESTS`                              | Retry time; call link                                            | Wait; call                         | "Too many order attempts. Try again in {n} minutes or call {phone}."                           |
| Blocked                    | `ORDER_NOT_ACCEPTED`                             | Generic refusal; call link                                       | Call                               | "We can't accept this order online. Please call {phone}."                                      |
| Network error              | Mutation/query failed                            | Inline error; retry; basket preserved                            | Retry                              | "We couldn't send your order. Check your connection and try again."                            |
| Receipt not found          | Bad token                                        | Empty receipt state                                              | Call; browse                       | "We couldn't find that order. Check the link or call {phone}."                                 |
| Legacy order               | Backfilled `pricingSource: 'legacyUnknown'`      | Items and status; "Total at pickup"                              | Call                               | "This order was placed before item prices were recorded. Confirm the total with the business." |
| Basket restored            | localStorage had a basket                        | Basket with a note                                               | Continue; clear                    | "We restored your basket from this device."                                                    |
| Conflict                   | `IDEMPOTENCY_CONFLICT` / `ORDER_ALREADY_DECIDED` | Inline error; refresh                                            | Refresh; call                      | "This order changed in another tab. Refresh to see the latest."                                |

### Interaction rules

- **Basket state:** `useReducer` keyed by `businessId`; localStorage key `lc:basket:<businessId>:v1`; versioned payload; no contact data in localStorage; cap lines/quantity at the same constants as the server. On successful commit, clear the basket and navigate to `/order/<token>`. If storage is unavailable, keep memory only; do not fail the order.
- **Price display:** while composing, show the client total; on submit, send `expectedSubtotal`; if the server disagrees, show the old/new totals and require an explicit second submit. Never auto-submit a changed total.
- **Stale item:** on `ITEM_UNAVAILABLE`/`GROUP_UNAVAILABLE`, mark the affected line, keep the rest, and focus the error summary. The user can remove the line and resend.
- **Receipt:** server-rendered (or server-fetched) by token; no third-party embeds; `Referrer-Policy: no-referrer`; copy-link button; "remove from this device" clears local history only. The receipt polls or subscribes to status; no full-page reload needed.
- **Cancel:** visible only while `new`; a confirmation dialog states "The kitchen may have started; cancel only if you need to." On success, status becomes `cancelled`. If the cancel races an accept, show `ORDER_ALREADY_DECIDED` and refresh.
- **Mobile:** sticky basket bar with total and "Review"; 44×44 px targets; quantity stepper with text labels, not just icons; no hover-only actions.
- **Accessibility:** `aria-live="polite"` for status changes; focus moves to the error summary on failure; error messages are associated with fields; status is text + icon, not color alone; honor `prefers-reduced-motion`; the stepper is a list with `aria-current="step"`; the receipt has a logical heading order.
- **No dark patterns:** no countdown timer on the basket, no pre-checked marketing, no "order now" that silently changes the total. The commitment is explicit.

## 6.8 Owner operator workflow

### Board

- **Default filter:** `New`, oldest first. This is the queue that needs action, not the whole history.
- **Filters:** `New`, `Accepted`, `Ready`, `Completed`, `Declined`, `Cancelled`, `Expired`, `No-show`, `All`. Counts show `99+` when capped; do not run an unbounded count on every render.
- **Row:** reference, customer name, masked/full contact (owner sees full), items with quantity and selections, subtotal or "Price not recorded," note, age since `createdAt`, status. The age badge turns amber after 5 minutes and red after 15 (defaults; tune with data).
- **Sort:** oldest first within the filter, so the longest-waiting order is at the top. Completed history never pushes `new` out of view (INV-23).
- **Realtime:** the board subscribes to the query; a new order appears without refresh. No optimistic status changes; wait for the server, then update.

### Accept

1. Open the order detail.
2. The detail shows the full contact and a **Call** link (`tel:`) or **Email** link (`mailto:`), the items, selections, note, and total.
3. Copy: **"Call {name} at {phone}. Confirm the items and pickup time. Only accept if you reach them."**
4. Buttons: **Accept verified**, **Decline**, **Close**.
5. `Accept verified` is the explicit operator confirmation. There is no checkbox; the action itself is the confirmation, and `orderEvents` records the owner and time.
6. If the customer is unreachable, use **Decline** with reason `Unreachable`. Do not accept "to be nice"; that is the order that becomes a no-show.

**Why no mandatory checkbox.** A checkbox can be ticked without calling; it adds a click and a false sense of assurance. The audit is the actor + timestamp + reason, not a tick. If the team later wants a checklist, it should be a short modal with the phone number and two buttons, not a compliance tick.

### Decline

Reasons (coded):

- `Sold out` — an item ran out after the order was placed.
- `Unreachable` — no answer / wrong number / no reply.
- `Too busy` — the kitchen cannot take more.
- `Duplicate` — the customer placed the same order twice.
- `Other` — free text required (1–200 chars).

The receipt shows the label and, for `Other`, the text. The owner sees the reason in the event history. Weekly review: if `Unreachable` > 5% of new orders, the verification script or the contact requirement needs work; if `Sold out` > 2%, the 86 process is stale.

### Ready / Complete / No-show

- **Ready:** only from `accepted`; the receipt updates and shows "Ready for pickup."
- **Complete:** only from `ready`; the receipt shows "Completed."
- **No-show:** only from `ready`; use when the customer never arrives. Reason defaults to "Not picked up"; do not mark no-show before the pickup window has passed (the UI can warn if the order is younger than the prep estimate; v1 has no prep estimate, so the owner decides).
- **Cancel after accept:** allowed from `accepted`/`ready` with a reason; use when the customer calls to cancel or an item is unavailable. It is distinct from no-show.

### Pause, hours, and availability

- **Pause orders:** button on the board; presets `30 min`, `1 hour`, `Rest of day`, `Custom`; optional note ("Back at 5"). Sets `acceptingOrders=false` and `acceptingOrdersUntil`; the banner shows "Paused until {time} — {note}." One-tap **Resume** clears both. If the owner forgets, the `until` makes the business open again automatically; the note explains the gap.
- **Hours:** edited in the existing business hours editor. The order path uses the same `openStatusAt` evaluator as the public "Open now" badge, so the two cannot disagree. If hours are empty, ordering is allowed (explicit no-hours policy, INV-10).
- **Item sold out:** toggle in the menu panel; the public menu shows "Sold out"; direct orders reject. Show "Sold out since {time}" in the owner menu so a stale 86 is visible.
- **Group unavailable:** toggle on the group; the public menu shows the section as unavailable; direct orders reject. Use for a whole station (e.g., grill down), not for a single item.
- **Audit:** every toggle writes `auditLogs` with the owner, action, target, note, and time. The board banner shows the pause note and time; the audit view shows the actor.

### Offline, no-watcher, and exceptions

- **No push in v1.** The owner must keep the board open (the Uber Eats academy makes the same point: a backgrounded app receives no orders, F6). The board title can show a `new` count; no sound is required in v1.
- **No watcher:** orders expire after 60 minutes; the customer sees `expired`; the owner sees the expired row and can call the customer to re-place. This is a failure mode, not a silent loss.
- **Sold out after accept:** call the customer; cancel with `Sold out`; if they accept a substitution, cancel and ask them to re-place (no line edits). The receipt explains the reason.
- **Customer calls to cancel after accept:** owner cancels with `Customer request` (an `Other` reason); the food cost is a business decision, not a platform refund (no payment).
- **Duplicate:** decline one with `Duplicate`; the other proceeds. If both are accepted, call the customer and cancel one.
- **Wrong order:** cancel with reason; ask the customer to re-place. Do not edit lines.
- **Ownership transfer:** the new owner sees the business's orders because authorization is `businesses.ownerId`; the old owner loses access. The audit shows who did what.
- **Business deletion:** do not hard-delete a business with orders without a retention decision; archive or block the delete (INV-30).

### Daily checklist (one screen, five items)

1. Open the **New** filter; clear the queue or decline with a reason.
2. Check **Ready** for pickups; complete or no-show after the window.
3. Check **Paused** and **Hours**; resume if the pause was accidental.
4. Check **Sold out** items; un-86 anything that is back.
5. Review yesterday's declines; note `Sold out`/`Unreachable` causes.

---

# 7. Phased plan and test plan

## 7.1 Slice overview

Each slice is a thin vertical cut with a rollback. The order is deliberate: **safety net → backend truth → owner controls → customer UI → abuse → measurement → optional money.** No slice requires a destructive migration, and no slice removes the legacy path.

| Slice                          | Outcome                                                                                                                                                                    | Depends on | Prod behavior change                                            | Rollback                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------- | ------------------------------------------------- |
| **S0 (complete, staged)** | Handler regression suite for the B8 contract                                                                                                                               | —          | **None** (tests only)                                           | Remove `convex/orders.test.ts`; no runtime        |
| **S1**                         | Schema expand + backfill + basket commit + token receipt + explicit states + idempotency + server pricing + business-throttle serialization, behind a server-enforced flag | S0         | Only for businesses on `basket`; legacy `submitOrder` untouched | Flag back to `legacy`; schema additive; no delete |
| **S2**                         | Owner controls: pause/until, group availability, hours enforcement, board filters, audit, decline/cancel/no-show UI                                                        | S1         | Owner can stop demand; pending orders unaffected                | Hide the controls; backend guards remain safe     |
| **S3**                         | Basket + receipt UI: multi-line, quantities, totals, `/order/[token]`, cancel, states, mobile/a11y                                                                         | S1         | Public UI for flagged businesses                                | Flag back to `legacy`; old panel still works      |
| **S4**                         | Abuse controls: per-contact throttle, block list, throttle clear, cancellation notification, expiry hardening (business throttle serialization already lands in S1)        | S1         | Public write surface is rate-limited                            | Raise limits/disable block UI; tables remain      |
| **S5**                         | Measurement + hardening: metrics, owner fake-order flag, load test, a11y audit, retention runbook                                                                          | S3         | Internal only                                                   | Remove dashboard; data remains                    |
| **S6 (optional)**              | C: verified phone / deposit / reputation, only if thresholds trigger                                                                                                       | S5         | Pre-commit verification/payment                                 | Disable; refund policy required                   |

**Why S1 is one slice, not three.** The commit, token, pricing, business serialization, and states share one transaction and one schema expand. Splitting them would leave a half-protocol that is harder to test and roll back: a token without a cancel state, or a basket without a snapshot. S1 is large but coherent. S2–S4 can follow independently.

**Why S4 is not optional before broad enable.** S1 closes the integrity gaps and bounds a single business, but it does not throttle a rotating contact or offer a block list. The pilot in S1 must be limited to 1–3 businesses with an owner who is actively watching; broad enable waits for S4.

## 7.2 Slice details

### S0 — Handler regression suite (complete, staged)

**Outcome:** a permanent safety net that proves the current B8 contract at the handler seam, so the schema expand cannot silently break the legacy path.

**Files:** `convex/orders.test.ts` (new).

**Functions exercised:** `api.orders.submitOrder`, `api.orders.listOrders`, `api.orders.transitionOrderStatus`, `api.orders.getOrderStatus`; `requireBusinessOwner`; the `new_order` notification.

**Schema:** none.

**Tests:** 10, all passing. They cover the happy path, owner advance, unavailable item, unapproved business, cross-business item, unauthenticated read/transition, non-owner read/transition, illegal transition, terminal state, and the status-only public projection.

**Rollout:** none; no production behavior changed.

**Rollback:** remove the test file (and keep the scratch characterization evidence outside the repo).

**What it does not prove:** duplicate submit, price snapshot, cancellation, kill switches. Those are the gaps the next slices close; the suite is deliberately green on today's behavior, not on the target behavior.

### S1 — Backend commit protocol (flagged)

**Outcome:** the server can accept a multi-line basket atomically, price it from the menu, snapshot it, mint a receipt token, enforce idempotency, and move through the 8-state machine. The legacy `submitOrder` still works.

**Schema:** the additions in §6.2: optional `orders.items/subtotal/pricingSource/statusReason/statusUpdatedAt/expiresAt/customerUserId`, widened `status`, optional legacy fields; `orderAccess`, `orderIdempotency`, `orderExpiry`, `orderEvents`, `orderThrottle`, `orderBlocks`; `businesses.orderProtocol`, `businesses.acceptingOrders/Until/Note`; `menuGroups.isAvailable`; indexes `byBusinessIdStatus`, `byAccessToken`, `byOrderId`, `byBusinessIdReference`, `byBusinessIdKey`, `byCreatedAt`, `byExpiresAt`, `byOrderIdCreatedAt`, `byKey`, `byBusinessIdContactHash`.

**Files (proposed):**

- `convex/schema.ts` — additive fields/tables/indexes.
- `convex/orderPolicy.ts` — extend statuses/actions/transition matrix; keep existing exports for the UI and the 27 tests.
- `convex/orderCommitPolicy.ts` (new) — pure `validateBasket`, `priceBasket`, `parseContact`, `canonicalArgsHash`, `createReference`, `isEffectiveOpen`; no DB imports, unit-testable with `node --test`.
- `convex/orderAccess.ts` (new) — `createAccessToken`, `createReference`, `insertOrderAccess`, `findByToken`, receipt projection.
- `convex/orderThrottle.ts` (new) — `claimBusinessThrottle` (serialization + 60/10 min limit); S4 adds contact keys.
- `convex/orderEvents.ts` (new) — `appendOrderEvent`, `listOrderEvents` (owner-only).
- `convex/orders.ts` — `placeOrder`, `getOrderByToken`, `cancelOrder`, extended `transitionOrderStatus`, filtered `listOrders`, keep `submitOrder`/`getOrderStatus`.
- `convex/businesses/mutations.ts` — `setAcceptingOrders` (owner), optional `clearContactThrottle` (S4), audit.
- `convex/menus.ts` — `setGroupAvailability` (owner), audit; item availability audit.
- `convex/orderExpiry.ts` (new) or an internal mutation in `orders.ts` — `insertOrderExpiry`, `expireOrder`, `sweepExpiredOrders` (internal).
- `convex/migrations/backfillOrderAccess.ts` (new) — internal, batched, idempotent.
- `convex/orders.test.ts` — extend.

**Functions and contracts:**

- `placeOrder({ businessId, lines, customerName, contactPhone?, contactEmail?, note?, expectedSubtotal?: number | null, idempotencyKey })` → `{ orderId, accessToken, reference, status, subtotal }`. At least one of `contactPhone`/`contactEmail` is required; the business must be `orderProtocol === 'basket'`.
- `getOrderByToken({ token })` → masked receipt or `null`.
- `cancelOrder({ token })` → `{ status: 'cancelled' }`; idempotent if already cancelled.
- `transitionOrderStatus({ businessId, orderId, action, reason? })` → `{ status, reused }`.
- `listOrders({ businessId, status?, cursor?, limit? })` → paginated rows; default `new`, oldest first; 50/page for `new`, 100 cap for other filters.
- `getOrderStatus({ orderId })` — legacy, unchanged.
- `submitOrder(args)` — legacy, unchanged (or a thin wrapper after verification; do not change it in S1).
- `expireOrder({ orderId })` — internal; loads the order; if it is not `new`, deletes any stale `orderExpiry` row and no-ops; if it is `new` and the row is due, transitions to `expired` and deletes the row.
- `sweepExpiredOrders({ now? })` — internal; queries `orderExpiry.byExpiresAt` up to `now`, calls `expireOrder`, batches.

**Migration/backfill:** §6.2.9; run in dev first; record counts; no price backfill; no `orderExpiry` rows for legacy orders.

**Tests:** extend the handler suite with the S1 matrix in §7.3; add the pure suite. A S1 PR is not mergeable until the P0 handler tests pass.

**Rollout:** deploy schema, backfill, deploy functions, then enable `basket` for 1–3 pilot businesses. The flag is enforced in `placeOrder`: only `basket` businesses can call it; missing/unknown = `legacy`. Do not advertise it until S3.

**Rollback:** flag back to `legacy`; the old panel calls `submitOrder`; new orders remain readable by token and the owner board. Schema is additive; do not drop fields/tables.

### S2 — Owner controls, board filters, audit

**Outcome:** the owner can stop demand and recover from bad orders without a developer.

**Files:** `app/owner/business/[id]/orders-panel.tsx` (filters, accept/decline/cancel/no-show dialogs, age badge, contact links), `orders-panel-*` components, menu panel group toggle, business hours/pause settings, `convex/orders.ts` (filtered query), `convex/businesses/mutations.ts`, `convex/menus.ts`, `convex/auditLogs` consumer.

**Schema:** none beyond S1; the fields/indexes exist.

**Tests:** handler tests for pause/group/hours + direct `placeOrder` rejection; audit row per toggle; board filter returns the right status and does not starve `new`; authz negatives for every new mutation; idempotent repeat; decline/cancel reason validation.

**Rollout:** owner-only; no public UI dependency. The controls can ship before the basket UI, but they only matter once `placeOrder` is used; pilot businesses can use them with the old panel for legacy orders.

**Rollback:** hide the controls; the backend guards remain. If a guard is wrong, disable `basket` for the affected businesses.

### S3 — Basket and receipt UI

**Outcome:** the customer can compose a multi-line basket, see a server-confirmed total, commit once, and return to a durable receipt.

**Files:** `components/profile/ordering-panel.tsx`, `ordering-panel-sections.tsx`, `ordering-panel-helpers.ts`, `menu-tabs.tsx`, `app/business/[id]/page.tsx` (flag), new `app/order/[token]/page.tsx`, new `components/order/receipt.tsx`, `components/order/basket-*.tsx`, `lib/order-errors.ts` (code → copy), CSS tokens.

**Schema:** none.

**Tests:** Reticle E2E on a running app (public + owner); manual script §7.5; unit tests for the basket reducer, total formatting, error mapping, and localStorage versioning; accessibility checks (keyboard, focus, aria-live, 44px).

**Rollout:** flag per business; start with the pilot; watch conversion and price-changed rate.

**Rollback:** flag back to `legacy`; the old panel remains; receipts for new orders still work.

### S4 — Abuse controls and expiry hardening

**Outcome:** the public write surface is bounded; a repeat contact can be blocked; a customer cancellation notifies the owner; expiry is reliable.

**Files:** extend `convex/orderThrottle.ts` (created in S1) with contact keys; `placeOrder` integration; `convex/orderBlocks.ts`/owner mutations; `orders-panel` block/unblock UI and throttle-clear action; `notificationHelpers.ts` `order_cancelled`; expiry scheduling (`ctx.scheduler.runAfter` from `placeOrder`, or a cron sweep); tests.

**Schema:** `orderThrottle`/`orderBlocks` already in S1; add `byCreatedAt` cleanup or a TTL job; no new order fields.

**Tests:** 4th contact submission in 10 min → `TOO_MANY_REQUESTS` with `retryAfterMs`; 11th in 24h; 61st business submission in 10 min (S1); window reset via a patched `windowStart`; block blocks both phone and email hashes; unblock restores; clear throttle is owner-only and audited; expiry from `new`; accepted order never expires; cancellation notification; idempotent duplicate does not double-count the contact throttle.

**Rollout:** defaults in the constants module; monitor false positives; owner can clear a contact throttle for their business.

**Rollback:** raise limits to effectively unlimited or disable the block UI; the tables remain. Do not remove the checks in an emergency without recording the reason.

### S5 — Measurement and hardening

**Outcome:** the team can answer "is this working?" with data, not anecdotes.

**Files:** `convex/orderMetrics.ts` (owner-only aggregate query), `orderEvents` indexes, owner fake-order flag, `docs/order-runbook.md`, load-test script, accessibility audit notes, retention policy.

**Schema:** optional `orderFeedback`/`orderFlags` table if the owner flag needs persistence; otherwise reuse `orderEvents` with an `owner_flagged` action (do not overload the transition union; add a separate table if needed).

**Tests:** metric query correctness on a seeded dataset; load test (e.g., 100 concurrent `placeOrder` calls across 10 businesses; measure p95, OCC retries, throttle behavior); a11y audit; retention job dry run.

**Rollout:** internal dashboard; no customer-facing change.

**Rollback:** remove the dashboard; data remains.

### S6 — Optional C (only if the thresholds trigger)

**Outcome:** add verified phone (SMS/voice), a non-refundable deposit, or a trusted-customer fast lane — **only** if S5 shows the fake/abuse rate is material and B's controls are insufficient.

**Files:** payment/verification integration, refund states, consent, webhooks, reconciliation, support runbook.

**Schema:** payment/verification tables; new terminal/refund states; audit.

**Tests:** payment sandbox E2E, refund/dispute, SMS failure, conversion comparison, authz for payment data.

**Rollout:** separate product approval; pilot; legal/privacy review.

**Rollback:** disable new deposits; honor existing refunds; keep the payment audit.

## 7.3 Test plan

### Layers

| Layer       | Tool                                                       | What it proves                                                                                                           | When it runs               |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Pure policy | `node --test` (`scripts/order-commit-policy.test.ts`)      | State matrix, caps, pricing arithmetic, contact parsing, token/reference format, error mapping, effective-open predicate | Every commit; no DB        |
| Handler     | `vitest` + `convex-test` (`convex/orders.test.ts`)         | The real `api.orders` functions, `requireBusinessOwner`, schema/indexes, transactions, events, notifications             | Every commit; mock backend |
| Concurrency | Real Convex dev deployment + two concurrent HTTP/CLI calls | OCC retry + idempotency + accept/decline race behavior that `convex-test` may serialize                                  | Before S4 broad enable     |
| Component   | Existing project setup (if any) or a minimal harness       | Basket reducer, total formatting, error mapping, localStorage versioning                                                 | S3                         |
| E2E         | Reticle (when the app runs) / manual script                | The customer + owner journey in a real browser                                                                           | Each user-facing slice     |
| Regression  | `node --test`, `vitest`, ESLint, TypeScript, build         | The existing app still works                                                                                             | Every commit               |

### Pure test matrix

| Area            | Cases (minimum)                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State machine   | All 8 statuses × 9 actions: `submit`, `accept`, `decline`, `cancel`, `ready`, `complete`, `noShow`, `expire`, `reuse`; assert target or `null`; assert the terminal set; assert idempotent repeat policy |
| Basket caps     | 0/1/20/21 lines; quantity 0/1/20/21; total units 100/101; selections 32/33; name 1/80/81; note 0/500/501; one business; duplicate lines                                                                  |
| Pricing         | Priced line; unpriced line; modifier adjustment; quantity multiplication; integer cents; max order value; expected-subtotal match/mismatch; client price ignored by signature                            |
| Contact         | Phone 6/7/20/21 digits; formatted phone; email basic valid/invalid; both; neither; control chars; normalization; hashing stability                                                                       |
| Token/reference | 32 random bytes; base64url charset; not derived from id; 6-char alphabet; collision retry; 7-char fallback                                                                                               |
| Canonical hash  | Key order stable; line order stable; normalized contact; different items/qty/selections/name/note produce different hashes                                                                               |
| Effective open  | Approved/paused/until/hours/no-hours; overnight; DST spring/fall; timezone boundary; `until` exactly now                                                                                                 |
| Errors          | Every code in §6.5 maps to a non-empty message and a recovery action; legacy string errors still map                                                                                                     |

### Handler test matrix (extend `convex/orders.test.ts`)

**Commit**

1. Two-line basket with quantities and modifiers → one order, subtotal, snapshots, one owner notification, one `submitted` event, token.
2. Unpriced line → `subtotal: null`, receipt says "Total at pickup," no partial sum.
3. Client tries to send a price field → rejected by the validator or ignored; stored price equals the menu.
4. Empty basket / 21 lines / quantity 0 / 21 / 101 units → typed errors, no order.
5. Price edit after commit → receipt and board unchanged (snapshot).
6. Item delete after commit → snapshot name renders; owner can still transition.
7. `expectedSubtotal` mismatch → `PRICE_CHANGED` with `actualSubtotal`, no order; retry with the new total succeeds.
8. One business per order; a foreign item → `ITEM_UNAVAILABLE`.

**States and authority**

9. Owner accept → accepted; ready → ready; complete → completed; each writes an event.
10. Owner decline from new with reason → declined; reason visible; no reason → `REASON_REQUIRED`.
11. Owner cancel from accepted/ready with reason → cancelled.
12. Visitor cancel from new via token → cancelled; from accepted → `CANNOT_CANCEL`; wrong token → `ORDER_NOT_FOUND`.
13. No-show only from ready; from accepted → `INVALID_TRANSITION`.
14. Terminal states reject every action; repeated same action is a no-op success.
15. Unauthenticated/non-owner list/transition → `Unauthorized`/`Forbidden`; cross-business order id → not found/forbidden.
16. Expire new after TTL; accepted never expires; accept after expiry → `ORDER_EXPIRED`.

**Supply**

17. Item unavailable → `ITEM_UNAVAILABLE`; group unavailable → `GROUP_UNAVAILABLE`; paused → `ORDERING_CLOSED`; hours closed → `OUTSIDE_HOURS`; no hours → accepted.
18. Unapproved business → `BUSINESS_UNAVAILABLE`; paused business still lists its existing orders.
19. Hours boundary (open at start, closed at end, overnight, DST) with an injected `now`.

**Abuse / durability**

20. Same idempotency key + same args → same order, no second notification; different args → `IDEMPOTENCY_CONFLICT`.
21. Two tabs / `Promise.all` same key → one order.
22. Contact throttle 4th/11th; business throttle 61st; window reset; `retryAfterMs`.
23. Blocked contact → `ORDER_NOT_ACCEPTED`; unblock restores; clear throttle owner-only and audited.
24. Token receipt masks contact; wrong token → `ORDER_NOT_FOUND`; token cannot read a different order.
25. Board filter by status; default new; oldest first; `new` is cursor-paginated at 50; completed history does not starve new.
26. Owner toggles write `auditLogs`; order transitions write `orderEvents`.
27. `submitOrder` still works for legacy clients; `getOrderStatus` still returns status+createdAt.
28. Backfill: a legacy order gets `orderAccess` + `items[]` with `unitPrice: undefined`; running twice is idempotent; no price is fabricated; legacy `new` is not auto-expired.

**Rollout gate and board**

29. A legacy business calls `placeOrder` directly → `ORDERING_CLOSED`; a `basket` business succeeds; a missing/unknown flag behaves as `legacy`.
30. The default `new` list is cursor-paginated at 50 and never silently truncates; other status filters cap at 100 with a visible count.

### Concurrency tests (real deployment, not just `convex-test`)

`convex-test` may execute mutations serially, so it can prove logic but not OCC behavior. Before broad enable, run these against a dev deployment with two parallel calls:

1. Two `placeOrder` with the same `(businessId, idempotencyKey)` and same args → exactly one order, one event, one notification; both responses return the same order id.
2. `accept` and `decline` in parallel → exactly one terminal outcome; the loser gets `ORDER_ALREADY_DECIDED`.
3. Two `accept` in parallel → both succeed with `reused: true`; one event.
4. `expire` and `accept` in parallel → one wins; the loser gets `ORDER_EXPIRED`/`ORDER_ALREADY_DECIDED`; no accepted-then-expired state.

Record the Convex request ids and the final rows. A test that only asserts "no crash" is not enough.

### E2E flows (Reticle when the app runs)

1. **Customer basket:** open an approved restaurant → add 2 items with modifiers/quantities → subtotal → submit with name/phone → receipt token.
2. **Receipt durability:** refresh/bookmark → same receipt → status updates after the owner accepts.
3. **Customer cancel:** new → cancel → cancelled; accepted → no cancel button.
4. **Owner accept:** board shows the order oldest-first → call link → accept verified → receipt accepted → ready → complete.
5. **Owner decline:** new → decline with `Unreachable` → receipt shows the reason.
6. **Pause:** owner pauses → customer sees browse-only + phone → direct `placeOrder` rejects → resume.
7. **Sold out:** owner 86s an item → customer sees sold out → direct `placeOrder` rejects.
8. **Group unavailable:** owner toggles a group → customer cannot order it → direct rejects.
9. **Hours:** close the business in hours → customer sees closed → direct rejects.
10. **Duplicate:** two tabs submit the same basket → one order.
11. **Price change:** owner edits a price after the basket is open → submit shows the new total and requires re-confirm.
12. **Throttle/block:** 4th order from one contact → retry message; owner blocks → generic refusal.
13. **Expiry:** a new order passes TTL → expired; accept rejects.
14. **Accessibility:** keyboard-only basket, screen-reader status, focus on error, 44px targets, no color-only status.

**Current status:** Reticle cannot run because the app returns HTTP 500 on every route (see §7.4). S0 is test-only, so there is no user-facing change to verify; the E2E flows are the acceptance gate for S1–S4, not S0. Do not mark them passed.

### Test data and isolation

- Seed two approved businesses, one unapproved, two groups, at least three items (priced, unpriced, unavailable), one owner, one other owner.
- Use fixed `now` where the handler accepts it (pure functions) or patch `orderExpiry.expiresAt`/`windowStart` in the mock DB for time tests; avoid `sleep`.
- Never use real phone numbers/emails in tests; use `555-01xx` and `example.com`.
- Clean the mock DB per test; do not share `t` across tests.
- For migration tests, seed a legacy-shaped order before running the backfill.

### Release gate

A slice is not releasable until:

1. Every P0 invariant **implemented in that slice** has a passing test at the named layer (§6.3).
2. The authz negative tests pass for every new mutation.
3. The kill-switch tests call the handler directly, not the UI.
4. Lint is clean (warnings may be pre-existing and documented).
5. Typecheck/build pass in a repaired environment (or the failure is proven environmental, not code).
6. The E2E flow for the slice has a Reticle verdict, or is explicitly `UNVERIFIED` with a reason.
7. The migration has a dry run and a rollback.

## 7.4 Commands and current results

**Environment:** Windows, Node `v24.x`, repo `D:\Dev\dircteshop-1`, branch `fix/issue-73-order-protocol-t1-land-s0-handler-regression-suite-protocol-doc`, HEAD `723a7f3`. The repo uses pnpm (`pnpm-lock.yaml`); the test toolchain is installed and `pnpm exec` resolves the binaries (the earlier empty `node_modules/.bin` was repaired).

| Check                                | Command                                                                                           | Result                                                                                                                                                                                                                                                                        | Verdict                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Listing state machine                | `node scripts/verify-state-machine.ts`                                                            | "verify-state-machine: 6 statuses, 11 actor rows pinned, 5 owner rows pinned (owner moderation refused)." Exit 0                                                                                                                                                              | **PASS** (listing, not orders)                |
| Scripts tests                        | `node --test "scripts/**/*.test.ts"`                                                              | 381 tests, 381 pass, 0 fail, 1.42 s                                                                                                                                                                                                                                           | **PASS**                                      |
| App/lib tests                        | `node --test "app/**/*.test.ts" "lib/**/*.test.ts"`                                               | 146 tests, 146 pass, 0 fail, 0.83 s                                                                                                                                                                                                                                           | **PASS**                                      |
| Pure order policy                    | `node --test scripts/order-policy.test.ts`                                                        | 27 tests, 27 pass, 0 fail, 164 ms                                                                                                                                                                                                                                             | **PASS**                                      |
| Handler regression suite             | `pnpm exec vitest run convex/orders.test.ts`                                                      | 10/10 pass (1 file), 550 ms (transform 160 ms, setup 0 ms, import 208 ms, tests 92 ms, environment 64 ms) under the repo's `edge-runtime` config; warning: duplicate `allowImportingTsExtensions` in `tsconfig.json:10,13`                                                    | **PASS**                                      |
| Repository test command (historical) | `npm test` on the earlier incomplete install                                                      | 527 Node tests pass, then `'vitest' is not recognized as an internal or external command`, exit 1; the failure was environmental and has been repaired in this checkout — the verified handler run is `pnpm exec vitest run convex/orders.test.ts` (10/10 pass)               | **REPAIRED (historical)**                     |
| Lint                                 | `node node_modules/eslint/bin/eslint.js .`                                                        | 0 errors, 4 warnings: `app/admin/directory/directory-route.tsx:118:8` complexity 13; `app/admin/directory/page.tsx:89:1` complexity 13; `app/admin/directory/page.tsx:177:3` complexity 16; `convex/menus.ts:611:1` max-lines 508                                             | **PASS (0 errors; warnings pre-existing)**    |
| Typecheck                            | `node node_modules/typescript/bin/tsc --noEmit`                                                   | Exit 2; 30 error lines; almost all `TS2307` for `@clerk/nextjs`, `@clerk/nextjs/server`, `@clerk/ui/themes`, `@dnd-kit/*`; one `TS2339` at `app/owner/business/[id]/photos-panel.tsx:116:56` (`photoUploads` missing from the generated API). **Superseded 2026-10-20:** re-run on the repaired tree exits 0 (`tsc --noEmit` clean) | **FAIL (environment + pre-existing codegen), since resolved** |
| Build                                | `node node_modules/next/dist/bin/next build`                                                      | Exit 1; "Turbopack build failed with 20 errors"; first `./app/globals.css` → `Cannot find module '@ampproject/remapping'` (from `@tailwindcss/node`), then 15+ `Module not found: Can't resolve '@clerk/nextjs'` / `@clerk/nextjs/server` / `@clerk/ui/themes` / `@dnd-kit/*`. **Superseded 2026-10-20:** re-run on the repaired tree exits 0 (`pnpm build`, compiled successfully) | **FAIL (environment), since resolved**        |
| Dev server                           | Existing server on port 3000                                                                      | At the time of that run: HTTP 500 on `/`, `/search`, `/categories`, `/sign-in`, `/owner`; log: `Module not found: Can't resolve '@clerk/nextjs'`. Superseded by the install repair; **not re-verified here** (no dev-server health check in this landing) | **FAIL (environment), historic**              |
| Install repair                       | `pnpm install`                                                                                    | `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR / Access is denied` (the running dev server holds the modules directory)                                                                                                                                                         | **BLOCKED**                                   |
| Missing packages                     | `Test-Path node_modules/@clerk/nextjs/package.json`; `node_modules/@edge-runtime/vm/package.json` | **Repaired since that run:** both files exist and both packages are populated; `@edge-runtime/vm` is `5.0.0`. `@ampproject/remapping` is still absent (build transitive only)                                                                                                 | **Environment repaired for tests**            |
| Build transitive                     | Build error                                                                                       | `@ampproject/remapping` missing from the pnpm store, so `@tailwindcss/node` cannot load                                                                                                                                                                                       | **Environment defect**                        |
| Receipt route                        | `Test-Path app/order`                                                                             | `False`; the route does not exist yet                                                                                                                                                                                                                                         | **Not implemented (by design)**               |
| User work                            | `git diff --stat`                                                                                 | Only the five pre-existing user files (menu panels, ordering panel sections, SPEC); no production file changed by this report                                                                                                                                                 | **Preserved**                                 |
| New artifacts                        | `git status --porcelain`                                                                          | `?? convex/orders.test.ts`, `?? docs/order-commitment-protocol.md`; scratch gap suite moved to `%TEMP%\opencode\orders.gap.test.ts`                                                                                                                                           | **As intended**                               |

**Interpretation.** The Node suites are green (527 tests across scripts/app/lib, including the 27 pure order-policy tests, plus 10 handler tests). Lint has no errors. **Typecheck and build do not fail because of the order code**; at the time of that run they failed because the install was incomplete: top-level `@clerk/*` and `@edge-runtime/vm` directories were empty, `@ampproject/remapping` was missing, and the running Next dev server held `node_modules` so `pnpm install` could not repair it. The test toolchain has since been repaired (`@edge-runtime/vm` `5.0.0` is installed and `pnpm exec` resolves `vitest`), so the handler suite now runs under the repo's `edge-runtime` config. **Re-run on the repaired tree (2026-10-20 review): typecheck exit 0, production build exit 0 (compiled successfully).** The historical rows above are kept as the record of that earlier run. The `photos-panel` `photoUploads` mismatch is a separate pre-existing codegen issue (the generated API references `businesses/photoUploads.js`, while the file is `photoStorage.ts`).

**What this means for the DoD.** The historical record stands: at the time of the landing run, "Lint, typecheck, build, and tests pass" was not met — lint PASS; Node tests PASS; handler tests PASS (10/10 via `pnpm exec vitest run convex/orders.test.ts` under the repo's `edge-runtime` config); typecheck/build failed on the incomplete install (since repaired). **On the current tree the environment-dependent rows are green** (typecheck exit 0, build exit 0, lint 0 errors, all suites pass). What remains open for this deliverable is unchanged: E2E `UNVERIFIED` (no running session was driven) and the protocol itself unimplemented.

## 7.5 Manual E2E script (until the app runs)

Use a dev deployment with two approved businesses, one owner each, and at least three items. Run each step twice: once through the UI, once with a direct handler call (Convex dashboard/CLI) to prove the UI is not the guard.

| #   | Step                                                                                                                                  | Expected                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Seed: business A approved, hours `{}`, items A1 (priced, modifier), A2 (priced), A3 (unpriced); business B approved; owner A, owner B | Menu reads for A; B is separate                                                                                 |
| 2   | As a visitor, add A1 ×2 with a modifier + A2 ×1; review                                                                               | Subtotal = server price; no order yet                                                                           |
| 3   | Submit with name + phone                                                                                                              | Receipt token; order `new`; owner A notification; `submitted` event                                             |
| 4   | Refresh and bookmark the receipt                                                                                                      | Same receipt; status `new`; masked contact; no PII in URL besides token                                         |
| 5   | Cancel from the receipt                                                                                                               | `cancelled`; owner sees it; no cancel button                                                                    |
| 6   | Place a second order; as owner A, call the number and accept                                                                          | `accepted`; receipt updates; cancel hidden                                                                      |
| 7   | Owner A: ready → complete                                                                                                             | `ready` → `completed`; events appended                                                                          |
| 8   | Owner A pauses orders for 30 min                                                                                                      | Public A browse-only + phone; direct `placeOrder` → `ORDERING_CLOSED`; existing new order can still be accepted |
| 9   | Owner A marks A1 sold out                                                                                                             | Public "Sold out"; direct `placeOrder` with A1 → `ITEM_UNAVAILABLE`                                             |
| 10  | Owner A marks the group unavailable                                                                                                   | Public section unavailable; direct → `GROUP_UNAVAILABLE`                                                        |
| 11  | Set A's hours to closed now                                                                                                           | Public closed; direct → `OUTSIDE_HOURS`; clear hours → orderable                                                |
| 12  | Place two orders in two tabs with the same idempotency key                                                                            | One order; both tabs show the same token; no duplicate notification                                             |
| 13  | Change A1's price after the basket is open; submit                                                                                    | `PRICE_CHANGED` with the new total; re-confirm succeeds; old order's receipt unchanged                          |
| 14  | Submit 4 orders from the same phone in 10 min                                                                                         | 1–3 succeed; 4th `TOO_MANY_REQUESTS` with `retryAfterMs`; owner clears throttle; next succeeds                  |
| 15  | Owner blocks the phone; submit again                                                                                                  | `ORDER_NOT_ACCEPTED` generic; unblock restores                                                                  |
| 16  | Create a new order, force its `orderExpiry` row past, run `sweepExpiredOrders`                                                        | `expired`; accept → `ORDER_EXPIRED`; accepted orders never expire; legacy new orders are not swept              |
| 17  | As anonymous/non-owner, call `listOrders`/`transitionOrderStatus`                                                                     | `Unauthorized`/`Forbidden`; no cross-business data                                                              |
| 18  | Wrong token / token from another order                                                                                                | `ORDER_NOT_FOUND`; no PII                                                                                       |
| 19  | Keyboard-only + screen reader through the basket/receipt                                                                              | Focus order, labels, `aria-live`, 44px, no color-only                                                           |
| 20  | Owner board with >100 completed orders + one new                                                                                      | New is visible, oldest-first; no starvation                                                                     |

**Pass criterion:** steps 1–18 produce the stated status/error, and step 19 has a recorded a11y pass. A UI-only pass is not enough; the direct-call rows are the proof.

**Reticle:** once `pnpm install` is repaired and the dev server compiles, run the `/reticle` flow for S1–S4. The current slice S0 is test-only and has no user-facing change; Reticle is not applicable to it. The app-level order flow is `UNVERIFIED` until the dev server returns 200 and the script above runs.

---

# 8. Risks, resolved decisions, and what is not verified

## 8.1 Risks

| #   | Risk                                                                    | Likelihood        | Impact                                                | Mitigation                                                                                         | Early signal                                                                        |
| --- | ----------------------------------------------------------------------- | ----------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| R1  | The incomplete `node_modules` prevents any E2E/build verification       | **Certain today** | Cannot prove the UI or build; DoD fails               | Stop the user-owned dev server, repair the install, rerun; do not weaken the check                 | `@clerk/nextjs`/`@edge-runtime/vm` empty; `@ampproject/remapping` missing; HTTP 500 |
| R2  | Schema expand breaks legacy order reads (`menuItemId` becomes optional) | Medium            | Old orders/board crash                                | Guard `order.menuItemId === undefined`; fallback to `items[]`; handler tests for both shapes       | Typecheck/runtime error on `ctx.db.get(order.menuItemId)`                           |
| R3  | The idempotency check-then-insert races and creates two orders          | Medium            | Duplicate food/owner work; P0                         | Per-business throttle doc write serializes; re-check after the write; real concurrency test        | Duplicate `(businessId, contact, items)` within 2 min                               |
| R4  | Token leaks via referrer/log/history                                    | Medium            | Receipt PII exposure; cancel capability               | `Referrer-Policy: no-referrer`, no third-party embeds, masking, no token logs; rotate/revoke later | Token in server logs or external referrer                                           |
| R5  | Owner skips the call and accepts a prank                                | High (human)      | Food waste, no-show                                   | One-tap call, explicit "Accept verified," audit, decline reasons, sample review                    | `Unreachable`/no-show rate; accept latency < 5 sec                                  |
| R6  | Throttle false positives block a real shared phone                      | Medium            | Lost order; support                                   | Owner clear-throttle (audited), limits tunable, measure                                            | `TOO_MANY_REQUESTS` + owner call                                                    |
| R7  | Hours gate silently stops a business with incomplete hours              | Medium            | Lost trade                                            | Explicit no-hours policy (skip when no periods); show "hours not set" in owner settings            | Orders drop to zero after S2 for a business with `{}`                               |
| R8  | Price mismatch flow confuses customers and loses conversion             | Medium            | Abandonment                                           | Show old/new total, one re-confirm, preserve basket; measure `PRICE_CHANGED` rate                  | High `PRICE_CHANGED` per business (stale menu)                                      |
| R9  | No push; owner misses orders until expiry                               | High              | Lost orders                                           | Age badge, tab title count, expiry, daily checklist; add push/staff in a later slice               | p95 time-to-accept > 30 min; expired rate                                           |
| R10 | PII in notes/logs/analytics                                             | Medium            | Privacy incident                                      | No PII in logs; note is owner-visible only; aggregate metrics; retention policy                    | Log grep finds phone/email/token                                                    |
| R11 | Backfill fabricates prices                                              | Low if specified  | Historical lie                                        | Backfill only name/qty/selections; `unitPrice: undefined`; label legacy; test                      | Backfilled `subtotal` non-null                                                      |
| R12 | Backfill misses orders; receipts 404                                    | Medium            | Support burden                                        | Count check (`orders` vs `orderAccess`), idempotent rerun, gate on 100%                            | `ORDER_NOT_FOUND` for old orders                                                    |
| R13 | Convex OCC does not behave as assumed                                   | Low–medium        | Duplicate/overwrite                                   | Real concurrency test before broad enable; idempotent repeat; fail closed                          | Two events for one action; duplicate order                                          |
| R14 | DST/holiday edge case opens/closes incorrectly                          | Medium            | Wrong orders                                          | DST tests; IANA timezone; manual pause for holidays; no special-hours claims                       | Order accepted when public says closed (or vice versa)                              |
| R15 | Super admin or support access leaks order PII                           | Low               | Privacy/trust                                         | Deny by default; future break-glass audited                                                        | Admin query returns contacts                                                        |
| R16 | Retention/hard delete cascades orders                                   | Low               | Data loss                                             | No cascade; admin guard; documented retention                                                      | Business delete removes orders                                                      |
| R17 | B12's unverified numbers drive a decision                               | Medium            | Wrong trade-off                                       | Use 18% with citation; label 24% unverified; measure local                                         | A decision cites 24% without a source                                               |
| R18 | Deposit/payment (C) is added without a refund policy                    | Low now           | Financial/dispute risk                                | Gate C on S5; refund states + policy first                                                         | Payment code without refund tests                                                   |
| R19 | Accessibility regressions in the basket/receipt                         | Medium            | Exclusion                                             | Keyboard/screen-reader tests; aria-live; 44px; no color-only                                       | a11y audit fails                                                                    |
| R20 | Staff role is needed but absent                                         | Medium            | Owner burnout                                         | Defer; design a scoped grant table; do not reuse `superAdmin`                                      | Owner asks for a second login                                                       |
| R21 | Multi-business cart request expands scope                               | Low               | Architecture churn                                    | Explicitly out of scope; one business per order                                                    | Product asks for a marketplace cart                                                 |
| R22 | `photoUploads` codegen mismatch confuses the build diagnosis            | **Certain today** | Masks real errors                                     | Regenerate Convex API; fix the stale import; keep it separate from order work                      | `TS2339 photoUploads` persists after install repair                                 |
| R23 | A crafted client calls `placeOrder` for a business still on `legacy`    | Low (mitigated)   | Owner sees a basket order but lacks decline/cancel UI | S1 pilot only; `placeOrder` requires `orderProtocol === 'basket'`; missing/unknown = `legacy` (Q9) | A new-protocol order appears for a non-pilot business                               |

## 8.2 Resolved implementation decisions (2026-10-20)

The product decisions are in §5.5. These implementation/operational questions were resolved in the 2026-10-20 grill session; the table records the decision, and the last column records what reopening it costs.

| #   | Question                                                | Decision (2026-10-20)                                                                                                | Decision owner        | Reversal cost                                                                  |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| Q1  | Does `submitOrder` mint a token/event after S1?         | **No**; keep `submitOrder` untouched in S1. Re-run the token backfill when a business switches to `basket`.          | Engineering + product | If yes, refactor to a shared insert and retest legacy args/return.             |
| Q2  | Is email-only accepted, or is phone required?           | **Either phone or email; at least one required.** Phone is prompted for pickup, not mandatory; no OTP in v1.         | Product               | Phone required raises friction; email required adds deliverability/typo risk.  |
| Q3  | Is `no_show` allowed only after a minimum wait?         | **No minimum timer; owner decides.** Confirm the pickup window in the UI.                                            | Operations            | A timer needs prep-time data and creates false no-shows.                       |
| Q4  | Can the owner cancel from `ready`?                      | **Yes**, owner cancel from `ready` with a reason.                                                                    | Operations            | If no, a customer who calls after ready has no path.                           |
| Q5  | Can the owner extend `expiresAt`?                       | **No** extension in v1.                                                                                              | Operations            | If yes, add reason/audit and accept a stale-board risk.                        |
| Q6  | Is the owner's decline free text shown to the customer? | **Yes**; canned reasons plus optional free text capped at 200, labeled customer-visible.                             | Product/privacy       | If no, show the code only; internal notes need a separate field.               |
| Q7  | Is the block list global or per business?               | **Per business.**                                                                                                    | Product/trust         | Global needs review/appeal.                                                    |
| Q8  | Is the throttle clear per business?                     | **Per business, audited.**                                                                                           | Operations            | Global clear is an abuse surface.                                              |
| Q9  | Does `placeOrder` check the `orderProtocol` flag?       | **Yes**; `placeOrder` requires `orderProtocol === 'basket'`; missing/unknown = `legacy`.                             | Engineering           | If no, legacy businesses can receive new-protocol orders (R23); add detection. |
| Q10 | Is `getOrderStatus` retired?                            | **No**; keep for old links; deprecate later.                                                                         | Engineering           | Retiring breaks old receipts and Q1 legacy orders.                             |
| Q11 | Is `menuVisible` ever added?                            | **No** `menuVisible` in v1.                                                                                          | Product               | Hidden + open must be decided.                                                 |
| Q12 | Is the receipt token rotated/revocable?                 | **No** rotation/revocation in v1; masked contact limits leak.                                                        | Security              | Rotation needs a UX, migration, and support path.                              |
| Q13 | Does the owner see the customer's note on the board?    | **Yes**; show it truncated with expand.                                                                              | Product               | If hidden, allergies/requests may be missed.                                   |
| Q14 | Is a customer notification added?                       | **No** SMS/email in v1; reactive receipt plus owner call.                                                            | Product               | SMS/email is C: cost, consent, deliverability.                                 |
| Q15 | Is the order list paginated?                            | **Cursor-paginate `new` at 50/page; 100 cap for other filters with a visible count.** Never silently truncate `new`. | Engineering           | If no, a 100 cap can hide the 101st new order.                                 |
| Q16 | Is a `no_show` counted as completed for metrics?        | **No**; `no_show` is separate from `completed`.                                                                      | Operations            | Counting it as completed hides the failure and distorts deposit decisions.     |

## 8.3 UNVERIFIED items

| #   | Item                                                                                 | Why it is unverified                    | What would verify it                               |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------- | -------------------------------------------------- |
| U1  | Fake/prank order prevalence                                                          | No public base rate; no local analytics | Two weeks of coded declines + owner flag           |
| U2  | No-show prevalence                                                                   | Same                                    | `no_show` rate after S4                            |
| U3  | B12's 24% account-abandonment figure                                                 | B12 has no URL; Baymard says 18%        | A citable source, or drop the number               |
| U4  | Deposit effect on pickup conversion/no-shows                                         | Evidence is reservations only           | A C pilot with a controlled comparison             |
| U5  | Multi-item basket effect on conversion/AOV                                           | No local data                           | S3 before/after, interrupted time series           |
| U6  | Owner verification compliance and time                                               | No observation                          | Audit sample + owner interviews                    |
| U7  | Convex OCC behavior under concurrent `placeOrder`                                    | `convex-test` may serialize             | Real deployment two-call test                      |
| U8  | Production `orders` row count and backfill duration                                  | Production data not visible here        | Count/query on the target deployment               |
| U9  | Next middleware behavior on `/order/[token]`                                         | Not read/tested here                    | Read `middleware.ts` matcher; route test           |
| U10 | DST/holiday edge cases                                                               | No tests yet                            | Fixed-`now` DST tests; manual pause for holidays   |
| U11 | Typecheck/build green after repair                                                   | ~~Install is broken~~ **Resolved 2026-10-20:** typecheck exit 0 and build exit 0 re-run on the repaired tree; recorded in §7.4/§9.4 | ~~Repair `node_modules`; rerun~~ Done — no further action  |
| U12 | Browser E2E                                                                          | App 500; no session                     | Reticle after repair                               |
| U13 | `crypto.getRandomValues`/`crypto.subtle` availability in the Convex mutation runtime | **Documented, not executed here:** the Convex Runtimes page lists `crypto`, `CryptoKey`, and `SubtleCrypto` among the default runtime's supported Web Crypto APIs (docs.convex.dev/functions/runtimes), so the token design rests on a documented platform capability. The 5-line smoke test is retained as cheap insurance; fallback `crypto.randomUUID` | A 5-line Convex test before relying on it in S1 |
| U14 | Real conversion impact of the accept call                                            | No data                                 | S5 metrics                                         |
| U15 | Staff role need                                                                      | No data                                 | Owner interviews                                   |
| U16 | Legal/privacy review of contact retention/blocking                                   | Not done                                | Counsel review before C                            |
| U17 | `photoUploads` codegen cause                                                         | Pre-existing; not investigated          | Regenerate Convex API; compare `photoStorage.ts`   |
| U18 | Whether `@ampproject/remapping` alone unblocks the build                             | Only the first CSS error is shown       | Repair install; rerun build                        |

## 8.4 Three most likely production failures (and detection)

| Failure                           | What it looks like                                                           | Detection                                                       | First response                                        | Permanent fix                                                 |
| --------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| **Owner misses the queue**        | Orders expire; customers call; board has a red age badge                     | `expired` rate; p95 accept latency; owner interview             | Call the owner; pause ordering; add a second watcher  | Push/SMS or staff role (C/S5)                                 |
| **Throttle blocks a real rush**   | A shared phone/office gets `TOO_MANY_REQUESTS`; owner cannot enter the order | Throttle hits + owner calls; false-positive rate                | Clear the contact throttle (audited); raise the limit | Tune limits; per-contact history; owner manual order (future) |
| **Stale menu**                    | Many `PRICE_CHANGED`/`ITEM_UNAVAILABLE` at submit; customers abandon         | Error rates by business; 86 age                                 | Fix the 86/hours; refresh menu                        | 86 checklist, POS sync (future), stale-menu alert             |
| **Backfill miss**                 | Old receipt links 404; owner sees legacy orders without tokens               | `orders` vs `orderAccess` count; `ORDER_NOT_FOUND` on old links | Rerun idempotent backfill                             | Count gate + alert                                            |
| **Duplicate despite idempotency** | Two orders from one submit; two notifications                                | Duplicate contact/items within 2 min; event count               | Cancel one; refund if payment; root-cause OCC         | Real concurrency test; unique constraint pattern              |

## 8.5 Self-review

**What is strong**

- The report starts from the code, not from B12. Every current-state claim has a `file:line`; every external claim has a URL, date/access date, and copied passage.
- The failure reproductions are concrete: duplicate submit creates two orders; a price edit rewrites an old order; no cancel/decline; no hours/pause/group gate; the receipt code is not a lookup.
- The options are genuinely different, and the recommendation has a stop condition: B now, C only if measured thresholds trigger.
- The state machine is explicit, including no-show, idempotent repeats, and the race semantics.
- The migration is expand/contract, not a one-step rewrite; it does not fabricate historical prices.
- The DoD is honest: the design is complete, but the implementation-dependent P0 tests do not exist, and the environment blocks typecheck/build/E2E.

**What is weak**

- No production code was changed. The protocol is a specification plus one test slice, not a working feature. The brief allows this, but it means the "every P0 has a passing test" DoD is unmet by construction.
- The external evidence is mostly vendor documentation; it proves how those products work, not that the same controls work here. The mechanism analysis is reasoning, not an experiment.
- The abuse thresholds (3/10 min, 10/24 h, 60/10 min, 60-min TTL) are policy defaults, not measured optima.
- The concurrency claim rests on an OCC assumption that has not been run against a real deployment.
- The receipt/`/order/[token]` route and middleware interaction are unspecified in code; U9 is open.
- The `submitOrder` token gap (Q1) is a deliberate trade-off, not a fully unified receipt for every order.
- The report is long. A reader who wants the decision can read the Verdict, §5.2, and §7.1; the rest is evidence and implementation detail.

**What I would do differently**

- Repair the environment first (stop the user-owned dev server, `pnpm install`, regenerate Convex, rerun build/E2E). Without that, the strongest possible evidence is handler-level.
- Ask the staff/deposit/menu-visibility questions before writing the options, not after; the defaults are reasonable but they are assumptions.
- If allowed to change production code, land S1 behind a flag and run the concurrency test against a dev deployment before writing the UI.

**Reviewer checklist**

- [ ] Can an engineer implement S1 without asking a clarifying question? (Check §6.2, §6.4, §6.5, §7.2.)
- [ ] Does every proposed P0 have a named test layer? (Check §6.3.)
- [ ] Is the migration reversible and non-destructive? (Check §6.2.9.)
- [ ] Does the UI remain guest-first? (Check §5.2, §6.7.)
- [ ] Is the owner's verification explicit, not assumed? (Check §6.6, §6.8.)
- [ ] Are the unverified claims labeled? (Check §8.3.)
- [ ] Is the DoD status honest? (Check the Verdict table.)

**P0 security finding?** No exploitable authentication bypass was found: `listOrders`/`transitionOrderStatus` are owner-guarded, and `getOrderStatus` exposes only `status` + `createdAt` (`orders.ts:211-221`). The P0s in this report are **integrity and operational** failures (duplicate orders, no termination, no kill switches, no token receipt), not a current auth bypass. Extending the id-based receipt to items/PII **would** create a privacy issue; that is why the token must land before the richer receipt.

---

# 9. Evidence log

## 9.1 Scope and environment

- **Repository:** `D:\Dev\dircteshop-1`
- **Branch:** `fix/issue-73-order-protocol-t1-land-s0-handler-regression-suite-protocol-doc`
- **HEAD:** `723a7f3`
- **Date:** 2026-10-20
- **Runtime:** Windows; Node 24.x; Convex dev deployment `dev:agile-husky-366`; Next dev server on port 3000 (this repo) and an unrelated `gunthy-win.exe` on port 3001. Neither server was killed.
- **Package manager:** pnpm lockfile; the test toolchain is installed and `pnpm exec` resolves the binaries (the earlier empty `node_modules/.bin` was repaired).
- **Scope of changes:** one new test file, one new report file, and one scratch test moved outside the repo. **No production code, schema, or UI was changed.**

## 9.2 Chronological log

| When             | Action                                                                                                                             | Command / method                                                                                                                                                                           | Result                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start            | Read the brief, repo rules, Convex guidelines, package scripts, SPEC §7/§7.1, B12, issue #8, and the order/menu/authz/schema files | Read/grep/graft                                                                                                                                                                            | Ground-truth citations collected                                                                                                                                              |
| Start            | Traced the public profile → `OrderingPanel` → `submitOrder` → `orders`/`notifications` path                                        | Read + graft                                                                                                                                                                               | Confirmed single-item B8 flow; no token/cancel/decline                                                                                                                        |
| Start            | Traced the owner board → `listOrders`/`transitionOrderStatus`                                                                      | Read + graft                                                                                                                                                                               | Confirmed owner-only guard and 4-state machine                                                                                                                                |
| Baseline         | Listing state machine                                                                                                              | `node scripts/verify-state-machine.ts`                                                                                                                                                     | PASS: 6 statuses, 11 actor rows, 5 owner rows                                                                                                                                 |
| Baseline         | Pure order policy                                                                                                                  | `node --test scripts/order-policy.test.ts`                                                                                                                                                 | 27 pass, 0 fail                                                                                                                                                               |
| Baseline         | Lint                                                                                                                               | `node node_modules/eslint/bin/eslint.js .`                                                                                                                                                 | 0 errors, 4 warnings                                                                                                                                                          |
| Baseline         | Typecheck                                                                                                                          | `node node_modules/typescript/bin/tsc --noEmit`                                                                                                                                            | 30 error lines, exit 2; empty `@clerk/*`/`@dnd-kit/*`                                                                                                                         |
| Baseline         | App                                                                                                                                | `Invoke-WebRequest http://localhost:3000/`                                                                                                                                                 | HTTP 500; log: `Module not found: Can't resolve '@clerk/nextjs'`                                                                                                              |
| Baseline         | Install repair                                                                                                                     | `pnpm install`                                                                                                                                                                             | `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR / Access is denied`                                                                                                              |
| Characterization | Created `convex/orders.gap.test.ts` (11 tests; scratch suite, outside the repo)                                                    | `node node_modules/vitest/vitest.mjs run convex/orders.gap.test.ts --environment node --reporter=verbose` (historical `node` workaround; the edge-runtime install was repaired afterwards) | 11/11 pass (628 ms)                                                                                                                                                           |
| Characterization | Confirmed duplicate submit                                                                                                         | `Promise.all` two `submitOrder` calls                                                                                                                                                      | **Two distinct order ids / two rows**                                                                                                                                         |
| Characterization | Confirmed price rewrite                                                                                                            | Change `menuItems.price` after order, then `listOrders`                                                                                                                                    | Old order returned the **new** price                                                                                                                                          |
| Characterization | Confirmed no cancel/decline                                                                                                        | Inspect `orderPolicy.ts`/`orders.ts` + handler call                                                                                                                                        | `decline` rejected; no `cancelOrder`                                                                                                                                          |
| Characterization | Confirmed no hours/pause/group gate                                                                                                | `hours: {}`; check fields                                                                                                                                                                  | Order accepted; `acceptingOrders`/group `isAvailable` absent                                                                                                                  |
| Characterization | Confirmed no token lookup                                                                                                          | `orderCode` last-6 + `getOrderStatus` by id                                                                                                                                                | Code is not accepted by any query                                                                                                                                             |
| Permanent suite  | Created `convex/orders.test.ts` (10 tests); re-verified on landing                                                                 | `pnpm exec vitest run convex/orders.test.ts`                                                                                                                                               | **10/10 pass (550 ms)** under the repo's `edge-runtime` config; tsconfig duplicate-key warning                                                                                |
| Permanent suite  | Lint the new file                                                                                                                  | `node node_modules/eslint/bin/eslint.js convex/orders.test.ts`                                                                                                                             | Exit 0                                                                                                                                                                        |
| Permanent suite  | Prettier the new file                                                                                                              | `node node_modules/prettier/bin/prettier.cjs --check convex/orders.test.ts`                                                                                                                | "All matched files use Prettier code style!"                                                                                                                                  |
| Cleanup          | Moved scratch suite out of the test tree                                                                                           | `Move-Item` to `%TEMP%\opencode\orders.gap.test.ts`                                                                                                                                        | Moved; not deleted; not in repo                                                                                                                                               |
| Regression       | Scripts tests                                                                                                                      | `node --test "scripts/**/*.test.ts"`                                                                                                                                                       | 381 pass, 0 fail (1.42 s)                                                                                                                                                     |
| Regression       | App/lib tests                                                                                                                      | `node --test "app/**/*.test.ts" "lib/**/*.test.ts"`                                                                                                                                        | 146 pass, 0 fail (0.83 s)                                                                                                                                                     |
| Regression       | Repository test command (historical)                                                                                               | `npm test` on the earlier incomplete install                                                                                                                                               | 527 pass, then `'vitest' is not recognized`, exit 1; environmental and since repaired — the verified handler run is `pnpm exec vitest run convex/orders.test.ts` (10/10 pass) |
| Build check      | Typecheck                                                                                                                          | `node node_modules/typescript/bin/tsc --noEmit`                                                                                                                                            | 30 lines, exit 2; 29-ish TS2307 + one `photoUploads` TS2339                                                                                                                   |
| Build check      | Production build                                                                                                                   | `node node_modules/next/dist/bin/next build`                                                                                                                                               | 20 errors, exit 1; `@ampproject/remapping` + 15+ Clerk/dnd-kit module-not-found                                                                                               |
| Install check    | Empty packages                                                                                                                     | `Test-Path node_modules/@clerk/nextjs/package.json`; `@edge-runtime/vm`                                                                                                                    | Both false (empty dirs); `convex-test` populated                                                                                                                              |
| Repo state       | User work preserved                                                                                                                | `git diff --stat`                                                                                                                                                                          | Only the 5 pre-existing user files; no production change by this report                                                                                                       |
| Deliverable      | Wrote this report                                                                                                                  | `docs/order-commitment-protocol.md`                                                                                                                                                        | New, **staged on the issue branch** (not yet committed — the PR phase commits)                                                                |                                                                                                                                                                |
| Deliverable      | Permanent test                                                                                                                     | `convex/orders.test.ts`                                                                                                                                                                    | New, **staged on the issue branch**, 10 passing (not yet committed — the PR phase commits)                                                                                    |

## 9.3 Files and artifacts

| Path                                                                | Status                 | Contents / impact                                                                                                  |
| ------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `convex/orders.test.ts`                                             | **New**                | 10 handler-level regression tests for the B8 contract; no runtime behavior                                         |
| `docs/order-commitment-protocol.md`                                 | **New**                | This report                                                                                                        |
| `C:\Users\calvi\AppData\Local\Temp\opencode\orders.gap.test.ts`     | Moved out of the repo  | Scratch characterization suite (11 tests) that reproduced the gaps; retained as evidence, not part of the test run |
| `app/owner/business/[id]/menu-panel-groups.tsx`                     | Pre-existing user edit | Not touched                                                                                                        |
| `app/owner/business/[id]/menu-panel-item-editor.tsx`                | Pre-existing user edit | Not touched                                                                                                        |
| `app/owner/business/[id]/menu-panel.tsx`                            | Pre-existing user edit | Not touched                                                                                                        |
| `components/profile/ordering-panel-sections.tsx`                    | Pre-existing user edit | Not touched                                                                                                        |
| `screens/SPEC.md`                                                   | Pre-existing user edit | Not touched                                                                                                        |
| `convex/schema.ts`, `convex/orders.ts`, `convex/orderPolicy.ts`, UI | **Unchanged**          | No production behavior, schema, or UI change                                                                       |

**Note on `.next`:** the production build attempt wrote `.next/build` artifacts. It did not modify source. The running dev server's `.next/dev` may be stale; a restart is required after the install repair.

## 9.4 Verification ledger

| Claim                                                          | Status                 | Evidence                                                                                                                                                                                                    |
| -------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current flow is single-item, 4 states, no token/cancel/decline | **PASS**               | Schema/policy/orders reads; handler tests; scratch suite                                                                                                                                                    |
| Duplicate submit creates two orders                            | **PASS (reproduced)**  | Scratch `Promise.all` test; code has no idempotency                                                                                                                                                         |
| Menu price edit rewrites an old order's displayed price        | **PASS (reproduced)**  | Scratch test; live join in `listOrders`                                                                                                                                                                     |
| Owner-only access is enforced                                  | **PASS**               | 10 handler tests (`Unauthorized`/`Forbidden`)                                                                                                                                                               |
| The receipt code is not a lookup                               | **PASS (reproduced)**  | `helpers.ts:231-234`; no query accepts it                                                                                                                                                                   |
| The protocol/state machine/options are specified               | **PASS**               | §5–§7                                                                                                                                                                                                       |
| Every proposed P0 has an implementation test                   | **FAIL**               | The protocol is not implemented; §6.3 maps future tests                                                                                                                                                     |
| Kill switches are proven by direct calls                       | **FAIL**               | No kill switch exists yet                                                                                                                                                                                   |
| Node tests                                                     | **PASS**               | 381 + 146 + 10; the 381 includes the 27 order-policy tests                                                                                                                                                  |
| Lint                                                           | **PASS**               | 0 errors, 4 pre-existing warnings                                                                                                                                                                           |
| Handler regression suite                                       | **PASS**               | `pnpm exec vitest run convex/orders.test.ts` → 10/10 pass (550 ms) under the repo's `edge-runtime` config; the earlier `npm test` failure (`vitest` binary missing) was environmental and has been repaired |
| Typecheck                                                      | **FAIL (environment), since resolved** | Re-run 2026-10-20 on the repaired tree: exit 0; the original 30 errors came from the incomplete install                                                                                                     |
| Build                                                          | **FAIL (environment), since resolved** | Re-run 2026-10-20 on the repaired tree: exit 0, compiled successfully; the original 20 errors were missing modules from the incomplete install                                                              |
| Browser E2E                                                    | **UNVERIFIED**         | App 500; no Reticle session                                                                                                                                                                                 |
| Production migration                                           | **UNVERIFIED**         | Not run; plan only                                                                                                                                                                                          |
| Real concurrency (OCC)                                         | **UNVERIFIED**         | Not run; plan only                                                                                                                                                                                          |
| Overall DoD                                                    | **FAIL**               | Design complete; implementation-dependent checks not met                                                                                                                                                    |

## 9.5 Rollback

- **S0 (added, staged on the issue branch, not yet committed):** remove `convex/orders.test.ts`; there is no runtime change, no schema change, and no data.
- **This report:** remove `docs/order-commitment-protocol.md`; no runtime impact.
- **Scratch suite:** it is outside the repo; delete it if the evidence is no longer needed.
- **Future S1–S4:** set `businesses.orderProtocol` back to `legacy`; the additive schema can remain; do not drop tables/fields in the rollback. New orders already created remain readable by token and the owner board.
- **Do not revert the five user-edited files.** They are unrelated and must be preserved.

## 9.6 Reproducibility commands

```powershell
# Baseline
node scripts/verify-state-machine.ts
node --test "scripts/**/*.test.ts"
node --test "app/**/*.test.ts" "lib/**/*.test.ts"
node --test scripts/order-policy.test.ts
pnpm exec vitest run convex/orders.test.ts

# Quality
node node_modules/eslint/bin/eslint.js .
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build

# Repository command (the earlier `vitest` binary failure was environmental and has been repaired; the verified handler run above is authoritative)
npm test

# Install repair (requires stopping the dev server that holds the modules dir)
pnpm install

# Current app health
Invoke-WebRequest http://localhost:3000/

# Repo state
git diff --stat
git status --porcelain
```

**Why this command:** the repo's `vitest.config.ts:12` selects `edge-runtime` and `include` covers `convex/**/*.test.ts`, so the canonical command needs no override. The earlier `--environment node` workaround existed because `@edge-runtime/vm` was an empty directory; that environment failure was repaired before landing (`@edge-runtime/vm` `5.0.0` is installed and `pnpm exec` resolves `vitest`). The suite now runs under the edge runtime, which is the environment the repo config specifies.

---

# Appendix A — Source bibliography

| #   | Source                                                                          | Date / access                                | URL                                                                                                                    | Used for                                                     |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Baymard Institute, _50 Cart Abandonment Rate Statistics 2026_                   | Last updated 2025-09-22; accessed 2026-10-20 | https://baymard.com/lists/cart-abandonment-rate                                                                        | 70.22% aggregate; 42/40/20/19/18/17/17/13/12/10/9/7% reasons |
| 2   | DoorDash Help, _How to Manage Your Store Status and Availability_               | Undated; accessed 2026-10-20                 | https://help.doordash.com/en-us/merchants/article/what-is-my-store-status                                              | Busy vs Pause; duration/channel                              |
| 3   | DoorDash Help, _Navigating Operations Quality Reporting in the Merchant Portal_ | Updated 2026-10-20; accessed 2026-10-20      | https://help.doordash.com/en-us/merchants/article/merchant-portal-operations-quality                                   | Avoidable cancellations; hours/86/confirm guidance           |
| 4   | Uber Help, _Pausing new orders_                                                 | Undated; accessed 2026-10-20                 | https://help.uber.com/merchants-and-restaurants/article/pausing-new-orders?nodeId=42e66554-9875-4ca4-93f9-59f497120949 | Pause duration/reason; end-of-day; kitchen-closed prompt     |
| 5   | Uber Eats Merchant Academy, _Accepting orders on Uber Eats_                     | Undated; accessed 2026-10-20                 | https://merchants.ubereats.com/us/en/academy/orders/                                                                   | Backgrounded app; accept/confirm/ready                       |
| 6   | Toast, _86 an Item on the POS or Toast Web_                                     | Last updated 2026-10-06                      | https://support.toasttab.com/en/article/86-an-Item                                                                     | Global 86; persists until un-86                              |
| 7   | Square Support, _Mark items and modifiers as sold out_                          | Undated; accessed 2026-10-20                 | https://squareup.com/help/us/en/article/8430-mark-items-and-modifiers-as-sold-out                                      | Sold-out hides; scheduled reset/future dates                 |
| 8   | Square Support, _Set up pickup options for your online ordering profile_        | Undated; accessed 2026-10-20                 | https://squareup.com/help/us/en/article/8608-set-up-pickup-options-for-your-online-ordering-profile                    | Prep/lead/pickup hours/downtime/limits                       |
| 9   | Stripe API Reference, _Idempotent requests_                                     | Undated; accessed 2026-10-20                 | https://docs.stripe.com/api/idempotent_requests                                                                        | Retry-safety, V4 UUID, 24h, parameter comparison             |
| 10  | Tock, _Best Practices for Deposit Experiences_                                  | Undated; accessed 2026-10-20                 | https://tock.zendesk.com/hc/en-us/articles/5912341029140-Best-Practices-for-Deposit-Experiences                        | 10–15% reservation deposit; reminders                        |
| 11  | Oh, J. & Su, X., _Pricing Restaurant Reservations: Dealing with No-Shows_       | Written 2012-10-31; posted 2012-11-02        | https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2169567                                                            | No-show penalty model up to meal price                       |
| 12  | Shopify Help, _Editing the checkout form options_                               | Undated; accessed 2026-10-20                 | https://help.shopify.com/en/manual/checkout-settings/checkout-form-options                                             | Phone or email, not both; sign-in hides accelerated checkout |
| 13  | Convex, _Rate Limiter_                                                          | Undated; accessed 2026-10-20                 | https://www.convex.dev/components/rate-limiter                                                                         | Fixed window/token bucket; transactional; fails closed       |
| 14  | Spence, M., _Job Market Signaling_, QJE 87(3)                                   | August 1973                                  | https://www.sfu.ca/~allen/Spence.pdf; DOI 10.2307/1882010                                                              | Cheap signals; one-shot actors; screening                    |
| 15  | Akerlof, G., _The Market for "Lemons"_, QJE 84(3)                               | August 1970                                  | https://link.springer.com/chapter/10.1007/978-1-349-24002-9_9; DOI 10.2307/1879431                                     | Quality uncertainty; market institutions/unraveling          |
| 16  | Order Online, Inc., _What are my options for dealing with fake orders?_         | Last updated 2023-01-20                      | https://www.onlineordering.help/article/98-what-are-my-options-for-dealing-with-fake-orders                            | Flag/block/discard; global callback validation               |
| 17  | GitHub issue #8, _B8: Restaurant vertical — menu modules + order workflow_      | Created 2026-09-18; updated 2026-10-12       | https://github.com/Calel33/dircteshop/issues/8                                                                         | Scope: single-item, no cart/checkout/payment; open           |

**Repo sources** are cited inline by `file:line`; the key files are `convex/schema.ts`, `convex/orders.ts`, `convex/orderPolicy.ts`, `convex/authz.ts`, `convex/menus.ts`, `convex/businesses/publicHours.ts`, `convex/businessTypes.ts`, `convex/notificationHelpers.ts`, `components/profile/ordering-panel*.tsx`, `components/profile/menu-tabs.tsx`, `app/business/[id]/page.tsx`, `app/owner/business/[id]/orders-panel.tsx`, `scripts/order-policy.test.ts`, `scripts/verify-state-machine.ts`, `vitest.config.ts`, `screens/SPEC.md`, `screens/wayfinder/build/B12-order-basket.md`, and `convex/AGENTS.md`.

---

# Appendix B — One-page implementation checklist

Use this as the S1 PR checklist; it is a summary, not a replacement for §6–§7.

**Schema and migration**

- [ ] Add optional `orders.items/subtotal/pricingSource/statusReason/statusUpdatedAt/expiresAt/customerUserId`; widen `status`; make legacy `menuItemId`/`selections` optional.
- [ ] Add `orderAccess`, `orderIdempotency`, `orderExpiry`, `orderEvents`, `orderThrottle`, `orderBlocks`; add indexes.
- [ ] Add `businesses.orderProtocol`, `businesses.acceptingOrders/Until/Note`; `menuGroups.isAvailable`.
- [ ] Guard `placeOrder` with `orderProtocol === 'basket'`; missing/unknown = `legacy`.
- [ ] Backfill `orderAccess` + `items[]`; **no price**; batch 50; idempotent; count gate.
- [ ] Keep `submitOrder`/`getOrderStatus` working; guard optional legacy fields.

**Commit path**

- [ ] Pure `validateBasket`/`priceBasket`/`parseContact`/`canonicalArgsHash`/`createReference`.
- [ ] `placeOrder`: guard chain (approved → pause/until → hours → group → item → selections → price → contact/caps → idempotency/throttle).
- [ ] Server price only; snapshot name/unitPrice/lineTotal/selections; integer cents.
- [ ] Idempotency: `(businessId, key)` + args hash; same → original; different → conflict.
- [ ] Token: 32 random bytes; `orderAccess`; masked receipt; no logs/referrer.
- [ ] Insert order + access + idempotency + event + notification atomically.
- [ ] Schedule expiry; internal `expireOrder` only `new`.

**States and authority**

- [ ] 8 states; `accept/decline/cancel/ready/complete/noShow/expire`; terminal set.
- [ ] Owner transitions require owner + business match + reason where required.
- [ ] Visitor cancel requires token + `new`.
- [ ] Idempotent repeat success; conflicting action `ORDER_ALREADY_DECIDED`.
- [ ] `orderEvents` on every transition; `auditLogs` on every toggle.

**Owner**

- [ ] Pause/until; group toggle; hours enforcement; item toggle audit.
- [ ] Board filters/default new/oldest first/age badge.
- [ ] Accept verified prompt with call link; decline reasons; cancel/no-show.
- [ ] Block/unblock; clear throttle (audited).

**Customer**

- [ ] Basket (1–20 lines, qty 1–20, total units ≤100); localStorage versioned.
- [ ] `expectedSubtotal` mismatch → review/re-confirm; preserve basket.
- [ ] `/order/[token]` receipt; refresh/bookmark; masked contact; cancel only new.
- [ ] Error map for every code; aria-live/focus/44px.

**Verification**

- [ ] Pure matrix + handler matrix + real concurrency + Reticle E2E.
- [ ] Authz negatives for every mutation.
- [ ] Kill switches by direct handler call.
- [ ] Lint/typecheck/build/tests in a repaired environment.
- [ ] Migration dry run + rollback.
