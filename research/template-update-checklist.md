## Template Upgrade Checklist

Use this checklist alongside `research/template-update-plan.md` when performing the migration.

### 1. Planning

- [ ] Confirm migration scope (core framework only vs including `recharts`/`zod`).
- [ ] Ensure a pre-migration backup or tagged commit exists.
- [ ] Verify Node.js version is >= 20.9.0.

### 2. Dependencies

- [ ] Update `package.json` to match the versions proposed in section 6 of `template-update-plan.md`.
- [ ] Run `npm install`.
- [ ] Confirm installed versions: `next@16.1.0`, `react@19.2.3`, `react-dom@19.2.3`.
- [ ] Decide whether to upgrade `recharts` to 3.x now or later.
- [ ] Decide whether to upgrade `zod` to 4.x now or later.

### 3. Framework & APIs

- [ ] Update scripts to use `next dev`, `next build`, `next start`, `next lint` (no `--turbopack`).
- [ ] Run `npx @next/codemod@canary upgrade latest`.
- [ ] Run the async Dynamic APIs codemod for `cookies`/`headers`/`params`/`searchParams`.
- [ ] Manually verify there is no remaining sync usage of those APIs.
- [ ] (If present) Update metadata image routes and `sitemap` to the async `params`/`id` pattern.

### 4. Auth & Convex

- [ ] Confirm middleware uses `clerkMiddleware` with `auth.protect()` for protected routes.
- [ ] Ensure all server routes use `await auth()` / `await clerkClient()` where needed.
- [ ] Verify `convex/auth.config.ts` still satisfies `AuthConfig` and references Clerk issuer correctly.
- [ ] Smoke test Convex queries/mutations and `Authenticated`/`Unauthenticated` UI.

### 5. UI & Components

- [ ] Manually verify landing page, sign-in, sign-up, and sign-out flows.
- [ ] Verify dashboard and payment-gated content render correctly.
- [ ] Check Radix-based components (dialogs, dropdowns, selects, tooltips, switches, tabs) for correct behavior and accessibility.
- [ ] If upgrading `recharts`, verify all charts render with expected data and styling.

### 6. Testing & Verification

- [ ] Run `npm run lint` and fix all issues.
- [ ] Run `npm run build` and ensure it succeeds.
- [ ] Run `npm start` and smoke test the production build.
- [ ] Re-run `npm audit` and confirm the previous Next.js 15 critical vulnerability is resolved.

### 7. Post-Migration

- [ ] Document any follow-up items (e.g., enabling React Compiler, deferred `recharts`/`zod` upgrades).
- [ ] Merge the upgrade branch back into your main line after review.
