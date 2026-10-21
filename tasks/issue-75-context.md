# Context — Issue #75: Order protocol T3 (pure commit policy + test matrix)

> Explorer output. Read-only exploration; no source file was modified. Every claim carries `file:line`.
> Authoritative spec: `docs/order-commitment-protocol.md` (referred to below as "spec").

---

## 0. Task contract

| Field | Value |
|---|---|
| TYPE | Codebase exploration / context gathering for an implementation ticket |
| TARGET | Issue #75: DB-free commit policy module + `node --test` matrix |
| GOAL | Map the spec, the reusable pure symbols, the schema/catalog shapes, the test-runner facts, and the no-change gate |
| DONE-WHEN | This file contains every required section; no source file touched |

---

## 1. Git / branch state (measured)

```
$ git rev-list --count main..HEAD
4
$ git log --oneline main..HEAD
dad4a65 feat(orders): expand order protocol schema and backfill legacy orders (#76)
2467f0a test(orders): land S0 handler regression suite + order commitment protocol (#73)
723a7f3 fix(photos): migrate panel upload to the authenticated Convex HTTP route (#74)
042a4ae feat(b8): add restaurant menu modules and anonymous order workflow (#8)
$ git rev-parse --short HEAD
dad4a65
$ git branch --show-current
fix/issue-76-order-protocol-t2-schema-expand-legacy-backfill-expand-step
```

- Current branch: `fix/issue-76-order-protocol-t2-schema-expand-legacy-backfill-expand-step`, HEAD `dad4a65`.
- HEAD contains the spec (`docs/order-commitment-protocol.md`, tracked) and the #76 schema expand (`convex/schema.ts`, `convex/orderAccess.ts`, `convex/migrations/backfillOrderAccess.ts`, widened `ORDER_DB_STATUSES`).
- `main` is **4 commits behind** HEAD. The #75 branch must be created from the **current HEAD** so it inherits the protocol doc and the #76 schema expand; branching from `main` would omit both.
- Working tree is dirty with many untracked files (`.archon/`, `.firecrawl/`, `tasks/*`, `prompts/003-…`). No tracked source file is modified (`git status --porcelain` shows only `??` entries).

---

## 2. What already exists / what does not

| Thing | Status | Evidence |
|---|---|---|
| The 8 order statuses | **Exists** as `ORDER_DB_STATUSES` | `convex/orderPolicy.ts:20-29` |
| 8×9 protocol transition matrix | **Does not exist** | `convex/orderPolicy.ts:15-19` reserves it: "The transition matrix below stays the 4-state legacy machine until T3 adds the actions that reach the new states." |
| Legacy 4×3 machine | **Exists**, consumed by handlers and UI | `convex/orderPolicy.ts:12-58`; `convex/orders.ts:9-13,246`; `app/owner/business/[id]/orders-panel.tsx` (via graft) |
| `convex/orderCommitPolicy.ts` | **Does not exist** | no file in the tree; no `scripts/order-commit-policy.test.ts` either |
| `createReference` (6→7 char, collision retry) | **Exists**, DB-adjacent module | `convex/orderAccess.ts:19-26,42-75` |
| Pure hours evaluator | **Exists** | `convex/businesses/publicHours.ts:120-176` |
| Contact validator (legacy) | **Exists**, name ≤120, no email shape | `convex/orderPolicy.ts:137-173` |
| SHA-256 / WebCrypto use | **No precedent** in repo | grep found only comments (`convex/schema.ts:275,316,324`) |
| Bounded list of script tests | 29 files under `scripts/*.test.ts` | `ls scripts/*.test.ts` |

`ORDER_DB_STATUSES` has **no importer today** (grep across `convex/` and `scripts/`: only `convex/orderPolicy.ts:20`). It is a declared-but-unused export.

---

## 3. Spec extract — §6.1 state machine (`docs/order-commitment-protocol.md:822-879`)

### 3.1 States (`spec:826-835`)

| State | Meaning | Terminal? | Who can put an order here |
|---|---|---|---|
| `new` | Committed by the customer; not yet acknowledged | No | `placeOrder` |
| `accepted` | Owner verified and accepted | No | Owner `accept` |
| `ready` | Food ready for pickup | No | Owner `ready` |
| `completed` | Handed to the customer | **Yes** | Owner `complete` |
| `declined` | Owner refused before accepting | **Yes** | Owner `decline` (reason required) |
| `cancelled` | Customer or owner cancelled | **Yes** | Visitor `cancel` (only from `new`, token); owner `cancel` (from `new`/`accepted`/`ready`, reason required) |
| `expired` | Not accepted within the TTL | **Yes** | System `expire` (only from `new`) |
| `no_show` | Customer did not pick up a `ready` order | **Yes** | Owner `noShow` (only from `ready`) |

Terminal set (spec:854, and plan D1): `completed`, `declined`, `cancelled`, `expired`, `no_show`.

### 3.2 Transitions (`spec:841-854`), verbatim rows

| From | Action | Actor | Guard | To | Error on failure |
|---|---|---|---|---|---|
| — | `submit` | Visitor | All `placeOrder` guards (§6.4) | `new` | See §6.5/§6.7 codes |
| `new` | `accept` | Owner | owner; belongs to business; not expired | `accepted` | `ORDER_EXPIRED`, `ORDER_ALREADY_DECIDED`, `FORBIDDEN` |
| `new` | `decline` | Owner | reason 1–200 | `declined` | `REASON_REQUIRED`, `ORDER_ALREADY_DECIDED` |
| `new` | `cancel` | Visitor (token) | token matches; status `new` | `cancelled` | `CANNOT_CANCEL`, `ORDER_EXPIRED` |
| `new` | `cancel` | Owner | reason 1–200 | `cancelled` | `REASON_REQUIRED` |
| `accepted` | `ready` | Owner | owner | `ready` | `INVALID_TRANSITION`, `ORDER_ALREADY_DECIDED` |
| `accepted` | `cancel` | Owner | reason 1–200 | `cancelled` | `REASON_REQUIRED` |
| `ready` | `complete` | Owner | owner | `completed` | `INVALID_TRANSITION` |
| `ready` | `noShow` | Owner | reason optional (default "Not picked up") | `no_show` | `INVALID_TRANSITION` |
| `ready` | `cancel` | Owner | reason 1–200 | `cancelled` | `REASON_REQUIRED` |
| `new` | `expire` | System | `orderExpiry.expiresAt <= now`; status `new` | `expired` | no-op if already decided |
| terminal (5) | any | — | — | — | `ORDER_TERMINAL` |

### 3.3 Idempotent repeat policy (`spec:856`)

> "Repeating the **same** action when the order is already in its target state is a success with `reused: true` and no new event. This covers double-click and OCC retry. Repeating a **different** action in a non-terminal state is `INVALID_TRANSITION`; in a terminal state it is `ORDER_TERMINAL`. A concurrent `accept` and `decline` has one winner; the loser gets `ORDER_ALREADY_DECIDED`."

Also: "No implicit transitions" (`spec:858`), "No client status" — `action`, never `status` (`spec:860`).

### 3.4 The matrix as the plan resolves it (plan D1, `tasks/issue-75-plan.md:43-44`)

- Wire union is 8 actions without `reuse`: `submit`, `accept`, `decline`, `cancel`, `ready`, `complete`, `noShow`, `expire`. `reuse` is **documentation vocabulary** only (§7.3) and must not enter the union.
- `submit` from any status resolves to `error: 'INVALID_TRANSITION'` (it is `placeOrder`'s create step, not a transition).
- The 5 terminal statuses resolve **every** action to `error: 'ORDER_TERMINAL'`.
- A repeat of the action whose target equals the current **non-terminal** status resolves to `{ kind: 'reused' }` (e.g. `accept` on `accepted`, `ready` on `ready`). `complete` on `completed` is terminal-first, so it is `ORDER_TERMINAL`.
- Everything else follows the mutation rows of §3.2; absent pairs are `INVALID_TRANSITION`.

### 3.5 8×9 grid (derived from §3.2 + §3.4; `reuse` column is the repeat resolution)

| status \ action | submit | accept | decline | cancel | ready | complete | noShow | expire | reuse |
|---|---|---|---|---|---|---|---|---|---|
| `new` | — (create) | → `accepted` | → `declined` | → `cancelled` | INVALID | INVALID | INVALID | → `expired` | reused if target == current |
| `accepted` | INVALID | reused | INVALID | → `cancelled` | → `ready` | INVALID | INVALID | INVALID | reused (`ready` on `ready`) |
| `ready` | INVALID | INVALID | INVALID | → `cancelled` | reused | → `completed` | → `no_show` | INVALID | reused (`complete` → terminal-first) |
| `completed` | TERMINAL | TERMINAL | TERMINAL | TERMINAL | TERMINAL | TERMINAL | TERMINAL | TERMINAL | — |
| `declined` | TERMINAL | … | … | … | … | … | … | … | — |
| `cancelled` | TERMINAL | … | … | … | … | … | … | … | — |
| `expired` | TERMINAL | … | … | … | … | … | … | … | — |
| `no_show` | TERMINAL | … | … | … | … | … | … | … | — |

Acceptance text: "all 8 statuses × 9 actions, terminal set asserted, idempotent-repeat policy asserted" (issue AC; `spec:1677`).

---

## 4. Spec extract — §6.2.4 constants (`spec:1046-1067`)

| Constant | Value | Notes |
|---|---|---|
| `MAX_LINES` | 20 | Server validator |
| `MAX_QUANTITY_PER_LINE` | 20 | Server validator |
| `MAX_TOTAL_UNITS` | 100 | Sum of quantities |
| `MAX_SELECTIONS_PER_LINE` | 32 | Matches today's `MAX_SELECTIONS` (`convex/orders.ts:30`) |
| `MAX_NAME` | 80 | Trim; reject control chars |
| `MAX_NOTE` | 500 | Matches today (`convex/orders.ts:27`) |
| `MAX_PHONE_DIGITS` | 20 | Normalize to digits; keep a leading `+` only for display |
| `MIN_PHONE_DIGITS` | 7 | Reject obviously incomplete numbers |
| `MAX_EMAIL` | 254 | Basic shape check |
| `DEFAULT_TTL_MS` | 60 × 60 × 1000 | Configurable later |
| `IDEMPOTENCY_TTL_MS` | 24 × 60 × 60 × 1000 | Stripe's minimum retention |
| `TOKEN_BYTES` | 32 | 256 bits, base64url |
| `REFERENCE_LENGTH` | 6 | Alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (32 chars) |
| `CONTACT_THROTTLE_10M` | 3 | Per hashed contact |
| `CONTACT_THROTTLE_24H` | 10 | Per hashed contact |
| `BUSINESS_THROTTLE_10M` | 60 | Per business |
| `MONEY` | integer cents | No floats; `Number.isInteger` |
| `MAX_ORDER_VALUE` | 100000 | $1,000 cap before unpriced lines |

Reference implementation constants already in tree: `TOKEN_BYTES = 32`, `REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'`, `REFERENCE_LENGTH = 6`, `REFERENCE_COLLISION_RETRIES = 5`, `MAX_INSERT_ATTEMPTS = 12` (`convex/orderAccess.ts:19-26`).

---

## 5. Spec extract — §6.2.5 pricing (`spec:1069-1087`)

For each line, in order:

1. Load the item and its group. Reject if missing, `businessId` mismatch, item unavailable, or group unavailable.
2. Validate every required option has exactly one choice; reject unknown options/choices and duplicate option names.
3. `unitPrice = item.price` (integer cents or `undefined`).
4. `adjustment = sum(selectedOption.priceAdjustment ?? 0)`.
5. `lineTotal = unitPrice === undefined ? undefined : (unitPrice + adjustment) * quantity`.
6. `subtotal = any lineTotal undefined ? undefined : sum(lineTotal)`.
7. Reject if `subtotal` is defined and > `MAX_ORDER_VALUE`.
8. Compare `expectedSubtotal`:
   - both defined and differ → `PRICE_CHANGED` with `actualSubtotal`;
   - client sent a number, server has `undefined` → `PRICE_UNAVAILABLE`;
   - client sent `null`, server has a number → `PRICE_CHANGED` with `actualSubtotal`;
   - both `null`/`undefined` → accept.
9. Snapshot `name`, `unitPrice`, `lineTotal`, and selected `optionName`/`choiceName`/`priceAdjustment` into `items[]`.

"The server never reads a price from the request. The request contains only ids, quantities, and selections." (`spec:1087`).

Note the `undefined` vs `null` vocabulary: the schema models absence with `v.optional(...)` (`convex/schema.ts:216`), and `null` is a distinct Convex type (`docs/alignment/issue-76.md:86`). Prose "subtotal null" means "no sum"; a stored row omits the field.

---

## 6. Spec extract — §6.2.6 token / reference (`spec:1089-1093`)

- **Token:** `crypto.getRandomValues(new Uint8Array(32))`, base64url. Never derived from order id, timestamp, or contact. Stored only in `orderAccess`; never logged (`convex/orderAccess.ts:29-40` is the existing implementation).
- **Reference:** 6 chars from the 32-char alphabet omitting `0/O/1/I`; unique per business (`byBusinessIdReference`); retry up to 5 on collision, then 7 chars. Handoff reference, **not** a lookup capability.
- **Receipt projection:** masked contact etc. (out of scope for #75).

---

## 7. Spec extract — §6.2.4/§6.5 error catalog (`spec:1273-1316`)

```ts
throw new ConvexError({
  code: 'PRICE_CHANGED',
  message: 'Prices changed while you were ordering. Review the new total and send again.',
  actualSubtotal: 2450,
});
```

**28 table rows; `FORBIDDEN` and `UNAUTHORIZED` share one row, so there are 29 code tokens.** Quoted verbatim:

| Code | When | Customer message (exact) | Recovery |
|---|---|---|---|
| `BUSINESS_UNAVAILABLE` | Not approved / deleted / no public record | "This business isn't available right now." | Back to directory |
| `MENU_UNAVAILABLE` | Approved but no published menu / all items removed | "This business hasn't published a menu yet." | Call the business |
| `MENU_EMPTY` | No orderable items | "There's nothing available to order right now." | Call the business |
| `ORDERING_CLOSED` | `acceptingOrders` false, `until` passed, or not on `basket` | "This business isn't accepting orders right now. Call {phone}." | Call; retry later |
| `OUTSIDE_HOURS` | Configured hours closed | "This business is closed right now. Call {phone} or check its hours." | Call; retry when open |
| `GROUP_UNAVAILABLE` | Group flag false | "One of the menu sections you picked is unavailable. Refresh the menu." | Refresh; remove section |
| `ITEM_UNAVAILABLE` | Item flag false / deleted | "One of the items you picked is sold out. Refresh the menu." | Refresh; remove line |
| `BASKET_EMPTY` | 0 lines | "Add at least one item before sending your order." | Add item |
| `BASKET_TOO_LARGE` | >20 lines / >100 units | "This order is too large to send here. Call the business." | Call |
| `QUANTITY_INVALID` | 0, 21, non-integer | "Choose a quantity between 1 and 20." | Fix quantity |
| `SELECTION_INVALID` | Missing required / unknown choice / >32 | "Check the options for {item}; one is missing or no longer available." | Re-select |
| `CONTACT_INVALID` | Name/phone/email fail | "Add a name and a phone or email so the business can reach you." | Fix contact |
| `NOTE_TOO_LONG` | >500 | "Keep the note under 500 characters." | Shorten |
| `PRICE_CHANGED` | `expectedSubtotal` mismatch | "Prices changed while you were ordering. Review the new total and send again." | Show old/new; re-confirm |
| `PRICE_UNAVAILABLE` | Client expected a number; server has none | "One item has no price listed. Confirm the total with the business." | Call / remove |
| `ORDER_VALUE_TOO_HIGH` | Subtotal > $1,000 | "This order is too large to send online. Call the business." | Call |
| `IDEMPOTENCY_CONFLICT` | Same key, different args | "This order was already sent with different details. Refresh your order." | Refresh |
| `TOO_MANY_REQUESTS` | Contact/business throttle | "Too many order attempts. Try again in {n} minutes or call the business." | Wait / call |
| `ORDER_NOT_ACCEPTED` | Blocked contact (generic) | "We can't accept this order online. Please call the business." | Call |
| `ORDER_NOT_FOUND` | Bad/expired token | "We couldn't find that order. Check the link or call the business." | Call |
| `ORDER_EXPIRED` | Action on expired | "This order expired before it was accepted. Place a new order." | Re-order |
| `CANNOT_CANCEL` | Customer cancel after `new` | "This order can no longer be cancelled online. Call the business." | Call |
| `INVALID_TRANSITION` | Wrong action for state | "That action isn't available for this order anymore. Refresh." | Refresh |
| `ORDER_TERMINAL` | Any action on terminal | "This order is already closed." | — |
| `ORDER_ALREADY_DECIDED` | Conflicting concurrent action | "Someone already updated this order. Refresh the board." | Refresh |
| `REASON_REQUIRED` | Decline/cancel without reason | (Owner UI) "Add a short reason before continuing." | Add reason |
| `FORBIDDEN` / `UNAUTHORIZED` | Auth failure | "You don't have access to this order." | Sign in / contact support |
| `INTERNAL` | Unexpected | "Something went wrong. Try again or call the business." | Retry |

Recovery is a UI instruction, not a code field today. `ORDER_TERMINAL`'s recovery is an em dash ("—"), i.e. no action. The issue AC requires "non-empty message + recovery action" for every code, so the module needs a per-code recovery string even where the table shows "—".

Existing client-side mapper for legacy string errors: `messageForError` / `messageForOrderError` (spec:1316; `components/profile/ordering-panel-helpers.ts` via graft). The spec says it "accepts a string (legacy) or an object".

---

## 8. Spec extract — §6.5 effective-open predicate (`spec:1231-1240`)

```ts
const configuredHours = hasAnyOpeningPeriod(business.hours); // any day with > 0 periods
const effectiveOpen =
  business.status === 'approved' &&
  (business.acceptingOrders ?? true) &&
  (business.acceptingOrdersUntil === undefined || now < business.acceptingOrdersUntil) &&
  (configuredHours ? openStatusAt(business.hours, business.timezone, now).isOpen : true);
```

- `openStatusAt` is the **existing** pure evaluator (`convex/businesses/publicHours.ts:120-176`); note its real signature takes `(hours, clock)`, not `(hours, timeZone, now)` — the predicate must build a `BusinessClock` (e.g. via `createBusinessFormatter` + `businessClock`) or accept a clock/timezone pair. The spec sketch and the implementation differ in arity; this is a known seam.
- **Empty hours ⇒ open** (`configuredHours ? … : true`).
- Does **not** model holidays/special hours (spec:1240).
- Precedence for supply errors: business approved → pause/until → hours → group → item → selections → price (`spec:1264`).

---

## 9. Spec extract — §7.2 slice ownership / §7.3 test matrix

### 9.1 §7.2 S1 file assignment (`spec:1555-1568`)

- `convex/orderPolicy.ts` — "extend statuses/actions/transition matrix; keep existing exports for the UI and the 27 tests."
- `convex/orderCommitPolicy.ts` (new) — "pure `validateBasket`, `priceBasket`, `parseContact`, `canonicalArgsHash`, `createReference`, `isEffectiveOpen`; no DB imports, unit-testable with `node --test`."
- `convex/orderAccess.ts` (new at the time) — `createAccessToken`, `createReference`, `insertOrderAccess`, …
- `convex/orders.ts` — `placeOrder`, … (a later handler ticket, **not** #75).

### 9.2 §7.3 layers (`spec:1664-1671`)

| Layer | Tool | What it proves | When |
|---|---|---|---|
| Pure policy | `node --test` (`scripts/order-commit-policy.test.ts`) | State matrix, caps, pricing arithmetic, contact parsing, token/reference format, error mapping, effective-open predicate | Every commit; no DB |
| Handler | `vitest` + `convex-test` (`convex/orders.test.ts`) | Real `api.orders` functions | Every commit; mock backend |

### 9.3 §7.3 pure test matrix (`spec:1673-1684`) — must-cover rows

| Area | Cases (minimum) |
|---|---|
| State machine | All 8 statuses × 9 actions: `submit`, `accept`, `decline`, `cancel`, `ready`, `complete`, `noShow`, `expire`, `reuse`; assert target or `null`; assert terminal set; assert idempotent repeat policy |
| Basket caps | 0/1/20/21 lines; quantity 0/1/20/21; total units 100/101; selections 32/33; name 1/80/81; note 0/500/501; one business; duplicate lines |
| Pricing | Priced line; unpriced line; modifier adjustment; quantity multiplication; integer cents; max order value; expected-subtotal match/mismatch; client price ignored by signature |
| Contact | Phone 6/7/20/21 digits; formatted phone; email basic valid/invalid; both; neither; control chars; normalization; hashing stability |
| Token/reference | 32 random bytes; base64url charset; not derived from id; 6-char alphabet; collision retry; 7-char fallback |
| Canonical hash | Key order stable; line order stable; normalized contact; different items/qty/selections/name/note produce different hashes |
| Effective open | Approved/paused/until/hours/no-hours; overnight; DST spring/fall; timezone boundary; `until` exactly now |
| Errors | Every code in §6.5 maps to a non-empty message and a recovery action; legacy string errors still map |

---

## 10. Reusable exports — exact names, signatures, locations

### 10.1 `convex/orderPolicy.ts` (pure: no runtime imports; header says so at L1-4)

| Symbol | Signature / value | Lines |
|---|---|---|
| `ORDER_STATUSES` | `['new','accepted','ready','completed'] as const` | 12 |
| `OrderStatus` | `(typeof ORDER_STATUSES)[number]` | 13 |
| `ORDER_DB_STATUSES` | `['new','accepted','ready','completed','declined','cancelled','expired','no_show'] as const` | 20-29 |
| `isLegacyOrderStatus` | `(status: string): status is OrderStatus` | 32-34 |
| `ORDER_ACTIONS` | `['accept','ready','complete'] as const` | 36 |
| `OrderAction` | `(typeof ORDER_ACTIONS)[number]` | 37 |
| `ORDER_ACTION_TARGET` | `Record<OrderAction, OrderStatus>` | 40-44 |
| `ORDER_STATUS_TRANSITIONS` | `Record<OrderStatus, OrderStatus \| null>` | 47-52 |
| `nextOrderStatus` | `(status: OrderStatus, action: OrderAction): OrderStatus \| null` | 55-58 |
| `OrderSelection` | `{ optionName: string; choiceName: string }` | 60 |
| `OrderCustomizationGroup` | `{ name: string; required: boolean; options: { name: string; priceAdjustment?: number }[] }` | 62-66 |
| `validateOneSelection` (private) | `(groupByName, selection, seen, countByGroup): string \| null` | 72-95 |
| `validateOrderSelections` | `(groups: readonly OrderCustomizationGroup[], selections: readonly OrderSelection[]): string \| null` | 106-135 |
| `MAX_CUSTOMER_NAME_LENGTH` (private) | `120` | 137 |
| `MAX_CONTACT_LENGTH` (private) | `200` | 138 |
| `validateOrderContact` | `(input: { customerName: string; contactPhone?: string; contactEmail?: string }): string \| null` | 146-173 |

Semantics to preserve (tested by 27 tests): unknown group/choice, duplicate `(optionName, choiceName)` pair, required group exactly 1, optional group 0..n (`convex/orderPolicy.ts:72-135`). Note this validator has **no** count cap — the 32-selection cap is enforced by the handler (`convex/orders.ts:101-105`).

### 10.2 `convex/orderAccess.ts` (DB-adjacent; `_generated` imports are type-only)

| Symbol | Signature / value | Lines |
|---|---|---|
| `TOKEN_BYTES` | `32` | 19 |
| `REFERENCE_ALPHABET` | `'23456789ABCDEFGHJKLMNPQRSTUVWXYZ'` | 20 |
| `REFERENCE_LENGTH` | `6` | 21 |
| `REFERENCE_COLLISION_RETRIES` | `5` | 22 |
| `MAX_INSERT_ATTEMPTS` | `12` | 26 |
| `createAccessToken` | `(): string` — 32 bytes → unpadded base64url (43 chars) | 29-40 |
| `randomReference` (private) | `(length: number): string` — `byte % 32` (unbiased) | 42-52 |
| `createReference` | `(existing: ReadonlySet<string>): string` — 6 chars, 5 retries, then 7 chars, then throw | 59-75 |
| `insertOrderAccess` | `async (ctx, { orderId, businessId }): Promise<{ accessToken; reference }>` | 85-115 |
| `hasOrderAccess` | `async (ctx, orderId): Promise<boolean>` | 118-127 |

`createReference` uses `crypto.getRandomValues`, so it is not injectable today. The #75 plan requires an **injectable RNG** in the ported copy (`tasks/issue-75-plan.md` D2/D3; issue text). `orderAccess.ts` must not be modified by #75.

### 10.3 `convex/businesses/publicHours.ts` (pure; only a type-only `Doc` import at L1)

| Symbol | Signature / value | Lines |
|---|---|---|
| `BusinessHours` | `Doc<'businesses'>['hours']` | 20 |
| `BusinessClock` | `{ weekday: number; minutes: number }` (0 = Sunday) | 23-26 |
| `OpenStatus` | `{ isOpen: boolean; closesAt?: string }` | 28-31 |
| `DAY_KEYS` (private) | `['sunday',…,'saturday']` | 36-44 |
| `createBusinessFormatter` | `(timeZone: string): Intl.DateTimeFormat` | 51-59 |
| `businessClock` | `(formatter: Intl.DateTimeFormat, now: number): BusinessClock` | 62-74 |
| `toMinutes` | `(value: string): number \| null` | 77-91 |
| `periodStatus` (private) | `(period, clock): OpenStatus \| null` | 93-113 |
| `openStatusAt` | `(hours: BusinessHours, clock: BusinessClock): OpenStatus` | 120-129 |
| `overnightCarryOver` (private) | `(hours, clock): OpenStatus` | 132-149 |
| `createOpenNowEvaluator` | `(now: number): { status; isOpen }` | 157-176 |

`hoursValidator` shape (used by `BusinessHours`): see `convex/schema.ts` / `convex/businesses/validators` — `Doc<'businesses'>['hours']` is `{ [weekday]: { opensAt: string; closesAt: string }[] }` (specimen values at `convex/businesses/seedFixtures.ts:108-116`).

### 10.4 `convex/orders.ts` helpers (DB-bound; reference only, must not change)

| Symbol | Signature | Lines |
|---|---|---|
| `ORDER_LIST_LIMIT` | `100` | 26 |
| `MAX_ORDER_NOTE_LENGTH` | `500` | 27 |
| `MAX_ORDER_SELECTIONS` | `32` | 30 |
| `approvedBusinessOrThrow` | `async (ctx, businessId): Promise<Doc<'businesses'>>`; message `'This business is not accepting orders.'` | 38-47 |
| `availableItemOrThrow` | `async (ctx, businessId, menuItemId)`; message `'This item is not available for ordering.'` | 50-60 |
| `normalizedNoteOrThrow` | `(note: string \| undefined): string \| undefined` | 63-69 |
| `submitOrder` | mutation; args `businessId, menuItemId, selections, customerName, contactPhone?, contactEmail?, note?` | 76-133 |
| `projectOrderRow` | `(order, legacyItem)`; snapshot wins, `legacyUnknown` never borrows live price | 140-169 |
| `listOrders` | owner-only, newest 100 via `byBusinessId` | 182-217 |
| `transitionOrderStatus` | action union `accept \| ready \| complete`; rejects non-legacy status with `'Invalid status transition'` | 228-253 |
| `getOrderStatus` | `(orderId) → { status, createdAt } \| null` | 264-274 |

---

## 11. Exact catalog shape (so `priceBasket` can be structural)

### 11.1 Schema (`convex/schema.ts`)

`businesses` (L39-77) — fields relevant to the predicate:
```
status: listingStatusValidator            // L52  = 'draft'|'pendingReview'|'approved'|'changesRequested'|'rejected'|'suspended' (convex/businessTypes.ts:9-16)
timezone: v.string()                      // L49  IANA name
hours: hoursValidator                     // L51  = { monday?..sunday?: { opensAt; closesAt }[] } (convex/businessTypes.ts:19-33)
acceptingOrders: v.optional(v.boolean())  // L73
acceptingOrdersUntil: v.optional(v.number()) // L74
acceptingOrdersNote: v.optional(v.string())  // L75
orderProtocol: v.optional(v.union(v.literal('legacy'), v.literal('basket'))) // L76
```
No `menuVisible` field (spec:1251).

`menuGroups` (L118-127):
```
businessId: v.id('businesses')   // L119
name: v.string()                 // L120
ordering: v.number()             // L122
isAvailable: v.optional(v.boolean()) // L124  absent = available
```

`menuItems` (L129-165):
```
businessId: v.id('businesses')        // L130
groupId: v.id('menuGroups')           // L131
name: v.string()                      // L132
description?: v.string()              // L133
price?: v.number()                    // L134  integer cents; absent = unpriced
customizationOptions: v.array(v.object({   // L136-147
  name: v.string(),
  required: v.boolean(),
  options: v.array(v.object({
    name: v.string(),
    priceAdjustment?: v.number(),     // integer cents
  })),
}))
ordering: v.number()                  // L148
isAvailable: v.boolean()              // L149
nutrition?: {...}                     // L154-161
```

`orders.items[]` snapshot shape (L198-215) — mirrors the pricing output:
```
{ menuItemId, name, unitPrice?, quantity, selections: [{ optionName, choiceName, priceAdjustment? }], lineTotal? }
```
plus `subtotal?` (L216), `pricingSource?` (`'snapshot' | 'legacyUnknown'`, L217), `status` 8-way union (L224-233), legacy `menuItemId?`/`selections?` (L242-250).

### 11.2 Runtime validators (`convex/menus.ts`)

`nutritionValidator` L35-40; `customizationGroupValidator` L42-51; `customizationOptionsValidator = v.array(customizationGroupValidator)` L53; `updateItemPatchValidator` L57-66. Types: `type CustomizationOptions = Infer<typeof customizationOptionsValidator>` L69; `type MenuItem = Doc<'menuItems'>` L72.

### 11.3 Seeded reality (`convex/businesses/seedFixtures.ts:290-346`)

A real item with prices and adjustments:
```
{
  name: 'Build Your Bowl',
  price: 14.5,
  isAvailable: true,
  customizationOptions: [
    { name: 'Base', required: true, options: [
        { name: 'Jasmine Rice' }, { name: 'Brown Rice' },
        { name: 'Mixed Greens' }, { name: 'Rice Noodles', priceAdjustment: 1.5 } ] },
    { name: 'Protein', required: true, options: [
        { name: 'Grilled Chicken', priceAdjustment: 4 }, … ] },
    { name: 'Sauce', required: true, options: [ … ] },
    { name: 'Veggies', required: false, options: [ … ] },
  ],
}
```
Seed prices are **decimal dollars** (14.5, 1.5, 0.75), while the protocol requires **integer cents**. That conversion is a mapping concern for the handler/tests, not a fact the seed guarantees. `SeedMenuItemFixture` (`convex/businesses/seedFixtures.ts:18-25`) is `{ name; description?; price?; isAvailable; nutrition?; customizationOptions }` — no `businessId`/`groupId`; those are supplied by `ensureMenuItems` (`convex/businesses/seed.ts:266-294`).

### 11.4 Structural type the plan proposes (`tasks/issue-75-plan.md:63-72`)

```ts
export type CatalogEntry = {
  businessId: string;
  name: string;
  unitPrice?: number;                 // integer cents; absent ⇒ unpriced
  isAvailable: boolean;
  groupAvailable: boolean;
  groups: OrderCustomizationGroup[];  // reuse orderPolicy's type incl. priceAdjustment
};
```
This is deliberately structural (no `Doc<'menuItems'>`) so the pure module imports no `_generated` values.

---

## 12. Test runner facts (measured)

### 12.1 Scripts (`package.json:9-22`)

```json
"test": "node scripts/verify-state-machine.ts && node --test \"app/**/*.test.ts\" \"lib/**/*.test.ts\" \"scripts/**/*.test.ts\" && vitest run"
```

- `npm test` runs, in order: `scripts/verify-state-machine.ts`, the Node test runner over three explicit globs, then Vitest.
- **`scripts/**/*.test.ts` is an explicit glob** — a new `scripts/order-commit-policy.test.ts` is auto-discovered; no script edit needed.
- Vitest is scoped to `convex/**/*.test.ts` (`vitest.config.ts:10-14`, comment L7-9: "The plain `node --test` suite under `scripts/` is deliberately untouched"). A pure test placed under `convex/` would be picked up by Vitest + edge-runtime instead — the spec names `scripts/`, so keep it there.
- Node engine: `"node": ">=22.6"` (`package.json:6-8`); measured runtime `node --version` → **v24.18.0**. `.ts` files run under `node --test` with no loader/flag because the globs are `.ts` and the suite is green in this repo (`docs/alignment/issue-73.md:22` records Node 24.18.0). Import specifiers in the existing pure test include the extension: `'../convex/orderPolicy.ts'` (`scripts/order-policy.test.ts:29`), enabled by `allowImportingTsExtensions: true` (`tsconfig.json:10`, duplicated at `:13` — a known pre-existing duplicate key, `docs/alignment/issue-73.md:117`).
- `npm run lint` = `eslint .`; no `typecheck` script; typecheck is `pnpm exec tsc --noEmit` (used in alignment reports). `npm run build` = `next build`.

### 12.2 Conventions in `scripts/order-policy.test.ts`

- Shebang `#!/usr/bin/env node` (L1), header doc with a `Run:` line (L17).
- `import assert from 'node:assert/strict'; import { test } from 'node:test';` (L19-20).
- Imports type-only symbols with `import type { … }` (L30-35).
- Helper `assertUserError(error, label)` asserts non-null, string, non-empty — **wording is deliberately not pinned** (L14-15, L38-42).
- Matrix tests spell out the expected object/array literally: `assert.deepEqual(ORDER_STATUS_TRANSITIONS, {…})` (L50-55); "exactly three of the twelve pairs may advance" (L106).
- Test names are behavioural sentences.

### 12.3 DST / hours test precedent (`scripts/public-hours.test.ts`)

- `businessClock` DST case: US Eastern springs forward 2026-03-08; `Date.UTC(2026,2,8,6,30)` → 01:30 EST, `Date.UTC(2026,2,8,7,30)` → 03:30 EDT (L93-101).
- Overnight: `{ friday: [{ opensAt: '22:00', closesAt: '02:00' }] }`; Saturday 01:00 open, 02:30 closed (L59-71).
- Timezone independence: London noon open vs New York 07:00 closed (L103-110).
- Empty hours: `openStatusAt({}, clock)` → `{ isOpen: false }` (L112-116). Note this is *raw hours*; the **effective-open predicate** must treat empty hours as *open* (spec:1237), the opposite default.

---

## 13. Constraints from prior alignment reports

| Constraint | Source |
|---|---|
| `crypto` / `CryptoKey` / `SubtleCrypto` are documented default-runtime Web APIs; `crypto.subtle` is safe in Convex and Node. | `docs/alignment/issue-73.md:81` (DRIFT #26), https://docs.convex.dev/functions/runtimes |
| Do **not** strengthen claims about `crypto.getRandomValues` entropy provenance; the "seeded ChaCha12, replayed on retry" comment is UNVERIFIABLE. | `docs/alignment/issue-76.md:82,116` (findings 18, 29) |
| `orderAccess.byAccessToken` has no uniqueness check; the 256-bit argument rests on an undocumented per-execution seed. | `docs/alignment/issue-76.md:93,117` |
| Convex has no unique indexes; uniqueness is a transactional check. | `docs/alignment/issue-76.md:72,87` |
| `undefined` ≠ `null`; `v.optional` means absent, never `null`. Omit keys rather than writing `undefined`. | `docs/alignment/issue-76.md:85-86` |
| `convex/_generated` is generated; never edit. Pure modules must avoid runtime generated imports. | `convex/AGENTS.md` (Commands/Conventions) |
| The legacy `validateOrderContact` (name ≤120, no email shape) is still wired into `submitOrder` and the UI — untouched. | `tasks/issue-75-plan.md:31`; `convex/orderPolicy.ts:137-173` |
| Handler tests are Vitest `edge-runtime`; pure tests are `node --test`. Two runners never share files. | `vitest.config.ts:3-14` |
| `convex-test` may run mutations serially; OCC is not modeled (UNVERIFIABLE claim). | `docs/alignment/issue-73.md:86` |

---

## 14. No-behavior-change gate — files that MUST NOT change

| File | Why |
|---|---|
| `convex/orders.ts` | Live handlers; S0 suite pins them (`convex/orders.test.ts`) |
| `convex/schema.ts` | #76 expand already landed; #75 is DB-free |
| `convex/orderAccess.ts` | Existing token/reference implementation; canonical copy lands in the pure module, dedupe deferred to S1 |
| `convex/orders.test.ts` | S0 handler regression suite |
| `convex/menus.ts` | Menu CRUD + validators |
| Legacy exports of `convex/orderPolicy.ts` | `ORDER_STATUSES`, `OrderStatus`, `isLegacyOrderStatus`, `ORDER_ACTIONS`, `OrderAction`, `ORDER_ACTION_TARGET`, `ORDER_STATUS_TRANSITIONS`, `nextOrderStatus`, `OrderSelection`, `OrderCustomizationGroup`, `validateOrderSelections`, `validateOrderContact` — consumed by `convex/orders.ts:9-13`, `app/owner/business/[id]/orders-panel.tsx`, `components/profile/ordering-panel-helpers.ts`, and the 27 tests. **Additive exports only.** |
| `convex/businesses/publicHours.ts` | `openStatusAt` is delegated to, not edited |
| `package.json` / `vitest.config.ts` / `tsconfig.json` | The test globs already cover the new file; no config change needed |
| `docs/order-commitment-protocol.md` | Spec; read-only |

Expected new/changed files for #75 (from the plan): **new** `convex/orderCommitPolicy.ts`, **new** `scripts/order-commit-policy.test.ts`, **additive-only** `convex/orderPolicy.ts`.

---

## 15. File map (implementation / test / config / docs)

| File | Role |
|---|---|
| `docs/order-commitment-protocol.md` | Authoritative spec (§6.1, §6.2.4–6.2.6, §6.5, §7.2–7.3) |
| `convex/orderPolicy.ts` | Legacy 4×3 machine + validators; target of additive protocol matrix |
| `convex/orderCommitPolicy.ts` | **To create** — six pure functions + constants + error catalog |
| `convex/orderAccess.ts` | Existing `createReference`/`createAccessToken` source to port |
| `convex/orders.ts` | Legacy handlers (must not change) |
| `convex/schema.ts` | Menu/business/order shapes (must not change) |
| `convex/menus.ts` | `customizationOptionsValidator` (must not change) |
| `convex/businesses/publicHours.ts` | `openStatusAt` pure evaluator (delegate) |
| `convex/businesses/seedFixtures.ts` | Realistic catalog/pricing data for fixtures |
| `convex/businesses/seed.ts` | `ensureMenuItems` idempotent seed |
| `convex/orders.test.ts` | S0 handler regression (Vitest, must stay green) |
| `scripts/order-policy.test.ts` | `node --test` conventions (27 tests) |
| `scripts/public-hours.test.ts` | DST/overnight/timezone test precedent |
| `scripts/order-commit-policy.test.ts` | **To create** — the pure matrix |
| `package.json` | Test scripts, Node engine |
| `vitest.config.ts` | `convex/**/*.test.ts` only |
| `tsconfig.json` | `allowImportingTsExtensions` |
| `convex/AGENTS.md` | Backend rules (generated dir, actions not statuses, token links) |
| `docs/alignment/issue-73.md`, `docs/alignment/issue-76.md` | Prior findings constraining crypto/RNG/type choices |
| `tasks/issue-75-plan.md`, `tasks/issue-75-todo.md` | Existing plan/todo (untracked) |
