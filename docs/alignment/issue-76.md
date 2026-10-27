# Alignment Report — Issue #76 Order protocol T2 (schema expand + legacy backfill)

> Mandatory output shape for the alignment skill. Fill every section. Delete nothing; write "none" where empty.

## Scope

- **Artifact type:** code (staged implementation + its migration runbook)
- **Artifact location:**
  - `convex/schema.ts`, `convex/orderPolicy.ts`, `convex/orders.ts`
  - `convex/orderAccess.ts` (new), `convex/migrations/backfillOrderAccess.ts` (new)
  - `convex/orders.test.ts`, `convex/_generated/api.d.ts`
  - `app/owner/business/[id]/orders-panel.tsx`, `app/owner/business/[id]/orders-panel-helpers.ts`
  - `components/profile/ordering-panel-sections.tsx`, `components/profile/ordering-panel-helpers.ts`
  - `docs/migrations/order-protocol-t2-backfill.md`
  - Branch `fix/issue-76-order-protocol-t2-schema-expand-legacy-backfill-expand-step`, staged diff (`git diff --cached`, 16 files, +1248/−63)
- **Reviewed:** 2026-10-20
- **Focus:** all libraries — Convex (schema/validators/indexes/pagination/runtime limits/crypto/internal functions/CLI), `convex-test`, Vitest, React 19, Next.js 16, Tailwind v4, TypeScript

Normative product input consulted: `docs/order-commitment-protocol.md` §6.2.2–§6.2.9 (L907–1137), plus `tasks/issue-76-research.md`, `tasks/issue-76-plan.md`, `convex/_generated/ai/guidelines.md`.

## Stack detected

| Library / technology | Installed version | Source of truth (manifest) | Docs target |
|----------------------|-------------------|----------------------------|-------------|
| convex | **1.46.0** (declared `^1.31.2`) | `package.json` / `node_modules/convex/package.json` | latest stable (1.47.0) |
| convex-test | 0.0.62 (declared `^0.0.62`) | `package.json` / `node_modules/convex-test/package.json` | latest stable (0.0.62) |
| vitest | 4.1.12 (declared `^4.1.12`) | `package.json` | latest stable (5.0.5) |
| @edge-runtime/vm | 5.0.0 | `package.json` | latest stable (5.0.0) |
| next | 16.3.5 (pinned) | `package.json` | latest stable (16.4.2) |
| react / react-dom | 19.3.0 (declared `^19.2.3`) | `node_modules/react/package.json` | latest stable (19.3.1) |
| typescript | 5.8.3 (declared `^5`) | `node_modules/typescript/package.json` | latest stable (7.0.2) |
| tailwindcss | 4.1.11 (declared `^4`) | `node_modules/tailwindcss/package.json` | latest stable (4.3.3) |
| Node | `engines: >=22.6` | `package.json` | — |

Convex AI guidelines in-tree declare: "These guidelines target Convex `^1.44.0`." Installed 1.46.0 satisfies that.

## Sources consulted

| Source | URL | Covers version |
|--------|-----|----------------|
| Schemas (optional fields, validators, schema validation, staged validators) | https://docs.convex.dev/database/schemas | latest (1.47.x-era docs) |
| Indexes (defining indexes, backfill, staged indexes) | https://docs.convex.dev/database/reading-data/indexes | latest |
| Pagination (cursor contract, `paginationOptsValidator`, manual loop) | https://docs.convex.dev/database/pagination | latest |
| `OrderedQuery.paginate` API reference | https://docs.convex.dev/api/interfaces/server.OrderedQuery#paginate | latest |
| `PaginationOptions` API reference | https://docs.convex.dev/api/interfaces/server.PaginationOptions | latest |
| Database types (`undefined`, null, arrays/objects, Id) | https://docs.convex.dev/database/types | latest |
| Writing data (pagination read budgets, transaction headroom) | https://docs.convex.dev/database/writing-data | latest |
| OCC and Atomicity (serializability, deterministic retry) | https://docs.convex.dev/database/advanced/occ | latest |
| Production limits (transactions, logs) | https://docs.convex.dev/production/state/limits#transactions | latest |
| Runtimes (Web Crypto, encoding APIs, seeded randomness, frozen time) | https://docs.convex.dev/functions/runtimes | latest |
| Internal functions | https://docs.convex.dev/functions/internal-functions | latest |
| CLI `convex run` reference | https://docs.convex.dev/cli/reference/run | latest |
| Next.js `use client` directive | https://nextjs.org/docs/app/api-reference/directives/use-client | Next.js 16 |
| convex-js CHANGELOG (1.25.0, 1.31.0, 1.46.0, 1.47.0, 1.48.0) | https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md | 1.47.0 released / 1.48.0 unreleased |
| `convex-test` 0.0.62 runtime (single-`.paginate()` enforcement) | `node_modules/convex-test/dist/index.js` | 0.0.62 |
| Project Convex guidelines | `convex/_generated/ai/guidelines.md` | targets `^1.44.0` |
| npm registry (latest stable versions) | https://www.npmjs.com/package/convex · /vitest · /next · /react · /tailwindcss · /typescript | latest |

Prior research (`tasks/issue-76-research.md`) and cached fetches under `.firecrawl/` were used as the starting point; every claim below was re-checked against the live pages above.

## Findings

| # | Label | Severity | Artifact location | Claim / usage | What the docs say | Source |
|---|-------|----------|-------------------|---------------|-------------------|--------|
| 1 | ALIGNED | — | `convex/schema.ts` L188–300 (`orders`, `businesses`, `menuGroups`) | New fields are all `v.optional(...)` so existing rows stay valid during expand | "You can describe optional fields by wrapping their type with `v.optional(...)`"; optional means the field might not be present | https://docs.convex.dev/database/schemas#validators |
| 2 | ALIGNED | — | `convex/schema.ts` `orders.items` | `v.optional(v.array(v.object({...})))` with nested optional `unitPrice`/`lineTotal`/`priceAdjustment` | Arrays of objects and nested optionals are the documented validator composition; arrays ≤8192 values, objects ≤1024 entries | https://docs.convex.dev/database/types |
| 3 | ALIGNED | — | `convex/schema.ts` `orders.status` | Widened to an 8-member `v.union` of `v.literal`s | "Use `v.literal` members in `v.union` validators for discriminated unions" | https://docs.convex.dev/functions/validation |
| 4 | ALIGNED | — | `convex/schema.ts` all new tables | `_id` / `_creationTime` are not declared | "`_id` and `_creationTime` are automatically added system fields … do not declare them" | https://docs.convex.dev/database/schemas |
| 5 | ALIGNED | — | `convex/schema.ts` `orders.byBusinessIdStatus` | A plain `.index()` on an existing table, queried only in a later slice | "You can feel free to query an index in the same deploy that defines it. Convex will ensure that the index is backfilled before the new query and mutation functions are registered." Staged indexes are for large tables | https://docs.convex.dev/database/reading-data/indexes |
| 6 | ALIGNED | — | `convex/schema.ts` six new side tables | Every side table indexes required (non-optional) fields; index names unique per table | "Defining indexes: 1. A name — must be unique per table. 2. An ordered list of fields to index." | https://docs.convex.dev/database/reading-data/indexes#defining-indexes |
| 7 | ALIGNED | — | `convex/schema.ts` (whole expand) | Additive-optional expand is safe to deploy because the push revalidates existing docs | "The first push after a schema is added or modified will validate that all existing documents match the schema. If there are documents that fail validation, the push will fail." | https://docs.convex.dev/database/schemas#schema-validation |
| 8 | ALIGNED | — | `convex/orderAccess.ts` L16–26, L85–115 | "Convex has no unique indexes", so reference uniqueness is a transactional check on `byBusinessIdReference` | The documented index definition has exactly two parts — a unique-per-table name and an ordered field list. No uniqueness constraint is part of the index API. | https://docs.convex.dev/database/reading-data/indexes#defining-indexes |
| 9 | VERSION-GAP | — | `convex/schema.ts` `orders.byBusinessIdStatus` | Plain (non-staged) index is created synchronously at deploy | Installed **1.46.0**: deploy blocks while a large index backfills. Latest **1.47.0**: "`npx convex deploy` now asks for confirmation before creating or changing an index on a large table … pass the new `--skip-large-indexes-check` flag to proceed without confirmation." | https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md |
| 10 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L79–82, L138–147 | Page result shape `{ page, isDone, continueCursor }`; `page` is an array | "The returned `page` … is an array of documents"; cursor pagination returns `page`, `isDone`, `continueCursor` | https://docs.convex.dev/database/pagination |
| 11 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L36, L57, L71–82 | `continueCursor` used as the checkpoint; `cursor` is nullable | Cursor "represents the point in the results that the current page ended"; `cursor` is required and nullable | https://docs.convex.dev/api/interfaces/server.PaginationOptions |
| 12 | **DRIFT** | **Medium** | `convex/migrations/backfillOrderAccess.ts` L44, L82 | Pagination options are hand-reconstructed (`{ numItems, cursor }`) from two scalar args instead of taking a `paginationOpts` argument | Docs specify the function "takes in a single arguments object with a `paginationOpts` property", validated with `paginationOptsValidator` and passed unchanged to `.paginate()`, "because optional native behavior would be lost". `PaginationOptions` also carries `endCursor`, `maximumRowsRead`, `maximumBytesRead`, `id`. Project guidelines repeat: "Do not reconstruct it". Works for the CLI loop, but the read-budget options can no longer be set. | https://docs.convex.dev/database/pagination · https://docs.convex.dev/api/interfaces/server.PaginationOptions · `convex/_generated/ai/guidelines.md` L38 |
| 13 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L50–51, L81 | `.order('asc')` on a plain `ctx.db.query('orders')` scan | A plain scan uses `by_creation_time`; `.order('asc'\|'desc')` selects direction; index reads append `_creationTime` as tie-breaker | https://docs.convex.dev/database/reading-data/indexes |
| 14 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L55; `docs/migrations/…` L25 | `count` is this page's row count and pages are summed for the gate | `numItems` "is only an initial value … If this is called from a reactive query function the number of results may not match". The documented use here is one-shot `npx convex run` (non-reactive), where the page length is the requested count | https://docs.convex.dev/api/interfaces/server.OrderedQuery#paginate |
| 15 | UNVERIFIABLE | — | `convex/migrations/backfillOrderAccess.ts` L20–23, L46–51; `docs/migrations/…` L27 | "Convex allows exactly ONE `.paginate()` per function execution (queries and mutations alike)" | No statement of this restriction exists in the pagination page, the `OrderedQuery.paginate` reference, or the limits page. It is enforced by the installed `convex-test` 0.0.62 (`"Only a single paginated query (\`.paginate()\`) is allowed per …"`). The split design is conservative and correct either way. | Searched: docs.convex.dev/database/pagination, /api/interfaces/server.OrderedQuery, /production/state/limits, /database/writing-data; `node_modules/convex-test/dist/index.js` |
| 16 | UNVERIFIABLE | — | `convex/migrations/backfillOrderAccess.ts` L69–82 | `.paginate()` is called inside an `internalMutation` | Docs frame pagination as a property of queries ("Paginated queries are queries…"), and the limits page counts "query or mutation" for pagination-related failures. No page states that a mutation may paginate. Direct evidence: the recorded dev run executed `backfillBatch` (a mutation) and returned a page. | Searched as above; `docs/migrations/order-protocol-t2-backfill.md` recorded run |
| 17 | ALIGNED | — | `convex/orderAccess.ts` L29–40 | `crypto.getRandomValues` used in application code | The default runtime lists Web Crypto: `crypto`, `CryptoKey`, `SubtleCrypto` | https://docs.convex.dev/functions/runtimes#web-crypto-apis |
| 18 | UNVERIFIABLE | — | `convex/orderAccess.ts` L9–13; `docs/migrations/…` L156–158 | "`getRandomValues` is backed by the per-execution seeded ChaCha12 RNG (not the OS CSPRNG) and a retried mutation replays the same stream" | Docs document a seeded PRNG for `Math.random()` and state that queries/mutations are "restricted by the runtime to be deterministic", but say nothing about `crypto.getRandomValues`'s entropy source or replay. Permission is proven empirically: the recorded dev run minted 5 tokens in one mutation. | Searched: /functions/runtimes (all sections), /database/advanced/occ, /production/state/limits |
| 19 | ALIGNED | — | `convex/orderAccess.ts` L38–39 | `btoa` exists; `Buffer` does not | Encoding APIs list `TextDecoder`, `TextEncoder`, `atob`, `btoa`; `Buffer` is only in the Node.js runtime (`"use node"`) | https://docs.convex.dev/functions/runtimes#encoding-apis |
| 20 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L108 (`createdAt: Date.now()`) | Wall clock read in a mutation | "`Date.now()` is fine in mutations and actions"; during execution it is frozen at function start, so all rows in a batch share one timestamp | https://docs.convex.dev/functions/runtimes#using-randomness-and-time-in-queries-and-mutations |
| 21 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L100–113, L131–134 | Prices are omitted by key omission (no `unitPrice`, `lineTotal`, `subtotal`), never written as `undefined`/`null` | "`{a: undefined}` is transformed into `{}` … Objects/records with `undefined` values are the same as if the field were missing"; `v.optional` means the field might not be present | https://docs.convex.dev/database/types#working-with-undefined |
| 22 | ALIGNED | — | `convex/schema.ts` (`unitPrice?: number`), `orders.ts` projections | `v.optional(v.number())` is treated as absent-or-number, never `null` | `null` is a distinct Convex type (`v.null()`); `undefined` is not a valid Convex value at all | https://docs.convex.dev/database/types |
| 23 | ALIGNED | — | `convex/orderAccess.ts` L77–115 | Collision check + insert in the same mutation is the serialization point for per-business reference uniqueness | "The implementation of optimistic concurrency control in Convex instead provides true serializability"; on conflict the deterministic transaction is simply re-run | https://docs.convex.dev/database/advanced/occ |
| 24 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L33, L69 | `internalQuery` / `internalMutation`; not client-callable | "Internal functions can only be called by other functions and cannot be called directly from a Convex client"; running from the CLI and Dashboard are documented callers | https://docs.convex.dev/functions/internal-functions |
| 25 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L15–18; `docs/migrations/…` L19–49 | Driver is `npx convex run migrations/…:backfillBatch '{"limit":50}'` | "Run a function with JSON arguments …"; "By default, this runs on your dev deployment"; `--prod` selects production | https://docs.convex.dev/cli/reference/run |
| 26 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L25–26, L76 | Batch of 50 stays inside the transaction limits | 16,000 documents written; 16 MiB written; 32,000 documents scanned; 4,096 index ranges (`db.get` + `db.query` calls) per transaction. 50 rows ≈ ≤100 writes and ≈≤651 `db.query`/`db.get` calls (1 page + 50 existence checks + ≤50 item reads + ≤600 collision probes in the pathological case) | https://docs.convex.dev/production/state/limits#transactions |
| 27 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L69–136 | A 50-row batch is expected to fit the 1 s user-code budget | "Query/mutation execution time \| 1 second \| Limit applies only to user code and doesn't include database operations" | https://docs.convex.dev/production/state/limits#transactions |
| 28 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L150 | One `console.log` line per batch, counts only | 4 KiB per log line; 256 log lines per function | https://docs.convex.dev/production/state/limits |
| 29 | UNVERIFIABLE | — | `convex/orderAccess.ts` L29–40, L89 | Access-token uniqueness across executions relies on a fresh 32-byte `rng_seed` per execution; no collision check exists on `byAccessToken` | Docs describe retries as deterministic re-runs and never specify how a *new* execution seeds `getRandomValues`. Within one batch the stream is sequential (5/5 unique tokens recorded); across batches nothing in the docs guarantees non-repetition. | Searched: /functions/runtimes, /database/advanced/occ, /production/state/limits, /database/reading-data/indexes; `tasks/issue-76-research.md` (source-level, backend `main`, not a pinned tag) |
| 30 | ALIGNED | — | `convex/migrations/backfillOrderAccess.ts` L106; `convex/orders.ts` `ctx.db.get('menuItems', …)` | Table-name first argument on `db.get`; `null` result handled with `'(item removed)'` | 1.31.0 release note: "`db.get`, `db.patch`, `db.replace`, and `db.delete` now accept a table name as the first argument"; `db.get` returns `null` when the document is absent | https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md |
| 31 | ALIGNED | — | `components/profile/ordering-panel-sections.tsx` L1; `app/owner/business/[id]/orders-panel.tsx` L1 | `'use client'` boundary + React function components; no `next/*` API used by the change | `use client` marks a Client Component boundary in the App Router; function components + hooks are the documented React 19 form | https://nextjs.org/docs/app/api-reference/directives/use-client |
| 32 | ALIGNED | — | `orders-panel.tsx` L6–7 | `useQuery` / `useMutation` from `convex/react`; `FunctionReturnType` from `convex/server` | Documented Convex React hooks; `FunctionReturnType` accepts either reference kind (1.46.0 note) | https://docs.convex.dev/client/react/overview · https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md |
| 33 | ALIGNED | — | `orders-panel-helpers.ts` L1–8; `ordering-panel-helpers.ts` L6–14 | Client modules import the pure `convex/orderPolicy.ts` (constants/types only) | Convex warns when *registered functions* are imported into a browser bundle ("Convex functions should not be imported in the browser"); a pure module that registers nothing is unaffected | https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md |
| 34 | VERSION-GAP | — | `package.json` devDependencies | `vitest` 4.1.12 | Latest stable **5.0.5**; project guidelines say for Convex tests "always install the latest versions of these packages" (`convex-test`, Vitest, `@edge-runtime/vm`). `convex-test` and `@edge-runtime/vm` are already latest. | https://www.npmjs.com/package/vitest |
| 35 | VERSION-GAP | — | `package.json` dependencies | `next` pinned 16.3.5 | Latest stable **16.4.2**. No Next.js API used by this change is affected (the UI files import no `next/*` module). | https://www.npmjs.com/package/next |
| 36 | VERSION-GAP | — | `package.json` dependencies | `react` / `react-dom` 19.3.0 | Latest stable **19.3.1** (patch) | https://www.npmjs.com/package/react |
| 37 | VERSION-GAP | — | `package.json` devDependencies | `tailwindcss` 4.1.11 | Latest stable **4.3.3**. The changed components use v4 utility/container-query syntax already supported by 4.1.x | https://www.npmjs.com/package/tailwindcss |
| 38 | VERSION-GAP | — | `package.json` devDependencies | `typescript` 5.8.3 | Latest stable **7.0.2**. Convex 1.43+ already supports side-by-side TS 6/7, but the project deliberately declares `^5`; no TS 7-only syntax is used. | https://www.npmjs.com/package/typescript |

## Summary

| Label | Count |
|-------|-------|
| ALIGNED | 27 |
| DRIFT | 1 |
| VERSION-GAP | 6 |
| UNVERIFIABLE | 4 |

**Top DRIFT findings** (severity-ranked, highest first):

1. **Medium — DRIFT #12:** `backfillStatus` and `backfillBatch` reconstruct `{ numItems, cursor }` instead of accepting a `paginationOpts` argument validated by `paginationOptsValidator` and passing it through. The loop still walks the table correctly; what is lost is `maximumRowsRead` / `maximumBytesRead` (the documented way to bound a page by bytes rather than row count), `endCursor`, and the client-managed `id`. The project's own Convex guidelines state: "Do not reconstruct it, because optional native behavior would be lost."
2. **UNVERIFIABLE #18 (risk: Medium):** the entropy provenance claimed in the code comment and migration doc ("seeded ChaCha12, replayed on retry") is not stated anywhere in the docs. Permission to call `getRandomValues` in a mutation is proven by the recorded dev run; the *quality* and cross-execution uniqueness of the seed are not.
3. **UNVERIFIABLE #29 (risk: Medium):** no uniqueness check exists on `orderAccess.byAccessToken`. The whole 256-bit argument rests on each execution receiving a fresh seed — undocumented. Within the recorded batch, 5/5 tokens were unique.
4. **UNVERIFIABLE #15/#16 (risk: Low):** the "exactly one `.paginate()` per execution" rule and "pagination inside a mutation" are platform behaviours confirmed only by `convex-test` 0.0.62 and the recorded run, not by the docs. The implementation is on the conservative side of both.

## Recommendations (advisory)

1. **DRIFT #12 (Medium)** — give both backfill functions a single `paginationOpts: paginationOptsValidator` argument and pass it unchanged to `.paginate()`; keep `dryRun`/`limit` as separate args if the CLI ergonomics matter. This restores byte-budget bounding (`maximumRowsRead` / `maximumBytesRead`) for a table whose `items[]` arrays will grow, and removes a documented-guideline deviation before the index/table gets large.
2. **VERSION-GAP #9 (Medium)** — decide the `byBusinessIdStatus` deploy path against 1.47.0, not 1.46.0: on the latest CLI the plain index triggers a confirmation prompt on a large table. Either accept the prompt, pass `--skip-large-indexes-check` in CI, or stage the index and unstage it in T3 before querying. Record the choice in `docs/migrations/order-protocol-t2-backfill.md`.
3. **UNVERIFIABLE #29 (Medium risk)** — add a `byAccessToken` collision check (mirroring the reference check) or a one-time uniqueness assertion in the backfill tests across two batches. Cheap insurance against a seed-provenance assumption that no doc confirms.
4. **UNVERIFIABLE #18 (Medium risk)** — keep the empirical note in the migration doc, but phrase the entropy claim as observed behaviour of the deployment rather than a documented guarantee; the current text is stronger than any official source supports.
5. **VERSION-GAP #34 (Low)** — Vitest 4.1.12 → 5.0.5; the project's Convex testing guideline asks for the latest test packages. Treat as a separate dependency-bump ticket, not part of #76.
6. **VERSION-GAP #35–#38 (Low)** — Next.js, React, Tailwind, TypeScript are each behind latest stable; none affects an API this change uses. Out of scope for this slice.
7. **Drift-free items need no action:** the additive-optional expand, the widened status union, the six side tables, the omission-not-`undefined` price policy, `internalMutation` + `npx convex run`, `btoa`, `Date.now()`, and the 50-row batch sizing are all confirmed by current docs.

## Notes

- **Doc conflict on the Convex release channel.** `node_modules/convex/CHANGELOG.md` (installed 1.46.0) still labels the `.optional()` validator addition as "Unreleased", while the upstream `main` CHANGELOG publishes 1.46.0 and 1.47.0 and carries 1.48.0 as unreleased. npm `latest` is 1.47.0. Findings use the upstream CHANGELOG and npm as the release-of-record; the installed tree is 1.46.0.
- **1.46.0 additions with no action required.** `.optional()` was added to every validator (`v.string().optional()` ≡ `v.optional(v.string())`); the artifact uses `v.optional(...)`, which remains the form shown in the schemas doc. No drift, but the two forms are now equivalent and a future cleanup could standardise.
- **`.staged()` (validator) vs `staged: true` (index).** 1.47.0 adds `defineTable(...).staged({...})` for background schema revalidation. The artifact uses neither; the contract step (making `items[]` required) is the natural place for `.staged()`.
- **Empirical evidence is not a doc URL.** `docs/migrations/order-protocol-t2-backfill.md` records a real dev run (5 orders → 5 `orderAccess`, 43-char tokens, 6-char references, idempotent rerun, no `subtotal`/`expiresAt`, no `unitPrice`). That run is the strongest evidence available for findings #16 and #18, but per the alignment taxonomy it does not make a docs claim verifiable.
- **Out of scope (not alignment findings).**
  - Index naming (`byBusinessIdStatus` vs the `by_field1_and_field2` convention in `convex/_generated/ai/guidelines.md` L46) — the protocol mandates the camelCase names; this is a project-convention question for code review, not a library-doc contradiction.
  - `formatPrice` imported from `components/profile/` into `app/owner/` — module-boundary/standards question.
  - Three lint warnings introduced (complexity 18 on `projectOrderRow`, 15 on `backfillBatch`, `max-lines` in `orders.test.ts`) — quality, not alignment.
  - `screens/SPEC.md` §7.1 and the `menu-panel*.tsx` aria-label changes are pre-existing/approved and contain no new library API surface.
  - `convex/businesses/adminDeletion.ts` does not yet cascade the six new side tables — already recorded as a follow-up in the migration doc.
- **Not checked / silence is not a finding.** The changed UI files import no `next/*` module, so the Next.js 16 surface is limited to the `'use client'` directive; no React 19 API (actions, `useActionState`, `use`) is used.
