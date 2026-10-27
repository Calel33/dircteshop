# Alignment Report — Issue #84 · Order protocol T10 (measurement, hardening, runbook)

> Mandatory output shape for the alignment skill. Fill every section. Delete nothing; write "none" where empty.
> Write to `docs/alignment/<slug>.md`.

## Scope

- **Artifact type:** code (plus the runbook and audit documents shipped with it)
- **Artifact location:**
  - New code/tests: `convex/orderFlags.ts`, `convex/metricCounter.ts`, `convex/orderMetrics.ts`, `convex/orderRetention.ts`, `convex/orderFlags.test.ts`, `convex/orderMetrics.test.ts`, `convex/orderRetention.test.ts`, `convex/businesses/adminDeletion.test.ts`
  - New docs: `docs/order-runbook.md`, `docs/validation/issue-84-a11y-audit.md`, `tasks/issue-84-loadtest-evidence.md`
  - Modified: `convex/schema.ts`, `convex/orderCommitPolicy.ts`, `convex/businesses/adminDeletion.ts`, `convex/crons.ts`, `convex/devProof.ts`, `convex/orderExpiry.test.ts`, `scripts/admin-delete-policy.test.ts`, `scripts/order-concurrency-proof.ts`, `components/order/basket-panel.tsx`, `components/order/receipt.tsx`, `app/owner/business/[id]/editor-section-body.tsx`, `app/owner/business/[id]/orders-panel.tsx`, `app/owner/business/[id]/orders-panel-dialogs.tsx`, `app/owner/business/[id]/orders-panel-row.tsx`, `convex/_generated/api.d.ts`
  - Branch: `fix/issue-84-order-protocol-t10-measurement-hardening-runbook` (working tree at `d9a52f1` + uncommitted issue work)
- **Reviewed:** 2026-10-27
- **Focus:** all libraries in the surface — Convex (schema, indexes, functions, crons, codegen), React 19 / Next 16, Tailwind CSS v4 tokens, Vitest + `convex-test`
- **Not re-reviewed:** the pre-existing protocol layer this issue builds on (`placeOrder`, `orderThrottle`, `orderBlocks`), except where the change modifies it.

## Stack detected

| Library / technology | Installed version | Source of truth (manifest) | Docs target |
|----------------------|-------------------|----------------------------|-------------|
| `convex` | 1.46.0 | `node_modules/convex/package.json`; `package.json` declares `^1.31.2` | latest stable (1.48.0) |
| `convex-test` | 0.0.62 | `node_modules/convex-test/package.json`; manifest `^0.0.62` | latest stable (0.0.65) |
| `next` | 16.3.5 | `node_modules/next/package.json`; manifest pinned `16.3.5` | latest stable (16.4.3) |
| `react` / `react-dom` | 19.3.0 | `node_modules/react/package.json`; manifest `^19.2.3` | latest stable (19.3.1) |
| `vitest` | 4.1.12 | `node_modules/vitest/package.json`; manifest `^4.1.12` | latest stable (5.0.5) |
| `tailwindcss` | 4.1.11 | `node_modules/tailwindcss/package.json`; manifest `^4` | latest stable (4.3.3) |
| `typescript` | 5.8.3 | `node_modules/typescript/package.json`; manifest `^5` | 7.0.2 (no claim in this change depends on it) |
| Node.js | `>=22.6` declared (`package.json` `engines`); evidence run used v24.18.0 | `package.json` / `tasks/issue-84-loadtest-evidence.md` | — |
| Convex AI guidelines | targets `^1.44.0` | `convex/_generated/ai/guidelines.md:3` | — |
| `@reticlehq/next`, `@reticlehq/react` | 3.7.0 | `package.json` `devDependencies` | (verification tool; no API claim in the artifact) |

## Sources consulted

| Source | URL | Covers version |
|--------|-----|----------------|
| Convex — Mutation functions (Transactions, Limits) | https://docs.convex.dev/functions/mutation-functions | current (fetched 2026-10-27) |
| Convex — Query functions (Caching & reactivity, determinism) | https://docs.convex.dev/functions/query-functions | current |
| Convex — Error Handling | https://docs.convex.dev/functions/error-handling/ | current |
| Convex — Argument and Return Value Validation | https://docs.convex.dev/functions/validation | current |
| Convex — Indexes (definition, sorting, staged, limits) | https://docs.convex.dev/database/indexes | current |
| Convex — OCC and Atomicity | https://docs.convex.dev/database/advanced/occ | current |
| Convex — Cron Jobs (schedules, top-of-hour guidance) | https://docs.convex.dev/scheduling/cron-jobs | current |
| Convex — Limits (transaction read/write limits) | https://docs.convex.dev/production/state/limits | current |
| Convex changelog (1.46.0 → 1.49.0-unreleased) | https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md | 1.46.0–1.49.0 |
| React — `Component` (error boundaries) | https://react.dev/reference/react/Component | React 19 |
| Tailwind CSS — Theme variables (`@theme`) | https://tailwindcss.com/docs/theme | v4 |
| MDN — `<label>` (`for` attribute) | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/label | living standard |
| Convex AI guidelines (repo authority for Convex usage) | `convex/_generated/ai/guidelines.md` (repo file; not a URL) | targets `^1.44.0` |
| Installed API surface (type truth) | `node_modules/convex/dist/esm-types/server/index.d.ts:73`, `.../api.d.ts:388` | 1.46.0 |
| npm registry dist-tags | https://registry.npmjs.org/convex · `/next` · `/react` · `/vitest` · `/tailwindcss` · `/convex-test` | fetched 2026-10-27 |
| Project theme tokens | `app/globals.css:194-219, 240-272` | Tailwind v4 `@theme` |

Cached fetches reused from `.firecrawl/`: `alignment-convex-mutation-functions.md`, `docs.convex.dev-database-advanced-occ.md.md`, `react.dev-reference-react-Component.md`. `tasks/issue-84-research.md` supplied the original Convex transaction/index evidence and was re-verified against the live pages above.

## Findings

| # | Label | Severity | Artifact location | Claim / usage | What the docs say | Source |
|---|-------|----------|-------------------|---------------|-------------------|--------|
| 1 | ALIGNED | — | `convex/crons.ts:19-24` | `crons.daily(name, { hourUTC, minuteUTC }, internal.fn, { dryRun: false })` | `crons.daily()` is a documented schedule form; extra arguments after the function reference are passed to it | https://docs.convex.dev/scheduling/cron-jobs |
| 2 | ALIGNED | — | `convex/crons.ts:3` | Cron target is an `internalMutation`, referenced through `internal` from `./_generated/api` | Documents require a public/internal function reference, not a function value; `internal.*` is the documented reference form | https://docs.convex.dev/scheduling/cron-jobs |
| 3 | ALIGNED | — | `convex/orderRetention.ts` (whole job) | No overlap guard needed; one pass per day | "At most one run of each cron job can be executing at any moment." | https://docs.convex.dev/scheduling/cron-jobs |
| 4 | ALIGNED | — | `convex/schema.ts` (new `byBusinessIdCreatedAt` on `orderEvents`) | Plain (non-staged) index, queried in the same deploy | "You can feel free to query an index in the same deploy that defines it." Staged indexes are the large-table alternative and are unusable until enabled | https://docs.convex.dev/database/indexes |
| 5 | ALIGNED | — | `convex/schema.ts` (`orderFlags`, `orderMetricCounters`, 3 new indexes) | Two new tables, 3 new indexes | Max 32 indexes/table and 16 fields/index; `_creationTime` is auto-appended | https://docs.convex.dev/database/indexes · https://docs.convex.dev/production/state/limits |
| 6 | ALIGNED | — | `convex/orderRetention.ts:167` | `ctx.db.query('orders').take(RETENTION_BATCH)` with no index → `by_creation_time` | A plain scan uses `by_creation_time`; index queries append `_creationTime` as tie-breaker | https://docs.convex.dev/database/indexes |
| 7 | ALIGNED | — | `convex/orderRetention.ts:167` | Full-index read bounded by `.take(50)` | "If you use an index without a range expression, you should always use one of … `.take(n)`" | https://docs.convex.dev/database/indexes |
| 8 | ALIGNED | — | `convex/orderMetrics.ts:539-560` | `.withIndex(...).eq(...).gte(...).lte(...)` in declared field order | Index range expression = 0+ `.eq`, then optional lower bound, then optional upper bound, stepping through fields in index order | https://docs.convex.dev/database/indexes |
| 9 | ALIGNED | — | `convex/orderMetrics.ts:549,559,567` | `.order('desc')` on index reads | `.order("asc"\|"desc")` selects direction; equal-key rows are not re-sorted in JS | https://docs.convex.dev/database/indexes · `convex/_generated/ai/guidelines.md:99` |
| 10 | ALIGNED | — | `convex/businesses/adminDeletion.ts:59-79, 219-226` | Guard throws inside the delete transaction ⇒ the caller's `delete` audit row is rolled back; no orphan audit row | "If the mutation writes some data to the database, but later throws an error, no data is actually written to the database." | https://docs.convex.dev/functions/mutation-functions |
| 11 | ALIGNED | — | `convex/orderFlags.ts:54-59`; `convex/businesses/adminDeletion.ts:70-78` | `new ConvexError({ code, message })` object payload | Application errors are `ConvexError`; custom `data` is preserved (and still carries `data` in production) | https://docs.convex.dev/functions/error-handling/ |
| 12 | ALIGNED | — | `convex/orderMetrics.ts:46-59` | `code: v.string()` + handler set-check instead of a `v.union` of literals, so an unknown code is a no-op not a throw | Validation is enforced at call time; a value outside the validator is an error, not a silent pass — so the union would throw on a beacon that must never throw | https://docs.convex.dev/functions/validation |
| 13 | ALIGNED | — | `app/owner/business/[id]/editor-section-body.tsx` · `AnalyticsBoundary` | React error boundary wrapping the `useQuery` consumer | "If your query function hits an error, the error will be sent to the client and thrown from your `useQuery` call site. The best way to handle these errors is with a React error boundary component." | https://docs.convex.dev/functions/error-handling/ |
| 14 | ALIGNED | — | `app/owner/business/[id]/editor-section-body.tsx` · `AnalyticsBoundary.getDerivedStateFromError` | Error boundary implemented with `static getDerivedStateFromError` | Docs: calling `setState` in `componentDidCatch` is deprecated "in favor of defining `static getDerivedStateFromError`" | https://react.dev/reference/react/Component |
| 15 | ALIGNED | — | `app/owner/business/[id]/editor-section-body.tsx:1-6`; `components/order/receipt.tsx:5` | `import type { FunctionReturnType } from 'convex/server'` | Exported by the installed package: `server/index.d.ts:73` re-exports `FunctionReturnType` from `./api.js` | https://docs.convex.dev/understanding/best-practices/typescript · `node_modules/convex/dist/esm-types/server/index.d.ts:73` |
| 16 | ALIGNED | — | `convex/metricCounter.ts:50-73`; `convex/orderFlags.ts:88-114` | Read-then-insert-or-patch upsert; two concurrent first-use inserts cannot both commit | OCC provides "true serializability and will yield correct results regardless of what transactions are issued concurrently" | https://docs.convex.dev/database/advanced/occ |
| 17 | ALIGNED | — | `convex/schema.ts` (`orderFlags.byOrderId` comment); `convex/orderFlags.ts:88-95` | "Convex has no unique indexes" ⇒ one-flag-per-order enforced in the mutation | The documented index definition is (name, ordered fields, staged) with no uniqueness constraint; `.unique()` is a read-time assertion that throws on multiple matches | https://docs.convex.dev/database/indexes |
| 18 | ALIGNED | — | `vitest.config.ts:10-14`; `convex/*.test.ts` | `environment: 'edge-runtime'`, tests under `convex/`, `convexTest(schema, modules)` | Testing guidance: `convex-test` + Vitest under `edge-runtime`, test files under `convex/`, module map passed to `convexTest` | `convex/_generated/ai/guidelines.md:117-122` |
| 19 | ALIGNED | — | `convex/orderMetrics.test.ts:42`; `convex/orderFlags.test.ts:34`; `convex/orderRetention.test.ts:31` | `import.meta.glob('./**/*.ts')` | Pass an `import.meta.glob("./**/*.ts")` module map to `convexTest(schema, modules)` | `convex/_generated/ai/guidelines.md:120` |
| 20 | ALIGNED | — | `convex/businesses/adminDeletion.test.ts:1` | `/// <reference types="vite/client" />` only in the file that uses `import.meta.glob` | Guidance: add the reference only in test files that use `import.meta.glob` | `convex/_generated/ai/guidelines.md:121` |
| 21 | ALIGNED | — | `app/owner/business/[id]/editor-section-body.tsx` (`flex flex-col gap-4`, `bg-muted`, `rounded-control`, `p-card`, `text-micro`, `tracking-label`, `border-danger-border`, `bg-danger-soft`, `text-danger-strong`, `py-card`, `scroll-mt-section`) | Uses design tokens only | Every token resolves in the project theme: `--color-muted`, `--color-danger-soft/-border/-strong` (`globals.css:270-272`), `--spacing-gap/-card/-section` (`:218-220`), `--radius-control/-card` (`:207-208`), `--text-micro` (`:194`), `--tracking-label` (`:200`) | https://tailwindcss.com/docs/theme · `app/globals.css` |
| 22 | ALIGNED | — | `orders-panel-row.tsx`, `orders-panel-dialogs.tsx` (`min-h-11`) | 44 px minimum touch target (protocol §6.7 `:1443`) | Tailwind spacing `11` = 2.75rem = 44px; arbitrary utilities in the same class strings (`grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]`) are valid v4 arbitrary-value syntax | https://tailwindcss.com/docs/theme |
| 23 | ALIGNED | — | `app/owner/business/[id]/editor-section-body.tsx` · `AnalyticsContent` | `overview === undefined` renders a skeleton | `useQuery` returns `undefined` while the result is loading | https://docs.convex.dev/functions/query-functions (client section) |
| 24 | ALIGNED | — | `convex/orderMetrics.ts:535` | `Date.now()` inside a `query` handler | Official docs: "Convex takes care of implementing these [Math.random()/Date.now()] in a way that you don't have to think about the deterministic constraint." **Conflicts with `convex/_generated/ai/guidelines.md:90`** ("Do not read the wall clock in a query") — see Notes | https://docs.convex.dev/functions/query-functions |
| 25 | DRIFT | Medium | `convex/crons.ts:19-24` | New daily job scheduled at `{ hourUTC: 5, minuteUTC: 0 }` — the top of the hour | The cron page now explicitly says "The top of the hour (minute `0`) is the busiest time on the clock", shows `minuteUTC: 0` as the ❌ example, and ships a lint rule: "The `@convex-dev/no-top-of-hour-crons` lint rule flags schedules pinned to the top of the hour." Leaving `minuteUTC` out lets Convex spread the run | https://docs.convex.dev/scheduling/cron-jobs |
| 26 | DRIFT | Medium | `convex/orderRetention.ts:131-149` | `deleteIdempotencyRows` does `.withIndex('byBusinessIdKey').collect()` over the business's whole idempotency key space, then filters by `orderId` in JS — once per eligible order, up to 50× per run | "If you are using `.collect()`, for instance, it will scan all of the rows in the range." Transaction limits are 16 MiB read / 32,000 documents scanned per function; a business that accumulates keys makes one retention run scan its full key space 50 times | https://docs.convex.dev/database/indexes · https://docs.convex.dev/production/state/limits |
| 27 | DRIFT | Medium | `convex/orderMetrics.ts:140-144, 590-603` | The `capped` guarantee is enforced by document-count caps only (`take(limit + 1)`, 5,000 / 1,000 / 1,000) | The documented transaction limit is byte-based ("Data read 16 MiB") as well as count-based ("Documents scanned 32,000"). A count-bounded read of 1,001 full `orders` documents plus 5,001 events can exceed 16 MiB and throw a read-limit error, so the reader gets an error where the contract promises a floor (`capped: true`) | https://docs.convex.dev/production/state/limits · https://docs.convex.dev/functions/error-handling/ |
| 28 | DRIFT | Low | `app/owner/business/[id]/editor-section-body.tsx` · `AnalyticsErrorState` ("Try again") | Offers a retry of a failed query by remounting `AnalyticsContent` (`retryKey`) with identical arguments | "Unlike other frameworks, there is no concept of 'retrying' if your query function hits an error. Because Convex functions are deterministic, if the query function hits an error, retrying will always produce the same error." (The adjacent copy does tell the user to sign in first, which changes the query context — the one case where a re-run can differ) | https://docs.convex.dev/functions/error-handling/ |
| 29 | DRIFT | Low | `app/owner/business/[id]/orders-panel-dialogs.tsx` · `FlagOrderDialog` (`<Label id={selectId}-label htmlFor={selectId}>` + `<SelectTrigger id={selectId}>`) | `for` points at a Radix `SelectTrigger`, which renders a `button` | `<label for>` must reference a *labelable* form element; a `button` is not labelable, so `htmlFor` is inert here. The trigger's `aria-labelledby` is the wiring that actually names it (so AT impact is ~nil) | https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/label |
| 30 | VERSION-GAP | — | `package.json` (`convex ^1.31.2`) / installed 1.46.0 | Whole Convex surface | Installed **1.46.0**, latest stable **1.48.0**. 1.47.0 adds a deploy confirmation before creating/changing an index on a large table (relevant to this change's new plain `orderEvents` index) and adds `.staged()` table validators; 1.48.0 adds mutation-side `ctx.storage` and `ctx.auth.signJwt` | https://registry.npmjs.org/convex · https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md |
| 31 | VERSION-GAP | — | `package.json` (`vitest ^4.1.12`) / installed 4.1.12 | Test runner for the 4 new `convex/**/*.test.ts` files | Installed **4.1.12**, latest stable **5.0.5**; the repo's own Convex guidance says to "always install the latest versions of these packages" | https://registry.npmjs.org/vitest · `convex/_generated/ai/guidelines.md:119` |
| 32 | VERSION-GAP | — | `package.json` (`convex-test ^0.0.62`) / installed 0.0.62 | `convexTest(schema, modules)` harness | Installed **0.0.62**, latest stable **0.0.65**; same "always install the latest versions" guidance | https://registry.npmjs.org/convex-test · `convex/_generated/ai/guidelines.md:119` |
| 33 | VERSION-GAP | — | `package.json` (`next 16.3.5`) / installed 16.3.5 | `'use client'` panel + `next/navigation` consumer | Installed **16.3.5**, latest stable **16.4.3**. No Next API introduced by this change depends on the delta | https://registry.npmjs.org/next |
| 34 | VERSION-GAP | — | `package.json` (`react ^19.2.3`) / installed 19.3.0 | Class error boundary, `useRef`, `useState`, `useId` | Installed **19.3.0**, latest stable **19.3.1**. Every API used exists in both | https://registry.npmjs.org/react |
| 35 | VERSION-GAP | — | `package.json` (`tailwindcss ^4`) / installed 4.1.11 | New utility class strings on the analytics panel, flag row and flag dialog | Installed **4.1.11**, latest stable **4.3.3**. No utility or theme feature used here is new in 4.2/4.3 | https://registry.npmjs.org/tailwindcss |
| 36 | UNVERIFIABLE | — | `convex/orderMetrics.ts:531-536` (comment) and `docs/order-runbook.md` §8.2 | "A live subscription also re-runs when the rows it read change, which keeps the window moving"; the UI states "Rolling {windowDays}-day window ending now" | Searched the query-functions, mutation-functions and OCC pages: caching/reactivity are described as re-execution on data change; no page states that a subscription re-executes on a clock tick or that `Date.now()` advances in a cached result. Whether `windowEnd` drifts while a filtered read set is unchanged is therefore not documented either way — the visible effect is that an idle business's "ending now" is the last execution time | — |

Itemize every DRIFT and VERSION-GAP. ALIGNED items may be summarized by count.

## Summary

| Label | Count |
|-------|-------|
| ALIGNED | 24 |
| DRIFT | 5 |
| VERSION-GAP | 6 |
| UNVERIFIABLE | 1 |

**Top DRIFT findings:** (severity-ranked, highest first)

1. **Medium — byte vs. count bounding in `orderMetrics.overview`** (#27). The `capped`/floor contract is enforced only by document counts; the documented 16 MiB read limit can throw first, so the owner can get an error card where the design promises a visibly-truncated floor. This is the one finding that can defeat the issue's own "fail visibly, never a false total" rule.
2. **Medium — business-wide `.collect()` in retention** (#26). `deleteIdempotencyRows` scans the whole `byBusinessIdKey` range per order, up to 50× per daily run. Correct today on small data, unbounded by construction, and the code's own comment records the missing index as out of scope.
3. **Medium — top-of-the-hour cron** (#25). The new job is scheduled exactly in the pattern the current cron docs mark as ❌ and flag with a lint rule. Trivial to fix by dropping `minuteUTC`.
4. **Low — "Try again" on a failed query** (#28). Docs state a same-argument retry always reproduces the error; the UI offers it as recovery.
5. **Low — `<label for>` on a Radix `SelectTrigger`** (#29). Inert attribute (the trigger is a button); `aria-labelledby` is what actually works.

## Recommendations (advisory)

Ordered by severity. None of these is an implementation change made by this report.

1. **#27 — bound by bytes, not only by count.** Either lower `METRICS_WINDOW_ORDER_LIMIT` (1,000 full order docs is the heaviest read), drop `items`/contact fields from the projection before returning, or wrap the three reads so a read-limit error degrades to `capped: true` with the metrics that did resolve. Cheapest honest option: reduce the order cap and record the new floor in the runbook §8.2.
2. **#26 — stop scanning the business key space.** Read `orderIdempotency` through a bounded `.take()` per run, or add a `byOrderId` index to `orderIdempotency` (it is a schema change, so it belongs in a follow-up issue, not this branch). Until then, state the bound in the runbook §4.2 table.
3. **#25 — drop `minuteUTC: 0`** from the new cron (keep `hourUTC: 5`), and consider the same for the pre-existing 04:00 throttle-cleanup job. One-line change, no behavioural consequence.
4. **#28 — re-word the recovery affordance.** Either label it "Reload" and keep the sign-in instruction, or state in the runbook that an error card is terminal for that session unless the auth/business context changes.
5. **#29 — drop `htmlFor`** from the flag dialog's `<Label>` (keep the `id` + `aria-labelledby`), or move the `id` onto a real form control.
6. **#30 — before the release deploy**, confirm the new plain `orderEvents` index against production table size: on 1.47+ `npx convex deploy` will prompt before backfilling a large index. Plan the maintenance window or stage the index, then record it in the release note (already anticipated in `tasks/issue-84-research.md` OQ-1).
7. **#31/#32 —** upgrade `vitest` and `convex-test` to latest in a dependency-upgrade issue (not in this branch; the 702+231 tests pass on the installed versions).

## Notes

**Doc inconsistencies found in the repo's own Convex guidance.** `convex/_generated/ai/guidelines.md` is declared the authority for Convex API usage (`convex/AGENTS.md`), and it disagrees with the live docs in two places this change touches:

1. `guidelines.md:90` — "Do not read the wall clock in a query … `Date.now()` is fine in mutations and actions." The Convex query page says `Date.now()` is implemented so determinism is not the developer's problem. `overview` (`orderMetrics.ts:535`) follows the live docs. Both sources are cited at #24; the code is not at fault, the guidance file is stale relative to the docs it targets (`^1.44.0`).
2. `guidelines.md:114` — "Use only `crons.interval` or `crons.cron`." The cron page documents `hourly/daily/weekly/monthly` as first-class. `crons.ts` (including the pre-existing `orderThrottleCleanup` job) uses `crons.daily`. Recorded as ALIGNED (#1) rather than DRIFT, with the conflict noted here.

Neither inconsistency is introduced by this change; both are worth refreshing with `npx convex ai-files update` (the 1.48.0 changelog notes that command now exits non-zero when the download or install fails).

**Version currency.** `next`, `react`, and `tailwindcss` all trail latest by a patch or minor release with no API used by this artifact affected (#33–#35). `typescript` is 5.8.3 against 7.0.2 upstream; no TypeScript-version-specific claim is made by this change, so it is recorded in the stack table only, not as a finding. `@clerk/nextjs` 7.9.15 (latest 7.9.21) is untouched by this change — no Clerk import was added.

**Scope exclusions.** `scripts/order-concurrency-proof.ts` (988 added lines) and `convex/devProof.ts` (602) are a load harness and a test-only seeding module. Their claims are measurement claims (p50/p95, OCC conflict counts) rather than library-usage claims; `tasks/issue-84-loadtest-evidence.md` already states its own limits honestly (no rejections observed ⇒ the counter cross-check is vacuous; OCC conflicts observed on `orderThrottle`/`orderIdempotency`, not on `orderMetricCounters`). Nothing there was re-derived.

**Where the artifact is unusually well aligned.** Three decisions match current docs exactly and deserve credit rather than re-litigation: (a) `recordOrderRejection` / `recordReceiptView` as *separate* committing mutations, because a rejection path's writes are discarded when it throws (#10); (b) `metricCounter.ts` as a plain leaf helper using only type imports, avoiding `ctx.runMutation` sub-transaction writes on a throwing path; (c) the error-boundary treatment of `useQuery`, using the hook React and Convex both recommend (#13, #14).

**`convex/_generated/api.d.ts`** carries only added module imports/entries for the four new modules (`metricCounter`, `orderFlags`, `orderMetrics`, `orderRetention`), which is the codegen shape. It was not hand-edited in any way I could detect, and `convex/AGENTS.md` requires it to be generated — but provenance (regenerated vs. pasted) is not verifiable from the file itself.

**Evidence hygiene note.** `docs/validation/issue-84-a11y-audit.md` correctly separates `verified` (Reticle `verified: "yes"`) from `source-inspected` and `BLOCKED`, and states that the owner board never rendered behind the Clerk gate. Its library-facing claims (Radix focus trap, `aria-current="step"`, `role="status"`, 44 px targets) are consistent with the docs I consulted and with `app/globals.css`. I did not re-drive the flows; alignment does not re-verify behaviour.

**Verdict for the code-review phase.** The change is **substantively aligned** with current Convex, React 19, and Tailwind v4 documentation: its riskiest choices (transaction rollback, plain-helper counters, error-boundary query handling, bounded index reads, plain index backfill) are each the documented behaviour, not a workaround. Five DRIFTs survive, three of them Medium and all three fixable without redesign — byte-bounding the metrics read, removing the business-wide `.collect()` from retention, and moving the cron off the top of the hour. None is Critical or High; nothing here contradicts a removed or renamed API. Review should treat #27 and #26 as follow-ups tied to scale rather than merge blockers, and #25/#28/#29 as one-line tidy-ups.

---

### Method note

Alignment only: no implementation file was modified. `git status --short` before and after writing this report differs by exactly one added path (`docs/alignment/issue-84.md`). Versions were read from `node_modules/*/package.json` and compared against npm `dist-tags` on 2026-10-27; documentation was fetched from the URLs in §Sources on the same date.
