# Issue #77 — Targeted research (plan open questions)

**For:** `tasks/issue-77-plan.md` §"OPEN QUESTIONS FOR TARGETED RESEARCH" + the Convex/unset and `updateItem` verification items.
**Scope:** research only. No implementation code was read-modified; this file is the only artifact written.
**Stack pinned:** Convex **1.46.0** (`node_modules/convex/package.json`), `convex-test` (Vitest, `edge-runtime`), TS `strict` with **no** `exactOptionalPropertyTypes` (`tsconfig.json:7`).

**Verdict table**

| # | Question | Status | Answer in one line |
|---|---|---|---|
| Q1 | Resume/clear argument shape | **RESOLVED** | One mutation, `until`/`note` nullable (`null` = clear), `accepting: true` force-clears both. No separate resume mutation. |
| Q2 | Pause on non-approved listing | **RESOLVED** | Allow on any owned business; no status guard. `placeOrder` already rejects unapproved first. |
| Q3 | Item audit path | **RESOLVED — plan changes** | Audit inside `updateItem` only. **Do not add `setItemAvailability`** (spec names only two new mutations). |
| Q4 | Idempotency granularity | **RESOLVED** | Full normalized tuple `(accepting, until, note)`; any member change → patch + exactly one row. |
| Q5 | `until <= now` at toggle time | **OPEN — blocking conflict** | Do **not** reject: issue AC and spec §6.4 say a passed `until` is *open*, the landed predicate says *closed*. Needs owner decision, not code. |
| Q6 | Clear `until`/`note` on resume | **RESOLVED** | Yes — the issue body mandates it verbatim. |
| Q7 | Always snapshot `targetName` | **RESOLVED — mandatory** | Always snapshot. For menu targets it is the *only* way the row stays legible. |
| V1 | Convex unset semantics | **RESOLVED** | No `unset` API. `ctx.db.patch` with `undefined` **removes** optional fields. |
| V2 | `updateItem` `isAvailable` path | **RESOLVED** | Allowed, unaudited today, and the live UI sends it on **every** save. |
| V3 | Tuple no-op guard shape | **RESOLVED** | Normalize before comparing (`?? true`, `?? undefined`, trim → undefined). |
| V4 | Do `until`/`note`-only changes audit? | **RESOLVED** | Yes — they are customer-visible supply state, and the row's `reason` records the note. |

---

## Q5 first: the one item that is genuinely blocked

This is the only question research could not answer "yes/no", because **the repository contradicts the issue**.

**Three sources, two incompatible readings of `acceptingOrdersUntil`:**

| Source | Says | Consequence |
|---|---|---|
| Issue #77 AC (authoritative for this ticket) | "`until` in the past → **effectively open**" | past `until` ⇒ orderable |
| `docs/order-commitment-protocol.md:1489` (§6.4) | "If the owner forgets, the `until` makes the business open again automatically" | past `until` ⇒ orderable |
| `docs/order-commitment-protocol.md:1287` (§6.5 error table) | `ORDERING_CLOSED` = "`acceptingOrders` false, **`until` passed**, or not on `basket`" | past `until` ⇒ closed |
| `convex/orderCommitPolicy.ts:997` (landed T2) | `(acceptingOrdersUntil === undefined \|\| now < acceptingOrdersUntil)` | past `until` ⇒ **closed** |
| `convex/orderCommitPolicy.ts:1047` | `now >= until` → `'until_passed'` | closed, dedicated reason |
| `convex/orders.ts:676-680` | `'accepting_off' \| 'until_passed'` → `ORDERING_CLOSED` | closed, same error code |
| `convex/orders.test.ts:1038-1040` | "`acceptingOrdersUntil` reached → ORDERING_CLOSED" | closed, **pinned by test** |
| `scripts/order-commit-policy.test.ts:1704-1716` | "reports closed once `acceptingOrdersUntil` has passed" / "exactly now" | closed, **pinned by test** |

So the *landed, tested* semantics read `acceptingOrdersUntil` as "accepting orders **until** T, then stop" (a scheduled close that never reopens), while the issue AC and §6.4 read it as "auto-resume at T".

**Why this blocks the plan's default.** Plan Q5 recommends rejecting `until <= now` at toggle time. That rejection would lock in the "closed forever" reading at the mutation boundary, and it makes the AC's own bullet unwritable: Task 4 requires driving the real mutation ("not a raw patch"), and there is no argument value that yields "until in the past → effectively open".

**Recommendation (adopt in the plan):**
1. **Do not reject past `until`** in `setAcceptingOrders`. Accept any `Number.isFinite(until)`. Rationale: rejecting contradicts a normative AC *and* §6.4, and would have to be removed the moment T2's semantics are corrected.
2. **Do not change the predicate.** `effectiveOpenReason`/`isEffectiveOpen` are T2's surface and pinned by pure + handler tests; #77 explicitly must not touch them.
3. **Do not write the "past `until` → effectively open" test in #77.** Write the pause → `ORDERING_CLOSED` → resume → orderable test (Q6/Q1), and leave expired-`until` behaviour to T2's existing test at `orders.test.ts:1038`.
4. **Raise a follow-up** (T2 or the parent epic #8) naming the §6.4-vs-§6.5 contradiction with the two doc lines and the two test files as evidence. Whichever way it is resolved, `acceptingOrdersUntil` validation belongs with that decision, not here.
5. If a guard is ever added, the boundary is `until < now` — `until === now` is **closed** (`order-commit-policy.test.ts:1709-1712`), so `<=` would reject a value that is already closed.

---

## Q1 — Resume/clear argument shape — RESOLVED

**Evidence**
- Spec lists exactly **one** business function: `convex/businesses/mutations.ts — setAcceptingOrders (owner) … audit` (`docs/order-commitment-protocol.md:1571`). No `resumeAcceptingOrders`.
- Issue body: "sets `acceptingOrders`, optional `acceptingOrdersUntil` … optional customer-visible `acceptingOrdersNote`" and "**One-tap resume clears pause + `until` + note**."
- Repo already has the nullable-clear convention: `imageStorageId: v.optional(v.union(v.id('_storage'), v.null()))` in `updateItemPatchValidator` (`convex/menus.ts:65`) with the UI passing `null` as an explicit clear (`app/owner/business/[id]/menu-panel-helpers.ts:445-448`).
- Convex arg validators reject undeclared keys **before** the handler runs, so the arg object is a hard contract (`convex/businessTypes.ts:116-123`).

**Recommendation**

```ts
export const setAcceptingOrders = mutation({
  args: {
    businessId: v.id('businesses'),
    accepting: v.boolean(),
    until: v.optional(v.union(v.number(), v.null())),
    note: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => { /* ... */ },
});
```

Semantics to document in the handler comment:
- `accepting: false` — `until`/`note` persist as supplied; `null` or omitted ⇒ absent.
- `accepting: true` — resume: `until` and `note` are **force-cleared** (`undefined`) whatever the args say (issue mandate). Do not throw on a supplied stale note; a retried one-tap resume must stay idempotent.
- No tri-state `accepting?: boolean`; the boolean is required.
- `null` exists so a future UI can clear a note **without** resuming; with Q6's auto-clear it is otherwise redundant, which is fine.

**Caveat:** returning a value is unnecessary — `setFeatured` returns nothing on both the no-op and the write path (`convex/businesses/adminMutations.ts:44-62`). Prefer mirroring that (return nothing) and assert rows through `t.run`, rather than introducing a `{ changed }` return shape no caller reads.

---

## Q2 — Pause while the listing is not approved — RESOLVED (allow)

**Evidence**
- `placeOrder` rejects unapproved **before** any supply gate: `status !== 'approved'` → `BUSINESS_UNAVAILABLE` (`convex/orders.ts:666-669`), pinned at `convex/orders.test.ts:1061-1063` ("Unapproved → BUSINESS_UNAVAILABLE, ahead of every supply switch"). A paused-but-unapproved business therefore cannot become orderable.
- Precedent for a status-agnostic flag toggle: `setFeatured` — "**Any status is pinnable**; public visibility stays with the feed's existing approved-only policy" (`convex/businesses/adminMutations.ts:31-32`).
- `assertMenuWritable`'s rationale is moderation of **content** (`convex/menus.ts:75-84`). `acceptingOrders*` is not owner-editable content at all: `EDITABLE_FIELD_CLASS` (`convex/businessTypes.ts:101-114`) contains only name/category/description/address/hours/phone/email/website/tags/amenities/keywords/photos, and the save validator mirrors it — pause fields are server-owned.
- No spec text gates the pause on listing status (§6.2.8 lists only the audit row; §6.5 gates `placeOrder`, not the toggle).

**Recommendation:** no status guard in `setAcceptingOrders`; do **not** call `assertMenuWritable`. Pin it: `pendingReview` business → toggle succeeds and writes a row, while `placeOrder` still returns `BUSINESS_UNAVAILABLE`. Keep `assertMenuWritable` on the **group** toggle (plan decision 5 is correct — every existing menu mutation uses it).

---

## Q3 — Item audit path — RESOLVED, and the plan's default changes

**The spec does not describe a third new mutation.**

- `docs/order-commitment-protocol.md:1110` — "`setAcceptingOrders`, `setGroupAvailability`, **and the existing item availability mutation** write an `auditLogs` row".
- `docs/order-commitment-protocol.md:1572` — file plan: "`convex/menus.ts` — `setGroupAvailability` (owner), audit; **item availability audit**". Two new functions, and audit for the item.
- `screens/SPEC.md:146` — "per-item `isAvailable` is **unchanged**".
- `docs/order-commitment-protocol.md:318` (INV-22) — requires the *row*, not a new function.

**`updateItem` is the live UI path and cannot be narrowed without a UI change (out of scope):**
- `app/owner/business/[id]/menu-panel.tsx:225` — the item editor saves via `updateItemMutation({ … patch: save.patch })`; `:202-203` — reorder uses the same mutation with `{ ordering }` only.
- `app/owner/business/[id]/menu-panel-helpers.ts:435-441` — **`buildItemPatch` always emits `isAvailable: draft.isAvailable`**, so *every* editor save carries the field, unchanged in the common case.
- `app/owner/business/[id]/menu-panel-item-editor.tsx:353-354` — the owner's availability `Switch` writes `draft.isAvailable`; if `updateItem` ignored or rejected the field, that switch would silently stop working.
- Today: `updateItemPatchValidator` allows `isAvailable: v.optional(v.boolean())` (`convex/menus.ts:61`), `validatedItemFields` copies it (`:271-273`), `updateItem` patches with no audit row (`:557-576`).

**Recommendation:** **delete Task 3's `setItemAvailability`**. Implement the audit branch in `updateItem` only:

```ts
const availabilityChanged =
  args.patch.isAvailable !== undefined && args.patch.isAvailable !== item.isAvailable;
// … existing patch flow …
if (availabilityChanged) await ctx.db.insert('auditLogs', buildSupplyAuditLog({ … }));
```

Because `buildItemPatch` always sends the field, the **persisted-value comparison is mandatory**, not optional — without it every name/price/description edit would manufacture an `orders.itemAvailability.toggled` row. This is precisely the failure mode `setFeatured` guards against ("must not be able to manufacture misleading events", `convex/businesses/adminMutations.ts:29-31`).

**Adjacent, state in a comment (no action):**
- `createItem` accepts `isAvailable` and defaults `?? true` (`convex/menus.ts:538`) — that is *initial state*, not a toggle, so no audit row. (A row there would also break "first write is the creation".)
- `deleteItem`/`deleteGroup` remove availability with no audit row. No spec action exists for deletion in §6.2.8, so this is a pre-existing gap outside #77 — worth one line in the plan's Notes.

---

## Q4 — Idempotency granularity for `setAcceptingOrders` — RESOLVED

**Evidence**
- AC: "Idempotent repeat of the same toggle value succeeds without duplicate audit spam (**single row per actual state change**)."
- Principle: `setFeatured` treats an equal value as no-op *and writes no row* — "duplicate no-op toggles must not create misleading audit events" (`convex/businesses/adminPolicy.ts:19-23`, consumed at `adminMutations.ts:44-47`).
- The note is **published customer-facing state** (`screens/SPEC.md:146`) and is copied into the row's `reason` (`docs/order-commitment-protocol.md:1116`), so the row is self-describing when only the note moved.
- The ordering predicate reads only `acceptingOrders` and `acceptingOrdersUntil` (`convex/orderCommitPolicy.ts:992-1004`); the note never affects gating.

**Recommendation:** compare the **full normalized tuple** — `(accepting, until, note)` — and treat *any* member change as an audited change (the plan's default is right):

| Member | Normalize as |
|---|---|
| accepting | `business.acceptingOrders ?? true` vs `args.accepting` |
| until | `business.acceptingOrdersUntil ?? undefined` vs `args.until ?? undefined` |
| note | `business.acceptingOrdersNote ?? undefined` vs `validateSupplyNote(args.note)` (trimmed; blank ⇒ `undefined`) |

Then: no-op ⇒ **no patch, no row**; any difference ⇒ patch **and** exactly one row. A note-only edit while already paused does audit — justified because the note is customer-visible supply state and `reason` carries it; the alternative (note-only, unaudited) leaves a customer-facing change out of the configuration history that §6.2.8 exists to record.

**Normalization is load-bearing** — without it, `note: '  '` vs absent, or a re-sent `note: 'Back at 5'` with different surrounding whitespace, would write a spurious row. Mirror `validatedDescription`'s blank-collapses-to-`undefined` behaviour (`convex/menus.ts:97-107`).

---

## Q6 — Auto-clear `acceptingOrdersUntil` on resume — RESOLVED

The issue body states it directly: "**One-tap resume clears pause + `until` + note**", and §6.4 repeats "One-tap **Resume** clears both" (`docs/order-commitment-protocol.md:1489`).

**Recommendation:** on `accepting: true`, patch `acceptingOrders: true` plus `acceptingOrdersUntil: undefined` and `acceptingOrdersNote: undefined` in the same `ctx.db.patch`. Pin with a test: pause with `until` + `note` → resume → both fields read as `undefined`.

**Consequence for Q4/Q5:** resume is *always* tuple-changing when a pause artifact existed, so a resume can never be a silent no-op; and there is no "leftover expired `until`" state after a resume — which is one more reason the Q5 conflict is about the predicate, not this mutation.

---

## Q7 — Always snapshot `targetName` — RESOLVED (mandatory, not stylistic)

**For `menuGroup` / `menuItem` targets there is no fallback, so a missing snapshot is permanent data loss of legibility:**

- `resolveLiveBusinessName` returns `null` for any `targetType !== 'business'` (`convex/auditLogs.ts:36-38`) → the audit read's fallback (`convex/auditProjections.ts:229-231, 247`) cannot name a group or item.
- `backfillAuditTargetNames` only patches `targetType: 'business'` rows (`convex/businesses/adminDeletion.ts:161-164`), so menu-target rows are **never** rescued before a cascade.
- The cascade **does** delete the targets: `HARD_DELETE_CHILD_TABLES` includes `menuGroups` and `menuItems` (`adminDeletion.ts:31-40`), while `auditLogs` are never deleted (`:26-29`) — so after one hard delete the id is all that would remain.
- Rendering and search both depend on it: `row.targetName ?? 'Unknown'` (`app/admin/audit/audit-table.tsx:59`, `app/admin/admin-overview-panels.tsx:126`); the free-text filter searches `targetName` (`convex/auditProjections.ts:218`).
- Established intent: "The snapshot keeps the row searchable by name after a hard delete" (`convex/businesses/adminPolicy.ts:37-39`); the delete row is inserted **first** "with the name snapshot, so the row survives the cascade" (`adminMutations.ts:70-73`); schema comment: "Immutable name snapshot written by every business audit path" (`convex/schema.ts:365-369`).

**Recommendation:** make `targetName: string` **required** in `buildSupplyAuditLog`'s input (unlike `buildModerationAuditLog`'s optional `targetName`, `convex/businesses/moderationPolicy.ts:103,113`). Pass `business.name` / `group.name` / `item.name` at the call site, read from the doc already loaded by the guard/helper — no extra query. One test per target type asserting the snapshot, plus a test that the row survives a business hard delete with `targetName` intact.

---

## V1 — Convex "unset" semantics (plan GOTCHA 1) — RESOLVED

**There is no `unset` argument in Convex.** Clearing is expressed as `undefined` **inside** the patch value.

- Official: "The `db.patch` method will patch an existing document… **Fields set to `undefined` are removed**", with the worked `db.patch("tasks", id, { tag: undefined })` example — <https://docs.convex.dev/database/writing-data>.
- Installed types (Convex **1.46.0**): `node_modules/convex/dist/cjs-types/server/database.d.ts:200-217` — "Fields set to `undefined` are removed. Fields not specified in the patch are left unchanged." with `await ctx.db.patch("tasks", taskId, { assignee: undefined })`; `patch` signature at `:226`; `PatchValue` at `:382-386` maps each key to `T[P] | undefined` **only where `undefined extends T[P]`**, i.e. optional schema fields — which `acceptingOrdersUntil`/`acceptingOrdersNote` are (`convex/schema.ts:73-76`).
- In-repo precedent, same meaning, already shipped: `convex/menus.ts:439-444` — "An empty supplied description clears the optional field: **patch with `undefined` removes it** (never stored as a value)", used by `updateGroup`.

**Consequences for the plan**
- Task 1's instruction "use `patch` + explicit `unset: [...]` if available, else `replace`" is unnecessary: **plain `patch` with `undefined`**. Do **not** use `replace` — it rewrites the whole document and would need every field re-supplied (`database.d.ts:244-261`).
- `tsconfig.json` has `strict: true` and **no** `exactOptionalPropertyTypes`, so `{ acceptingOrdersUntil: undefined }` type-checks against `PatchValue` without gymnastics.
- **convex-test nuance:** its `patch` merges the value in (`node_modules/convex-test/dist/index.js:131-137`), so a cleared key can survive as an own property whose value is `undefined`. Behaviour is identical for `=== undefined` and `??` (every consumer in this repo uses one of those — e.g. `convex/orderCommitPolicy.ts:997,1044`), so tests pass; but assert clearing with `expect(doc.field).toBeUndefined()` or `toEqual`, **not** `toStrictEqual`/`Object.keys`/`in`.

---

## V2 — `updateItem` `isAvailable` path — RESOLVED

Confirmed end to end: validator allows it (`convex/menus.ts:61`), `validatedItemFields` copies it (`:271-273`), `updateItem` patches and returns nothing (`:546-577`), **no audit insert anywhere in `convex/menus.ts`**. It is reached by the item editor for every save (`menu-panel.tsx:225` + `buildItemPatch`'s unconditional `isAvailable`, `menu-panel-helpers.ts:438`). See Q3 for the recommendation.

---

## V3 — Tuple no-op guard shape — RESOLVED

`resolveSupplyChange` should not mirror `resolveFeaturedChange(current: boolean, next: boolean)` literally, because the business pause is a tuple. Two clean options; prefer the first:

1. **Keep one generic helper** and compare a small record:
   `resolveSupplyChange(previous: { accepting; until?; note? }, next: { … })` → `{ changed: boolean }`, comparing member-by-member after normalization (Q4 table). Menu toggles call it with a single-member record, or use the existing boolean form.
2. Keep `resolveFeaturedChange`'s exact shape as `resolveAvailabilityChange(current ?? true, next)` for the two menu booleans, plus a separate `resolveAcceptingOrdersChange` for the tuple.

Either way: normalize `undefined` and `null` to the same "absent" value before comparing, and trim the note first — otherwise retries with cosmetic differences write rows. Group availability must compare against `group.isAvailable ?? true` ("absent means available", `convex/schema.ts:124`; projection `convex/menus.ts:353-360`), item availability against the required boolean (`schema.ts:149`).

---

## V4 — Does a change to `until`/`note` alone count as an audited state change? — RESOLVED: yes

Covered by Q4. Summary of the reasoning chain: AC says "single row per actual **state** change"; the persisted pause state is the tuple, not the boolean; the note is customer-visible and is the row's `reason`; therefore any tuple member moving is a state change worth one row, while an identical tuple stays silent.

---

## Plan deltas (smallest edits the implementer should make)

| # | Plan/todo text | Change |
|---|---|---|
| D1 | Decision 3 + Task 3 "ADD `setItemAvailability`"; todo Task 3 | **Drop the new mutation.** Audit inside `updateItem` only. Spec names two new functions, and `screens/SPEC.md:146` says per-item `isAvailable` is unchanged. Keep the persisted-value comparison. |
| D2 | Todo Task 1 "Verify … `until <= now` rejects"; Testing Strategy | **Remove the rejection** pending the Q5 decision. Accept any finite `until`. Do not write the "past `until` → open" test in #77. |
| D3 | Task 1 GOTCHA 1 ("`unset` … else `replace`") | Replace with: "clear optional fields by including them as `undefined` in `ctx.db.patch`" + cite `menus.ts:439-444` and the Convex docs. Never `replace`. |
| D4 | Decision 2 `buildSupplyAuditLog` input | Make `targetName` **required** (Q7), for all three target types. |
| D5 | Decision 7 "return the unchanged doc/result" | Prefer returning nothing, mirroring `setFeatured`; assert rows through `t.run`. A `{ changed }` return is harmless but unreferenced. |
| D6 | Note length | No normative limit exists. Precedents: 200 for the audit `reason` (`convex/orderCommitPolicy.ts:1125`), **500** for the customer-visible order note (`convex/orders.ts:50`). 200 is defensible for a banner + audit `reason`; pick one, document it, pin 200/201 in a test. |
| D7 | Notes | Add the two accepted gaps: `createItem` sets initial `isAvailable` (not a toggle → no row); `deleteItem`/`deleteGroup` remove availability without a row (no §6.2.8 action exists). |
| D8 | Acceptance Testing | New audit actions render as their raw string and are absent from the audit filter dropdown until a UI ticket adds labels (`app/admin/audit/audit-types.ts:17`, `audit-route.tsx:75`, fallbacks `audit-table.tsx:59`). Not a backend gap; note it so the "audit is visible" expectation is not overstated. |

---

## Sources (consulted)

**Normative (repo)**
- Issue #77 body + AC — <https://github.com/Calel33/dircteshop/issues/77> (`gh issue view 77`)
- `docs/order-commitment-protocol.md:318` (INV-22), `:1110-1118` (§6.2.8), `:1254`, `:1271`, `:1287` (§6.5), `:1489` (§6.4 pause/resume = auto-reopen), `:1571-1572` (file plan), `:1690` (test matrix incl. "`until` exactly now")
- `screens/SPEC.md:146` (§7.1 item 6)

**Official (Convex)**
- Writing Data — "Fields set to `undefined` are removed" (patch), `db.replace` semantics: <https://docs.convex.dev/database/writing-data>
- Installed types (authoritative for the pinned version): `node_modules/convex/dist/cjs-types/server/database.d.ts:200-217, 226, 244-281, 382-386` — Convex **1.46.0**

**Repo code (evidence)**
- `convex/orderCommitPolicy.ts:992-1004, 1037-1060, 1125`
- `convex/orders.ts:50, 666-685` · `convex/orders.test.ts:1015-1040, 1061-1063`
- `scripts/order-commit-policy.test.ts:1704-1716`
- `convex/menus.ts:57-66, 75-84, 97-107, 259-287, 231-253, 353-374, 423-448, 538, 546-577`
- `convex/businesses/mutations.ts` (no `setAcceptingOrders`; `assertPatchInAllowlist` at `:622-629`)
- `convex/businesses/adminPolicy.ts:19-67` · `convex/businesses/adminMutations.ts:26-73` · `convex/businesses/adminDeletion.ts:22-40, 139-171`
- `convex/businesses/moderationPolicy.ts:95-116`
- `convex/auditLogs.ts:26-47, 105-144` · `convex/auditProjections.ts:218, 227-252`
- `convex/schema.ts:73-76, 118-165, 360-378` · `convex/businessTypes.ts:101-123`
- `app/owner/business/[id]/menu-panel.tsx:202-203, 225` · `menu-panel-helpers.ts:402-451` · `menu-panel-item-editor.tsx:353-354`
- `app/admin/audit/audit-types.ts:17` · `audit-route.tsx:75` · `audit-table.tsx:59` · `admin-overview-panels.tsx:126`
- `node_modules/convex-test/dist/index.js:110-138` (patch merge behaviour) · `tsconfig.json:7`

---

## Caveats / residual risk

- **Q5 is unresolved by design.** It needs a product decision (T2 predicate vs §6.4/AC). Until then, `until` behaviour for expired pauses cannot be asserted through this ticket's mutation; do not "fix" it inside #77.
- The issue AC's "`until` in the past → effectively open" and `docs/order-commitment-protocol.md:1489` are the conflicting side; `:1287` backs the code. All four artifacts are current at HEAD — this is a genuine doc/test disagreement, not staleness.
- Note-length limit is a free choice (D6); nothing normative fixes it.
- Snapshot policy relies on the call site passing the doc's `name` — no query is required because both `groupInBusiness`/`itemInBusiness` and `requireBusinessOwnerUser` already load the document.
- Reticle was not used: this task produced no user-facing change, only research notes.
