# Alignment Report — Issue #16 (B6b: Admin overview + owners + audit page + categories CRUD + CSV export)

> Post-implementation alignment check. Report-only: no implementation file was modified.
> Every technology claim in the finished change is classified ALIGNED / DRIFT / VERSION-GAP / UNVERIFIABLE
> against the **current official documentation** of the installed libraries.

## Scope

- **Artifact type:** code (35 changed files, 3816 insertions, on `fix/issue-16-b6b-admin-overview-owners-audit-page-categories-crud-csv-export`)
- **Artifact location:** `convex/{schema,adminQueries,adminProjections,adminExports,adminExportPolicy,categories,categoryAdminPolicy,auditLogs,auditProjections}.ts`, `app/admin/**`, `scripts/admin-*`, `scripts/card-muted-contrast.test.ts`
- **Reviewed:** 2026-10-17
- **Focus:** all libraries in the surface (Convex 1.46.0, Next.js 16.3.5, Tailwind CSS 4.1.11, RFC 4180, WCAG 2.2 AA)

## Stack detected

Versions read from `package.json` (declared) and `pnpm-lock.yaml` (resolved). **The lockfile wins** — it is what runs.

| Library / technology | Installed version | Source of truth (manifest) | Docs target |
|----------------------|-------------------|----------------------------|-------------|
| `next` | **16.3.5** (pinned) | `package.json` / `pnpm-lock.yaml` | latest stable (16.4.2) |
| `convex` | **1.46.0** (declared `^1.31.2`) | `pnpm-lock.yaml` | latest stable (1.47.0) |
| `react` | **19.3.0** | `pnpm-lock.yaml` | latest stable (19.3.1) |
| `react-dom` | **19.3.0** | `pnpm-lock.yaml` | latest stable (19.3.1) |
| `tailwindcss` | **4.1.11** (declared `^4`) | `pnpm-lock.yaml` | latest stable (4.3.3) |
| `typescript` | **5.8.3** (declared `^5`) | `pnpm-lock.yaml` | latest stable (7.0.2) |
| `eslint` | **10.12.0** (declared `^10.10.0`) | `pnpm-lock.yaml` | latest stable (10.13.0) |
| `@clerk/nextjs` | **7.9.4** (declared `^7.9.4`) | `pnpm-lock.yaml` | latest stable (7.9.17) |
| `zod` | **4.6.7** (+ `3.25.76` transitive) | `pnpm-lock.yaml` | latest stable (4.6.7) |
| `node` | `engines: ">=22.6"` | `package.json` | — |
| RFC 4180 | 2005 (Informational) | rfc-editor.org | current |
| WCAG 2.2 AA (SC 1.4.3) | 2.2 | w3.org | current |

Out of scope (declared in `package.json` but **not imported by any changed file**): `recharts`, `@tanstack/react-table`, `@dnd-kit/*`, `zod`. Owners/audit tables are hand-rolled HTML `<table>` elements; the analytics stub renders plain cards.

## Sources consulted

| Source | URL | Covers version |
|--------|-----|----------------|
| Convex — Indexes | https://docs.convex.dev/database/reading-data/indexes | latest |
| Convex — Paginated Queries | https://docs.convex.dev/database/pagination | latest |
| Convex — `server.Query` (async iterator, `.collect()` warning, `.unique()`) | https://docs.convex.dev/api/interfaces/server.Query | latest |
| Convex — Limits | https://docs.convex.dev/production/state/limits | latest |
| Convex — Error Handling | https://docs.convex.dev/functions/error-handling | latest |
| Convex — Data Types (indexing `undefined` fields) | https://docs.convex.dev/database/types | latest |
| Convex — Reading Data | https://docs.convex.dev/database/reading-data | latest |
| Convex — Mutations | https://docs.convex.dev/functions/mutation-functions | latest |
| Convex — Auth in Functions | https://docs.convex.dev/auth/functions-auth | latest |
| Convex — Next.js Server Rendering | https://docs.convex.dev/client/nextjs/app-router/server-rendering | latest |
| Next.js — Server Actions (guide) | https://nextjs.org/docs/app/guides/server-actions | latest |
| Next.js 16 (installed) — `serverActions` config | `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` | 16.3.5 |
| Next.js 16 (installed) — `use server` directive | `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md` | 16.3.5 |
| Next.js — `proxy.js` file convention (middleware deprecation) | https://nextjs.org/docs/app/api-reference/file-conventions/proxy | latest |
| Tailwind CSS v4 — Theme variables | https://tailwindcss.com/docs/theme | latest |
| RFC 4180 (CSV) | https://www.rfc-editor.org/rfc/rfc4180 | 2005 |
| W3C — WCAG 2.2 SC 1.4.3 Contrast (Minimum) | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html | 2.2 |
| npm registry (latest dist-tags) | https://registry.npmjs.org/-/package/<pkg>/dist-tags | — |

Local project sources read: `package.json`, `pnpm-lock.yaml`, `next.config.ts`, `middleware.ts`, `app/globals.css`, `convex/schema.ts`, `convex/authz.ts`, `convex/adminQueries.ts`, `convex/adminProjections.ts`, `convex/adminExports.ts`, `convex/adminExportPolicy.ts`, `convex/categories.ts`, `convex/categoryAdminPolicy.ts`, `convex/auditLogs.ts`, `convex/auditProjections.ts`, `convex/businessTypes.ts`, `app/admin/**`, `scripts/admin-export-policy.test.ts`, `scripts/card-muted-contrast.test.ts`.

## Findings

| # | Label | Severity | Artifact location | Claim / usage | What the docs say | Source |
|---|-------|----------|-------------------|---------------|-------------------|--------|
| 1 | ALIGNED | — | `convex/adminQueries.ts:66-84`, `convex/auditLogs.ts:95-107` | Index-range query built with `withIndex(...)` + `q.gte()`/`q.lt()` | Documented range form: "0 or more equality expressions… a lower bound… an upper bound… You must step through fields in index order." | https://docs.convex.dev/database/reading-data/indexes |
| 2 | ALIGNED | — | `convex/adminQueries.ts:32-39` | `countRows()` streams a query's async iterator (no `.collect()`) | Docs show exactly this: `for await (const task of ctx.db.query("tasks"))` — "Async iteration for processing large result sets… without loading all into memory" | https://docs.convex.dev/api/interfaces/server.Query |
| 3 | ALIGNED | — | `convex/adminQueries.ts:64` | `countRows(ctx.db.query('businesses'))` — full-table scan streamed, never materialized | Explicitly documented pattern; but "Documents scanned: 32,000" still applies | https://docs.convex.dev/production/state/limits |
| 4 | ALIGNED | — | `convex/auditProjections.ts:142-161` → `convex/auditLogs.ts:95-107` | Audit date band applied to `byCreatedAt` **on the index**, not `.filter()` | "`.filter()` doesn't affect which documents are scanned"; ranges belong on the index | https://docs.convex.dev/database/reading-data/indexes |
| 5 | ALIGNED | — | `convex/auditLogs.ts:111`, `convex/adminQueries.ts:115` | `.paginate({ ...opts, maximumRowsRead: N })` | "To limit how much is read from the database, set `maximumBytesRead` and/or `maximumRowsRead` in `PaginationOptions`." | https://docs.convex.dev/database/pagination |
| 6 | ALIGNED | — | `convex/adminQueries.ts:105,115` | `paginationOptsValidator` from `"convex/server"`; result read as `{ page, isDone, continueCursor }` | Documented arg validator and `PaginationResult` shape | https://docs.convex.dev/database/pagination |
| 7 | ALIGNED | — | `convex/adminExports.ts:44-47` | Index-less `.order('asc').paginate(...)` | `.paginate()` is an allowed consumer when no range expression is used | https://docs.convex.dev/database/reading-data/indexes |
| 8 | ALIGNED | — | every handler in `adminQueries.ts` / `adminExports.ts` / `categories.ts` | `await requireSuperAdmin(ctx)` **first**, before any read/write | `ctx.auth.getUserIdentity()` + throw is the documented in-function authz pattern | https://docs.convex.dev/auth/functions-auth |
| 9 | ALIGNED | — | `convex/authz.ts:27-47` | `requireSuperAdmin` throws on missing identity / wrong role / absent env whitelist (fails closed) | `if (identity === null) { throw new Error("Unauthenticated…") }` | https://docs.convex.dev/auth/functions-auth |
| 10 | ALIGNED | — | `convex/categories.ts:237,250,258,305,366,410`; `adminProjections.ts:48,52,93`; `adminExportPolicy.ts:50` | Application errors thrown as `ConvexError` with a client-safe message | "Application Errors: …your code throws a `ConvexError`." Prod redacts the message but "Server application errors will still include their custom `data`." | https://docs.convex.dev/functions/error-handling |
| 11 | ALIGNED | — | `convex/categories.ts:245-251` | Slug uniqueness checked with `bySlug` + `.unique()` before insert (Convex cannot declare unique indexes) | "`unique()` — Return the only result, and throw if there is more than one result." | https://docs.convex.dev/api/interfaces/server.Query |
| 12 | ALIGNED | — | `convex/categories.ts:161-174,364` | Reference count via `byCategoryId` + `.take(cap+1)` — bounded read, no scan | "If you use an index without a range expression, you should always use one of: `.first()`, `.unique()`, `.take(n)`, `.paginate(ops)`." | https://docs.convex.dev/database/reading-data/indexes |
| 13 | ALIGNED | — | `convex/categories.ts:270-279,327-337,374-385,419-433` | Audit row inserted in the **same transaction** as the write; the `deleteCategory` snapshot is inserted before the target is deleted | Mutations are transactional; the hard-delete snapshot-before-delete convention is B6a's | https://docs.convex.dev/functions/mutation-functions |
| 14 | ALIGNED | — | `convex/adminExports.ts:79-88` | Exactly one `recordBusinessesCsvExport` audit write, guarded, actor from `requireSuperAdmin` | Guard-first pattern; actor never a client value | https://docs.convex.dev/auth/functions-auth |
| 15 | ALIGNED | — | `app/admin/export-actions.ts:1` | File-level `'use server'` — the repo's first Server Action | "The `use server` directive designates a function or file to be executed on the server side." | `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md` |
| 16 | ALIGNED | — | `app/admin/export-actions.ts:47-90` | Re-derives the Clerk token server-side, then calls guarded Convex fns | "A Server Action runs as a POST request against the page that invokes it… Treat every action as an untrusted entry point." | https://nextjs.org/docs/app/guides/server-actions |
| 17 | ALIGNED | — | `app/admin/export-actions.ts:82-87`; `directory-route.tsx:89-116` | Returns serializable `{ ok, csv, fileName, rowCount }`; client builds a Blob and clicks an `<a download>` | "An action that does none of the above carries only its return value, and the current route is not re-rendered." | https://nextjs.org/docs/app/guides/server-actions |
| 18 | ALIGNED | — | `app/admin/export-actions.ts:28-31` | Comment: `bodySizeLimit` (1 MB) is a **request** cap, not a response cap | "By default, the maximum size of the **request body** sent to a Server Action is 1MB." | `.../05-config/01-next-config-js/serverActions.md` |
| 19 | ALIGNED | — | `next.config.ts` (no `serverActions` key) | No `experimental.serverActions` configured | "Server Actions became a stable feature in Next.js 14, and are enabled by default." | `.../05-config/01-next-config-js/serverActions.md` |
| 20 | ALIGNED | — | `app/admin/export-actions.ts:64-73` (single sequential loop, no client fan-out) | Export pages awaited one at a time | "Next.js dispatches Server Actions one at a time per client… do not rely on `Promise.all` to parallelize Server Actions from the client." | https://nextjs.org/docs/app/guides/server-actions |
| 21 | ALIGNED | — | `convex/adminExportPolicy.ts:66-71` | Quote a field when it contains `"`, `,`, CR or LF; double embedded quotes | RFC 4180 §2.6 "Fields containing line breaks (CRLF), double quotes, and commas should be enclosed in double-quotes"; §2.7 "a double-quote appearing inside a field must be escaped by preceding it with another double quote." | https://www.rfc-editor.org/rfc/rfc4180 |
| 22 | ALIGNED | — | `convex/adminExportPolicy.ts:74-91` | CRLF record separators + a trailing CRLF | §2.1 "Each record is located on a separate line, delimited by a line break (CRLF)"; ABNF `file = [header CRLF] record *(CRLF record) [CRLF]` | https://www.rfc-editor.org/rfc/rfc4180 |
| 23 | ALIGNED | — | `convex/adminExportPolicy.ts:20-21`, `76-88` | Fixed 8-column header, every record has the same field count | §2.3 (optional header with the same format); §2.4 "Each line should contain the same number of fields throughout the file." | https://www.rfc-editor.org/rfc/rfc4180 |
| 24 | ALIGNED | — | `convex/adminExportPolicy.ts:55-60` | Dates as UTC ISO 8601 (`new Date(ts).toISOString()`) | `Date.prototype.toISOString` returns the UTC ISO 8601 form (ECMA-262) | https://tc39.es/ecma262/#sec-date.prototype.toisostring |
| 25 | ALIGNED | — | `convex/adminProjections.ts:31-38`; `auditProjections.ts:114-133` | Local-midnight window via the `Date` constructor (`new Date(y, m, d ± offset)`) | The multi-argument `Date` constructor resolves the local calendar day and rolls DST correctly | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/Date |
| 26 | ALIGNED | — | `app/admin/audit/audit-route.tsx:86-99`; `audit/page.tsx:101-108` | `from` inclusive / `through` exclusive-next-day → `.gte(from).lt(before)` | `q.gte` / `q.lt` are inclusive / exclusive bounds; the half-open interval is the documented way to include a whole day | https://docs.convex.dev/database/reading-data/indexes |
| 27 | ALIGNED | — | `scripts/card-muted-contrast.test.ts:100-121` | `--card-muted` vs card must clear 4.5:1 in both light and dark | WCAG 2.2 SC 1.4.3: "a contrast ratio of at least 4.5:1" for normal text (3:1 large) | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html |
| 28 | ALIGNED | — | `app/globals.css:115-201`; all changed `app/admin/**` `className`s | Custom utilities used: `text-card-muted`, `bg-card`, `text-card-foreground`, `rounded-card`, `rounded-control`, `rounded-pill`, `bg-surface`, `text-surface-foreground`, `font-display`, `bg-secondary`, `text-destructive`, `border-border`, `ring-ring` | "Theme variables… influence which utility classes exist"; `--color-*`, `--radius-*`, `--font-*` namespaces generate the matching utilities. All the above tokens exist in `@theme inline`. | https://tailwindcss.com/docs/theme |
| 29 | ALIGNED | — | `app/admin/owners/owners-table.tsx:73-95`; `admin-overview-cards.tsx:60-63` | Arbitrary values `p-[1.5rem]`, `rounded-[1rem]`, `font-[600]`, `text-[0.6875rem]`, `tracking-[0.05em]`, `tabular-nums` | Arbitrary values are documented Tailwind syntax (`font-[<value>]`, `p-[<value>]`, …) | https://tailwindcss.com/docs/theme |
| 30 | ALIGNED | — | `convex/schema.ts:83` | New `bySubmittedAt: ['submittedAt']` index; the claim that `byStatusSubmittedAt` "requires a status equality first, so it cannot bound the month across statuses" | Range bounds "must follow the equality expressions and compare the **next** field." On `['status','submittedAt']` a `submittedAt` bound requires a preceding `status` equality, so a `submittedAt`-only month range is impossible on it. A single-field index is the documented way to range on one field. | https://docs.convex.dev/database/reading-data/indexes |
| 31 | ALIGNED | — | `convex/adminExports.ts:17-23`; `app/admin/export-actions.ts:62-63` | Export pages are separate queries → "NO snapshot isolation across pages" | Each function invocation is its own transaction; Convex docs make no cross-invocation snapshot promise for paged reads. The stated limitation is honest, not claimed away. | https://docs.convex.dev/functions/mutation-functions |
| 32 | ALIGNED | — | `convex/adminQueries.ts:139-142` | Full-table counts on `orders`/`bookings`/`quoteRequests`; comment states the per-function limits apply | "Documents scanned: 32,000 · Index ranges read: 4,096 · Data read: 16 MiB" — per function | https://docs.convex.dev/production/state/limits |
| 33 | **DRIFT** | **Low** | `convex/schema.ts:81-82` | "Rows without a `submittedAt` are **absent from this index**." | Contradicted. Convex indexes every document; an unset indexed field is stored/ordered as `undefined`: `withIndex("by_a", q => q.eq("a", undefined))` "matches documents that do not have the field" and "`undefined < null < all other values`". Undated rows **are** in `bySubmittedAt` (sorted first) — they are excluded by the `.gte(monthStart)` lower bound, not by absence. | https://docs.convex.dev/database/types |
| 34 | **DRIFT** | **Low** | `convex/adminQueries.ts:53` | "(undated rows are absent from the index)" | Same contradiction as #33. Behaviour is nonetheless correct (no behavioural impact). | https://docs.convex.dev/database/types |
| 35 | **DRIFT** | **Low** | `convex/adminQueries.ts:50-51` | "`byStatusVerifiedVerifiedAt` (**the index holds only verified rows**, so the range is bounded and never scans)" | An index holds **all** documents of its table ("Indexes… organize your documents"); it is not filtered to verified rows. The range is bounded by the `.eq('status',…).eq('verification.isVerified', true)` equalities, not by the index containing only matching rows. The usage itself is correct and bounded. | https://docs.convex.dev/database/reading-data/indexes |
| 36 | VERSION-GAP | — | `package.json` / `pnpm-lock.yaml` | `next` **16.3.5** installed | latest stable **16.4.2** | https://registry.npmjs.org/-/package/next/dist-tags |
| 37 | VERSION-GAP | — | `package.json` / `pnpm-lock.yaml` | `convex` **1.46.0** installed (declared `^1.31.2`) | latest stable **1.47.0** | https://registry.npmjs.org/-/package/convex/dist-tags |
| 38 | VERSION-GAP | — | `pnpm-lock.yaml` | `react` / `react-dom` **19.3.0** installed | latest stable **19.3.1** | https://registry.npmjs.org/-/package/react/dist-tags |
| 39 | VERSION-GAP | — | `pnpm-lock.yaml` | `tailwindcss` **4.1.11** installed | latest stable **4.3.3** | https://registry.npmjs.org/-/package/tailwindcss/dist-tags |
| 40 | VERSION-GAP | — | `pnpm-lock.yaml` | `typescript` **5.8.3** installed | latest stable **7.0.2** (a major channel: 6/7 line) | https://registry.npmjs.org/-/package/typescript/dist-tags |
| 41 | VERSION-GAP | — | `pnpm-lock.yaml` | `eslint` **10.12.0** installed | latest stable **10.13.0** | https://registry.npmjs.org/-/package/eslint/dist-tags |
| 42 | VERSION-GAP | — | `pnpm-lock.yaml` | `@clerk/nextjs` **7.9.4** installed | latest stable **7.9.17** | https://registry.npmjs.org/-/package/@clerk/nextjs/dist-tags |
| 43 | VERSION-GAP | — | `middleware.ts` (root; **untouched by this change**) | Uses the `middleware` file convention under Next **16.3.5** | "The `middleware` file convention is deprecated and has been renamed to `proxy`." Valid in the installed major, superseded by `proxy.ts`. Pre-existing; #16 did not touch it (build emits the deprecation notice). | https://nextjs.org/docs/app/api-reference/file-conventions/proxy |
| 44 | UNVERIFIABLE | — | `app/admin/export-actions.ts:26`; `directory-route.tsx:86-87` | "a Server Action **cannot set `Content-Disposition`**" | Official Next docs describe the **Route Handler** download idiom and state action returns are serialized, but nowhere state that a Server Action cannot set `Content-Disposition`. No doc contradicts it either; the chosen return-value + Blob pattern is compatible with the documented model. Searched: installed `server-actions.md` / `use-server.md`, nextjs.org server-actions guide, route-handlers doc. | — |
| 45 | UNVERIFIABLE | — | `convex/adminExportPolicy.ts:55-60`; `scripts/admin-export-policy.test.ts:116-130` | Missing `submittedAt` renders **blank** (not `null`, not epoch) | RFC 4180 does not define missing-value semantics; a `v.optional(v.number())` field has no CSV representation rule. Blank is a project contract, pinned by test. | — |
| 46 | UNVERIFIABLE | — | `admin-overview-cards.tsx:122`; `audit/page.tsx:101` | Local-month/day window computed from the client clock | No official doc covers app-specific SSR-vs-hydration timezone divergence. No visible mismatch occurs (initial render is a skeleton); recorded as unverifiable rather than asserted. | — |

Itemized above: every DRIFT (#33–#35) and every VERSION-GAP (#36–#43). ALIGNED items are itemized where they are load-bearing claims; the aggregate count is below.

## Summary

| Label | Count |
|-------|-------|
| ALIGNED | 32 |
| DRIFT | 3 |
| VERSION-GAP | 8 |
| UNVERIFIABLE | 3 |

**Top DRIFT findings:** all three are severity **Low** (documentation/comment accuracy; **no behavioural impact**).

1. `convex/adminQueries.ts:50-51` — "the index holds only verified rows" (Low).
2. `convex/schema.ts:81-82` — "Rows without a `submittedAt` are absent from this index" (Low).
3. `convex/adminQueries.ts:53` — "(undated rows are absent from the index)" (Low).

No Critical, High, or Medium DRIFT was found.

## Recommendations (advisory)

Ordered by severity — the work is well aligned; these are accuracy/currency items, not defects.

1. **Low — fix the three index-semantics comments** (#33–#35). ✅ **Done — applied in the post-review remediation (see the Notes entry, 2026-10-17): the three comments were corrected in `convex/schema.ts` and `convex/adminQueries.ts`. The DRIFT table and counts above preserve the original scan.** Original suggested wording (historical):
   - `schema.ts`: "Rows without a `submittedAt` sit in this index as `undefined` (ordering `undefined < null < all other values`) and are excluded by the range's lower bound, not by absence."
   - `adminQueries.ts`: "`byStatusVerifiedVerifiedAt` is bounded by the `status` + `isVerified` equalities; the index itself holds every business row."
   - `adminQueries.ts`: drop "undated rows are absent from the index".
   Documentation-only; behaviour already correct.
2. **Low — `middleware.ts` → `proxy.ts`** (#43). Outside this change's scope, but the Next 16 deprecation will eventually become a removal; rename when convenient (the build already warns).
3. **Currency — dependency lag** (#36–#42). Only `zod` is at latest. The largest gaps are `typescript` 5.8.3 → 7.0.2 (a major channel) and `tailwindcss` 4.1.11 → 4.3.3. Nothing in this change depends on APIs that changed across those gaps; schedule upgrades separately, not inside this PR.
4. **Optional — Route Handler alternative for the CSV download** (advisory only). If a future requirement needs `Content-Disposition`/streaming, the documented path is a Route Handler returning `new Response(csv, { headers: … })`. The current Server Action + Blob is a correct, issue-compliant choice and needs no change.
5. **Scale follow-up — not a doc drift.** `totalBusinesses` (1 full scan) and `analyticsCounts` (3 full scans **in one function**, sharing one 32,000-doc / 16 MiB budget) are the first reads to breach limits. The code already returns errors rather than estimates. The documented scale answer is the Aggregate component (https://docs.convex.dev/database/reading-data).

## Notes

- **Behavioural verification of the three DRIFTs.** They are comments only. `submissionsThisMonth` counts `bySubmittedAt` with `.gte(monthStart)`: an `undefined` `submittedAt` orders before any number, so it is excluded by the lower bound — the same correct result the comment's (incorrect) rationale predicts. `verifiedActive` uses precise `.eq` equalities, so it is bounded regardless of what else is in the index. No count is wrong.
- **Snapshot isolation.** Convex docs do not use the term "snapshot isolation" for paginated reads; they neither promise nor deny it across separate query invocations. The change's "NO snapshot isolation" statement is consistent with the per-function transaction model and is not contradicted. Recorded as ALIGNED with this caveat rather than invented as a DRIFT.
- **`middleware.ts` is not part of this change.** It appears in the report only because the task asked about the build's middleware→proxy deprecation notice. `git status` confirms it is untouched.
- **Pre-existing conditions, not introduced by #16** (carried from the validation node and re-confirmed here): `tsconfig.json` duplicate `allowImportingTsExtensions` key; `convex` resolved `1.46.0` vs declared floor `^1.31.2`; the middleware deprecation notice. None is caused by this change.
- **Research blocker cleared.** `tasks/issue-16-research.md` §2.1/§5 flagged `convex/_generated/ai/guidelines.md` as **absent** and required `npx convex ai-files install` first. This change **adds** that file (286 lines) plus `ai-files.state.json`; the blocker is resolved.
- **Validation evidence** was taken from the validate node (`pnpm test` 441/441 exit 0 ×2; `pnpm lint` exit 0 with 5 pre-existing complexity warnings; `pnpm build` exit 0, 18/18 static pages, all 9 `/admin/*` routes). The alignment pass is report-only and did **not** re-run the suite or modify any source file.
- **Source conflict:** none found. Convex's reading-data ordering table (`undefined < null < …`) and the Data Types index guidance agree with each other and both contradict findings #33/#34; no authoritative source supports the "absent from the index" wording.
- **Scope exclusion:** `recharts`, `@tanstack/react-table`, `@dnd-kit/*`, `zod` are declared dependencies but are imported by no changed file, so no alignment finding is recorded for them.
- **Post-review remediation (2026-10-17):** The three Low index-semantics comment findings (#33–#35) were corrected in `convex/schema.ts` and `convex/adminQueries.ts`. The DRIFT table and counts above preserve the original alignment scan; they are not unresolved current comments.
