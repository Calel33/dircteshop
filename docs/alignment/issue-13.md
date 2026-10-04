# Alignment Report — Issue #13 B3b Admin Approvals Queue (staged diff, branch `fix/issue-13-b3b-admin-approvals-queue-per-card-actions-w-required-reason-audit-rows`)

> Mandatory output shape for the alignment skill. Fill every section. Delete nothing; write "none" where empty.
> Artifact under review: the staged implementation for [issue #13](https://github.com/Calel33/dircteshop/issues/13) — `convex/businesses/{queries,mutations,moderationPolicy,moderationProjections}.ts`, `convex/schema.ts`, `app/admin/approvals/**`, `components/ui/{dialog,textarea}.tsx`, and the pure `node --test` suites.

## Scope

- **Artifact type:** code
- **Artifact location:** staged diff on `fix/issue-13-b3b-admin-approvals-queue-per-card-actions-w-required-reason-audit-rows` — `convex/businesses/queries.ts`, `convex/businesses/mutations.ts`, `convex/businesses/moderationPolicy.ts`, `convex/businesses/moderationProjections.ts`, `convex/schema.ts`, `app/admin/approvals/**`, `components/ui/dialog.tsx`, `components/ui/textarea.tsx` (+ tests `scripts/moderation-*.test.ts`, `app/admin/approvals/*.test.ts`)
- **Reviewed:** 2026-10-03
- **Focus:** all libraries used by the diff — Convex (1.46.0), Clerk (@clerk/nextjs 7.9.10), Radix UI (@radix-ui/react-dialog 1.1.23), Tailwind CSS v4 (4.1.11), Next.js 16 (16.3.5), React 19 (19.3.0)

## Stack detected

| Library / technology | Installed version | Source of truth (manifest) | Docs target |
|----------------------|-------------------|----------------------------|-------------|
| convex | 1.46.0 | `pnpm-lock.yaml` (`convex@1.46.0`) | latest stable (1.46.0) |
| @clerk/nextjs | 7.9.10 | `pnpm-lock.yaml` | latest stable (7.9.10) |
| @clerk/backend | 3.22.0 | `pnpm-lock.yaml` | latest stable (3.22.0) |
| @radix-ui/react-dialog | 1.1.23 | `pnpm-lock.yaml` | scoped latest (1.1.23); unified `radix-ui` 1.6.7 (see Findings 13) |
| @radix-ui/react-label | 2.1.15 | `pnpm-lock.yaml` | latest stable (2.1.15) |
| tailwindcss | 4.1.11 | `pnpm-lock.yaml` + `node_modules/tailwindcss/package.json` | latest stable (4.3.3) |
| @tailwindcss/postcss | 4.1.11 | `pnpm-lock.yaml` | latest stable (4.3.3) |
| next | 16.3.5 | `pnpm-lock.yaml` | latest stable (16.3.8) |
| react / react-dom | 19.3.0 | `pnpm-lock.yaml` | latest stable (19.3.0) |
| typescript | 5.8.3 | `pnpm-lock.yaml` (`typescript@5.8.3`) | latest stable (7.0.2; repo pins `^5` deliberately) |
| zod | 4.6.5 | `pnpm-lock.yaml` | latest stable (4.6.5) |
| node (runtime, tests) | 24.18.0 | `node --version` | engines `>=22.6` (type-stripped `node --test`) |

## Sources consulted

| Source | URL | Covers version |
|--------|-----|----------------|
| Convex — Writing Data (atomicity, patch semantics) | https://docs.convex.dev/database/writing-data | latest |
| Convex — Mutation Functions (transactions) | https://docs.convex.dev/functions/mutation-functions | latest |
| Convex — Indexes | https://docs.convex.dev/database/reading-data/indexes | latest |
| Convex — Indexes and Query Performance | https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf | latest |
| Convex — Argument Validation | https://docs.convex.dev/functions/validation | latest |
| Convex — Error Handling | https://docs.convex.dev/functions/error-handling | latest |
| Convex — Application Errors | https://docs.convex.dev/functions/error-handling/application-errors | latest |
| Convex — Auth: functions-auth | https://docs.convex.dev/auth/functions-auth | latest |
| Convex — Auth: Clerk | https://docs.convex.dev/auth/clerk | latest |
| Convex — Best Practices (`db.get` table name) | https://docs.convex.dev/understanding/best-practices/ | latest |
| Convex — React client overview (`useQuery`) | https://docs.convex.dev/client/react/overview | latest |
| Convex — Document IDs (`db.get` two-arg form) | https://docs.convex.dev/database/document-ids | latest |
| Radix UI — Dialog primitive | https://www.radix-ui.com/primitives/docs/components/dialog | latest |
| Radix UI — primitives issues #2030, #2248 (initial focus) | https://github.com/radix-ui/primitives/issues/2030 · https://github.com/radix-ui/primitives/issues/2248 | latest |
| shadcn/ui — changelog Feb 2026 "Unified Radix UI Package" | https://ui.shadcn.com/docs/changelog/2026-02-radix-ui | latest |
| shadcn/ui — changelog index | https://ui.shadcn.com/docs/changelog | latest |
| Tailwind — Theme / Theme variable namespaces | https://tailwindcss.com/docs/theme | latest |
| Tailwind — Field Sizing | https://tailwindcss.com/docs/field-sizing | latest (introduced in v4.1; installed 4.1.11 has it) |
| Next.js — Pages and Layouts (nesting layouts) | https://nextjs.org/docs/app/getting-started/layouts-and-pages | latest |
| npm registry (latest versions) | via `octocode.npmSearch` (convex, next, react, tailwindcss, @tailwindcss/postcss, @clerk/nextjs, zod, @radix-ui/react-dialog, radix-ui, @radix-ui/react-label, typescript) | 2026-10-03 |

## Findings

| # | Label | Severity | Artifact location | Claim / usage | What the docs say | Source |
|---|-------|----------|-------------------|---------------|-------------------|--------|
| 1 | ALIGNED | — | `convex/businesses/mutations.ts:276-296` (`moderateListing`) | One mutation performs `ctx.db.patch(business)` **and** `ctx.db.insert('auditLogs', …)`; both must commit together or not at all | "Mutations run **transactionally**… All database writes get committed together. If the mutation writes some data to the database, but later throws an error, no data is actually written to the database." Also: "the entire `mutation` function is automatically a single transaction." | https://docs.convex.dev/functions/mutation-functions#transactions · https://docs.convex.dev/database/writing-data |
| 2 | ALIGNED | — | `convex/schema.ts:73` + `convex/businesses/queries.ts:207-210` | Composite index `byStatusSubmittedAt: ['status','submittedAt']`; query `withIndex('byStatusSubmittedAt', q => q.eq('status','pendingReview'))` then `.collect()`; code comment: "Convex appends `_creationTime` as the final tiebreak" | Docs define composite indexes as "indexes on an ordered list of fields" (`.index("by_channel_user", ["channel","user"])`); a range expression is "0 or more equality ([`.eq`]) … optionally a lower bound … optionally an upper bound"; "Since Convex automatically includes `_creationTime` as the last column in all indexes…"; querying by equality on a leading column orders by the remaining index columns. | https://docs.convex.dev/database/reading-data/indexes · https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf |
| 3 | ALIGNED | — | `convex/businesses/mutations.ts:242-253` (`moderationActionValidator`, args object) | Args are an object with `businessId: v.id('businesses')`, `action: v.union(v.literal('approve'), v.literal('requestChanges'), v.literal('reject'))`, `reason: v.optional(v.string())` | "pass an object with `args` and `handler` properties to the `query`, `mutation` or `action` constructor"; the validator table documents `v.id(tableName)`, `v.union`, `v.literal`, `v.optional`. Validation is "currently optional" for non-public functions but supported as used. | https://docs.convex.dev/functions/validation |
| 4 | ALIGNED | — | `convex/businesses/mutations.ts:276-284`; `convex/businesses/moderationPolicy.ts:35-60` (`normalizeModerationReason`) | Approve clears stale `moderationReason` by writing `undefined` through the patch (`moderationReason: normalizedReason` where the value is `undefined` for approve) | "`db.patch` … shallow merging it with the given partial document… Fields set to `undefined` are removed." | https://docs.convex.dev/database/writing-data |
| 5 | ALIGNED | — | `convex/businesses/mutations.ts:281-283` vs `convex/businessTypes.ts:47-50` + `convex/schema.ts:53` | Approve stamps `verification: { isVerified: true, verifiedAt: now, verifiedBy: admin._id }` | `verificationValidator = v.object({ isVerified: v.boolean(), verifiedAt: v.optional(v.number()), verifiedBy: v.optional(v.id('users')) })` — the stamped shape matches the validator exactly (required `isVerified`, optional `verifiedAt`/`verifiedBy`, `verifiedBy` typed `Id<'users'>`). | https://docs.convex.dev/functions/validation (validator semantics) |
| 6 | ALIGNED | — | `convex/authz.ts:27-47` (`requireSuperAdmin`, pre-existing) + calls at `queries.ts:205`, `mutations.ts:257`; `app/admin/layout.tsx` (pre-existing) | Identity comes from `ctx.auth.getUserIdentity()` + `identity.subject`, users row via `byExternalId`, plus the `SUPER_ADMIN_CLERK_IDS` env whitelist; UI gate is the pre-existing Clerk `auth()`/`getToken({ template: 'convex' })` layout. No new Clerk APIs introduced by the diff. | "Convex offers a provider that is specifically for integrating with Clerk called `<ConvexProviderWithClerk>`"; functions-auth documents `getUserIdentity()` returning an identity whose `subject` is the token subject; the `auth()` + `getToken({ template: 'convex' })` pattern is the documented Next.js Clerk integration. | https://docs.convex.dev/auth/clerk · https://docs.convex.dev/auth/functions-auth |
| 7 | ALIGNED | — | `app/admin/approvals/approvals-route.tsx:21-26` + `app/admin/approvals/approvals-load-boundary.tsx` | `queueStateFor` maps `useQuery` returning `undefined` to the `'loading'` state; render-time query failures are caught by a class error boundary (`ApprovalsLoadBoundary`) | "The `useQuery` hook returns `undefined` while the data is first loading"; for query errors: "the error will be sent to the client and thrown from your `useQuery` call site. The best way to handle these errors is with a React error boundary component." | https://docs.convex.dev/client/react/overview · https://docs.convex.dev/functions/error-handling |
| 8 | ALIGNED | — | `components/ui/dialog.tsx:21-82`, `app/admin/approvals/approval-action-dialog.tsx:133-214` | Controlled `<Dialog open onOpenChange>`; `DialogContent` with `onEscapeKeyDown`/`onInteractOutside` (preventDefault while submitting); `DialogClose asChild`; portal/overlay; Radix built-in focus trap and Esc-to-close | "Can be controlled or uncontrolled" (`open`, `onOpenChange`); "Focus is automatically trapped within modal"; "Esc closes the component automatically"; `Content` exposes `onEscapeKeyDown`, `onPointerDownOutside`, `onInteractOutside`; default open-focus goes to the first keyboard-focusable element (docs' default `onOpenAutoFocus` behavior, corroborated by primitives #2248: "The default behavior of `Dialog.Content` is to focus on the first focusable element inside it", and #2030). | https://www.radix-ui.com/primitives/docs/components/dialog · https://github.com/radix-ui/primitives/issues/2248 · https://github.com/radix-ui/primitives/issues/2030 |
| 9 | ALIGNED | — | `app/globals.css:97-150` (`@theme inline` tokens), usage in `approval-card.tsx`, `approval-states.tsx`, `dialog.tsx`, `textarea.tsx` | Design tokens via `@theme inline`: `--spacing-*` → `gap-gap`, `py-card`, `px-card`, `size-*`; `--radius-card` → `rounded-card`; `--font-display`/`--font-label` → `font-display`/`font-label` utilities; `--color-*` → `text-muted-foreground`, `bg-background`, `border-input`, `ring-ring` etc.; `field-sizing-content` on the textarea | Theme namespace table: "`--color-*` Color utilities … `--font-*` Font family utilities … `--spacing-*` Spacing and sizing utilities like `px-4`, `max-h-16` … `--radius-*` Border radius utilities"; "You can name your theme variables whatever you want within these namespaces, and a corresponding utility with the same name will become available"; `@theme inline` is the documented form for referencing runtime vars. `field-sizing-content` → `field-sizing: content` (page live; utility present in installed `tailwindcss/dist/lib.js`). | https://tailwindcss.com/docs/theme#theme-variable-namespaces · https://tailwindcss.com/docs/field-sizing |
| 10 | ALIGNED | — | `app/admin/layout.tsx` (pre-existing) + `app/admin/approvals/page.tsx` | `/admin/approvals` inherits the `/admin` layout gate (super-admin 404) purely from folder nesting — `page.tsx` declares no layout of its own | "By default, layouts in the folder hierarchy are also nested, which means they wrap child layouts via their `children` prop." A `layout` file inside a route segment wraps every nested page. | https://nextjs.org/docs/app/getting-started/layouts-and-pages#nesting-layouts |
| 11 | ALIGNED (fixed in this review) | — | `convex/businesses/mutations.ts:255-271`; `convex/businesses/moderationPolicy.ts:24-35`; surfaced by `app/admin/approvals/approvals-route.tsx:17-32` | Expected moderation failures now throw `ConvexError`; the route reads string/object `error.data` and falls back to `error.message` for other errors. | Convex recommends `ConvexError` for expected failures and preserves its custom `data` in production, unlike plain server errors which are redacted. | https://docs.convex.dev/functions/error-handling#differences-in-error-reporting-between-dev-and-prod · https://docs.convex.dev/functions/error-handling/application-errors |
| 12 | ALIGNED (fixed in this review) | — | `convex/businesses/queries.ts:215-216`; `convex/businesses/mutations.ts:94,259` | New queue joins, draft category validation, and moderation lookup use table-qualified `ctx.db.get(tableName, id)` calls. | Convex best practices recommend including the table name; this matches the repo's typed-ID precedent and protects future custom ID generation compatibility. | https://docs.convex.dev/understanding/best-practices/#always-include-the-table-name-when-calling-ctxdb-functions · https://docs.convex.dev/database/document-ids |
| 13 | VERSION-GAP | — | `components/ui/dialog.tsx:9-18` (comment), `package.json` (`@radix-ui/react-dialog: ^1.1.15`) | New primitives build on the scoped `@radix-ui/react-dialog` package; code comment: "the repo predates shadcn's Feb 2026 unified `radix-ui` package" | Installed `@radix-ui/react-dialog@1.1.23` == latest scoped version (still published/maintained, so nothing is broken today), but shadcn's Feb 2026 changelog: "The `new-york` style now uses the unified `radix-ui` package instead of individual `@radix-ui/react-*` packages" (unified latest = `radix-ui@1.6.7`). The artifact deliberately stays on the scoped package. | https://ui.shadcn.com/docs/changelog/2026-02-radix-ui · npm `radix-ui` 1.6.7 |
| 14 | VERSION-GAP | — | `pnpm-lock.yaml` (`next@16.3.5`, pre-existing) | Project ships Next 16.3.5; diff itself uses only stable App Router features (nested layout, async server component layout, client route shell) | Installed 16.3.5 vs latest 16.3.8 (patch-level; no documented breaking change affecting the artifact's usage) | https://nextjs.org/docs/app/getting-started/layouts-and-pages · npm `next` 16.3.8 |
| 15 | VERSION-GAP | — | `pnpm-lock.yaml` (`tailwindcss@4.1.11`, `@tailwindcss/postcss@4.1.11`, pre-existing) | Tailwind v4 utilities/tokens as used by the diff all exist in 4.1.11 (incl. `field-sizing-*`, `size-*`, `rounded-xs`, `shadow-xs`, `outline-hidden`) | Installed 4.1.11 vs latest 4.3.3 (same major; no removed utilities affecting the diff) | npm `tailwindcss` 4.3.3 · npm `@tailwindcss/postcss` 4.3.3 |
| 16 | VERSION-GAP | — | `pnpm-lock.yaml` (`typescript@5.8.3`, pre-existing) | Toolchain on TS 5.8.3; `tsc --noEmit` clean across the diff | Installed 5.8.3 vs latest 7.0.2. The repo pins `"typescript": "^5"` in `package.json` — a deliberate pin, not an artifact decision; no diff API depends on 7.x. | npm `typescript` 7.0.2 |
| 17 | UNVERIFIABLE | — | `convex/businesses/queries.ts:207-210` ordering assumption for documents **missing** the optional `submittedAt` field inside `byStatusSubmittedAt` | The queue relies on "(status, then submittedAt; `_creationTime` tiebreak)" so the oldest submission is reviewed first. For rows where `submittedAt` is undefined the exact sort position is not spelled out by the docs. | Searched: Convex Indexes page, Indexes-and-Query-Perf page for "optional / undefined / missing / null" — the pages document composite ordering, eq/bounds range expressions, and the automatic `_creationTime` last column, but do not state how a document *missing* an optional indexed field sorts relative to documents that have it. Impact is bounded: all `pendingReview` rows are written with `submittedAt` by `submitForReview`; only pre-existing/hand-crafted rows could lack it. | https://docs.convex.dev/database/reading-data/indexes · https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf |

## Summary

| Label | Count |
|-------|-------|
| ALIGNED | 11 |
| DRIFT | 0 |
| VERSION-GAP | 4 |
| UNVERIFIABLE | 1 |

**Top DRIFT findings:** none remain from the two recommendations addressed in this review.

## Recommendations (advisory)

1. **RESOLVED in this review:** expected moderation failures use `ConvexError`, and the route extracts structured error data with a safe fallback. The sibling `transition` path was intentionally left unchanged because it is outside these new queue decisions.
2. **RESOLVED in this review:** all `ctx.db.get` calls introduced by the staged issue #13 implementation include their table names.
3. **(VERSION-GAP 13, optional)** Keep the scoped `@radix-ui/react-dialog` for now (still the latest of that package and fully functional); when the repo next touches shadcn conventions, migrate `dialog.tsx`/`textarea.tsx` to the unified `radix-ui` package per the Feb 2026 changelog, or `npx shadcn migrate radix`. The in-code comment already flagging this is good.
4. **(Minor)** Schedule a routine upgrade sweep for Next (16.3.5 → 16.3.8) and Tailwind (4.1.11 → 4.3.3); nothing in the diff blocks on these.

## Notes

- **Verification executed:** `pnpm test` (state-machine verifier + `node --test` 137 pass / 0 fail), `pnpm build` (exit 0), and `pnpm exec tsc --noEmit` (exit 0) were run by this review after the fixes; runtime browser tracers are environment-deferred and documented in `tasks/issue-13-tracers.md` — no live Convex deployment or dev server was available in this review.
- **Convex `useQuery` errors:** the docs recommend a React error boundary, which `ApprovalsLoadBoundary` implements; the ConvexError client-display fix in Finding 11 applies to the moderation mutation's actionable errors.
- **`transition` narrowing:** the diff also narrows the generic `transition` mutation so moderation actions route only through `moderateListing`; this is a logic/state-machine change covered by `scripts/verify-state-machine.ts` (PASS) and is not a library-claims matter, so it carries no alignment classification of its own.
- **Source conflicts:** none — the Radix "first focusable element gets focus on open" detail is not spelled out on the official Dialog page (it documents focus trap + `onOpenAutoFocus`), so it was corroborated via the official primitives issue tracker (#2248, #2030); everything else was confirmed from official docs directly.
- **Version ambiguities:** "latest" versions for the Stack table were read from the npm registry via `octocode.npmSearch` on 2026-10-03. Installed versions were read from `pnpm-lock.yaml` (never guessed).
- **Firecrawl note:** two Convex URLs 404'd on first fetch (`/database/transactions`, `/functions/mutations`) and were resolved to their current canonical pages (`/database/writing-data`, `/functions/mutation-functions`) — no retry failures after that. `.firecrawl/` cache artifacts from this research are untracked in git.
