# Implementation Plan — Issue #75: Order protocol T3 — Pure commit policy + test matrix

> Plan only. No implementation code was written by this planning session.
> Authoritative spec: `docs/order-commitment-protocol.md` (§6.1, §6.2.4–§6.2.6, §6.5 error table at L1275–1304, §6.5 effective-open predicate at L1229–1240, §7.2 S1 at L1549–1588, §7.3 at L1660–1684). Product record: `screens/SPEC.md` §7.1. Prior art (superseded): `screens/wayfinder/build/B12-order-basket.md`.

## 0. Problem definition (Phase 1)

- **Goal** — Land the DB-free policy layer of the Option B order protocol as one pure module plus its exhaustive `node --test` matrix, so the S1 commit ticket can consume it without reinventing validation, pricing, hashing, references, or the open predicate.
- **Constraints** — No `convex/` runtime imports (generated `api`/`server` values), no handlers, no schema changes, zero production behavior change; Node ≥ 22.6 type-stripped `node --test` conventions; module must run in BOTH the Convex V8 runtime (no `node:crypto`, no `Buffer`) and the Node test runner.
- **Users** — (a) the S1 commit ticket (`placeOrder` handler), (b) the client basket panel (imports the same pure validators, mirroring today's `ordering-panel-helpers.ts` pattern), (c) future S4 throttle work (constants).
- **Success metrics** — All six exports (`validateBasket`, `priceBasket`, `parseContact`, `canonicalArgsHash`, `createReference`, `isEffectiveOpen`) unit-tested; every §7.3 pure-matrix row covered; every §6.5 error code mapped to message + recovery; existing 27 order-policy tests and the S0 handler suite still green; `tsc --noEmit`, lint, build pass.

## 1. Ground truth established (verified, not assumed)

| Fact | Evidence |
|---|---|
| The 8 statuses already exist as `ORDER_DB_STATUSES` | `convex/orderPolicy.ts:20-29` (added by #76) |
| The 8×9 protocol transition matrix does **not** exist anywhere yet — only the legacy 4×3 machine (`ORDER_STATUSES` × `ORDER_ACTIONS` → `nextOrderStatus`) | `convex/orderPolicy.ts:12-58`; in-file comment L17-19: "stays the 4-state legacy machine **until T3 adds the actions** that reach the new states" |
| The spec assigns the matrix extension to `orderPolicy.ts` and the six pure functions to a new `convex/orderCommitPolicy.ts` | `docs/order-commitment-protocol.md:1558-1559` |
| The spec names the pure test file `scripts/order-commit-policy.test.ts` | `docs/order-commitment-protocol.md:1666` |
| Pure `node --test` conventions: shebang, header doc, `node:assert/strict`, `node:test`, `.ts` import specifiers, spelled-out EXPECTED matrix, "assert non-empty, don't pin wording" | `scripts/order-policy.test.ts:1-42,76-80` |
| `npm test` auto-discovers `scripts/**/*.test.ts` | `package.json:17` |
| The pure hours evaluator is `openStatusAt` / `createOpenNowEvaluator` in `convex/businesses/publicHours.ts` — no runtime imports, only a type-only `Doc` import; overnight carry-over built in; DST test instants already exist | `convex/businesses/publicHours.ts:1-20,120-176`; `scripts/public-hours.test.ts:80-96` |
| Reference minting (alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, len 6, 5 retries, then 7) already exists in DB-touched `convex/orderAccess.ts` alongside `createAccessToken` | `convex/orderAccess.ts:19-75` |
| Terminal set per §6.1: `completed`, `declined`, `cancelled`, `expired`, `no_show`; idempotent-repeat policy: same action while already in target state (non-terminal) → success `reused: true`, no event; different action non-terminal → `INVALID_TRANSITION`; any action in terminal → `ORDER_TERMINAL` | `docs/order-commitment-protocol.md:826-856` |
| Effective-open predicate (authoritative form): approved ∧ (`acceptingOrders ?? true`) ∧ (`until === undefined ∨ now < until`) ∧ (hours configured ? `openStatusAt(...).isOpen` : true) | `docs/order-commitment-protocol.md:1231-1240` |
| Pricing algorithm (9 steps) incl. unpriced ⇒ `subtotal` null (never partial), `MAX_ORDER_VALUE = 100_000` cents, and the 4-case `expectedSubtotal` comparison | `docs/order-commitment-protocol.md:1069-1087` |
| Constants §6.2.4: `MAX_LINES 20`, `MAX_QUANTITY_PER_LINE 20`, `MAX_TOTAL_UNITS 100`, `MAX_SELECTIONS_PER_LINE 32`, `MAX_NAME 80`, `MAX_NOTE 500`, `MIN_PHONE_DIGITS 7`, `MAX_PHONE_DIGITS 20`, `MAX_EMAIL 254`, `DEFAULT_TTL_MS`, `IDEMPOTENCY_TTL_MS`, `TOKEN_BYTES 32`, `REFERENCE_LENGTH 6`, throttle constants 3/10/60, `MONEY` integer cents, `MAX_ORDER_VALUE 100000` | `docs/order-commitment-protocol.md:1046-1067` |
| Error catalog: 29 codes, each with exact customer message + recovery action | `docs/order-commitment-protocol.md:1275-1304` |
| #76 alignment warnings that touch this ticket: RNG-provenance claims are UNVERIFIABLE (#18, #29) — do not strengthen them; `byAccessToken` uniqueness unchecked | `docs/alignment/issue-76.md` findings 18/29, recommendations 3-4 |
| Legacy contact validator (name ≤120, no email shape check) is still wired into `submitOrder` and the UI — it must stay untouched | `convex/orderPolicy.ts:137-173`; `docs/order-commitment-protocol.md:53` |

## 2. Architecture decisions (with tradeoffs)

### D1 — The protocol state machine is ADDED to `convex/orderPolicy.ts`; the pure module RE-EXPORTS it. No duplication.

The 8 statuses exist in `orderPolicy.ts`; the 9-action protocol machine does not exist yet. The spec (§7.2 S1) assigns the extended matrix to `orderPolicy.ts`, and the in-file comment literally reserves it for T3. Therefore:

- `convex/orderPolicy.ts` gains **additive exports only** (zero existing lines modified):
  - `ORDER_PROTOCOL_ACTIONS = ['submit','accept','decline','cancel','ready','complete','noShow','expire'] as const` and `type OrderProtocolAction`.
  - `TERMINAL_ORDER_STATUSES = ['completed','declined','cancelled','expired','no_show'] as const`.
  - `type OrderActionResolution = { kind: 'move'; to: OrderDbStatus } | { kind: 'reused' } | { kind: 'error'; code: 'INVALID_TRANSITION' | 'ORDER_TERMINAL' }`.
  - `resolveOrderAction(status: OrderDbStatus, action: OrderProtocolAction): OrderActionResolution` — the §6.1 transition table + repeat policy in one pure function. `submit` from any status resolves to `error: 'INVALID_TRANSITION'` (submit is `placeOrder`'s job, not a transition); the 5 terminal statuses resolve every action to `error: 'ORDER_TERMINAL'`; repeat of the action whose target equals the current non-terminal status → `{ kind: 'reused' }` (e.g. `accept` on `accepted`); all else per the §6.1 table.
  - The 9th matrix action, `reuse`, is **documentation vocabulary** (§7.3), not a wire action — it is expressed by the `reused` resolution and must NOT enter the action union.
- `convex/orderCommitPolicy.ts` re-exports all of the above. The commit ticket imports one module; the legacy machine (`ORDER_STATUSES`, `ORDER_ACTIONS`, `ORDER_ACTION_TARGET`, `ORDER_STATUS_TRANSITIONS`, `nextOrderStatus`) stays byte-identical for `submitOrder`, the board, and the 27 existing tests.

**Tradeoff:** extending an existing file slightly widens T3's diff vs. a fully new file, but it keeps ONE transition table per era (legacy vs protocol), honors the spec's file assignment, and prevents the drift two parallel matrices would guarantee. The alternative (protocol matrix inside `orderCommitPolicy.ts`, deriving statuses from `ORDER_DB_STATUSES`) was rejected because it splits the state-machine concern across two files and contradicts both the spec and the in-repo T3 reservation comment.

### D2 — `convex/orderCommitPolicy.ts` owns the six protocol functions and the canonical reference minting; `orderAccess.ts` dedupes later (S1).

`createReference` (+ `REFERENCE_ALPHABET`, `REFERENCE_LENGTH`, `REFERENCE_COLLISION_RETRIES`, `randomReference`) moves canonically into the pure module with **identical semantics** to `convex/orderAccess.ts:42-75`. `orderAccess.ts` is NOT modified by this ticket; the S1 commit ticket collapses `orderAccess.ts` to import from `orderCommitPolicy.ts` (its `_generated` imports are type-only, so nothing breaks in the interim).

**Tradeoff:** temporary duplication of ~30 lines between `orderAccess.ts` and the pure module. Accepted because the issue forbids touching the DB-adjacent file and the tests pin both semantics through the canonical copy; the risk is tracked (R2) and retired at S1 integration.

### D3 — Hashing is ASYNC via `globalThis.crypto.subtle` (SHA-256). No `node:crypto`, no `Buffer`.

`canonicalArgsHash`, `parseContact` (returns `contactHash`), and an exported `sha256Hex` helper use WebCrypto, which exists in both the Convex default runtime and Node ≥ 22 (and matches `docs/alignment/issue-73.md` finding 16). All three are deterministic pure functions of their input, so Convex's deterministic-retry model is unharmed.

**Tradeoff:** an async surface where a sync one would be marginally simpler to call. Accepted — it is the only hash primitive portable across both runtimes, and `parseContact` returning the throttle/block key saves every caller from re-implementing §6.2.2's "contact hashed at rest" rule.

### D4 — `priceBasket` takes a caller-supplied catalog, not `Doc<'menuItems'>`.

```ts
export type CatalogEntry = {
  businessId: string;
  name: string;
  unitPrice?: number;                 // integer cents; absent ⇒ unpriced line
  isAvailable: boolean;
  groupAvailable: boolean;
  groups: OrderCustomizationGroup[];  // reuse orderPolicy's type incl. priceAdjustment
};
```

The handler builds the catalog from its DB reads; the pure function stays DB-free and schema-expansion-proof (the issue defers type reconciliation with #76 to integration — a structural input type is exactly the seam for that).

**Tradeoff:** one mapping layer at the call site vs. compile-time coupling to generated `Doc` types (which would import `_generated` and break the "no DB imports" rule as a value dependency and freeze the module against the still-evolving schema).

### D5 — Canonicalization rules (pin them in tests).

- `canonicalArgsHash(args)`: recursive key-sorted JSON; basket lines sorted by `(menuItemId, canonical selections string)` so line ORDER is stable; selections sorted by `optionName` within a line? — **No**: §6.2.5 step 2 forbids duplicate option names and `validateOrderSelections` enforces set semantics per line, so per-line selections are sorted by `(optionName, choiceName)` for key-order stability; contact enters the hash **normalized** (phone → digits, email → lowercased, name → trimmed) — never raw; `note` enters trimmed; the client `idempotencyKey` and `businessId` enter as-is. Different items/quantities/selections/name/note ⇒ different hash (§7.3).
- `parseContact` normalization: name trimmed, control chars (`U+0000–U+001F`, `U+007F`) rejected; phone → keep optional leading `+` for display, digits-only for validation and hashing (7–20); email → trimmed, lowercased, ≤254, basic shape `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`; at least one channel required (§6.2.4, superseding the legacy 120-char/no-email-shape rules **only for the basket path** — legacy `validateOrderContact` is untouched, D6).
- Duplicate identical basket lines are **permitted** (quantity exists for multiples; the protocol forbids nothing here) — pinned by test as accepted, priced as separate lines, and producing a different hash than the quantity-2 equivalent.
- `expectedSubtotal: number | null | undefined`: `undefined` ≡ `null` (client omitted); comparison per §6.2.5 step 8 — equal numbers ⇒ ok; differing numbers ⇒ `PRICE_CHANGED` + `actualSubtotal`; client number vs server none ⇒ `PRICE_UNAVAILABLE`; client none vs server number ⇒ `PRICE_CHANGED`; both none ⇒ ok.

### D6 — Legacy behavior is frozen.

`ORDER_STATUSES`, `ORDER_ACTIONS`, `ORDER_ACTION_TARGET`, `ORDER_STATUS_TRANSITIONS`, `nextOrderStatus`, `validateOrderSelections`, `validateOrderContact`, and everything `submitOrder`/`transitionOrderStatus` import today: **zero modifications**. New constants (name ≤ 80, email shape, phone digit bounds) live only in the new module. Regression proof: the 27-test `scripts/order-policy.test.ts` must pass untouched, and `convex/orders.test.ts` (S0) must pass untouched.

## 3. Dependency graph (Phase 2)

```
convex/orderPolicy.ts (extended, additive: protocol machine)
        │ re-export
        ▼
convex/orderCommitPolicy.ts
  ├─ constants (§6.2.4) ──────────────┐
  ├─ error catalog (§6.5, 29 codes)   │ consumed by
  ├─ validateBasket (uses constants,  │ every function
  │   re-exported machine for status  │ below and by
  │   vocabulary)                     │ the S1 ticket
  ├─ priceBasket (uses validateOrderSelections + constants + catalog D4)
  ├─ parseContact + sha256Hex (async, D3)
  ├─ canonicalArgsHash (async, D5)
  ├─ createReference (D2, injectable RNG)
  └─ isEffectiveOpen (imports openStatusAt from convex/businesses/publicHours.ts — pure)
        │
        ▼
scripts/order-commit-policy.test.ts   (node --test, mirrors order-policy.test.ts conventions)
```

Import rule for the new module: **runtime imports limited to** `convex/orderPolicy.ts` and `convex/businesses/publicHours.ts` (both pure; `publicHours`' `_generated` import is type-only and erased). Type-only imports from `_generated` are allowed but unnecessary given D4.

## 4. Task list (Phase 3-4; vertical slices, each ends green)

### Task 1: Protocol state machine in `orderPolicy.ts` + re-export shell
**Description:** Add the additive protocol exports from D1 to `convex/orderPolicy.ts` (statuses exist; add actions, terminal set, `resolveOrderAction`, resolution type). Create `convex/orderCommitPolicy.ts` with the module header (purpose, "no runtime imports outside orderPolicy/publicHours", async-hash note) re-exporting the machine and `ORDER_DB_STATUSES`.
**Acceptance criteria:**
- [ ] `resolveOrderAction` returns the exact §6.1 outcome for all 8 × 8 pairs (spelled-out literal table in tests, `EXPECTED`-style, independent of the implementation mapping).
- [ ] Terminal set asserted: `TERMINAL_ORDER_STATUSES` deep-equals the 5 §6.1 terminal states; every action on each terminal status → `{ kind: 'error', code: 'ORDER_TERMINAL' }`.
- [ ] Idempotent-repeat policy asserted: same-action repeat in the action's own (non-terminal) status → `{ kind: 'reused' }`; different action non-terminal → `INVALID_TRANSITION`; `submit` anywhere → `INVALID_TRANSITION`.
- [ ] Legacy exports byte-identical: `scripts/order-policy.test.ts` passes unmodified.
**Verification:** `node --test scripts/order-commit-policy.test.ts` (machine block) && `node --test scripts/order-policy.test.ts` && `npx tsc --noEmit`.
**Dependencies:** None. **Files:** `convex/orderPolicy.ts`, `convex/orderCommitPolicy.ts`, `scripts/order-commit-policy.test.ts`. **Scope:** S.

### Task 2: Constants + error catalog
**Description:** Export every §6.2.4 constant individually AND as a frozen `ORDER_COMMIT_CONSTANTS` object (S4 consumes the throttle constants without new code). Export `ORDER_ERROR_CODES` (union of the 29 §6.5 codes) and `ORDER_ERRORS: Record<OrderErrorCode, { message: string; recovery: string }>` with the exact §6.5 customer messages (keep `{phone}` as a literal placeholder token for handler substitution) and recovery actions.
**Acceptance criteria:**
- [ ] Each constant's value equals the §6.2.4 table (asserted literally, not mirrored from the object).
- [ ] `Object.keys(ORDER_ERRORS)` covers exactly the 29 codes; every message and recovery is a non-empty string; spot-assert the 4 price-related codes' identities.
**Verification:** `node --test scripts/order-commit-policy.test.ts` (constants/errors blocks). **Dependencies:** Task 1. **Files:** `convex/orderCommitPolicy.ts`, test file. **Scope:** S.

### Task 3: `validateBasket` — boundary matrix
**Description:** Implement per §6.2.4/§7.3 with §6.5 precedence: 0 lines → `BASKET_EMPTY`; >20 lines or >100 total units → `BASKET_TOO_LARGE`; per-line quantity non-integer/0/>20 → `QUANTITY_INVALID`; >32 selections/line → `SELECTION_INVALID`; `note` trimmed >500 → `NOTE_TOO_LONG`; cross-business line keys → `ITEM_UNAVAILABLE` (catalog `businessId` mismatch — full availability checks land in Task 4; the validator takes the catalog for membership only).
**Acceptance criteria:**
- [ ] Boundary matrix: lines 0/1/20/21; quantity 0/1/20/21; units 100/101; selections 32/33; name 1/80/81 (name bounds live in Task 5 but the basket-level `MAX_NAME` constant is used there); note 0/500/501 — each boundary asserts the exact pass/fail code.
- [ ] One business per order asserted (foreign line rejected); duplicate identical lines accepted (D5).
- [ ] First-error precedence asserted (e.g. 21 lines with an invalid quantity → `BASKET_TOO_LARGE`).
**Verification:** `node --test scripts/order-commit-policy.test.ts` (basket block). **Dependencies:** Task 2. **Files:** `convex/orderCommitPolicy.ts`, test file. **Scope:** S.

### Task 4: `priceBasket` — pricing + `expectedSubtotal`
**Description:** Implement §6.2.5 steps 3–8 over the D4 catalog, reusing `validateOrderSelections` (imported from `orderPolicy.ts`) for per-line selection semantics → `SELECTION_INVALID`; group-then-item availability precedence (`GROUP_UNAVAILABLE` before `ITEM_UNAVAILABLE`, §6.5 item/group matrix); `lineTotal = (unitPrice + Σ adjustments) × quantity` in integer cents; any unpriced line ⇒ `subtotal: null` and that line's `lineTotal` omitted (never a partial sum); `subtotal > MAX_ORDER_VALUE` → `ORDER_VALUE_TOO_HIGH`; `expectedSubtotal` 4-case comparison per D5 returning `actualSubtotal` on `PRICE_CHANGED`.
**Acceptance criteria:**
- [ ] Priced line; unpriced line ⇒ `subtotal null` + no partial sum; adjustment math; quantity multiplication; non-integer cent input rejected; `MAX_ORDER_VALUE` cap exactly at 100000 (99999 passes, 100001 fails, 100000 boundary pinned).
- [ ] `expectedSubtotal`: match / mismatch / number-vs-null / null-vs-number / both-null — all five pinned, `actualSubtotal` carried on `PRICE_CHANGED`.
- [ ] Supply precedence: group unavailable beats item unavailable beats selection error beats price.
**Verification:** `node --test scripts/order-commit-policy.test.ts` (pricing block). **Dependencies:** Task 3. **Files:** `convex/orderCommitPolicy.ts`, test file. **Scope:** M.

### Task 5: `parseContact` + `sha256Hex`
**Description:** Implement per D3/D5: async; returns `{ ok, contact: { customerName, phoneDigits?, email? }, contactHash }` or `{ ok: false, code: 'CONTACT_INVALID' }`. Name 1–80 after trim, control chars rejected; phone normalization (strip separators, optional `+`, 7–20 digits); email ≤254 + basic shape + lowercased; ≥1 channel; SHA-256 hex of the canonical normalized contact (`sha256Hex` exported).
**Acceptance criteria:**
- [ ] Phones: 6 digits rejected / 7 accepted / 20 accepted / 21 rejected; formatted input (`(555) 010-1234`, `+1 555-0100`) normalizes to digits; hash stability: same normalized input ⇒ same hash across calls, different input ⇒ different hash; control chars rejected; both channels ok; neither → `CONTACT_INVALID`; name boundaries 1/80/81.
- [ ] No `node:crypto`/`Buffer` import anywhere in the module (grep-verified).
**Verification:** `node --test scripts/order-commit-policy.test.ts` (contact block) + grep gate in Task 9. **Dependencies:** Task 2. **Files:** `convex/orderCommitPolicy.ts`, test file. **Scope:** S.

### Task 6: `canonicalArgsHash`
**Description:** Async SHA-256 (via `sha256Hex`) over the D5 canonical form: key-sorted JSON, lines sorted `(menuItemId, sorted selections)`, normalized contact, trimmed note, `businessId` included.
**Acceptance criteria:**
- [ ] Key order permuted ⇒ same hash; lines reordered ⇒ same hash; selections reordered within a line ⇒ same hash; contact formatting permuted (`+1 555-0100` vs `5550100`, `A@B.COM` vs `a@b.com`) ⇒ same hash.
- [ ] Different item / quantity / selection / name / note / businessId ⇒ different hash (six asserts).
**Verification:** `node --test scripts/order-commit-policy.test.ts` (hash block). **Dependencies:** Task 5. **Files:** `convex/orderCommitPolicy.ts`, test file. **Scope:** S.

### Task 7: `createReference` with injectable RNG
**Description:** Canonical port of `orderAccess.ts:42-75` semantics: 6-char candidates from the 32-char alphabet (256 % 32 = unbiased), `existing` set consulted, 5 collision retries, then 7-char fallback, bounded throw. Add an optional `random?: (length: number) => string` parameter (defaults to the `crypto.getRandomValues` implementation) so the collision path is deterministically testable.
**Acceptance criteria:**
- [ ] Output ∈ alphabet, length 6 (no `0/O/1/I` — assert 200 minted refs over the alphabet); never returns a member of `existing`; with an injected RNG that always collides at 6 chars ⇒ 7-char fallback; with an always-colliding RNG ⇒ bounded throw with non-empty message.
- [ ] Doc comment states semantics WITHOUT strengthening the RNG-provenance claim (issue-76 alignment findings 18/29 — phrase as current implementation behavior).
**Verification:** `node --test scripts/order-commit-policy.test.ts` (reference block). **Dependencies:** Task 2. **Files:** `convex/orderCommitPolicy.ts`, test file. **Scope:** S.

### Task 8: `isEffectiveOpen`
**Description:** Implement the §6.5 predicate verbatim (D1 of §6.5): `status === 'approved'` ∧ (`acceptingOrders ?? true`) ∧ (`acceptingOrdersUntil === undefined || now < until`) ∧ (hours configured ? `openStatusAt(hours, clock).isOpen` : true) — delegating the hours gate to `openStatusAt` from `publicHours.ts` (import; it is the issue-designated "existing pure hours evaluator"). Hours configured = any day with > 0 periods (skip gate when empty). Signature: `(business: { status: string; acceptingOrders?: boolean; acceptingOrdersUntil?: number; hours: BusinessHours; timezone: string }, now: number) => boolean`, with `BusinessHours` imported type-only from `publicHours.ts`. `until` exactly `now` ⇒ closed (`now < until` is strict).
**Acceptance criteria:**
- [ ] Paused → false; `until` exactly now → false; `until` in future → true (other gates open); `acceptingOrders` undefined → treated true.
- [ ] Hours configured: open period → true; closed → false; empty hours `{}` → true (gate skipped); overnight carry-over (22:00–02:00 queried at 01:00 next day) → true.
- [ ] DST: spring-forward and fall-back instants pinned with fixed UTC dates reusing the `public-hours.test.ts` pattern (e.g. US Eastern 2026-03-08 02:00 EST → 03:00 EDT); timezone-boundary case (two zones, same instant).
**Verification:** `node --test scripts/order-commit-policy.test.ts` (effective-open block). **Dependencies:** Task 1. **Files:** `convex/orderCommitPolicy.ts`, test file. **Scope:** M.

### Task 9: Full-matrix sweep + no-behavior-change gate
**Description:** Reconcile the test file against EVERY row of §7.3's pure matrix (state machine, basket caps, pricing, contact, token/reference, canonical hash, effective open, errors) and run the whole verification battery.
**Acceptance criteria:**
- [ ] `node --test scripts/order-commit-policy.test.ts` green (full matrix).
- [ ] `node --test scripts/order-policy.test.ts` green (legacy pins untouched).
- [ ] `npm test` green end-to-end (includes S0 `convex/orders.test.ts` via vitest, `verify-state-machine.ts`).
- [ ] `npx tsc --noEmit` exit 0; `npm run lint` no NEW errors; `npm run build` succeeds.
- [ ] Purity gate: `grep -n "from './_generated" convex/orderCommitPolicy.ts` → no runtime imports (type-only acceptable but D4 makes even those unnecessary); `grep -n "node:crypto|require(" convex/orderCommitPolicy.ts` → empty.
- [ ] `git diff convex/orderPolicy.ts` shows only additive export blocks; `git diff convex/orders.ts convex/schema.ts convex/orderAccess.ts` → empty.
**Dependencies:** Tasks 1–8. **Files:** none new (verification only). **Scope:** S.

## 5. Checkpoints

- **Checkpoint A (after Tasks 1–2):** machine + constants + errors pinned; legacy order-policy tests still green; module imports audited (no runtime `_generated`).
- **Checkpoint B (after Tasks 3–5):** the three validators complete; boundary matrices green; async hashing proven in `node --test`.
- **Checkpoint C (after Tasks 6–8):** all six exports implemented; §7.3 matrix fully covered.
- **Final gate (Task 9):** battery + purity greps + diff audit. **No human review checkpoint is required** (pure, additive, behavior-frozen slice), but the diff audit output is pasted into the PR for the reviewer.

## 6. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| R1 — Type drift between the D4 `CatalogEntry` view and #76's `Doc<'menuItems'>` at S1 integration | Medium | Structural typing keeps the seam narrow; Task 9 asserts the module compiles standalone; the commit ticket owns the adapter. |
| R2 — Temporary duplication of reference minting (`orderAccess.ts` vs pure module) | Low | Tests pin identical semantics; S1 collapses `orderAccess.ts` to re-export; noted in the module header so it cannot silently persist. |
| R3 — `crypto.subtle` availability in the future vitest/edge-runtime handler tests (S1) | Low–Med | Pure tests run under `node --test` (WebCrypto present). S1's handler suite must smoke-test `sha256Hex` in edge-runtime before relying on it (issue-73 alignment finding 16 supports but does not prove edge-runtime parity). |
| R4 — New contact rules (name ≤80, email shape) diverge from legacy (≤120, no shape) | Medium | D6 freezes legacy; both validators stay exported under distinct names; UI migration happens in S3, not here. |
| R5 — DST/Intl divergence between Node's ICU and the Convex V8 ICU (protocol U9) | Low | Fixed-instant tests pin Node behavior; the handler-level S1 suite re-proves on the deployment runtime; `openStatusAt` is shared, so no second implementation exists to diverge. |
| R6 — `reuse` leaks into the wire action union | Low | `resolveOrderAction`'s resolution union has no `reuse` action; test asserts `'reuse' as OrderProtocolAction` is a type error by omitting it from the union (compile-time proof in Task 1). |
| R7 — `orderPolicy.ts` grows two eras of machine in one file | Low | Section banner comments separate legacy vs protocol; knip/jscpd gates already run (`lint:dead-code`, `lint:duplicates`). |

## 7. Open questions (none block implementation)

1. Should `ORDER_COMMIT_CONSTANTS` include `TOKEN_BYTES` even though `createAccessToken` stays in `orderAccess.ts` until S1? **Default: yes** — the constant is protocol-owned (§6.2.4) and the value must not fork.
2. Error messages containing `{phone}`: keep the placeholder token and let the handler substitute (chosen), vs. a message factory. Revisit if S3 needs interpolation of more fields.

## 8. Out of scope (explicit)

`convex/schema.ts`, `convex/orders.ts`, `convex/orderAccess.ts`, `convex/orders.test.ts`, any handler wiring, the throttle table logic (S1/S4), the backfill `paginationOpts` drift (issue-76 alignment rec. 1 — separate ticket), the `byAccessToken` collision check (issue-76 alignment rec. 3 — S1), and any UI change.
