# Alignment Report — Issue #77 Order protocol T6 (owner supply toggles + audit)

## Scope

- **Artifact type:** code
- **Artifact location:** branch `fix/issue-77-order-protocol-t6-owner-supply-toggles-audit`, staged working tree (7 files, 1118 insertions, 3 deletions); issue <https://github.com/Calel33/dircteshop/issues/77>
- **Reviewed:** 2026-10-26
- **Focus:** all libraries exercised by the change (Convex backend + convex-test/Vitest/Vite test surface + TypeScript)

**Changed files in the delta**

| File | Change |
|---|---|
| `convex/supplyAudit.ts` | new pure helper module (audit row builder, note validation, tuple no-op guard) |
| `convex/businesses/mutations.ts` | new `setAcceptingOrders` mutation (patch + one `auditLogs` row) |
| `convex/menus.ts` | new `setGroupAvailability`; `updateItem` gains the item-availability audit branch |
| `convex/businesses/supply.test.ts` | new handler tests (authz, idempotency, resume clearing, `placeOrder` integration) |
| `convex/menus.test.ts` | new handler tests (group/item toggles, `targetName` snapshot, hard-delete survival) |
| `convex/orders.test.ts` | +91 lines: end-to-end supply → commit-guard tests |
| `convex/_generated/api.d.ts` | codegen entry for the new `supplyAudit` module |

**Reported validation** (from the implementing session; not re-run during alignment): `npm run test` exit 0, `node --test` 672/672, vitest 131/131, targeted 91/91.

**Scope exclusions:** no UI (`app/`, `components/`) and no schema/migration change is part of this delta; earlier T2/T5/T8 commits on the branch were not re-aligned here.

## Stack detected

| Library / technology | Installed version | Source of truth (manifest) | Docs target |
|----------------------|-------------------|----------------------------|-------------|
| convex | 1.46.0 | `package.json` (`^1.31.2`), `node_modules/convex/package.json` | latest stable 1.48.0 |
| convex-test | 0.0.62 | `package.json` (`^0.0.62`), `node_modules/convex-test/package.json` | latest stable 0.0.65 |
| vitest | 4.1.12 | `package.json` (`^4.1.12`), `node_modules/vitest/package.json` | latest stable 5.0.5 |
| vite (via vitest, `import.meta.glob`) | 6.4.4 | `package.json` (`^6.4.4`) | latest stable 8.3.5 |
| typescript | 5.8.3 | `package.json` (`^5`), `node_modules/typescript/package.json` | latest stable 7.0.2 |
| Node.js (runtime) | 24.18.0 local; manifest `>=22.6` | `package.json` `engines`; `node -v` | — |

## Sources consulted

| Source | URL | Covers version |
|--------|-----|----------------|
| Convex — Writing Data (patch/replace semantics, single-transaction mutations) | https://docs.convex.dev/database/writing-data | latest (1.48) |
| Convex — Mutations (args, `undefined` return, helper modules) | https://docs.convex.dev/functions/mutation-functions | latest |
| Convex — Application Errors (`ConvexError`, string `data`, rollback) | https://docs.convex.dev/functions/error-handling/application-errors | latest |
| Convex — Validation (unions, `v.null()`, optional, IEEE-754 incl. NaN) | https://docs.convex.dev/functions/validation | latest |
| Convex — `GenericDatabaseWriter` API (`patch` overloads) | https://docs.convex.dev/api/interfaces/server.GenericDatabaseWriter#patch | latest |
| Convex — Generated API (`api.d.ts` is codegen output) | https://docs.convex.dev/generated-api/ | latest |
| Convex CLI — `npx convex codegen` | https://docs.convex.dev/cli/reference/codegen | latest |
| Convex — Auth in Functions (`getUserIdentity`, `subject`) | https://docs.convex.dev/auth/functions-auth | latest |
| Convex — Testing with convex-test (`t.run`, `t.mutation`, `withIdentity`, `import.meta.glob`) | https://docs.convex.dev/testing/convex-test | latest |
| Convex — OCC / transaction atomicity | https://docs.convex.dev/database/advanced/occ | latest |
| Convex 1.48.0 changelog (npm package) | https://unpkg.com/convex@1.48.0/CHANGELOG.md | 1.47.0, 1.48.0 |
| Convex — Deleting Files | https://docs.convex.dev/file-storage/delete-files | latest (no transactionality statement) |
| Vitest — `vi.useFakeTimers` / `vi.setSystemTime` | https://vitest.dev/api/vi#vi-usefaketimers | latest (5.x) |
| Vitest — Timers guide | https://vitest.dev/guide/mocking/timers | latest |
| Vite — Features (`import.meta.glob`) | https://vite.dev/guide/features | latest |
| npm registry (latest versions) | https://registry.npmjs.org/convex ; https://registry.npmjs.org/convex-test ; https://registry.npmjs.org/vitest ; https://registry.npmjs.org/vite ; https://registry.npmjs.org/typescript | 2026-10-26 |
| Project authority — Convex API guidelines | `convex/_generated/ai/guidelines.md:103` (local, read) | installed |
| Installed Convex types (`patch` overload comments) | `node_modules/convex/dist/cjs-types/server/database.d.ts:226-243` (local, read) | 1.46.0 |

## Findings

| # | Label | Severity | Artifact location | Claim / usage | What the docs say | Source |
|---|-------|----------|-------------------|---------------|-------------------|--------|
| 1 | ALIGNED | — | `convex/businesses/mutations.ts:637`, `convex/menus.ts:534`, `convex/supplyAudit.ts:93-99` | Clearing optional pause fields by including them as `undefined` in `ctx.db.patch` | "Fields set to `undefined` are removed. Fields not specified in the patch are left unchanged." | https://docs.convex.dev/database/writing-data |
| 2 | ALIGNED | — | `convex/businesses/mutations.ts:601-659` | Partial update uses `patch`, never `replace` | `replace` overwrites the whole document and removes unspecified fields; `patch` is the documented partial-update method | https://docs.convex.dev/database/writing-data |
| 3 | ALIGNED | — | `convex/businesses/mutations.ts:631-657`, `convex/menus.ts:534-547`, `convex/menus.ts:631-647` | One patch + one `auditLogs` insert commit atomically (INV-22) | "the entire `mutation` function is automatically a single transaction"; throwing prevents the transaction from committing | https://docs.convex.dev/database/writing-data · https://docs.convex.dev/functions/error-handling/application-errors |
| 4 | ALIGNED | — | `convex/supplyAudit.ts:108-110` | `throw new ConvexError("<message>")` with a plain string payload | `ConvexError` accepts any Convex value as `data`; the docs' first example is a plain string | https://docs.convex.dev/functions/error-handling/application-errors |
| 5 | ALIGNED | — | `convex/businesses/mutations.ts:602-607` | `v.optional(v.union(v.number(), v.null()))` / `v.optional(v.union(v.string(), v.null()))` args | Unions, `v.null()`, and `v.optional(...)` are documented validators (`v.nullable(x)` is the equivalent convenience form) | https://docs.convex.dev/functions/validation |
| 6 | ALIGNED | — | `convex/supplyAudit.ts:59-77`; `convex/schema.ts:360-374` | `ctx.db.insert('auditLogs', row)` with `action`/`targetType` as narrow literal unions and omitted optional `reason` | `insert(table, value)` is the documented typed form; omitted optional schema fields are valid | https://docs.convex.dev/database/writing-data · https://docs.convex.dev/functions/validation |
| 7 | ALIGNED | — | `convex/businesses/mutations.ts:631-633`, `convex/menus.ts:528-530` | No-op path returns nothing (early `return;`) | "Mutations can also return `undefined`… When a mutation returns `undefined` it is translated to `null` on the client" | https://docs.convex.dev/functions/mutation-functions |
| 8 | ALIGNED | — | `convex/authz.ts:67-88` (newly consumed by both mutations) | Owner guard reads `ctx.auth.getUserIdentity()`, rejects `null`, keys the user by `identity.subject` | Documented pattern; `subject` is one of the three guaranteed identity fields | https://docs.convex.dev/auth/functions-auth |
| 9 | ALIGNED | — | `convex/supplyAudit.ts:1-17` | Non-function helper module imported by mutations | "Splitting up mutation code via helpers" is documented; helper modules are first-class | https://docs.convex.dev/functions/mutation-functions |
| 10 | ALIGNED | — | `convex/_generated/api.d.ts:55,110` | New `supplyAudit` module appears in the generated API map | `api.js`/`api.d.ts` are generated for every module in `convex/`; generated code is committed and regenerated by `npx convex dev` | https://docs.convex.dev/generated-api/ · https://docs.convex.dev/cli/reference/codegen |
| 11 | ALIGNED | — | `convex/businesses/supply.test.ts:11-17,41-44`; `convex/menus.test.ts:12-17,37-38` | `convexTest(schema, modules)`, `t.run`, `t.mutation`, `t.withIdentity({ subject })` | All documented convex-test APIs; `subject` is an accepted identity attribute (auto-generated when omitted) | https://docs.convex.dev/testing/convex-test |
| 12 | ALIGNED | — | `convex/menus.test.ts:19`; `convex/businesses/supply.test.ts:24-29` | `import.meta.glob` to supply the module map, paths relative to the test file | Documented pattern: "The paths are relative to the test file in which `import.meta.glob` is called" | https://docs.convex.dev/testing/convex-test |
| 13 | ALIGNED | — | `convex/businesses/supply.test.ts:33-39`; `convex/menus.test.ts:27-33` | `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime(NOW)` pins `Date.now()` (asserted via `createdAt: NOW`) | `useFakeTimers` mocks `Date`; `toFake` selects timers to mock; `setSystemTime` changes the system clock for date APIs | https://vitest.dev/api/vi#vi-usefaketimers |
| 14 | ALIGNED | — | `vitest.config.ts:10-14` | `environment: 'edge-runtime'` with `@edge-runtime/vm` installed | convex-test's documented Vitest configuration uses exactly this environment | https://docs.convex.dev/testing/convex-test |
| 15 | DRIFT | Medium | `convex/businesses/mutations.ts:637`; `convex/menus.ts:534` (same pattern pre-existing at `convex/menus.ts:631`, `convex/businesses/mutations.ts:166,218,345,446,540`) | New code uses the two-argument `ctx.db.patch(id, value)` overload | The documented form is `ctx.db.patch(tableName, id, value)`; the id-only overload is labelled "Supported for backwards compatibility. Prefer `db.patch(tableName, id, value)` in new code." The project's own Convex authority likewise specifies `ctx.db.patch(table, id, fields)` | https://docs.convex.dev/api/interfaces/server.GenericDatabaseWriter#patch · https://docs.convex.dev/database/writing-data · `convex/_generated/ai/guidelines.md:103` · `node_modules/convex/dist/cjs-types/server/database.d.ts:237-238` |
| 16 | VERSION-GAP | — | whole delta (Convex API surface) | Convex APIs used here (`patch`, `insert`, `ConvexError`, validators, auth) | installed 1.46.0 vs latest 1.48.0 (2026-10-22). 1.47 added `.staged()` schema and CLI flags; 1.48 added `ctx.auth.signJwt` and `ctx.storage.store/get` in mutations — no API used by #77 changed | https://unpkg.com/convex@1.48.0/CHANGELOG.md |
| 17 | VERSION-GAP | — | `convex/businesses/supply.test.ts`, `convex/menus.test.ts` | convex-test handler-test surface | installed 0.0.62 vs latest 0.0.65; no public changelog file was found in the published package, so upgrade impact was not assessed | https://www.npmjs.com/package/convex-test/v/0.0.65 |
| 18 | VERSION-GAP | — | both test files, `vitest.config.ts` | Vitest runner API (`vi.useFakeTimers`, `setSystemTime`) | installed 4.1.12 vs latest 5.0.5; v5 requires Node `^22.12 \|\| ^24 \|\| >=26` (project declares `>=22.6`; local Node 24.18.0) | https://www.npmjs.com/package/vitest/v/5.0.5 |
| 19 | VERSION-GAP | — | `convex/businesses/supply.test.ts:24-29`, `convex/menus.test.ts:19` | Vite `import.meta.glob` module map | installed 6.4.4 vs latest 8.3.5; v8 requires Node `^20.19 \|\| >=22.12` | https://www.npmjs.com/package/vite/v/8.3.5 |
| 20 | VERSION-GAP | — | whole delta (type checking) | TypeScript strict type checking of the typed `patch`/`insert` surface | installed 5.8.3 vs latest 7.0.2; #77 uses no syntax affected by the major | https://www.npmjs.com/package/typescript/v/7.0.2 |
| 21 | UNVERIFIABLE | — | `convex/businesses/mutations.ts:601-659` vs issue AC | Issue AC: "`until` in the past → effectively open" | No library doc can resolve this: the issue body and spec §6.4 read a passed `until` as open, while spec §6.5 and the landed T2 predicate/tests read it as closed (`until_passed` → `ORDERING_CLOSED`). #77 deliberately defers it (plan R1) and writes no such test. Product decision, not a technology drift | https://github.com/Calel33/dircteshop/issues/77 |
| 22 | UNVERIFIABLE | — | `convex/businesses/supply.test.ts:24-29` | Custom `import.meta.glob` key rewrite so a test in `convex/businesses/` yields convex-root-relative keys | The docs specify that glob paths are relative to the test file but do not document convex-test's single-prefix module resolution, which this workaround exists for. Behaviour is consistent with the installed 0.0.62 implementation and the tests pass | https://docs.convex.dev/testing/convex-test |

Itemization rule: every DRIFT and VERSION-GAP above carries a full source URL; ALIGNED rows are itemized here for traceability rather than only counted.

## Summary

| Label | Count |
|-------|-------|
| ALIGNED | 14 |
| DRIFT | 1 |
| VERSION-GAP | 5 |
| UNVERIFIABLE | 2 |

**Top DRIFT findings:**

1. **Medium — two-argument `ctx.db.patch(id, value)` in the two new mutations** (`businesses/mutations.ts:637`, `menus.ts:534`). Works today (the overload is explicitly kept for backward compatibility), but current Convex docs and the project's own Convex guidelines both specify the table-first form in new code. The pre-existing `updateItem` call at `menus.ts:631` shares the pattern; 40 production call sites use the 2-arg form vs 3 using the 3-arg form, so this is a repo-wide legacy convention rather than an #77 regression.

No Critical or High drift was found. The transaction/idempotency/audit contract this ticket exists to satisfy is implemented with documented Convex primitives.

## Recommendations (advisory)

1. **(Medium) Use the table-first `patch` in the two new call sites** — `ctx.db.patch('businesses', args.businessId, {...})` and `ctx.db.patch('menuGroups', group._id, {...})`. Because the 2-arg form dominates the repo, either apply it to #77 only (leaving mixed style) or schedule a mechanical repo-wide sweep; do not hand-migrate unrelated files inside this ticket.
2. **(Info) Re-run codegen before merge** — `npx convex dev --once` (or `npx convex codegen --dry-run`) to confirm `convex/_generated/api.d.ts` byte-matches generated output. The staged two-line delta is exactly the shape codegen produces for a new module, but provenance was not re-proven during alignment.
3. **(Info) Version gaps need no action for #77** — Convex 1.47/1.48 change nothing this ticket uses. If bumping Vitest to 5 / Vite to 8, raise `engines.node` to `>=22.12` first; local Node (24.18.0) already satisfies it.
4. **(Optional, product) Decide the `until` finite-value guard** — see the Notes observation; it belongs with the R1 product decision, not with alignment.

## Notes

- **Product-spec conflict, not a library finding.** The issue's “`until` in the past → effectively open” AC is unimplemented by design (`tasks/issue-77-research.md` Q5, `tasks/issue-77-plan.md` R1). The landed T2 predicate and two test files pin the opposite reading. Row 21 records this as UNVERIFIABLE because the sources conflict; it needs a product decision, not a code change.
- **Internal-plan divergence worth one line.** The plan says “accept any finite number” for `until`, but the handler performs no finiteness check. Convex documents `v.number()` as accepting all IEEE-754 values including `NaN` (https://docs.convex.dev/functions/validation#convex-values), so `until: NaN` would pass validation and make the `now < until` gate false. Not a documentation drift (the docs permit it) and not exercised by #77's tests; flagged for the Planner alongside R1.
- **Generated file provenance.** `convex/_generated/api.d.ts` carries the “THIS CODE IS AUTOMATICALLY GENERATED… To regenerate, run `npx convex dev`” header. `api.js` exports `anyApi` and lists no modules, so `api.d.ts` is the only file codegen would touch for a new module — consistent with the two-line delta.
- **Unverified pre-existing comment (out of scope).** `updateItem`'s “`ctx.storage.delete` is not transactional” is unchanged by #77 and the File Storage docs make no transactionality statement; it was not classified.
- **No implementation code was modified during this alignment.** All findings are advisory.
