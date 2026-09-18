# Build Ticket B2: Convex schema + categories + one seeded business renders publicly

Slice owner: SPEC §4, §5, §6 (foundation), §10 (category seed). Decisions from tickets 01, 04, 10. Blocked by: B1.

## End-to-end slice

1. Full schema per [wayfinder/research/convex-domain-model.md](../wayfinder/research/convex-domain-model.md) + SPEC §4 deltas (isFeatured, moderationReason, moderatedAt, lastSavedAt on businesses; orders/bookings/quoteRequests/auditLogs/notifications tables included now to avoid migrations later — but their functions come in later tickets).
2. Status-transition helper with the SPEC §5 allow-list + action-based mutations (never client-supplied status). `requireBusinessOwner(ctx, businessId)` guard.
3. Category seed (script or Super Admin-only mutation): the SPEC §10 taxonomy — restaurants, automotive, healthcare, legal-services, beauty-wellness, food-drink, retail, professional-services (slug, icon, ordering).
4. `lib/verticals.ts` code registry per SPEC §6 (configs for all 8 slugs — modules may not all exist yet; registry shape + actions union land now).
5. Profile foundation primitives (SPEC §6): breadcrumb, hero/gallery, identity bar, actions bar, info card, hours card, last-updated footer; layout slots; `BusinessProfile` component; two-column → one-column collapse; design tokens only.
6. Seed ONE approved food-drink business (script) with photos-as-placeholder URLs → it renders at `/business/[id]` with its config actions.

## Done when (verification evidence)

- Lint + build clean.
- `/business/[id]` renders the seeded business with all foundation slots; responsive collapse verified at narrow width.
- A public query returns ONLY the approved business (draft a second seeded business, confirm it's invisible publicly).
- Search index: seeded business found via searchText query filtered to approved.
