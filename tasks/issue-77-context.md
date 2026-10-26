# Issue #77 — Context Pack: Order protocol T6 (owner supply toggles + audit)

**Task type:** coding (Convex mutations + audit rows + handler tests; UI explicitly out of scope).
**Repo:** `D:\Dev\dircteshop-1`
**Captured:** 2026-10-26
**Spec:** `docs/order-commitment-protocol.md` §6.2.8 + §6.5; product record `screens/SPEC.md` §7.1.
**Blocked-by status:** #76 (T2) has landed — `acceptingOrders*`, `menuGroups.isAvailable`, `auditLogs`, `placeOrder`, `effectiveOpenReason` all exist at HEAD.

---

## 1. Repo structure (only the slices this issue touches)

| Area | Path | Role |
|---|---|---|
| Backend schema | `convex/schema.ts` | Tables/indexes for `businesses`, `menuGroups`, `menuItems`, `auditLogs`, `orders`, `orderEvents` |
| Order policy (pure) | `convex/orderCommitPolicy.ts` | Basket validation/pricing, error vocabulary, `isEffectiveOpen` / `effectiveOpenReason` |
| Order handlers | `convex/orders.ts` | `placeOrder`, owner `transitionOrderStatus`, public reads |
| Menu handlers | `convex/menus.ts` | Menu group/item CRUD + public menu projection |
| Business handlers | `convex/businesses/mutations.ts` | Owner save/transition + admin moderation, existing `auditLogs` insert precedent |
| Authz | `convex/authz.ts` | `requireBusinessOwner`, `requireBusinessOwnerUser`, `requireSuperAdmin` |
| Audit read | `convex/auditLogs.ts`, `convex/auditProjections.ts` | Read-only Super Admin feed (no write path) |
| Hours evaluator | `convex/businesses/publicHours.ts` | `openStatusAt`, `createOpenNowEvaluator` (same evaluator as public "Open now") |
| Handler tests | `convex/orders.test.ts`, `convex/businesses/mutations.test.ts`, `convex/categories.test.ts` | `convex-test` + `edge-runtime` (Vitest) |
| Pure-suite tests | `scripts/order-commit-policy.test.ts` | `node --test` against `orderCommitPolicy.ts` |
| Docs | `docs/order-commitment-protocol.md`, `screens/SPEC.md` | Normative behaviour |

No `app/`/`components/` change is in scope for #77.

---

## 2. Relevant files with exact anchors

### 2.1 Schema (all prerequisite fields already present)

| Location | Fact |
|---|---|
| `convex/schema.ts:39-77` | `businesses` table; ordering fields at L73-76: `acceptingOrders`, `acceptingOrdersUntil`, `acceptingOrdersNote`, `orderProtocol` (all `v.optional`) |
| `convex/schema.ts:118-127` | `menuGroups`; `isAvailable: v.optional(v.boolean())` at L124 — "§6.2.2 additive pause switch; absent means available" |
| `convex/schema.ts:129-165` | `menuItems`; `isAvailable: v.boolean()` at L149 (required) |
| `convex/schema.ts:360-378` | `auditLogs`: `actorUserId`, `action: v.string()`, `targetType: v.string()`, `targetId: v.string()`, `targetName?`, `fromStatus?/toStatus?` (typed `listingStatusValidator`), `reason?`, `createdAt`; indexes `byActorUserId`, `byTarget(targetType,targetId)`, `byCreatedAt` |
| `convex/schema.ts:292-312` | `orderEvents` (order transitions only — NOT for supply toggles) |

### 2.2 Existing toggle write paths

| Location | Fact |
|---|---|
| `convex/menus.ts:423-448` | `updateGroup` patches only `name` / `description`; **no `isAvailable` path exists** |
| `convex/menus.ts:546-577` | `updateItem` patches via `validatedItemFields` (`menus.ts:255-287`); `isAvailable` is allowed at L61/L271-273; **writes no audit row** |
| `convex/menus.ts:80-84` | `assertMenuWritable` → throws when `ownerSaveMode(status) === 'reject'` (pendingReview / suspended / rejected) |
| `convex/businesses/mutations.ts:72,130,190,313,413,497` | Existing exports: `createDraft`, `saveDraft`, `transition`, `moderateListing`, `approveSelected`, `saveAndResubmit` — **no `setAcceptingOrders` exists yet** |

### 2.3 Existing audit-write precedent

| Location | Fact |
|---|---|
| `convex/businesses/mutations.ts:350-362` | `moderateListing` inserts one `auditLogs` row via `buildModerationAuditLog` inside the same transaction as the patch |
| `convex/businesses/mutations.ts:439-475` | `approveSelected` loops patch + one audit row per listing |
| `convex/businesses/adminMutations.ts:34-64` | `setFeatured`: **no-op guard** (`resolveFeaturedChange`) then patch + one audit row |
| `convex/businesses/adminPolicy.ts:19-32` | `resolveFeaturedChange` returns `{changed:false}` when the value is unchanged — the idempotency precedent ("duplicate no-op toggles must not create misleading audit events") |
| `convex/businesses/adminPolicy.ts:41-67` | Audit-row builder shape: plain object literal (`action`, `targetType`, `targetId`, `reason`, `targetName`, `createdAt`) with no `fromStatus`/`toStatus` for non-status flags |
| `convex/auditLogs.ts:17-24` | Confirms "there is no write path here — every row is written by its owning mutation's transaction" |

### 2.4 Supply enforcement already implemented (what the toggles must feed)

| Location | Fact |
|---|---|
| `convex/orderCommitPolicy.ts:992-1005` | `isEffectiveOpen`: approved && `acceptingOrders ?? true` && `until === undefined || now < until` && (configured hours ? `openStatusAt` : true) |
| `convex/orderCommitPolicy.ts:1037-1059` | `effectiveOpenReason`: `'accepting_off'` → `'until_passed'` → `'outside_hours'` → `'open'` (first failing gate wins) |
| `convex/orders.ts:666-685` | `placeOrder` guard order: approved → `orderProtocol === 'basket'` → `effectiveOpenReason` (`ORDERING_CLOSED` / `OUTSIDE_HOURS`) |
| `convex/orders.ts:477-507` | `loadBasketCatalog` builds `Catalog` with `group.isAvailable ?? true` (L493) and `item.isAvailable` (L501) |
| `convex/orderCommitPolicy.ts:465-504` | `priceLine` emits `GROUP_UNAVAILABLE` (L472) before `ITEM_UNAVAILABLE` (L474); `CatalogEntry` type L282-289 |
| `convex/orderCommitPolicy.ts:293-309` | `BasketFailure` codes incl. `GROUP_UNAVAILABLE`, `ITEM_UNAVAILABLE` |
| `convex/orders.ts:514-539` | `basketFailureError` maps policy failure → `ConvexError` envelope (with `lineIndex` for supply errors) |
| `convex/orders.ts:267-365` | `transitionOrderStatus` deliberately reads **no** supply state (create-only guard, INV-17) |

### 2.5 Authz + errors

| Location | Fact |
|---|---|
| `convex/authz.ts:56-59` | `requireBusinessOwner(ctx, businessId)` → returns business doc; throws `Unauthorized` (no identity) / `Forbidden` (no user, missing business, wrong owner) |
| `convex/authz.ts:67-88` | `requireBusinessOwnerUser` → `{ business, user }`; the only source of `actorUserId` for an audit row |
| `convex/orderCommitPolicy.ts:1125-1145` | `MAX_TRANSITION_REASON_LENGTH = 200`; `validateTransitionReason` (trim, optional/required) — order transitions only; no toggle-specific reason limit exists |

### 2.6 Public/read projections that already surface the state

| Location | Fact |
|---|---|
| `convex/businesses/queries.ts:95-99` | `getPublic` projects `orderProtocol ?? 'legacy'`, `acceptingOrders ?? true`, `acceptingOrdersUntil` — **`acceptingOrdersNote` is not projected** |
| `convex/menus.ts:353-360` | `publicGroup` projects `isAvailable: group.isAvailable ?? true` |
| `convex/menus.ts:362-374` | `publicItem` projects `isAvailable` |
| `components/profile/profile-types.ts:19-44` | `PublicBusiness` mirrors the projection (no note field) |
| `components/order/basket-panel.tsx:198-199` | UI pause check reads the same two fields (UI out of scope) |

### 2.7 Test infrastructure

| Location | Fact |
|---|---|
| `convex/orders.test.ts:63-165` | `seed(t)` inserts owner (`user_owner`), other owner (`user_other_owner`), two approved businesses, groups, items |
| `convex/orders.test.ts:681-687` | `configureBasket(t, businessId, patch)` patches `orderProtocol: 'basket'` + overrides |
| `convex/orders.test.ts:752-770` | `expectOrderError(promise, code, extra)` asserts the `ConvexError.data` envelope |
| `convex/orders.test.ts:735-745` | `rowCounts(t)` — counts the six commit tables + throttle |
| `convex/orders.test.ts:1575-1587` | `ownerTransition(...)` = `t.withIdentity({ subject: 'user_owner' })` |
| `convex/orders.test.ts:1003-1067` | Existing pause/until/hours guard test — pins `ORDERING_CLOSED` and `OUTSIDE_HOURS` |
| `convex/orders.test.ts:1275-1290` | Existing `GROUP_UNAVAILABLE` test (group patched directly, not via mutation) |
| `convex/businesses/mutations.test.ts:91-123` | Owner-vs-other-vs-admin authz test pattern for an owner mutation |
| `convex/categories.test.ts:74-76,114` | Audit-row assertion pattern: `ctx.db.query('auditLogs').collect()` inside `t.run` |
| `vitest.config.ts:10-14` | Vitest `environment: 'edge-runtime'`, `include: ['convex/**/*.test.ts']` |
| `package.json:17` | `test` = `verify-state-machine` → `node --test app/lib/scripts` → `vitest run` |

**No `convex/menus.test.ts` and no `scripts/*menu*` test exists** — group/item toggle handler tests are new files.

---

## 3. Normative behaviour (quoted from the spec)

`docs/order-commitment-protocol.md:1108-1118` (§6.2.8):

- Functions: `setAcceptingOrders`, `setGroupAvailability`, and the existing item availability mutation.
- Audit fields: `actorUserId` = owner, `action` = `orders.acceptingOrders.toggled` | `orders.groupAvailability.toggled` | `orders.itemAvailability.toggled`, `targetType` = `business` | `menuGroup` | `menuItem`, `targetId` = the id, `reason` = the optional note.
- "The order board's own transitions use `orderEvents`; the supply toggles use `auditLogs`."

`docs/order-commitment-protocol.md:1234-1278` (§6.5):

- Effective-open predicate reuses `openStatusAt` (`convex/businesses/publicHours.ts:120-129`).
- Supply-error precedence: approved → pause/until → hours → group → item → selections → price (`:1271`).
- INV-17: pause/closed hours never mutate pending orders; guard is on create only (`:1275`).
- INV-18: every switch enforced in the handler (`:1276`).
- INV-22: every owner toggle writes an `auditLogs` row (`:1278`).
- Error copy: `ORDERING_CLOSED`, `OUTSIDE_HOURS`, `GROUP_UNAVAILABLE` at `:1287-1290`.

`screens/SPEC.md:146` (§7.1 item 6): owners gain `acceptingOrders` + customer-visible note; groups gain `isAvailable`; item `isAvailable` unchanged; gates enforced in the mutation.

---

## 4. Patterns the implementation must follow

1. **Mutation shape (owner-scoped):** `mutation({ args, handler })` → `await requireBusinessOwner(ctx, businessId)` (or `requireBusinessOwnerUser` when `actorUserId` is needed) → validate → `ctx.db.patch` → `ctx.db.insert('auditLogs', …)` in the same transaction. Mirrors `convex/menus.ts:401-421` and `convex/businesses/adminMutations.ts:34-64`.
2. **Audit row builder as a pure typed helper** (`buildModerationAuditLog`, `buildFeaturedAuditLog`) — object literal, no `fromStatus`/`toStatus` for non-status flags (`convex/businesses/adminPolicy.ts:41-67`).
3. **No-op short-circuit for idempotent toggles:** `{ changed: false }` → return without patch and without audit (`convex/businesses/adminPolicy.ts:19-32`, consumed at `adminMutations.ts:44-47`).
4. **Single transaction** per toggle: patch + audit insert together (`convex/businesses/mutations.ts:339-362`).
5. **Owner-scoped reads/writes only**; `targetId` is a `v.string()` in `auditLogs`, so `Id<'menuGroups'>`/`Id<'menuItems'>` are stored directly.
6. **Explicit projections** — if a note is exposed later, add it to `getPublic`/`PublicBusiness` explicitly (current style `convex/businesses/queries.ts:80-100`).
7. **Handler tests** use `convexTest(schema, import.meta.glob('./**/*.ts'))`, `t.withIdentity({ subject: 'user_owner' })`, and raw `t.run((ctx) => ctx.db.query('auditLogs').collect())` for assertions.

---

## 5. Constraints

- **Build/test commands:** `pnpm install`; `npx convex dev` (codegen; never hand-edit `convex/_generated/`); `pnpm exec vitest run convex/<file>.test.ts`; `npm run lint`; `npx tsc --noEmit`; `npm run build`; `npm test` (node --test suites + vitest).
- **Runtime:** Node >= 22.6; Convex runtime is the `edge-runtime` VM in tests.
- **Bounded reads:** production Convex code must not `collect()` unbounded (guidance in `convex/_generated/ai/guidelines.md`); tests may collect.
- **`auditLogs.fromStatus`/`toStatus` are typed as listing statuses** — supply-toggle rows must leave them unset.
- **Menu writes are status-gated:** `assertMenuWritable` (`convex/menus.ts:80-84`) rejects pendingReview / suspended / rejected. Any new menu-group toggle should decide whether to reuse it (existing menu mutations all do).
- **No reason-length rule exists for toggles**; the only precedent is 200 chars for order transitions (`orderCommitPolicy.ts:1125`).
- **UI is out of scope** — only backend mutations, audit rows, handler tests.
- **`acceptingOrdersNote` has no read projection today**; storing it is enough for this ticket.
- **Docs style:** every non-obvious field/index/handler carries a comment naming the spec section and issue.

---

## 6. Dependencies

### Inbound (who depends on these toggles / this data)

| Consumer | Dependency |
|---|---|
| `convex/orders.ts:666-685` (`placeOrder`) | Reads `businesses.acceptingOrders` / `acceptingOrdersUntil` via `effectiveOpenReason` |
| `convex/orderCommitPolicy.ts:992-1005` | Pure predicate shared with the public "Open now" badge |
| `convex/orders.ts:477-507` + `orderCommitPolicy.ts:465-504` | Group/item availability gates at commit; `GROUP_UNAVAILABLE` already implemented |
| `convex/businesses/queries.ts:95-99` | `getPublic` projects pause state to the customer page |
| `convex/menus.ts:353-374` | Public menu projects group/item availability |
| `convex/businesses/adminDeletion.ts:188-269` | Cascade delete removes `menuGroups`/`menuItems` (a new audit row's target may be deleted; `targetName` snapshot is the safeguard) |

### Outbound (what the new mutations will call)

| Dependency | Use |
|---|---|
| `convex/authz.ts:56-88` | Owner guard + `user._id` for `actorUserId` |
| `convex/schema.ts:360-378` (`auditLogs`) | Insert target |
| `convex/businesses/ownerSavePolicy.ts` (`ownerSaveMode`) | Menu writability guard (if reused) |
| `convex/businesses/publicHours.ts` | Not called by the toggles; `effectiveOpenReason` already wraps it |

---

## 7. Unresolved questions (material to the plan)

1. **Resume semantics.** "One-tap resume clears pause + until + note" — is resume modelled as `setAcceptingOrders({ accepting: true })` that also clears `until` and `note`, or as an explicit `{ until: null, note: null }` payload? No existing code or spec signature fixes the argument shape.
2. **Pause while not approved.** No spec statement on whether `setAcceptingOrders` should reject for draft/pendingReview/suspended listings (menu mutations dodge this via `assertMenuWritable`); INV-17 only constrains pending orders.
3. **Where `setGroupAvailability` lives.** The spec places it in `convex/menus.ts` (`docs/order-commitment-protocol.md:1571-1572`); the issue names it as a distinct mutation, while `updateGroup` currently has no `isAvailable` argument. Adding a dedicated mutation vs. extending `updateGroup` is an implementation choice for the plan.
4. **Item toggle audit granularity.** `updateItem` accepts a multi-field patch; "one row per actual state change" requires a changed-check against the persisted `isAvailable` (precedent: `resolveFeaturedChange`). Whether the item audit is written from `updateItem` or a dedicated `setItemAvailability` is not fixed by the issue text.
5. **Idempotent repeat for `setAcceptingOrders`.** If `acceptingOrders` is already `false` but `until`/`note` differ, is that a "state change" that writes the audit row? The issue only says "same toggle value … without duplicate audit spam".
6. **Audit verification in tests.** `listAuditLogs` requires Super Admin; handler tests must assert rows through `t.run(ctx.db.query('auditLogs'))` (existing precedent in `convex/categories.test.ts:114`) rather than the query surface.
