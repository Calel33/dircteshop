# Wayfinder Map: LocalConnect on template-app — from starter to build-ready spec

Label: wayfinder:map

## Destination

A build-ready implementation spec plus a tracer-bullet ticket set for **LocalConnect/LocalHub** — the local-business discovery + owner-management + superuser-admin platform described in `../LOCALCONNECT-SCREEN-SPEC.md` — built on the `Calel33/template-app` starter (Next.js 16 + React 19 + Tailwind v4 + Clerk + Convex + shadcn/ui), ready to hand to build sessions with nothing left to decide.

## Notes

- **Domain:** local-business directory / discovery platform. Three role-specific apps in one Next.js codebase: public discovery, owner workspace (LocalHub), admin workspace (LocalHub Admin).
- **Source of truth for screens:** `../LOCALCONNECT-SCREEN-SPEC.md` and the 13 HTML mockups beside it. Treat every mockup button as visual intent unless the spec says behavior is confirmed.
- **Skills every session should consult:** `/grilling` + `/domain-modeling` for HITL tickets; `/research` for research tickets; `/prototype` for the prototype ticket.
- **Standing preferences (decided at charting):**
  - Build on `Calel33/template-app` — never from scratch. Starter defaults everywhere: single Next.js app, pnpm, Vercel + Convex cloud, Tailwind tokens in globals.css.
  - Admin is **superuser-only**: exactly one Super Admin (the user), bootstrapped via Clerk user ID whitelist in env/Convex seed. No UI can grant admin — no privilege-escalation path.
  - Clerk Billing **deferred** (plumbing retained, no payment-gated features in v1).
  - Property/real-estate vertical **out of scope for v1** (record as extension candidate).
  - Public profiles: one shared foundation + data-driven module system; **restaurant and salon are the two fully-built exemplar verticals**; bakery/auto/vet/legal become config/stubs.
  - Conversion actions: native workflows in Convex (booking, quote requests) — not link-outs.
  - Reviews: no public submission in v1; rating/count are admin-set display fields.
  - Search: Convex search index over name/category/keywords; no geolocation in v1.
  - Media: Convex file storage with limits.
  - Notifications: in-app only (notifications table + badge); no email in v1.
  - AGENTS.md session rules are binding for all sessions working this map (design tokens, read-before-edit, MCP navigation, verification).

## Decisions so far

- [Define the role model](tickets/03-role-model.md) — self-serve owner at first draft; multiple businesses per owner; anonymous visitor forms in v1; server-side owner guard (requireBusinessOwner); Super Admin moderates but never directly edits listing content. No separate owner role literal — ownership is derived from businesses.ownerId.
- [Specify the shared public profile foundation](tickets/04-profile-module-system.md) — typed module registry with layout slots (hero/identityBar/actionsBar/mainContent/sidebar); vertical config as a code registry keyed by category slug; ProfileAction discriminated union (link vs native workflow); generic bakery-derived primitive set; non-exemplars render generic profile + config actions.
- [Specify the exemplar verticals](tickets/05-exemplar-verticals.md) — ordering = order record + in-app notification, no payment (new/accepted/ready/completed); salon booking = hours+duration slot picker, owner confirms/declines, tokenized visitor cancel, UTC+timezone; quote workflow = name+contact+message, new/responded/closed; nutrition display-only, rewards dropped; content edits live for approved businesses, only core identity fields re-trigger review. New tables: orders, bookings, quoteRequests.
- [Specify the admin workspace](tickets/07-admin-workspace.md) — separate app/admin tree reusing starter shell; approvals queue with required-reason modals + bulk approve only; grid+table real, map stubbed; confirm modal + auditLogs table for every admin action, hard delete only behind type-the-name; moderationReason on business + owner notification; read-only accounts + CSV export; summary cards replace revenue with submissions-this-month.
- [Specify the owner workspace](tickets/06-owner-workspace.md) — LocalHub Editor is the one owner surface (compact manager = its mobile view); explicit save-to-draft with preview rendered from unsaved form state; hours presets as UI quick-fills; undo/redo/reset client-only; read-only + banners while pending, moderationReason banner on changes-requested; change history = simple savedAt/status trail. Prototype: [prototype/owner-workspace.html](prototype/owner-workspace.html)
- [Specify the public directory landing page](tickets/08-public-directory-landing.md) — Open Now + Highly Rated are real filters, others disabled-with-tooltip; Trending = admin-pinned isFeatured flag; /search + /categories/[slug] share one BusinessResults component (searchIndex filterFields, Load-more pagination); one shared BusinessCard with density variants; all landing sections with graceful empty/hidden states + skeletons.
- [Configure the four non-exemplar vertical stubs](tickets/10-non-exemplar-stubs.md) — vet gets the real booking workflow, legal gets quote; all four stubs render services + credentials (auto with price-list styling); category seed = mockup taxonomy; Super Admin category CRUD with delete-blocked-when-in-use.
- [Consolidate into the build-ready spec](tickets/09-final-spec-assembly.md) — SPEC.md written next to the screen spec (all sections ticket-cited) + tracer-bullet build tickets B1–B11 in wayfinder/build/ with blockers and verification evidence. Destination reached.
- [Pin the Convex domain model](tickets/01-convex-domain-model.md) — businesses/categories + separate menuGroups/menuItems/serviceOfferings/stylists tables; 6-status approval state machine; single searchText projection + searchIndex filtered by status/category. Detail: [research/convex-domain-model.md](research/convex-domain-model.md)
- [Design the superuser auth boundary](tickets/02-superuser-auth-boundary.md) — SUPER_ADMIN_CLERK_IDS env whitelist, role stamped in upsertFromClerk AND re-checked per-request by requireSuperAdmin(ctx) on every admin function; middleware + server-layout 404 gate; role never client-writable. Detail: [research/superuser-auth-boundary.md](research/superuser-auth-boundary.md)

(Charting decisions — destination, property scope, superuser model, billing deferral, exemplar verticals, workflow depth, reviews, search, media, notifications — are baked into Notes.)

## Not yet specified

- **Owner-deletion policy** (graduated from ticket 02): Clerk user.deleted deletes the users row — define reassignment/archival/nullable-owner before businesses.ownerId data exists.
- **Whether approved-listing edits re-trigger review** — resolved by ticket 05 (content live, identity fields re-review).
- Config-stub contracts for bakery / auto / vet / legal verticals — graduated into [Configure the four non-exemplar vertical stubs](tickets/10-non-exemplar-stubs.md)
- Flagged-content moderation flow — ticket 07 nav includes a stub; rules/sources/queue behavior stay unspecified until a flag source exists (public reports? admin-created? deferred decision)
- Categories admin management (taxonomy CRUD, ordering, slug rules)
- Analytics definitions for both owner and admin dashboards (what is actually measured?)
- Notification trigger matrix in detail (which status transitions fire which notifications)
- Change history / audit granularity (field-level vs revision-level)
- The "Add Your Business" owner onboarding funnel shape (entry is settled — any signed-in user, self-serve, role at first draft — but the first-listing flow screens remain, folded into the owner workspace ticket)
- Map/location embed behavior in the owner editor ("Location & Map" section in mockup)
- Empty / loading / error / validation / accessibility state standards per flow
- Export format and content for admin export action

## Live tickets

(none — the map is complete. The destination is reached: `../SPEC.md` + `build/B1`–`B11` are ready for build sessions.)

Closed: [Pin the Convex domain model](tickets/01-convex-domain-model.md), [Design the superuser auth boundary](tickets/02-superuser-auth-boundary.md), [Define the role model](tickets/03-role-model.md), [Specify the shared public profile foundation](tickets/04-profile-module-system.md), [Specify the exemplar verticals](tickets/05-exemplar-verticals.md), [Specify the admin workspace](tickets/07-admin-workspace.md), [Specify the owner workspace](tickets/06-owner-workspace.md), [Specify the public directory landing page](tickets/08-public-directory-landing.md), [Configure the four non-exemplar vertical stubs](tickets/10-non-exemplar-stubs.md), [Consolidate into the build-ready spec](tickets/09-final-spec-assembly.md)

## Out of scope

- Property/real-estate vertical — extension candidate only; do not merge property data or workflows into the core model (per spec §Scope question + charting decision).
- Clerk Billing / payments — keep plumbing, build nothing payment-gated.
- Public review submission and review moderation lifecycle — ratings are admin-set display fields in v1.
- Geolocation / "Nearby" filter / distance computation — deferred with the search decision.
- Fully building bakery / auto / vet / legal verticals — only restaurant + salon are exemplars.
