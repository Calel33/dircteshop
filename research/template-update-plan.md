## 1. Executive Summary

This starter currently runs on Next.js 15.3.5, React 19.0.0, Clerk v6, Convex 1.25.2, Radix UI 1.x/2.x, and Tailwind CSS v4. All core dependencies have newer stable releases available, most notably Next.js 16.1.0, React 19.2.3, Clerk SDK updates, Convex 1.31.x, and Zod 4.x. npm audit reports a critical Next.js vulnerability (React flight/RSC RCE plus several image/middleware issues) that is fully remediated by upgrading Next.js beyond the affected 15.x range; additional ecosystem advisories in late 2025 further reinforce the need to move to the latest 16.x security releases. A structured migration to Next.js 16, with aligned upgrades for React, Clerk, Convex, Radix, Tailwind, and related tooling, can be completed without changing the overall architecture, but will require focused work on async request APIs, auth integration, and verifying cache/middleware behavior.

Estimated effort for full migration (including testing) is roughly 1–2 focused days for an experienced engineer familiar with Next.js App Router and Clerk/Convex, assuming no unexpected third‑party regressions. The highest priority is removing the known Next.js 15.x security issues by upgrading to Next.js 16.1.0 and React 19.2.3, then aligning Clerk and Convex integrations with their latest best practices.

## 2. Dependency Update Matrix

The table below covers the primary runtime dependencies. Versions and latest tags are based on the local `npm outdated --json` output and current official docs at the time of this report.

| Package                 | Current            | Latest / Target  | Type              | Breaking Changes / Notes                                                                                                                                                                                                                                                                                                                                                                   | Security Issues                                                                                                                                                                                                                |
| ----------------------- | ------------------ | ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `next`                  | 15.3.5             | 16.1.0           | **major**         | Next.js 16 promotes Turbopack to default, fully removes sync Dynamic APIs (cookies/headers/params/searchParams), tightens async request APIs, changes turbopack config location, and updates Node/TS minimums. Check for any sync `cookies/headers/draftMode` usage and custom webpack config.                                                                                             | npm audit flags multiple issues in 15.x including critical RCE in React flight protocol (GHSA-9qr9-h5gf-34mp) and DoS and image‑related vulnerabilities; upgrade to >=16.x to remediate and track Next.js security advisories. |
| `react`                 | ^19.0.0            | ^19.2.3          | minor             | React 19.2 includes new features (View Transitions, `useEffectEvent`, Activity) and continued canary stabilization; no template‑specific breaking changes, but ensure any experimental APIs align with Next.js 16 support.                                                                                                                                                                 | Covered indirectly by React Server Components / RSC vulnerabilities – keep React at current patched 19.x and follow framework guidance.                                                                                        |
| `react-dom`             | ^19.0.0            | ^19.2.3          | minor             | Matches React core; no additional template‑specific breakage expected.                                                                                                                                                                                                                                                                                                                     | Same as React.                                                                                                                                                                                                                 |
| `@clerk/nextjs`         | ^6.24.0            | ^6.36.4          | minor             | v6 already adopted but latest patch adds improvements and bugfixes; key v6 breaking changes vs earlier include async `auth()`, async `clerkClient()`, `auth.protect()` instead of `auth().protect()`, and static rendering by default unless `dynamic` is set on `ClerkProvider`. The current middleware pattern already matches the v6 async style.                                       | No specific CVEs surfaced, but staying current is recommended for auth/security patches.                                                                                                                                       |
| `@clerk/backend`        | ^2.4.1             | ^2.28.0          | minor             | Backend helper updates; review any backend code using `clerkClient` and `verifyToken` if added later.                                                                                                                                                                                                                                                                                      | Same as above.                                                                                                                                                                                                                 |
| `@clerk/themes`         | ^2.2.55            | ^2.4.45          | minor             | Design/UX updates to hosted components; may require small appearance/localization tweaks if you heavily customize Clerk themes.                                                                                                                                                                                                                                                            | None known.                                                                                                                                                                                                                    |
| `convex`                | ^1.25.2            | ^1.31.2          | **minor/feature** | Convex client/server have continued to refine TypeScript types, React integration, and auth providers; Next.js + Clerk example now strongly encourages `ConvexProviderWithClerk` and `useConvexAuth`. The current template already uses the recommended `ConvexProviderWithClerk` wrapper and `auth.config.ts`, so breakage risk is low but review changelog for any auth/type tightening. | No public high‑severity CVEs; keep current for general security posture.                                                                                                                                                       |
| `@radix-ui/react-*`     | 1.1.x / 2.2.5      | Latest 1.x / 2.x | patch/minor       | Radix added React 19 and RSC compatibility, bugfixes for forms, tooltips, and accessibility; no major API changes for the primitives used here (Avatar, Checkbox, Dialog, DropdownMenu, Label, Select, Separator, Slot, Switch, Tabs, Toggle, ToggleGroup, Tooltip). Validate interactive components visually after upgrade.                                                               | None known; primarily quality/accessibility fixes.                                                                                                                                                                             |
| `tailwindcss`           | ^4                 | ^4.1.x           | minor             | Tailwind v4 is already in use; latest 4.1.x adds performance improvements and small API refinements. Major breaking changes from 3.x (CSS‑first config, new engine, theme variables) are already adopted.                                                                                                                                                                                  | None known; keep current for engine and PostCSS fixes.                                                                                                                                                                         |
| `@tailwindcss/postcss`  | ^4                 | ^4.1.x           | minor             | Tracks Tailwind core; ensure PostCSS config matches latest docs.                                                                                                                                                                                                                                                                                                                           | None known.                                                                                                                                                                                                                    |
| `lucide-react`          | ^0.525.0           | ^0.562.0         | minor             | Icon additions/updates; no breaking changes expected for existing icons.                                                                                                                                                                                                                                                                                                                   | None known.                                                                                                                                                                                                                    |
| `recharts`              | ^2.15.4            | ^3.6.0           | **major**         | v3 modernizes chart APIs and may introduce breaking changes around component props and internal layout; audit dashboard chart usage in `app/dashboard/chart-area-interactive` before upgrading. Consider deferring this if migration cost is high and security risk is low.                                                                                                                | No widely reported security issues; primarily a DX/perf update.                                                                                                                                                                |
| `zod`                   | ^3.25.76           | ^4.2.1           | **major**         | Zod 4 introduces breaking type and API changes; upgrade requires touching any schema/validation code. This template appears to use Zod lightly; review all `zod` imports (e.g. in schemas or API validation) before bumping to v4.                                                                                                                                                         | No critical CVEs known; upgrade mainly for features and DX.                                                                                                                                                                    |
| `framer-motion`         | ^12.23.3           | ^12.23.26        | patch             | Small bugfixes/perf improvements; no breaking changes expected.                                                                                                                                                                                                                                                                                                                            | None known.                                                                                                                                                                                                                    |
| `motion`                | ^12.23.0           | ^12.23.26        | patch             | Animation helpers aligned with framer‑motion; safe patch bump.                                                                                                                                                                                                                                                                                                                             | None known.                                                                                                                                                                                                                    |
| `@tabler/icons-react`   | ^3.34.0            | ^3.36.0          | patch             | Icon additions/bugfixes only.                                                                                                                                                                                                                                                                                                                                                              | None known.                                                                                                                                                                                                                    |
| `sonner`                | ^2.0.6             | ^2.0.7           | patch             | Toast notification fixes; non‑breaking.                                                                                                                                                                                                                                                                                                                                                    | None known.                                                                                                                                                                                                                    |
| `svix`                  | ^1.69.0            | ^1.82.0          | minor             | Webhook client improvements; check any webhook usage if added beyond starter defaults.                                                                                                                                                                                                                                                                                                     | Review Svix advisories if you expose webhooks heavily; no specific CVEs surfaced in this audit.                                                                                                                                |
| `tailwind-merge`        | ^3.3.1             | ^3.4.0           | minor             | Better class merge behavior; safe upgrade.                                                                                                                                                                                                                                                                                                                                                 | None known.                                                                                                                                                                                                                    |
| `next-themes`           | ^0.4.6             | ^0.4.6           | none              | Already current.                                                                                                                                                                                                                                                                                                                                                                           | None known.                                                                                                                                                                                                                    |
| `@tanstack/react-table` | ^8.21.3            | ^8.21.3          | none              | Already current.                                                                                                                                                                                                                                                                                                                                                                           | None known.                                                                                                                                                                                                                    |
| `@dnd-kit/*`            | As in package.json | latest matches   | none              | Current versions already match latest per `npm outdated`; no changes required.                                                                                                                                                                                                                                                                                                             | None known.                                                                                                                                                                                                                    |

DevDependencies (`typescript`, `@types/*`, `tw-animate-css`) are already specified with `^` ranges targeting the latest major lines compatible with React 19 and Next 16. You can optionally pin them to their exact latest patch versions when performing the migration, but this is not strictly required for security.

## 3. Security Audit Results

**Tooling used:** `npm audit --json`, plus external research on recent Next.js/React security advisories (including React2Shell and related Next.js vulnerabilities).

- **Critical:** Next.js 15.3.5 is affected by multiple vulnerabilities:
  - **React flight protocol / RSC RCE (GHSA-9qr9-h5gf-34mp)** – Remote code execution affecting React Server Components integration in Next 15.3.x.
  - **Server Components DoS (GHSA-mwv6-3258-q52c)** – Potential denial of service via malicious RSC traffic.
  - **Source code exposure in Server Actions (GHSA-w37m-7fhw-fmv9)** – Risk of server code leakage via mis‑handled Server Actions.
  - **Image Optimization vulnerabilities** (cache key confusion and content injection – GHSA-g5qg-72qw-gw5v, GHSA-xv57-4mr9-wg8v).
  - **Middleware redirect SSRF risk** (GHSA-4342-x723-ch2f).
- **Audit summary:**
  - `npm audit` reports **1 critical vulnerability** tied to `next` with multiple underlying advisories.
  - `fixAvailable` suggests upgrading to a patched 15.5.9, but the long‑term fix should be upgrading fully to **Next.js 16.1.0** as recommended by the official `Upgrading: Version 16` guide.
- **Other dependencies:** No additional critical or high vulnerabilities surfaced directly in the audit output, but the broader ecosystem advisories (React2Shell, CVE‑2025‑66478, and related) all recommend staying on the latest React/Next patch streams.

**Remediation steps:**

1. Upgrade `next` to **16.1.0** and align `react`/`react-dom` to **19.2.3**.
2. Rebuild and run test suites to verify no regressions in RSC and Server Actions.
3. Review any use of Server Actions, `route.ts` handlers, and middleware redirects to ensure they follow current security guidance.
4. Track the Next.js security blog for any further 16.x patches and update promptly.

## 4. Breaking Changes Detail

### 4.1 Next.js 15 → 16

Key breaking changes from the official `Upgrading: Version 16` guide that are relevant to this template:

- **Async Dynamic Request APIs only**
  - Temporary synchronous access to `cookies`, `headers`, `draftMode`, `params`, and `searchParams` introduced in 15 is fully removed.
  - Impact: Search the codebase for any synchronous calls like `cookies()`, `headers()`, or direct `params`/`searchParams` usage in `page.tsx`, `layout.tsx`, `route.ts`, and metadata/image route files.
  - Migration: Use the codemod (`npx @next/codemod@canary upgrade latest` and the async dynamic APIs codemod) or manually convert to async functions and `await` the respective helpers; for pages and layouts, prefer the new `PageProps` / `LayoutProps` helpers generated by `npx next typegen`.

- **Turbopack by default**
  - `next dev` and `next build` now use Turbopack without needing `--turbopack`.
  - In this template, `package.json` currently has `"dev": "next dev --turbopack"`; this can be simplified to `"next dev"` and `"next build"` without flags.
  - If you introduce a custom `webpack` config later, be aware that Turbopack builds will fail if that config is present; use `--webpack` or migrate to `turbopack` configuration.

- **Turbopack config location change**
  - `experimental.turbopack` is replaced by a top‑level `turbopack` option in `next.config.ts`.
  - This template’s `next.config.ts` is minimal; if you add turbopack config, ensure it uses the new top‑level field when on Next 16.

- **Async parameters for metadata image routes and sitemap**
  - `params` and `id` props for `opengraph-image`, `twitter-image`, `icon`, `apple-icon`, and `sitemap` become promises.
  - Impact: Only relevant if you add such route files; currently none are present in the starter.

- **React 19.2 + React Compiler support**
  - Next 16 uses the latest React 19.2 canary features. React Compiler can be enabled via `reactCompiler: true` in `next.config.ts`.
  - Impact: Optional, but you may choose to enable the compiler later for perf gains.

### 4.2 Clerk SDK v6

The template already follows most v6 patterns, but important breaking changes to keep in mind:

- **`auth()` and `clerkClient()` are async**
  - Any server or middleware code must `await auth()` / `await clerkClient()`.
  - Current `middleware.ts` uses `clerkMiddleware(async (auth, req) => { if (isProtectedRoute(req)) await auth.protect() })`, which is compatible.

- **`auth().protect()` → `auth.protect()`**
  - The template already uses `auth.protect()`, matching current docs.

- **Static rendering by default**
  - `ClerkProvider` no longer forces dynamic rendering for the whole app. If you rely on per‑request auth data at render time in server components, use `auth()` on the server; only set `dynamic` on `ClerkProvider` if absolutely necessary.
  - In `app/layout.tsx`, `ClerkProvider` wraps `ConvexClientProvider` and the rest of the app. This is correct; consider whether any server components depend on per‑request auth‑driven rendering and, if so, migrate them to use `auth()` instead of assuming dynamic rendering.

### 4.3 Convex

- **Auth integration with Clerk**
  - The current pattern (`ConvexProviderWithClerk` in a client wrapper, `ClerkProvider` in `app/layout.tsx`, and `auth.config.ts` using Clerk’s issuer domain) matches Convex’s Next.js + Clerk guide.
  - Upgrading `convex` from 1.25.x to 1.31.x is primarily a type and DX improvement; just verify that `auth.config.ts` continues to satisfy `AuthConfig` and that any Convex functions using `ctx.auth.getUserIdentity()` still compile.

### 4.4 Tailwind CSS v4

- The template already uses Tailwind v4 with `@tailwindcss/postcss`.
- The major breaking changes (CSS‑first configuration, new engine, theme variables) are already absorbed; only minor version updates remain.

### 4.5 Radix UI

- Recent Radix releases focus on React 19 compatibility, SSR improvements, and bugfixes.
- No breaking prop or component name changes for the primitives in use were identified; most changes are internal or additive.

### 4.6 Zod 3 → 4 (if you choose to upgrade)

- Zod 4 introduces breaking changes in some type inference and refinements.
- Before upgrading, locate all `zod` usage (validators, schemas for Convex types, or API validation) and test type‑level behavior; given that this starter uses Zod lightly, migration is feasible but optional if you prefer to defer.

## 5. Code Pattern Updates

Using the codebase structure and representative files surfaced by the MCP codebase retrieval, here are modernization recommendations:

- **App Router & async APIs**
  - **What to review:** All files in `app/` that might use `cookies`, `headers`, `draftMode`, `params`, or `searchParams` synchronously. The sampled files (`app/layout.tsx`, `app/dashboard/page.tsx`, `app/(landing)/*.tsx`) do not currently show such usage, which reduces Next 16 migration risk.
  - **Update pattern:** For any future or hidden usage, convert pages/layouts/routes to async and use the Next 16 async helpers plus `PageProps`/`LayoutProps` from `next typegen` for type‑safe params/searchParams.

- **Root layout and providers** (`app/layout.tsx`)
  - Current pattern:
    - Imports Geist fonts, wraps `body` with `ThemeProvider`, `ClerkProvider`, and `ConvexClientProvider`.
    - This matches the Clerk + Convex integration docs for App Router.
  - **Modernization:**
    - After upgrading Next, simplify scripts in `package.json` to drop `--turbopack` and rely on built‑in Turbopack.
    - Optionally adopt `reactCompiler: true` in `next.config.ts` once React Compiler stability is verified for your use‑case.

- **Middleware auth pattern** (`middleware.ts`)
  - Uses `clerkMiddleware` with `createRouteMatcher` to protect `/dashboard(.*)` routes and matches the recommended v5/v6 Core 2 middleware style.
  - **Modernization:** No structural change required; just keep Clerk updated and ensure any additional protected routes use `auth.protect()` as shown.

- **Convex client integration** (`components/ConvexClientProvider.tsx`)
  - Client component wrapping `ConvexProviderWithClerk` with `useAuth` and `ConvexReactClient` configured from `NEXT_PUBLIC_CONVEX_URL`, exactly as in Convex’s Next.js + Clerk example.
  - **Modernization:** No change required beyond bumping `convex` to the latest 1.31.x line and ensuring environment variables (`NEXT_PUBLIC_CONVEX_URL`, Clerk issuer domain via `auth.config.ts`) remain configured.

- **Auth‑aware UI** (e.g. `app/(landing)/header.tsx`)
  - Uses Convex’s `Authenticated`, `Unauthenticated`, and `AuthLoading` wrappers around Clerk’s `SignInButton`, `SignUpButton`, and `UserButton`, along with `useTheme` and `dark` theme from `@clerk/themes`.
  - **Modernization:** This matches the current Convex + Clerk guidance and React 19 patterns; after upgrading Clerk and Convex, verify that these components still render correctly and that CSS tokens / themes are intact.

- **Dashboard UI and layout** (`app/dashboard/*.tsx`)
  - Uses modern shadcn‑style components (e.g. `Sidebar`, `Badge`, etc.) and container queries.
  - **Modernization:** No structural changes required for Next 16; just verify that any dynamic data rendering continues to work under async APIs and Turbopack.

- **TypeScript & typings**
  - The project already uses TS 5 with `@types/react@19` and `@types/react-dom@19`.
  - **Modernization:** After upgrading Next, run `npx next typegen` to generate `PageProps`, `LayoutProps`, and `RouteContext` types, and progressively adopt them where you introduce async params/searchParams, especially in any new dynamic routes you add.

## 6. Updated package.json

Below is a proposed `package.json` with dependencies updated to the latest stable versions compatible with Next.js 16.1.0, React 19.2.3, Clerk v6, Convex 1.31.x, and Tailwind v4. Dev dependencies retain their current major lines with `^` ranges, which will resolve to latest compatible minor/patch releases.

```json
{
  "name": "elite-next-starter",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@clerk/backend": "^2.28.0",
    "@clerk/nextjs": "^6.36.4",
    "@clerk/themes": "^2.4.45",
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/modifiers": "^9.0.0",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@radix-ui/react-avatar": "^1.1.11",
    "@radix-ui/react-checkbox": "^1.3.3",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-label": "^2.1.8",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-separator": "^1.1.8",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-switch": "^1.2.6",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-toggle": "^1.1.10",
    "@radix-ui/react-toggle-group": "^1.1.11",
    "@radix-ui/react-tooltip": "^1.2.8",
    "@tabler/icons-react": "^3.36.0",
    "@tanstack/react-table": "^8.21.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "convex": "^1.31.2",
    "framer-motion": "^12.23.26",
    "lucide-react": "^0.562.0",
    "motion": "^12.23.26",
    "next": "16.1.0",
    "next-themes": "^0.4.6",
    "react": "^19.2.3",
    "react-dom": "^19.2.3",
    "react-use-measure": "^2.1.7",
    "recharts": "^3.6.0",
    "sonner": "^2.0.7",
    "svix": "^1.82.0",
    "tailwind-merge": "^3.4.0",
    "vaul": "^1.1.2",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4",
    "tw-animate-css": "^1.3.5",
    "typescript": "^5"
  }
}
```

Notes:

- `next` is pinned to `16.1.0` rather than a caret range to align with the current documented latest and to keep upgrades explicit; you can switch to `^16.1.0` later if you prefer automatic minor updates.
- `zod` is intentionally left at `3.x` to avoid forcing a Zod 4 migration; see §4.6. If you opt into Zod 4, update the version and adjust any schemas accordingly.
- Dev dependencies are left as `^` ranges on their current major lines to avoid unnecessary friction; you may run `npm outdated` periodically to bump them.

## 7. Migration Checklist

Use this checklist to perform the migration in a safe, ordered way.

- **Pre‑migration**
  - [ ] Create a new branch specifically for the upgrade.
  - [ ] Ensure a recent backup or tagged commit of the current state exists.
  - [ ] Verify Node.js version is **>= 20.9.0** (Next.js 16 requirement); you’re targeting Node 24.12.0, which is compatible.

- **Dependency upgrades**
  - [ ] Replace the existing `package.json` with the updated version from §6 (or merge changes carefully).
  - [ ] Run `npm install` to resolve and lock updated versions.
  - [ ] Confirm `node_modules/next` shows 16.1.0 and `react`/`react-dom` show 19.2.3.
  - [ ] Optionally upgrade `recharts` and `zod` only after the core framework migration is stable if you want to minimize risk.

- **Framework & API migrations**
  - [ ] Run `npx @next/codemod@canary upgrade latest` to apply automatic Next.js 16 codemods (Turbopack config, middleware migration, lint changes, etc.).
  - [ ] Run the async Dynamic APIs codemod to convert any sync `cookies`/`headers`/`params`/`searchParams` usage to async where applicable.
  - [ ] Manually verify there are no remaining sync usages of the APIs listed in §4.1.
  - [ ] Simplify `package.json` scripts to remove `--turbopack` flags as shown.
  - [ ] If you add or already use metadata image routes (`opengraph-image`, `twitter-image`, `icon`, `apple-icon`) or `sitemap`, ensure their `params`/`id` handlers are async per Next 16 docs.

- **Auth & Convex integration**
  - [ ] Ensure any new server or middleware code uses `await auth()` / `await clerkClient()` and `auth.protect()`.
  - [ ] Confirm `convex/auth.config.ts` still satisfies `AuthConfig` and references `NEXT_PUBLIC_CLERK_FRONTEND_API_URL` or `CLERK_JWT_ISSUER_DOMAIN` correctly.
  - [ ] Smoke test Convex queries/mutations and `Authenticated`/`Unauthenticated` rendering in both landing and dashboard flows.

- **UI & component checks**
  - [ ] Manually verify core routes: landing page, sign‑in/sign‑up, dashboard, and payment‑gated content.
  - [ ] Check all Radix‑backed components (dialogs, dropdown menus, selects, tooltips, switches, tabs) for expected keyboard and pointer interactions.
  - [ ] Validate charts (Recharts) still render correctly; if upgrading to v3, follow their migration notes for prop changes.

- **Testing & verification**
  - [ ] Run `npm run lint` and fix any reported issues (particularly around new async patterns).
  - [ ] Run the app with `npm run dev` and exercise all auth paths (sign‑in, sign‑up, sign‑out, dashboard access, webhooks if configured).
  - [ ] Run `npm run build` and start the production server with `npm start`, verifying there are no build‑time or runtime errors.
  - [ ] Re‑run `npm audit` and confirm that the previous `next` critical vulnerability is resolved and no new critical issues are present.

## 8. Risk Assessment

- **Primary risks**
  - **Security exposure if migration is delayed:** Remaining on Next.js 15.3.5 leaves the app vulnerable to known critical RSC/RCE and related issues.
  - **Async API regressions:** If any synchronous dynamic request APIs are used (cookies/headers/params/searchParams), they may break at runtime under Next 16 unless migrated.
  - **Third‑party component behavior:** Recharts major upgrades and Radix patches could introduce subtle visual or behavioral differences; these are low security risk but can affect UX.

- **Mitigations**
  - Use codemods wherever possible for Next.js and Clerk migrations to reduce manual error.
  - Keep the migration tightly scoped: upgrade core framework and auth first, validate, then incrementally tackle optional major upgrades (`recharts`, `zod`).
  - Maintain a dedicated upgrade branch and avoid mixing unrelated feature work into the migration.

- **Rollback strategy**
  - If severe issues are encountered, revert to the pre‑migration commit or branch and re‑deploy.
  - Because the migration is primarily dependency and pattern updates (no schema migrations), rollback is straightforward and low‑risk.

- **Testing recommendations**
  - Focus on end‑to‑end flows that exercise:
    - Authentication via Clerk (sign‑in, sign‑up, session persistence).
    - Convex‑backed, payment‑gated dashboard pages.
    - Any routes that use dynamic params or server actions.
  - Add targeted tests for any newly async handlers or server components introduced during migration.

Overall, the migration risk is manageable and justified by the security benefits of leaving the vulnerable Next.js 15.x line, especially given React2Shell‑class vulnerabilities and the strong official guidance to move to patched Next.js 16.x and React 19.x.

## 9. Upgrade Cheatsheet (Code Patterns)

This section collects copy/pasteable patterns tailored to this starter so upgrades stay consistent.

### 9.1 Next.js 16 + React 19

**Async page/layout props (no sync `params`/`searchParams`):**

```ts
// app/dashboard/[id]/page.tsx
import type { PageProps } from "next";

export default async function Page(props: PageProps<"/dashboard/[id]"><?>) {
  const { id } = await props.params;
  const search = await props.searchParams;
  // ...
  return <div>Dashboard {id}</div>;
}
```

**Async request helpers in route handlers:**

```ts
// app/api/example/route.ts
import { cookies, headers } from 'next/headers';

export async function GET() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  // ...
  return new Response('ok');
}
```

**Updated scripts (Turbopack default):**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint"
}
```

### 9.2 Clerk v6 + Middleware/Auth

**Middleware (pattern used in this repo):**

```ts
// middleware.ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
```

**Server route using async `auth()`:**

```ts
// app/api/me/route.ts
import { auth } from '@clerk/nextjs/server';

export async function GET() {
  const { userId } = await auth();
  if (!userId) return new Response('Unauthorized', { status: 401 });
  return Response.json({ userId });
}
```

**Protecting a server component page:**

```ts
// app/dashboard/page.tsx
import { auth } from "@clerk/nextjs/server";

export default async function DashboardPage() {
  await auth.protect();
  return <div>Dashboard</div>;
}
```

### 9.3 Convex + Clerk Integration

**Client provider (matches current `ConvexClientProvider`):**

```ts
"use client";

import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
```

**Root layout wiring:**

```tsx
// app/layout.tsx
import { ClerkProvider } from '@clerk/nextjs';
import ConvexClientProvider from '@/components/ConvexClientProvider';
import { ThemeProvider } from '@/components/theme-provider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="...">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ClerkProvider>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**Auth‑aware UI using Convex helpers and Clerk buttons:**

```tsx
import { Authenticated, Unauthenticated, AuthLoading } from 'convex/react';
import { SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';

export function HeaderAuth() {
  return (
    <>
      <Unauthenticated>
        <SignInButton />
        <SignUpButton />
      </Unauthenticated>
      <Authenticated>
        <UserButton />
      </Authenticated>
      <AuthLoading>
        <p>Loading...</p>
      </AuthLoading>
    </>
  );
}
```

### 9.4 Tailwind CSS v4

**CSS‑first Tailwind config with theme tokens:**

```css
/* app/globals.css */
@import 'tailwindcss';

@theme {
  --spacing: 0.25rem;
  --color-primary: #0f172a;
  --font-sans: system-ui, sans-serif;
}
```

**Using container queries (pattern already in dashboard layout):**

```tsx
<div className="@container/main flex flex-1 flex-col gap-2">
  <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">{children}</div>
  {/* ... */}
</div>
```

Use these patterns as the default shape when adding or refactoring code during the migration so new changes stay aligned with Next 16, React 19, Clerk v6, Convex 1.31.x, and Tailwind v4 best practices.
