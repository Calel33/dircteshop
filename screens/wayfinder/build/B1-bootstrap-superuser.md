# Build Ticket B1: Bootstrap the app + superuser boundary

Slice owner: SPEC §3 (roles & auth). Decisions from tickets 02, 03. Blocking: none.

## End-to-end slice

Clone `Calel33/template-app` into a fresh repo. Configure Convex + Clerk (template README steps; webhook URL is the Convex HTTP route `/clerk-users-webhook`, NOT `/api/...`). Then:

1. Schema: add `role: v.union(v.literal('user'), v.literal('superAdmin'))` to users (+ migration assignment for existing rows).
2. Convex env: `SUPER_ADMIN_CLERK_IDS=<your Clerk user ID>` (exactly one in production).
3. Stamp role in `upsertFromClerk` (internalMutation) from the whitelist — cite [wayfinder/research/superuser-auth-boundary.md](../wayfinder/research/superuser-auth-boundary.md) for the exact hook point.
4. `convex/authz.ts`: `requireSuperAdmin(ctx)` helper per the research asset (identity → row → role → whitelist re-check; fails closed).
5. `middleware.ts`: add `/admin(.*)` to the auth matcher.
6. `app/admin/layout.tsx`: server-side super-admin check → `notFound()` on failure. Placeholder index page.
7. Keep the invariant: no public function accepts or writes `role`.

## Done when (verification evidence)

- `pnpm lint` + `pnpm build` clean.
- You (whitelisted) reach `/admin` placeholder; a second Clerk account gets 404.
- Convex row shows `role: 'superAdmin'` after a user.updated event.
- Removing the ID from env (temporarily) blocks you on the next request (guard re-checks).

## Follow-ups opened by this ticket

- Decide the **owner-deletion policy** (SPEC §3 open item) before B2 creates ownership data: recommended — block Clerk user deletion handling (keep the row, mark inactive) or make `deleteFromClerk` skip when businesses exist; record the decision here when made.
