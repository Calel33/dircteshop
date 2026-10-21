# TODO — Issue #75: Order protocol T3 — Pure commit policy + test matrix

> Companion to `tasks/issue-75-plan.md`. Check off in order; every task ends green.
> Blocked by: #73 (T1 — protocol doc + test conventions) — merged. Coordinate types with #76 (T2, schema expand) at S1 integration only.

## Definition of done (issue acceptance criteria → task mapping)

| Acceptance criterion | Task(s) |
|---|---|
| 6 exports unit-tested with `node --test` | 1–8 |
| State matrix: 8 statuses × 9 actions, terminal set, idempotent-repeat | 1 |
| Boundary matrix: lines/qty/units/selections/name/note | 3 (+5 name) |
| Pricing: priced/unpriced/null-subtotal/adjustments/qty math/integer cents/cap/expected-subtotal | 4 |
| Contact: phone digits/formatting/email/channels/control chars/hash stability | 5 |
| Effective-open: paused/until-exactly-now/hours open-closed/empty-hours/overnight/DST | 8 |
| Every §6.5 error code → message + recovery | 2 |
| No production behavior change | 1 (additive-only diff) + 9 (battery + diff audit) |

## Tasks

- [ ] **Task 1 — Protocol state machine in `orderPolicy.ts` + re-export shell**
  Files: `convex/orderPolicy.ts` (additive only), `convex/orderCommitPolicy.ts` (new), `scripts/order-commit-policy.test.ts` (new).
  Add `ORDER_PROTOCOL_ACTIONS` (8 wire actions — `submit accept decline cancel ready complete noShow expire`; `reuse` is NOT a wire action), `TERMINAL_ORDER_STATUSES` (5), `OrderActionResolution`, `resolveOrderAction(status, action)` implementing §6.1 + repeat policy. Verify: `node --test scripts/order-commit-policy.test.ts` && `node --test scripts/order-policy.test.ts` && `npx tsc --noEmit`.

- [ ] **Task 2 — Constants (§6.2.4) + error catalog (§6.5)**
  Files: `convex/orderCommitPolicy.ts`, test file.
  All §6.2.4 constants individually + frozen `ORDER_COMMIT_CONSTANTS`; `ORDER_ERROR_CODES` (29) + `ORDER_ERRORS` with exact §6.5 messages (`{phone}` literal placeholder) + recovery strings. Verify: constants block green; values asserted literally.

- [ ] **Task 3 — `validateBasket` boundary matrix**
  Files: `convex/orderCommitPolicy.ts`, test file.
  §6.5 precedence: empty → too-large → quantity → selections → note; one business per order; duplicate identical lines permitted. Boundaries: lines 0/1/20/21 · qty 0/1/20/21 · units 100/101 · selections 32/33 · note 0/500/501. Verify: basket block green.

- [ ] **Task 4 — `priceBasket` + `expectedSubtotal`**
  Files: `convex/orderCommitPolicy.ts`, test file.
  Catalog-driven (structural `CatalogEntry`, plan D4); reuse `validateOrderSelections`; group→item→selection→price precedence; integer-cent math; unpriced line ⇒ `subtotal: null`, no partial sum; cap at 100000; 4-case `expectedSubtotal` (+ both-null), `actualSubtotal` on `PRICE_CHANGED`. Verify: pricing block green.

- [ ] **Task 5 — `parseContact` + `sha256Hex` (async, WebCrypto)**
  Files: `convex/orderCommitPolicy.ts`, test file.
  Name 1/80/81 + control chars; phone 6/7/20/21 digits after normalization (+ display `+`); email ≤254 basic shape lowercased; ≥1 channel; stable SHA-256 hex contact hash. Verify: contact block green; no `node:crypto`/`Buffer`.

- [ ] **Task 6 — `canonicalArgsHash`**
  Files: `convex/orderCommitPolicy.ts`, test file.
  Key-sorted canonical JSON; line order stable; per-line selection order stable; normalized contact/trimmed note in; permutation ⇒ same hash; six difference axes ⇒ different hash. Verify: hash block green.

- [ ] **Task 7 — `createReference` (injectable RNG)**
  Files: `convex/orderCommitPolicy.ts`, test file.
  Port `orderAccess.ts:42-75` semantics canonically: 32-char alphabet (no 0/O/1/I), 6 chars, 5 collision retries, 7-char fallback, bounded throw; optional `random` injection for deterministic collision tests; doc comment must not strengthen RNG-provenance claims (issue-76 alignment findings 18/29). Verify: reference block green.

- [ ] **Task 8 — `isEffectiveOpen`**
  Files: `convex/orderCommitPolicy.ts`, test file.
  §6.5 predicate verbatim; hours gate only when any day has periods (empty hours ⇒ open); delegate to `openStatusAt` from `convex/businesses/publicHours.ts`; `until` exactly now ⇒ closed. Cases: paused / until-past / until-exactly-now / until-future / undefined-flag / hours open / hours closed / `{}` hours / overnight carry-over / DST spring-forward + fall-back (fixed UTC instants, reuse `scripts/public-hours.test.ts` dates) / timezone-boundary pair. Verify: effective-open block green.

- [ ] **Task 9 — Full §7.3 matrix sweep + no-behavior-change gate**
  Files: none new.
  Battery: `node --test scripts/order-commit-policy.test.ts` && `node --test scripts/order-policy.test.ts` && `npm test` && `npx tsc --noEmit` && `npm run lint` && `npm run build`. Purity greps: no runtime `_generated` import, no `node:crypto`, no `require(` in `convex/orderCommitPolicy.ts`. Diff audit: `convex/orderPolicy.ts` additive-only; `convex/orders.ts`, `convex/schema.ts`, `convex/orderAccess.ts`, `convex/orders.test.ts` untouched. Paste audit into the PR description.

## Checkpoints

- [ ] **A (after 1–2):** machine + constants + errors pinned; legacy tests green; imports pure.
- [ ] **B (after 3–5):** validators complete; boundary + contact matrices green; async hash proven.
- [ ] **C (after 6–8):** all six exports done; §7.3 matrix fully covered.
- [ ] **Final gate (9):** full battery + purity + diff audit pasted in PR.
