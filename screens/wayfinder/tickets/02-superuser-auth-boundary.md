# Ticket: Design the superuser auth boundary — one Super Admin, zero escalation paths

Parent: [map.md](../map.md)
Labels: wayfinder:research — **RESOLVED**

## Question

(see map / original ticket body below in git history — research question: bootstrap, route protection, Convex guards, no-escalation guarantee, denial behavior for the superuser-only admin panel)

## Resolution

Full research findings with citations at `../research/superuser-auth-boundary.md` (asset). Key decisions:

- **Template reality:** `middleware.ts` only protects `/dashboard(.*)` via `auth.protect()` — `/admin` is currently UNPROTECTED. No `role` field exists on `users`. `upsertFromClerk` (internalMutation) is the single Clerk→Convex sync point, driven by the Svix-verified webhook in `convex/http.ts`.
- **Bootstrap:** Convex env var `SUPER_ADMIN_CLERK_IDS=user_123` (exactly one ID). Role stamped in `upsertFromClerk` from the whitelist — AND re-checked per-request in the guard (the whitelist is authoritative; the stamped role is a projection). This survives env changes without waiting for webhooks.
- **Route protection:** three layers — (1) middleware matcher extended to `/admin(.*)` for authentication; (2) `app/admin/layout.tsx` server-side gate calling a server-side Convex role check, `notFound()` on failure (404 chosen over redirect/403 — minimizes info disclosure that a privileged panel exists); (3) `requireSuperAdmin(ctx)` inside EVERY admin Convex function — this is the real boundary; UI gates are not substitutes.
- **No-escalation guarantee:** all three template users-table write paths are `internalMutation` (webhook-only). Rule: `role` is never a client argument, never written by any public function. Future users-table writers must be treated as authorization-sensitive changes.
- **Holes to account for:** webhook path is `/clerk-users-webhook` (Convex HTTP router — README's `/api/...` mentions are wrong); `upsertFromClerk` trusts webhook data post-Svix (fine while internal); **Clerk user deletion deletes the users row — LocalConnect must define an owner-deletion policy before businesses/ownership exists** (new fog item); dashboard's `<Protect>` is billing gating, not identity authz — do not reuse.
