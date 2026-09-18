# Research Asset: Superuser auth boundary for LocalConnect (ticket 02)

Source: /research subagent, resolved at map charting. All template claims cite fetched file contents from https://github.com/Calel33/template-app (master).

## Template Auth Wiring (observed)

- `middleware.ts`:
  ```ts
  const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);
  export default clerkMiddleware(async (auth, req) => {
    if (isProtectedRoute(req)) await auth.protect();
  });
  ```
  `/admin` is NOT protected; no role checks anywhere.
- `convex/schema.ts`: `users {name, externalId}` — no role field.
- `convex/users.ts`: `upsertFromClerk` / `deleteFromClerk` are `internalMutation`s; the ONLY users-table writers, invoked by the webhook. Identity resolution: `ctx.auth.getUserIdentity()` → `users.byExternalId` on `identity.subject`. `upsertFromClerk` args trust webhook data (`v.any() as Validator<UserJSON>`) — safe only because the route is Svix-verified and internal.
- `convex/http.ts`: POST `/clerk-users-webhook` (Convex HTTP router, NOT a Next.js `/api` route — README/CLAUDE.md references to `/api/clerk-users-webhook` are inaccurate). Svix verify with `svix-id`/`svix-timestamp`/`svix-signature`; invalid → 400. Events: user.created/updated → upsert, user.deleted → delete, paymentAttempt.updated.
- `app/dashboard/layout.tsx`: no auth guard of its own — relies entirely on middleware.
- `app/dashboard/payment-gated/page.tsx`: `<Protect>` checks `has({plan:'free_user'})` — billing gating, unrelated to identity authz. Do not reuse for admin.
- Versions: `@clerk/nextjs ^6.36.4`, `@clerk/backend ^2.28.0`, `convex ^1.31.2`, `next 16.1.0`, `svix ^1.82.0`.

## Enforcement Design

### Schema

```ts
users: defineTable({
  name: v.string(),
  externalId: v.string(),
  role: v.union(v.literal('user'), v.literal('superAdmin')),
}).index('byExternalId', ['externalId'])
```
Migration: existing rows get `role: 'user'` except the whitelisted Clerk ID.

### Bootstrap

Convex deployment env var (NOT `NEXT_PUBLIC_*`):
```env
SUPER_ADMIN_CLERK_IDS=user_123
```
Exactly one ID in production. Stamp in `upsertFromClerk`:

```ts
const role = isConfiguredSuperAdmin(data.id) ? 'superAdmin' : 'user';
// included in both insert and patch of userAttributes
```

The per-request guard re-reads the env whitelist every call — authoritative check. Stamped role is a projection. Consequences: removing an ID revokes access on next request even with stale `role:"superAdmin"`; adding an ID grants access before the next webhook, provided the users row exists.

### Route protection (three layers)

1. Middleware: `createRouteMatcher(['/admin(.*)'])` added → `auth.protect()` (authentication only).
2. `app/admin/layout.tsx` (server component): server-side Convex super-admin check → `notFound()` on failure. 404 chosen: a redirect reveals /admin exists; 403 confirms a privileged endpoint; 404 is indistinguishable from a missing route.
3. `requireSuperAdmin(ctx)` at the top of every admin query/mutation — the real security boundary (direct Convex calls bypass Next.js).

### Guard helper (convex/authz.ts)

```ts
import type { MutationCtx, QueryCtx } from './_generated/server';

type AuthenticatedCtx = QueryCtx | MutationCtx;

function configuredSuperAdminIds(): Set<string> {
  return new Set(
    (process.env.SUPER_ADMIN_CLERK_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export async function requireSuperAdmin(ctx: AuthenticatedCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) throw new Error('Unauthorized');
  const user = await ctx.db
    .query('users')
    .withIndex('byExternalId', (q) => q.eq('externalId', identity.subject))
    .unique();
  if (
    user === null ||
    user.role !== 'superAdmin' ||
    !configuredSuperAdminIds().has(identity.subject)
  ) {
    throw new Error('Forbidden');
  }
  return user;
}
```

Checks: authenticated → row exists → role stamped → Clerk subject STILL in env whitelist. Fails closed.

### No-escalation invariant

> `role` is never accepted from a client and never written by a public Convex function.

Template users-writers: upsertFromClerk (insert + patch), deleteFromClerk (delete) — all internalMutation. Any future users-table writer must be reviewed as authorization-sensitive. Admin code must never patch users rows.

### Bootstrap procedure

1. Identify the one Clerk user; copy ID (`user_123`).
2. Set `SUPER_ADMIN_CLERK_IDS=user_123` in Convex dashboard env vars.
3. Deploy schema + functions.
4. Trigger `user.updated` (or run an internal reconciliation) so the row is stamped.
5. Verify Convex row: expected externalId + role.
6. Verify a second Clerk user gets 404 on /admin and Forbidden on admin functions.

### Open holes / requirements for LocalConnect

- **Owner-deletion policy:** `deleteFromClerk` deletes the users row — businesses.ownerId would dangle. Must define reassignment/archival/nullable-owner policy before ownership data exists (→ map fog).
- Webhook URL must match the actual Convex route `/clerk-users-webhook` when configuring Clerk.
- Guard must fail closed when identity no longer resolves to a users row.
