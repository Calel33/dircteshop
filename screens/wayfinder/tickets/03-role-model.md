# Ticket: Define the role model — owner, visitor, superAdmin on top of the starter's Clerk setup

Parent: [map.md](../map.md)
Labels: wayfinder:grilling — **RESOLVED**

## Question

With superuser settled (map Notes), the remaining role questions need decisions, not research:

1. **Owner role assignment:** how does a user become a "business owner"? (Auto on first listing creation? Self-serve "Add Your Business" with role assigned at submission? Admin-granted — bearing in mind only the Super Admin can grant anything?)
2. **Owner↔business cardinality:** can one owner account own multiple businesses? (Mockups show one; decide the data model anyway.)
3. **Visitor accounts:** is a Clerk account required to use booking/quote workflows, or are they anonymous forms in v1?
4. **Owner self-edit rights:** owners edit their own listing only — confirm edit rights are enforced Convex-side by `ownerId == authed user`, not just UI hiding.
5. **Admin vs owner surfaces:** confirm admins never edit listing content directly except via the same moderation flows (or is there an admin-override edit path in v1?).

## Resolution

All five decided by the human (grilling session):

1. **Owner assignment — self-serve at first submission.** Any signed-in user clicks "Add Your Business"; the owner role is stamped on their users row when they create their first listing draft. No admin gatekeeping at the entry point; the Super Admin still moderates what goes public. Rationale: matches the mockup nav ("Add Your Business" is a public CTA); keeps moderation at the approval step, not the signup step.
2. **Cardinality — multiple businesses per owner.** Data model already supports it (`businesses.ownerId` per business). Owner workspace gets a "My Businesses" switcher. Avoids a v2 migration.
3. **Visitor accounts — anonymous forms in v1.** Booking/quote requests submit name + phone/email without sign-in. Mockups show no login step before booking; auth'd visitors get nothing extra in v1. (Revisit when "my bookings" or review submission enters scope.)
4. **Edit enforcement — server-side only, confirmed.** Every owner mutation resolves `ctx.auth` → users row → `businesses.ownerId` match and throws otherwise. UI hiding is cosmetic convenience, never the boundary. Same pattern as `requireSuperAdmin` (ticket 02) — a `requireBusinessOwner(ctx, businessId)` helper.
5. **Super Admin — moderation only, no direct content edits.** Super Admin never writes listing content fields; corrections flow to the owner via "changes requested". Keeps content ownership unambiguous and the audit trail clean. Super Admin CAN manage categories, ratings (admin-set per map Notes), and verification. Note: this narrows the user's original "full, unrestricted access" phrasing — unrestricted access to the *panel and its actions*, not ghost-writing listing content.

**Role summary:** `users.role ∈ {user, superAdmin}` per ticket 02's schema, plus an implied owner capability: a `user` with ≥1 business. No separate `owner` role literal — ownership is derivable (`businesses.byOwnerId` non-empty), which keeps the no-escalation invariant from ticket 02 intact (role stays two-valued, env-controlled).
