# Alignment Report — Issue #73: Land S0 handler regression suite + protocol doc

> Alignment is advisory. No implementation file was changed by this review.

## Scope

- **Artifact type:** code (`convex/orders.test.ts`) + spec (`docs/order-commitment-protocol.md`)
- **Artifact location:** issue https://github.com/Calel33/dircteshop/issues/73 · branch `fix/issue-73-order-protocol-t1-land-s0-handler-regression-suite-protocol-doc` · HEAD `723a7f3` · both files staged
- **Reviewed:** 2026-10-20
- **Focus:** all libraries in the surface — `convex-test`, `vitest`, `convex`, `vite`, `@edge-runtime/vm`, `typescript`

## Stack detected

| Library / technology | Installed version | Source of truth (manifest) | Docs target |
|----------------------|-------------------|----------------------------|-------------|
| `convex-test` | 0.0.62 | `package.json:75` (`^0.0.62`), `node_modules/convex-test/package.json` | latest stable |
| `vitest` | 4.1.12 | `package.json:87` (`^4.1.12`), `node_modules/vitest/package.json` | latest stable |
| `convex` | 1.46.0 | `package.json:48` (`^1.31.2`), `node_modules/convex/package.json` | latest stable |
| `vite` | 6.4.4 | `package.json:86` (`^6.4.4`), `node_modules/vite/package.json` | latest stable |
| `@edge-runtime/vm` | 5.0.0 | `package.json:64` (`^5.0.0`) | latest stable |
| `typescript` | 5.8.3 | `package.json:84` (`^5`) | latest stable |
| Node.js | 24.18.0 | `node -v`; `package.json:7` (`>=22.6`) | latest LTS |
| Vitest config | `environment: 'edge-runtime'`, `include: ['convex/**/*.test.ts']` | `vitest.config.ts:10-14` | — |

Latest published (npm, measured 2026-10-20): `convex-test` 0.0.62 · `vitest` 5.0.5 (`V4` tag = 4.1.12) · `convex` 1.47.0 · `vite` 8.3.4 · `@edge-runtime/vm` 5.0.0 · `typescript` 7.0.2.

## Sources consulted

| Source | URL | Covers version |
|--------|-----|----------------|
| Convex — `convex-test` (guide, incl. Limitations) | https://docs.convex.dev/testing/convex-test | latest |
| Convex — Reading Data (`db.get`, `withIndex`, ordering) | https://docs.convex.dev/database/reading-data | latest |
| Convex — Indexes | https://docs.convex.dev/database/reading-data/indexes | latest |
| Convex — `GenericDatabaseReader.get` API reference | https://docs.convex.dev/api/interfaces/server.GenericDatabaseReader | latest |
| Convex — Schemas (`v.optional`, `v.union`, `v.id`) | https://docs.convex.dev/database/schemas | latest |
| Convex — Application Errors (`ConvexError.data`) | https://docs.convex.dev/functions/error-handling/application-errors | latest |
| Convex — Runtimes (Web Crypto APIs) | https://docs.convex.dev/functions/runtimes | latest |
| Convex — OCC and Atomicity | https://docs.convex.dev/database/advanced/occ | latest |
| Convex — Rate Limiter component | https://www.convex.dev/components/rate-limiter | latest |
| Convex — generated AI guidelines (repo authority) | `convex/_generated/ai/guidelines.md:80,95,119-121` | repo |
| Stripe — Idempotent requests | https://docs.stripe.com/api/idempotent_requests | API v1 |
| Vitest — Test Environment | https://vitest.dev/guide/environment | latest |
| Vitest — Expect (`toThrow`, `rejects`) | https://vitest.dev/api/expect | latest |
| Vitest — Migration to 5.0 | https://vitest.dev/guide/migration/ | 5.x |
| Vitest — Migration to 4.0 | https://v4.vitest.dev/guide/migration | 4.x |
| npm — `convex-test` | https://www.npmjs.com/package/convex-test | registry |
| npm — `vitest` | https://www.npmjs.com/package/vitest | registry |
| npm — `convex` | https://www.npmjs.com/package/convex | registry |
| npm — `vite` | https://www.npmjs.com/package/vite | registry |
| npm — `typescript` | https://www.npmjs.com/package/typescript | registry |

## Findings

| # | Label | Severity | Artifact location | Claim / usage | What the docs say | Source |
|---|-------|----------|-------------------|---------------|-------------------|--------|
| 1 | ALIGNED | — | `convex/orders.test.ts:1,17,23` | `/// <reference types="vite/client" />` + `import { convexTest } from 'convex-test'` + `import.meta.glob('./**/*.ts')` | Docs' primary example is exactly `convexTest(schema, modules)` with `const modules = import.meta.glob("./**/*.ts")` and the `vite/client` reference in the file that calls it; repo guidelines mandate the same | https://docs.convex.dev/testing/convex-test |
| 2 | ALIGNED | — | `convex/orders.test.ts:143,166,189,199,209,218,229,247,261,276` | One `convexTest(schema, modules)` per test (fresh backend, no shared `t`) | Docs: call `convexTest` at the start of each test; each call gets a fresh database/scheduler | https://docs.convex.dev/testing/convex-test |
| 3 | ALIGNED | — | `convex/orders.test.ts:170,232,252,264` | `t.withIdentity({ subject: 'user_owner' })` | Docs: `withIdentity(Partial<UserIdentity>)`; omitted `issuer`, `subject`, `tokenIdentifier` are generated automatically; returns a new accessor | https://docs.convex.dev/testing/convex-test |
| 4 | ALIGNED | — | `convex/orders.test.ts:146,161,171,177,194,280` | `t.mutation(api.*, args)` / `t.query(api.*, args)` against generated refs | Docs: public and internal refs may be called through `t.query`/`t.mutation`/`t.action` | https://docs.convex.dev/testing/convex-test |
| 5 | ALIGNED | — | `convex/orders.test.ts:28-129,148,184,191,201` | `t.run(async (ctx) => ctx.db.insert/query/get/patch)` for setup and assertions | Docs: `t.run` supplies a `ctx` for direct reads/writes outside declared functions | https://docs.convex.dev/testing/convex-test |
| 6 | ALIGNED | — | `convex/orders.test.ts:153-158` | `ctx.db.query('notifications').withIndex('byUserId', q => q.eq(...)).collect()` | Docs: index filtering is `withIndex()` + `q.eq()`; `.collect()` returns all matches | https://docs.convex.dev/database/reading-data |
| 7 | ALIGNED | — | `convex/orders.test.ts:193-196,203-205,212-214,222-225,234-236,251-257,270-272` | `await expect(promise).rejects.toThrow('…')` with a string | Vitest: `toThrow` accepts a string and matches a **substring**; `toThrowError` is deprecated; `rejects` unwraps the promise | https://vitest.dev/api/expect |
| 8 | ALIGNED | — | `vitest.config.ts:12-13` | `environment: 'edge-runtime'`, `include: ['convex/**/*.test.ts']` | Vitest documents `edge-runtime` (uses `@edge-runtime/vm`); Convex documents the single-environment config with `environment: "edge-runtime"` and an `include` of `convex/**/*.test.{ts,js}` | https://vitest.dev/guide/environment · https://docs.convex.dev/testing/convex-test |
| 9 | ALIGNED | — | `package.json:75` | `convex-test@0.0.62` | 0.0.62 is the latest published version; peer `convex: ^1.43.0` is satisfied by 1.46.0 | https://www.npmjs.com/package/convex-test |
| 10 | ALIGNED | — | `package.json:64` | `@edge-runtime/vm@5.0.0` | 5.0.0 is the latest published version (`npm view @edge-runtime/vm version`) | https://www.npmjs.com/package/@edge-runtime/vm |
| 11 | ALIGNED | — | `docs/order-commitment-protocol.md:1304-1314` | Error envelope: `throw new ConvexError({ code, message, actualSubtotal })`, client reads `data.message`/`data.code` | Docs: any argument/return/data type may be passed to `ConvexError` and is exposed on `error.data`; the client example reads `(error.data as {...}).message` | https://docs.convex.dev/functions/error-handling/application-errors |
| 12 | ALIGNED | — | `docs/order-commitment-protocol.md:1042` | "Convex does not enforce unique indexes. Uniqueness is enforced in the mutation transaction." | The documented index model is name + ordered field list only (no uniqueness option); uniqueness is a query-time check (`.unique()` throws when multiple match) or an application invariant | https://docs.convex.dev/database/reading-data/indexes · `convex/_generated/ai/guidelines.md:95` |
| 13 | ALIGNED | — | `docs/order-commitment-protocol.md:1039` | Required indexed fields avoid optional-field index semantics for token/idempotency/expiry lookups | Docs: indexed fields order `undefined` first (no value set < null < …), i.e. optional indexed values are indexed but sort first; the rationale is consistent | https://docs.convex.dev/database/reading-data |
| 14 | ALIGNED | — | `docs/order-commitment-protocol.md:1361` | Guidelines recommend `@convex-dev/rate-limiter` for per-key quotas; hand-rolled counters race and lose quota on rollback | Repo guideline states this nearly verbatim; the component page confirms fixed-window/token-bucket, transactional rollback, and fail-closed behavior | `convex/_generated/ai/guidelines.md:80` · https://www.convex.dev/components/rate-limiter |
| 15 | ALIGNED | — | `docs/order-commitment-protocol.md:1666,1731-1740,1859,1904` | OCC retry exists; concurrency must be proven on a real deployment with parallel calls | Docs: OCC aborts on read-set version conflict and deterministically re-runs the transaction, giving serializability; a mock cannot reproduce backend contention | https://docs.convex.dev/database/advanced/occ |
| 16 | ALIGNED | — | `docs/order-commitment-protocol.md:1089` | `crypto.getRandomValues(new Uint8Array(32))` for the bearer token | Default Convex runtime lists Web Crypto APIs: `crypto`, `CryptoKey`, `SubtleCrypto` (see also finding 26) | https://docs.convex.dev/functions/runtimes |
| 17 | ALIGNED | — | `docs/order-commitment-protocol.md:1356` | "Idempotency retention 24 h — Stripe's minimum" | Stripe: for API v1 keys may be removed after they are "at least 24 hours old"; the idempotency layer compares parameters and errors on mismatch | https://docs.stripe.com/api/idempotent_requests |
| 18 | ALIGNED | — | `docs/order-commitment-protocol.md:885-1034` | Schema sketches use `v.optional`, `v.union`, `v.literal`, `v.id`, `defineTable(...).index(...)` | All are documented validator/schema builders, including optional fields and unions | https://docs.convex.dev/database/schemas |
| 19 | ALIGNED | — | `docs/order-commitment-protocol.md:2088` | The canonical command needs no override because `vitest.config.ts:12` selects `edge-runtime` and `include` covers `convex/**/*.test.ts` | Matches `vitest.config.ts:10-14` verbatim | `vitest.config.ts:10-14` |
| 20 | ALIGNED | — | `docs/order-commitment-protocol.md:1665` | Handler layer = `vitest` + `convex-test` driving the real `api.orders` functions | Docs: `convex-test` is the mock backend for calling real functions; Vitest is the documented runner | https://docs.convex.dev/testing/convex-test |
| 21 | ALIGNED | — | `convex/orders.test.ts` (whole file) | No removed Vitest 4 APIs (`environmentMatchGlobs`, `poolMatchGlobs`, options-object third argument) | Vitest 4 removed exactly those; the file and config use none of them | https://v4.vitest.dev/guide/migration |
| 22 | ALIGNED | — | `convex/orders.test.ts` (whole file) | Uses `toThrow`, not `toThrowError` | `toThrowError` is documented as a deprecated alias; `toThrow` is current | https://vitest.dev/api/expect |
| 23 | ALIGNED | — | environment | Node 24.18.0 on the installed stack | Vitest 5 requires Node >= 22.12 and Vite >= 6.4.0; the installed Node 24.18 and Vite 6.4.4 satisfy both, and Vitest 4 is satisfied | https://vitest.dev/guide/migration/ |
| 24 | ALIGNED | — | `docs/order-commitment-protocol.md:1970-1978,2013-2027` | Scope: one new test file, one new report, no production change; scratch suite moved outside the repo | Consistent with the staged diff (two new files) and `git status` | — |
| 25 | DRIFT | **Medium** | `convex/orders.test.ts:148,184` | `ctx.db.get(orderId)` — single-argument form | Public docs show `ctx.db.get("tasks", args.taskId)`; the installed type marks the single-arg overload "Supported for backwards compatibility. Prefer `db.get(tableName, id)` in new code". The two-arg form is the documented/recommended one; the single-arg form still works | https://docs.convex.dev/database/reading-data · https://docs.convex.dev/api/interfaces/server.GenericDatabaseReader · `node_modules/convex/dist/cjs-types/server/database.d.ts` |
| 26 | DRIFT | **Low** | `docs/order-commitment-protocol.md:1910` (U13) | "`crypto.getRandomValues`/`crypto.subtle` availability in the Convex mutation runtime — design assumption; not executed" | The Runtimes page lists `crypto`, `CryptoKey`, `SubtleCrypto` as supported Web Crypto APIs in the default runtime (where queries/mutations run). The uncertainty is already answered by official docs; U13 understates documented support | https://docs.convex.dev/functions/runtimes |
| 27 | VERSION-GAP | — | whole suite | `vitest` 4.1.12 installed, latest 5.0.5 | Installed 4.1.12 is the newest 4.x (`V4` dist-tag) and remains a supported line, but 5.0.5 is latest stable. V5 changes that touch this repo: `clearMocks` defaults `true`, `vite` becomes a required peer, config files are no longer looked up from parent directories, and Vitest 4's removed options stay removed. No `convex-test` statement on V5 exists; upgrading is a separate ticket | https://vitest.dev/guide/migration/ · https://www.npmjs.com/package/vitest |
| 28 | VERSION-GAP | — | test types / peer | `convex` 1.46.0 installed, latest 1.47.0 | 1.46.0 satisfies `convex-test@0.0.62`'s peer `^1.43.0`; one minor behind. No API used by this suite changed in the gap | https://www.npmjs.com/package/convex |
| 29 | VERSION-GAP | — | `/// <reference types="vite/client" />`, Vitest engine | `vite` 6.4.4 installed, latest 8.3.4 | Installed 6.4.4 satisfies both Vitest 4 (`^6.0.0 || ^7.0.0 || ^8.0.0`) and Vitest 5 (`^6.4.0 || ^7.0.0 || ^8.0.0`) peer ranges. Two majors behind latest stable; no usage in the artifact depends on a newer Vite API | https://www.npmjs.com/package/vite |
| 30 | VERSION-GAP | — | toolchain | `typescript` 5.8.3 installed, latest 7.0.2 | Four majors behind (5 → 7). `package.json:84` pins `^5`, so TS 7 is a deliberate major migration, not a patch bump. The test file uses only long-standing syntax (`as const`, type-only imports, `ReturnType`) | https://www.npmjs.com/package/typescript |
| 31 | UNVERIFIABLE | — | `docs/order-commitment-protocol.md:1733` | "`convex-test` may execute mutations serially, so it can prove logic but not OCC behavior" | The `convex-test` guide and its Limitations section do not state whether mutations are serialized or whether OCC is modeled. The OCC page documents the real backend only. The cautious conclusion (use a real deployment) is sound, but the serialization claim has no authoritative source | searched: https://docs.convex.dev/testing/convex-test (body + Limitations), https://docs.convex.dev/database/advanced/occ |
| 32 | UNVERIFIABLE | — | `docs/order-commitment-protocol.md:1794-1795,1806,2044-2045` | Recorded results: typecheck "Exit 2; 30 error lines", build "Exit 1; 20 errors", DoD "not met" on that basis | The artifact's own record now conflicts with the measured state of this tree: `pnpm build` compiled successfully (TypeScript finished, 18/18 pages), `pnpm lint` exits 0. No library doc can adjudicate a repo-state claim, so this is flagged as conflicting evidence for the code-review phase, not a documentation drift | measured run 2026-10-20 (build/lint/test) vs artifact §7.4/§9.4 |

## Summary

| Label | Count |
|-------|-------|
| ALIGNED | 24 |
| DRIFT | 2 |
| VERSION-GAP | 4 |
| UNVERIFIABLE | 2 |

**Top DRIFT findings:**
1. **Medium — `ctx.db.get(id)` single-argument form** (`convex/orders.test.ts:148,184`). The public docs and the installed type both point at `ctx.db.get('orders', id)`; the single-arg overload is kept "for backwards compatibility". Works today; align while the file is new.
2. **Low — U13 understates Web Crypto support** (`docs/order-commitment-protocol.md:1910`). The Runtimes page lists `crypto` and `SubtleCrypto` as supported in the default runtime, so the "design assumption; not executed" label can be upgraded to a documented fact (a smoke test is still cheap insurance).

## Recommendations (advisory)

1. **Medium:** Change the two assertion reads to `ctx.db.get('orders', orderId)` in `convex/orders.test.ts:148,184`. Behaviour is identical; it removes the only superseded API usage in the new file.
2. **Low:** In §8.3, replace U13 with a note that `crypto`/`SubtleCrypto` are documented default-runtime APIs, keeping the "run a 5-line mutation test before relying on it" action if desired.
3. **For code review (not a library finding):** §7.4 and §9.4 still record typecheck/build as failing and the Verdict/DoD as "not met" on that basis; the current tree builds clean. Either refresh those rows or state explicitly that they are the historical environment record, so the document does not contradict the landing evidence. The same applies to the "uncommitted/untracked" wording in §9.1 and §9.3 — both files are staged.
4. **Debt, out of scope for #73:** Vitest 4.1.12 is one major behind 5.0.5 (still supported); `convex` is one minor behind; `vite` and `typescript` are several majors behind. Upgrade Vitest only with the glob/dynamic-import path re-run and the full suite green (`convex-test` publishes no V5 compatibility statement).

## Notes

- **Version policy:** alignment targets latest stable. Vitest 4.1.12 is the newest 4.x (`V4` dist-tag) and in a supported line, so the gap is recorded but not a defect of this change.
- **`convex` 1.46.0** is what the generated `api`/`dataModel` types were produced against; bumping it is a codegen-affecting change, not part of this test-only landing.
- **Error-text coupling:** the suite asserts application-owned message strings (`'Unauthorized'`, `'Forbidden'`, `'Invalid status transition'`, `'This item is not available for ordering.'`). The `convex-test` Limitations section warns only against relying on *backend-generated* error text, so this is not drift; the protocol doc already plans typed codes (INV-19/INV-27) for S1.
- **`convex-test` Limitations** also state the mock does not enforce size/time limits, does not guarantee ID format, and runs on an Edge Runtime shim that "might differ from the Convex runtime". The doc's §8.3/§9 reflect these; no additional finding.
- **`toThrow` vs docs:** the Convex guide's error example uses `.rejects.toThrowError()`, which Vitest now documents as a deprecated alias. The artifact's `toThrow` is the current form; this is a doc-side lag, not artifact drift.
- **Out of scope:** the vendor/market citations in §4 (Baymard, DoorDash, Uber Eats, Toast, Square, Tock, Shopify, Spence, Akerlof) are product evidence, not the library surface this change uses; only the Stripe claim that drives a constant was checked (finding 17).
- **Internal-only claim checked:** the "duplicate `allowImportingTsExtensions`" warning at §7.4 is real (`tsconfig.json:10,13`).
