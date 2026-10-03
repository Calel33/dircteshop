# Alignment Report — Issue #12 / B3a owner home, add-business, editor core & submit

> Mandatory output shape for the alignment skill. Advisory only — the artifact was **not** modified.
> Checked against live official docs on **2026-10-02** (Firecrawl scrape + Firecrawl developer index).

## Scope

- **Artifact type:** code (staged change set; `tasks/issue-12-contract.md` and `tasks/issue-12-research.md` used as supporting intent)
- **Artifact location:** staged diff on `fix/issue-12-b3a-owner-home-add-your-business-editor-core-submit` — 47 files, `+4288 / −6` (`git diff --cached`), repo `D:\Dev\dircteshop-1`
- **Reviewed:** 2026-10-02
- **Focus:** all libraries used by the diff (no `--focus` given)
- **Method note:** the actual finished code was inspected (full staged diff plus `node_modules`), not the issue summary. The known `middleware.ts` condition and the Node `engines` threshold are **pre-existing** (not introduced by this change set) and are classified for completeness.

## Stack detected

Installed versions were read from the actual install (`npm ls … --depth=0` → `node_modules/.pnpm/...`), not from `package.json` specs.

| Library / technology | Installed version | Source of truth | Docs target |
|----------------------|-------------------|-----------------|-------------|
| next | 16.3.5 | `package.json` (exact `16.3.5`) | latest stable (16.3.8) |
| react / react-dom | 19.3.0 | `package.json` `^19.2.3` | latest stable (19.3.0) |
| convex | 1.46.0 | `package.json` `^1.31.2` | latest stable (1.46.0) |
| @clerk/nextjs | 7.9.9 | `package.json` `^7.9.4` | latest stable (7.9.10) |
| tailwindcss | 4.1.11 | `package.json` `^4` | latest stable (4.3.3) |
| typescript | 5.8.3 | `package.json` `^5` | latest stable (7.0.2) |
| zod | 4.6.5 | `package.json` `^4.6.5` | latest stable (4.6.5) |
| node (runtime / engines) | v24.18.0 installed; `engines.node >=22.6` declared | `package.json` | latest stable |

Out of technology surface (present in `package.json`, **not** used by this diff): zod (declared, not imported by changed files), motion, sonner, vaul, recharts, `@radix-ui/*`, `@tanstack/react-table`, `lucide-react`, `@dnd-kit/*`. No findings recorded for these.

## Sources consulted

| Source | URL | Covers version |
|--------|-----|----------------|
| Convex — Argument and Return Value Validation (`.partial`, `Infer`, extra props) | https://docs.convex.dev/functions/validation | latest |
| Convex — Writing Data (`db.patch` shallow merge, `undefined`, transactions) | https://docs.convex.dev/database/writing-data | latest |
| Convex — Reading Data (`db.get`, `withIndex/eq/collect`, `v.id` note) | https://docs.convex.dev/database/reading-data | latest |
| Convex — Schemas (optional fields, schema validation) | https://docs.convex.dev/database/schemas | latest |
| Convex — React client (`useQuery`/`useMutation`, `"skip"`) | https://docs.convex.dev/client/react | latest |
| Convex — `react` API module (`Authenticated`/`Unauthenticated`/`AuthLoading`, `useQuery` signature) | https://docs.convex.dev/api/modules/react | latest |
| Convex — `server` API module (`FunctionReturnType`) | https://docs.convex.dev/api/modules/server | latest |
| Convex — `GenericDatabaseWriter` (`get`/`patch` positional forms) | https://docs.convex.dev/api/interfaces/server.GenericDatabaseWriter | latest |
| Convex — Application errors (`ConvexError`) | https://docs.convex.dev/functions/error-handling/application-errors | latest |
| Clerk — Next.js quickstart (component exports) | https://clerk.com/docs/nextjs/getting-started/quickstart | latest |
| Clerk — `<UserButton />` reference | https://clerk.com/docs/nextjs/reference/components/user/user-button | latest |
| Clerk — `<SignInButton mode="modal">` (developer index: docs/StackBlitz) | https://stackblitz.com/edit/clerk-react-with-modals | latest |
| Clerk — `<SignUpButton>` description (docs index) | https://clerk.com/docs/templates.md | latest |
| Next.js — `proxy.js` convention (middleware→proxy rename) | https://nextjs.org/docs/app/api-reference/file-conventions/proxy | latest |
| Next.js — `page.js` convention (`params` Promise) | https://nextjs.org/docs/app/api-reference/file-conventions/page | latest |
| React — `Component` / error boundaries (`getDerivedStateFromError`) | https://react.dev/reference/react/Component | latest (19.x) |
| Tailwind — Theme variables & namespaces (`@theme inline`) | https://tailwindcss.com/docs/theme | v4.3 |
| Node.js — Modules: TypeScript (type stripping) | https://nodejs.org/api/typescript.html | latest |
| Node.js — Test runner (`.test.ts` discovery) | https://nodejs.org/api/test.html | latest |
| npm registry (latest stable) | `npm view <pkg> version` / `dist-tags` | live 2026-10-02 |

## Findings

Itemized: every DRIFT and VERSION-GAP. ALIGNED is aggregated (representative usages listed).

| # | Label | Severity | Artifact location | Claim / usage | What the docs say | Source |
|---|-------|----------|-------------------|---------------|-------------------|--------|
| 1 | DRIFT | High | `package.json:6-8` (**pre-existing**) | `engines.node: ">=22.6"` while `npm test` runs `node --test` over `.test.ts` and `node scripts/*.ts` | Type stripping is enabled **by default only from v23.6.0 / v22.18.0** (stable v24.12.0+). The test runner matches `**/*.test.{cts,mts,ts}` **only** when type stripping is on. On Node 22.6–22.17 the declared range cannot run `npm test`/`npm run seed` without `--experimental-strip-types`. (Installed runtime is v24.18.0, so it works in this environment.) | https://nodejs.org/api/typescript.html · https://nodejs.org/api/test.html |
| 2 | DRIFT | Medium | `middleware.ts:1-9` (**pre-existing**) | `middleware.ts` file convention | "The `middleware` file convention is deprecated and has been renamed to `proxy`. See Migration to Proxy." Version history: `v16.0.0 — Middleware is deprecated and renamed to Proxy.` Still functional in 16.x. | https://nextjs.org/docs/app/api-reference/file-conventions/proxy |
| 3 | DRIFT | Low | `convex/businesses/queries.ts` (`getMine`, new) | `ctx.db.get(businessId)` (id-first form) | API reference: "Fetch a single document from the database by its `GenericId`. **Supported for backwards compatibility. Prefer `db.get(tableName, id)` in new code**." | https://docs.convex.dev/api/interfaces/server.GenericDatabaseWriter#get |
| 4 | DRIFT | Low | `convex/businesses/mutations.ts` (`saveDraft`, `saveAndResubmit`, new) | `ctx.db.patch(businessId, { … })` (id-first form) | API reference: `patch(table, id, value)` preferred; the `patch(id, value)` overload is "**Supported for backwards compatibility. Prefer `db.patch(tableName, id, value)`**". Same for `replace`/`delete`. | https://docs.convex.dev/api/interfaces/server.GenericDatabaseWriter#patch |
| 5 | VERSION-GAP | — | `package.json:51` | next installed **16.3.5** | latest stable **16.3.8** | https://nextjs.org/docs/app/api-reference/file-conventions/proxy |
| 6 | VERSION-GAP | — | `package.json:25` | @clerk/nextjs installed **7.9.9** | latest stable **7.9.10** | https://registry.npmjs.org/@clerk/nextjs/latest |
| 7 | VERSION-GAP | — | `package.json:78` | tailwindcss installed **4.1.11** | latest stable **4.3.3** (all directives/namespaces used exist in the 4.1 line) | https://tailwindcss.com/docs/theme · https://registry.npmjs.org/tailwindcss/latest |
| 8 | VERSION-GAP | — | `package.json:80` | typescript installed **5.8.3** | latest stable **7.0.2** (`npm view typescript dist-tags.latest`) — major-version gap | https://registry.npmjs.org/typescript/latest |
| 9 | UNVERIFIABLE | — | `.env.local` / `convex/auth.config.ts` (pre-existing, out of change set) | Convex deployment reads `NEXT_PUBLIC_CLERK_FRONTEND_API_URL`; official docs use `CLERK_JWT_ISSUER_DOMAIN` / `CLERK_FRONTEND_API_URL` | Searched Convex & Clerk docs; cannot confirm the Convex deployment env mapping without deployment access | — |
| 10 | UNVERIFIABLE | — | `app/owner/business/[id]/convex-id.ts:1-24` | Convex ids are Crockford base32 (no `i/l/o/u`, 31–37 chars) | Code cites `convex-backend` `base32.rs`/`id_v6.rs`, not the public docs; the public docs describe ids as opaque strings (`Ids are strings … use `v.id` or `normalizeId``). Structural regex not independently confirmed from an authoritative doc page | https://docs.convex.dev/database/document-ids (partial) |

### ALIGNED (aggregated — representative usages)

| Usage | Confirmation | Source |
|-------|--------------|--------|
| `v.object({…}).partial()` for `editablePatchValidator` / `saveDraft` / `saveAndResubmit` args | "You can create new object validators … using `.pick`, `.omit`, `.extend`, and `.partial`"; "Creates a validator where all fields are optional. This is useful for validating patches to a document." | https://docs.convex.dev/functions/validation |
| `Infer<typeof editablePatchValidator>` from `convex/values` | `Infer` turns validator calls into TS types | https://docs.convex.dev/functions/validation |
| Object validators reject undeclared keys (comment + `assertPatchInAllowlist`) | "Object validators don't allow extra properties, objects with properties that aren't specified will fail validation." | https://docs.convex.dev/functions/validation |
| `Authenticated` / `Unauthenticated` / `AuthLoading` imported from `convex/react` | Listed and exported in the `react` API module | https://docs.convex.dev/api/modules/react |
| `useQuery(api.…, args | "skip")` in `owner-editor.tsx` | Documented "Skipping queries"; signature `useQuery(query, ...args)` accepts `"skip"` | https://docs.convex.dev/api/modules/react · https://docs.convex.dev/client/react |
| Positional `useQuery` errors surface to an error boundary (`EditorLoadBoundary`) | Positional form: `throwOnError` defaults `true` → "errors are thrown and caught by an error boundary" | https://docs.convex.dev/api/modules/react |
| `FunctionReturnType<typeof api.…>` from `convex/server` (`business-card.tsx`, `editor-types.ts`) | Documented type alias on `server` module | https://docs.convex.dev/api/modules/server |
| `ctx.db.query('businesses').withIndex('byOwnerId', q => q.eq('ownerId', user._id)).collect()` (`listMine`) | Documented `withIndex(...).eq(...).collect()` pattern | https://docs.convex.dev/database/reading-data |
| `ctx.db.get(businessId)` returns `null` when missing (`getMine`) | "The … document at the given GenericId, or `null` if it no longer exists." | https://docs.convex.dev/api/interfaces/server.GenericDatabaseWriter#get |
| `v.id('businesses')` query arg rejects malformed ids | "use the `v.id` validator … to make sure you are not exposing data from tables other than the ones you intended." | https://docs.convex.dev/database/reading-data |
| `ctx.db.patch` shallow-merge + `undefined` removes a field (`saveAndResubmit` moderation policy) | "shallow merging … Fields set to `undefined` are removed." | https://docs.convex.dev/database/writing-data |
| Atomic identity+status write in one `saveAndResubmit` patch | "the entire `mutation` function is automatically a single transaction … executes them all in a single transaction when the function ends" | https://docs.convex.dev/database/writing-data |
| `tags` / `amenities` added as `v.optional(v.array(v.string()))` (backward compatible) | Optional fields: `v.optional(...)`; schema validation of existing docs (adding optional fields cannot fail on missing values) | https://docs.convex.dev/database/schemas |
| `ConvexError` thrown for expected failures in `saveDraft` / `saveAndResubmit` | "If you have expected ways your functions might fail, you can either return different values or throw `ConvexError`s." (Plain `Error` in `saveAndResubmit` is an unreachable invariant, not an expected failure.) | https://docs.convex.dev/functions/error-handling/application-errors |
| `SignInButton`, `SignUpButton`, `UserButton` imported from `@clerk/nextjs` | "Use Clerk components from `@clerk/nextjs` such as `SignInButton`, `SignUpButton`, `Show`, and `UserButton`." | https://clerk.com/docs/nextjs/getting-started/quickstart |
| `<SignInButton mode="modal">` / `<SignUpButton mode="modal">` | `mode="modal"` documented/used in Clerk examples; `<SignUpButton>` "links to the sign-up page or displays the sign-up modal" | https://stackblitz.com/edit/clerk-react-with-modals · https://clerk.com/docs/templates.md |
| Dynamic route `params: Promise<{ id: string }>` awaited in `app/owner/business/[id]/page.tsx` | "Since the `params` prop is a promise, you must use `async/await` or React's `use`." | https://nextjs.org/docs/app/api-reference/file-conventions/page |
| `metadata` export, `useRouter` from `next/navigation`, `Link` from `next/link`, `'use client'` | App Router conventions | https://nextjs.org/docs/app/api-reference/file-conventions/page |
| Class error boundary (`Component` + `static getDerivedStateFromError`) in `editor-load-boundary.tsx` | React docs: "To implement an Error Boundary component, you need to provide `static getDerivedStateFromError`"; still current in 19.x | https://react.dev/reference/react/Component |
| `useState` lazy initializers + controlled inputs (`editor-shell.tsx`, `create-business-form.tsx`) | Standard React hooks; no removed API | https://react.dev/reference/react/Component |
| Tailwind `@theme inline` custom namespaces: `--font-display`/`--font-body`/`--font-label`, `--radius-card`/`--radius-control`/`--radius-pill`, `--spacing-base`/`--spacing-gap`/`--spacing-card`/`--spacing-section` | "Defining new theme variables in these namespaces will make new corresponding utilities … available"; `--font-*`, `--radius-*`, `--spacing-*` are documented namespaces. **Empirically confirmed**: built `.next` CSS contains `.font-display`, `.font-label`, `.rounded-card`, `.rounded-control`, `.gap-gap`, `.py-card`, `.px-card`, `.mt-section` | https://tailwindcss.com/docs/theme |
| `node --test` discovers `*.test.ts` (new `convex-id.test.ts`, `editor-form.test.ts`, `editor-status.test.ts`, `preview-adapter.test.ts`, `listing-status.test.ts`, `scripts/*.test.ts`) | Patterns `**/*.test.{cts,mts,ts}` are matched "Unless `--no-strip-types` is supplied" | https://nodejs.org/api/test.html |
| Type stripping of the test graph (explicit `.ts` import extensions, `import type` for `@/` aliases, no `.tsx` imports) | Type stripping requires explicit extensions and the `type` keyword on type-only imports; `.tsx` is unsupported (no test imports `.tsx`). Installed Node v24.18.0 → type stripping stable | https://nodejs.org/api/typescript.html |

## Summary

| Label | Count |
|-------|-------|
| ALIGNED | 24 claims / usage groups (aggregated above) |
| DRIFT | 4 |
| VERSION-GAP | 4 |
| UNVERIFIABLE | 2 |

**Top DRIFT findings (severity-ranked):**
1. **High — `engines.node: ">=22.6"`** is below the documented default-type-stripping floor (v22.18.0 / v23.6.0). Pre-existing; the change set adds more `.test.ts` files that depend on it. (`package.json:6-8`)
2. **Medium — `middleware.ts`** is deprecated and renamed to `proxy.ts` in Next 16. Pre-existing; the change set deliberately does **not** add `/owner` to it (resource-level auth), which is the docs-aligned direction.
3. **Low — `ctx.db.get(id)` / `ctx.db.patch(id, value)`** id-first forms in the new owner functions; docs prefer the `(tableName, id)` forms "in new code" (backwards-compatible but non-preferred).
4. *(VERSION-GAP, not DRIFT)* typescript 5.8.3 vs 7.0.2, tailwindcss 4.1.11 vs 4.3.3, next 16.3.5 vs 16.3.8, @clerk/nextjs 7.9.9 vs 7.9.10.

## Recommendations (advisory)

Ordered by severity; alignment never edits the artifact.

1. Raise `engines.node` to `>=22.18` (or `>=24`) to match documented default type stripping, or pin Node ≥24 in CI. *(High, pre-existing)*
2. Rename `middleware.ts` → `proxy.ts` (export `proxy`) per Next 16 / Clerk guidance. *(Medium, pre-existing; tracked as debt in PR #25)*
3. In new Convex functions, prefer `ctx.db.get('businesses', id)` and `ctx.db.patch('businesses', id, value)`; optionally standardise repo-wide. *(Low)*
4. Optional patch bumps: `next@16.3.8`, `@clerk/nextjs@7.9.10`, `tailwindcss@4.3.3` — behaviour-compatible within their lines. TypeScript 7 is a major upgrade and out of scope for this change set.

## Notes

- **Pre-existing vs introduced.** Findings 1, 2, and (partly) 9 concern files **not modified** by this change set (`package.json` engines, `middleware.ts`, `convex/auth.config.ts`). They are recorded because the Node docs item is newly exercised by the added `.test.ts` files, and because the task explicitly asked to classify the `middleware.ts` condition. Everything else was introduced by the diff.
- **Install base.** `package.json` specs differ from the observed install (`node_modules/.pnpm`): e.g. `@clerk/nextjs ^7.9.4` → installed 7.9.9; `tailwindcss ^4` → 4.1.11; `typescript ^5` → 5.8.3. Version claims use the **installed** values.
- **Resource-level auth.** Clerk's current guidance is resource-level protection. The change set uses `convex/react`'s `<Authenticated>/<Unauthenticated>/<AuthLoading>` plus server-side `requireBusinessOwner`/`getMine`, and intentionally leaves `/owner` out of the middleware matcher. This is consistent with the docs-aligned direction (and avoids adding a new `createRouteMatcher` usage, which is deprecated).
- **Error handling improvement.** Unlike the pre-existing `new Error(...)` pattern flagged in `docs/alignment/b1-b2.md`, the new owner mutations use `ConvexError` for expected failures — aligned with the error-handling docs. The one `new Error(...)` in `saveAndResubmit` guards an unreachable invariant (`approved` always resolves a target), not a user-reachable failure.
- **Empirical confirmation.** Tailwind custom namespace utilities were verified both from the theme docs and by grepping the actual `next build` output (`.next/static/chunks/*.css`), which contains the generated selectors — a stronger signal than docs inference alone.
- **Source conflicts:** none found. Next.js (proxy rename) and Clerk agree; Convex docs are internally consistent on the positional vs table-name `get`/`patch` forms.
- **Scope exclusions:** `convex/_generated/*` regeneration is mechanical (not an API claim); `pnpm-lock.yaml`/`bun.lock` are pre-existing stale artifacts and were not treated as change-set drift.
