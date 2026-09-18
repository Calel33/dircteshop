# LocalConnect / LocalHub — v1 Implementation Specification

**Status:** Build-ready. Consolidated from the [wayfinder map](wayfinder/map.md) (all tickets closed). Every decision traces to a closed ticket — cited inline as `(T##)`.

**Product source of truth for screens:** `LOCALCONNECT-SCREEN-SPEC.md` + the 13 HTML mockups in this folder. Mockup buttons are visual intent unless that spec marks behavior confirmed.

**Foundation:** `Calel33/template-app` https://github.com/Calel33/template-app starter (Next.js 16 App Router, React 19, Tailwind v4, Clerk, Convex `^1.31.2`, shadcn/ui, pnpm, Vercel). Never build from scratch. Starter defaults everywhere (single app, Tailwind tokens in globals.css). AGENTS.md session rules bind all build sessions: design tokens only (rem/em/%; px only for small details), read-before-edit, verification required.

---

## 1. Product Summary

Local-business discovery + management platform, three role-specific surfaces in one Next.js app:

- **Public discovery** (LocalConnect): landing, search, category browse, business profiles.
- **Owner workspace** (LocalHub): listing editor with live preview and submission flow.
- **Admin workspace** (LocalHub Admin): superuser-only approvals queue + directory management.

**Out of scope v1** (map): property/real-estate vertical (extension candidate), Clerk Billing (plumbing retained, nothing payment-gated), public review submission (ratings are admin-set display fields), geolocation/Nearby/distance, fully building bakery/auto/vet/legal (config stubs only), email notifications (in-app only).

## 2. Routes

| Route | Surface | Access |
|---|---|---|
| `/` | Landing (hero+search, categories, trending, chips, new, verified) | public |
| `/search` | Search results | public |
| `/categories` | Category index | public |
| `/categories/[slug]` | Category-filtered results | public |
| `/business/[id]` | Public business profile (module foundation) | public |
| `/sign-in`, `/sign-up` | Clerk (starter) | public |
| `/owner` | Owner home: My Businesses switcher + editor | authed, ownership-derived |
| `/owner/business/[id]` | LocalHub Editor | authed + `requireBusinessOwner` |
| `/admin` | Admin overview | Super Admin only (404 otherwise) |
| `/admin/approvals` | Pending approvals queue | Super Admin only |
| `/admin/directory` | Directory management (grid/table) | Super Admin only |
| `/admin/owners` | User accounts (read-only) | Super Admin only |
| `/admin/categories` | Category CRUD | Super Admin only |
| `/admin/audit` | Audit log (read-only, filterable) | Super Admin only |
| `/admin/settings`, `/admin/flagged`, `/admin/analytics` | v1 stubs | Super Admin only |

Starter's `/dashboard` and landing/billing routes remain untouched. (T02, T04, T06, T07, T08)

**Demo-only notice:** the starter's `/dashboard` (data table, charts, sidebar, cards) is **template demo content**. It is not part of LocalConnect/LocalHub, must not be used in the product UI, and must not be copied from or built upon. The real product surfaces are `/owner` and `/admin` (see table above).

**Local-env redirects:** the Clerk redirect variables in `.env.local` currently point at the demo dashboard (`/dashboard`) and need to be changed to the product surfaces per the table above before building: `NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`. `.env.local` is local-only (gitignored) — each environment sets its own values.

## 3. Roles & Auth (T02, T03)

- `users.role ∈ {user, superAdmin}` — two-valued, stamped ONLY by `upsertFromClerk` (internalMutation) from the `SUPER_ADMIN_CLERK_IDS` Convex env var. Exactly one ID in production. **No-escalation invariant: role is never accepted from a client and never written by a public function.**
- **Owner is not a role literal** — ownership derives from `businesses.ownerId`. Any signed-in user can create a first listing draft ("Add Your Business"); self-serve, no admin gate at entry. Multiple businesses per owner.
- **Guards (server-side only; UI hiding is cosmetic):**
  - `requireSuperAdmin(ctx)` — identity → users row → role stamped → Clerk subject still in env whitelist (re-checked every request). Fails closed.
  - `requireBusinessOwner(ctx, businessId)` — `ctx.auth` → users row → `businesses.ownerId` match.
- **Admin route gating:** middleware matches `/admin(.*)` for authentication + `app/admin/layout.tsx` server-side super-admin check → `notFound()` (404, not 403/redirect — minimizes info disclosure). The Convex guard is the real boundary.
- **Super Admin moderates but never directly edits listing content** — corrections flow via "changes requested". Admin CAN manage categories, ratings, verification, isFeatured.
- **Visitor workflows (booking/quote/order) are anonymous forms in v1** — name + contact, no Clerk account required.
- **Owner-deletion policy (OPEN — must decide at build of ticket B2):** Clerk `user.deleted` deletes the users row; businesses.ownerId would dangle. Required: block deletion or nullable-owner/archive policy before real data.

## 4. Convex Schema (T01 + deltas from T05, T07, T08)

Full schema proposal: [wayfinder/research/convex-domain-model.md](wayfinder/research/convex-domain-model.md). Tables:

- `users {name, externalId, role}` — index `byExternalId`.
- `categories {name, slug, icon?, ordering, parentCategoryId?}` — indexes `bySlug`, `byParentCategoryId`, `byOrdering`.
- `businesses` — `name, categoryId, description, address{...(+lat/lng optional)}, phone?, email?, website?, photos[{storageId, altText?, ordering}], hours{day → [{opensAt, closesAt}]}, status, verification{isVerified, verifiedAt?, verifiedBy?}, rating, ratingCount, services[], credentials[], keywords[], searchText, ownerId, lastUpdatedAt, submittedAt?, isFeatured, moderationReason?, moderatedAt?, lastSavedAt?`
  - indexes `byStatus`, `byCategoryId`, `byOwnerId`; `searchIndex('searchText', {searchField: 'searchText', filterFields: ['status', 'categoryId']})`.
  - `searchText` maintained by mutations: `[name, keywords.join(' '), description].join(' ')`.
- Verticals (separate tables, NOT JSON blobs): `menuGroups`, `menuItems` (with nested `customizationOptions[{name, required, options[{name, priceAdjustment?}]}]`, optional nutrition display fields), `serviceOfferings {price?, durationMinutes?, ...}`, `stylists {serviceOfferingIds[], ...}`.
- Workflows (T05): `orders {businessId, menuItemId, selections[], customerName, contactPhone?, contactEmail?, status: new|accepted|ready|completed, createdAt}`; `bookings {businessId, serviceOfferingId, stylistId?, customerName, customerPhone, customerEmail, startAt (UTC), cancelToken, status: requested|confirmed|declined|cancelled}`; `quoteRequests {businessId, customerName, customerContact, message, sourceLabel?, status: new|responded|closed, createdAt}`.
- Admin (T07): `auditLogs {actorUserId, action, targetType, targetId, fromStatus?, toStatus?, reason?, createdAt}`; `notifications {userId, type, businessId?, message, reason?, readAt?, createdAt}` (in-app badge).

## 5. Listing Approval State Machine (T01)

Statuses: `draft, pendingReview, approved, changesRequested, rejected, suspended`.

```ts
const allowedTransitions = {
  draft: ['pendingReview', 'rejected'],
  pendingReview: ['approved', 'changesRequested', 'rejected'],
  approved: ['pendingReview', 'suspended'],
  changesRequested: ['pendingReview', 'draft', 'rejected'],
  rejected: ['draft', 'pendingReview'],
  suspended: ['approved'],
} as const;
```

- Mutations accept an **action**, never a client-supplied status; server loads doc → resolves user → role check → allow-list → atomic patch (+ searchText maintenance).
- Approve stamps verification `{isVerified: true, verifiedAt, verifiedBy}`.
- **Public visibility = `status === 'approved'` only.**
- **Re-review policy (T05):** content edits (menu/services/stylists/photos) go live immediately for approved businesses; only **core identity fields** (name, categoryId, address, description) trigger `approved → pendingReview`.

## 6. Public Profile Foundation (T04, T05, T10)

- **Typed module registry + layout slots:** `hero, identityBar, actionsBar, mainContent[], sidebar[]`. One `BusinessProfile` component renders any business; modules are pure components over `BusinessProfileData` (business doc + resolved vertical content).
- **Vertical config = code registry** `lib/verticals.ts`, keyed by category slug: `{ modules: ModuleId[], defaultActions: ProfileAction[] }`. Developer artifact, not admin-editable data.
- **Actions — discriminated union:**
  ```ts
  type ProfileAction =
    | { kind: 'call' | 'directions' | 'website'; href: string }
    | { kind: 'book' | 'quote'; workflow: 'booking' | 'quoteRequest'; label?: string };
  ```
- **Primitives** (extracted from the bakery mockup): breadcrumb, hero/gallery, identity bar (name, verified badge, rating/count, open-until status), actions bar, info card, hours card, last-updated footer. Foundation owns the two-column → one-column responsive collapse. Design tokens only.
- **Vertical configs:**

| slug | modules beyond foundation | actions |
|---|---|---|
| restaurants | menuTabs, orderingPanel (exemplar) | Order Online (order workflow), Call, Directions, Website |
| beauty-wellness | stylistsCard, servicesPriceList, bookingForm, portfolio (exemplar) | Book (booking workflow), Call |
| food-drink | gallery emphasis, services | Call, Directions, Website |
| automotive | services (price-list styling) | Call, "Request Towing" → quote (custom label), Quote |
| healthcare | services (specializations), credentials | Book (booking workflow), Call, Emergency Line (call) |
| legal-services | services (practice areas), credentials | "Schedule Consultation" → quote (custom label), Call, Send Message → quote |
| retail | services | Call, Directions, Website |
| professional-services | services, credentials | Quote, Call |

- Team cards (vet team, legal attorneys) degrade to services-list presentation in v1.

## 7. Workflows (T05)

- **Ordering (restaurant):** customize one item → order record → owner in-app notification. No cart, no checkout, no payment. Statuses `new → accepted → ready → completed` (owner transitions).
- **Booking (salon, vet):** slots derived from business hours + service `durationMinutes`; no per-stylist calendar, naive slot marking. Owner confirms/declines; visitor cancels via tokenized link (anonymous forms). Times stored UTC + business timezone string, rendered local.
- **Quote (auto/towing, legal, professional):** name + contact + message (+ action-context `sourceLabel`). Statuses `new → responded → closed` (owner transitions; reply is phone/email contact, no in-app thread).
- All three notify the owner in-app.

## 8. Public Directory Landing (T08)

- Sections: hero+search → Explore by Category → Trending This Week (`isFeatured` approved, ordered by lastUpdatedAt) → filter chips → New to LocalConnect (newest approved) → Recently Verified. Empty sections **hide entirely**; skeletons for loading; standard empty state (message + clear-filters CTA + browse-categories link) on search/category results.
- **Filter chips:** Open Now (hours vs current time) + Highly Rated (`rating ≥ 4.5 && ratingCount > 0`) are real; Trending/Special Offers/Nearby render **disabled with tooltip**.
- **Search:** `/search?q=` and `/categories/[slug]` share one `BusinessResults` component — Convex searchIndex with `filterFields` (status=approved, categoryId). "Load more" cursor pagination, no page numbers.
- **BusinessCard:** one shared component, density variants (public rich card, admin grid same card, admin table = separate row component). Card actions capped to 2.

## 9. Owner Workspace — LocalHub Editor (T06)

- The **single** owner editing surface (compact Biz Listing UI style = its mobile view). Section nav: Basic Info, Operating Hours, Photos & Media, Contact, Location & Map (address fields only — no map embed), Categories & Tags, Features & Amenities, Analytics (stub), Change History (trail), Settings (stub).
- **Save model:** edits in client form state; Save Draft persists (`draft`); **Preview Live renders the real profile foundation from unsaved state (WYSIWYS)**; Submit for Approval fires the transition. No autosave.
- Hours presets (Standard/Coffee Shop/Weekend Only/Custom) = UI quick-fills, not persisted. Undo/Redo/Copy-from-Template/Reset Section = client-only session tools (Reset restores from last-saved Convex state).
- **Post-submit:** pendingReview → read-only + status banner; changesRequested → `moderationReason` banner, editing enabled; rejected → reason banner + resubmit. Change History = simple lastSavedAt/status trail, no field diffs.
- Prototype reference: [wayfinder/prototype/owner-workspace.html](wayfinder/prototype/owner-workspace.html).
- Owner onboarding ("Add Your Business"): any signed-in user → create first draft (owner role derived). First-listing flow screens = the editor itself, starting from blank.

## 10. Admin Workspace (T07, T10)

- Separate `app/admin/*` tree, reusing the starter's sidebar/shell pattern; server-layout 404 gate (§3).
- **Overview:** cards — Total Businesses, Pending Approval (clickable → queue), Verified Active, Submissions This Month. No revenue card (billing deferred).
- **Approvals queue:** cards (image, name, category, submitted age, owner, priority, address, contact); filters (category/priority/time); select-all with confirmed indeterminate behavior; per-card Approve / Changes / Reject (modal with **required reason** → `moderationReason`) / View Full Details side panel; **bulk approve only** (confirm modal with count); pagination.
- **Directory:** Grid + Table real (same data); Map view stubbed. Search by name/owner/location; filters by category/status/verification. Add Business = admin-created listing with owner email assignment. Listing actions: Approve, Request Changes, Reject, Suspend, Restore, Delete; bulk bar: approve only. isFeatured pinning lives here.
- **Destructive safety:** every status-changing action + delete → confirm modal stating consequences → `auditLogs` row. **Hard delete of business + children only behind type-the-business-name** — the one irreversible action. Audit log page: read-only, filterable.
- **Accounts:** read-only users table (name, businesses count, role). **Export:** server-generated CSV of businesses (name, category, status, owner, rating, dates).
- **Categories:** Super Admin CRUD + ordering; delete blocked while businesses reference it (reassign first). Seed via script/Super Admin seed mutation — mockup taxonomy: restaurants, automotive, healthcare, legal-services, beauty-wellness, food-drink, retail, professional-services.
- Nav stubs in v1: Flagged Content, Analytics, Settings.

## 11. Notifications (in-app only)

`notifications` table + badge. Triggers (minimum matrix — full matrix remains open fog): listing submitted → Super Admin; approved/changes-requested/rejected/suspended (with `moderationReason`) → owner; new order/booking/quoteRequest → owner. No email in v1.

## 12. Media

Convex file storage; uploads via actions with size/type limits; photos stored as `{storageId, altText?, ordering}` (ordered array, reordering supported in editor). Upload limits: TBD at build (open detail).

## 13. Open Items (explicit deferred markers — not blockers)

- Owner-deletion policy (§3) — decide at build of the ownership slice.
- Flagged-content flow (no flag source exists in v1).
- Analytics definitions (stub shows counts from existing tables: views TBD, orders/bookings/quotes counts real).
- Full notification trigger matrix.
- Upload size/type limits.
- Empty/loading/error/validation/accessibility standards per flow — each build ticket must include its own states (skeletons + hidden-empty-sections + standard empty state per §8).

## 14. Tracer-Bullet Ticket Set

Ordered build tickets in `wayfinder/build/` — each a thin end-to-end slice, each declaring blocking edges. Build sessions take them in order; verify each with lint + build + the ticket's stated evidence.

| # | Ticket | End-to-end slice | Blocked by |
|---|---|---|---|
| B1 | [Bootstrap + superuser boundary](build/B1-bootstrap-superuser.md) | Clone template → env vars → role stamp + guards + middleware + 404 gate → Super Admin signs in, others get 404 | — |
| B2 | [Schema + categories + seed one business → public profile](build/B2-schema-profile.md) | Schema + state machine + guards + category seed + one seeded approved business renders the generic public profile | B1 |
| B3 | [Owner onboarding + editor + approval loop](build/B3-owner-approval-loop.md) | Self-serve draft → submit → Super Admin approves w/ audit → status flips → public profile updates; changes-requested reason loop | B2 |
| B4 | [Landing + search + category browse](build/B4-landing-search.md) | Landing sections, chips, BusinessResults, BusinessCard; search + category pages work against seeded data | B2 |
| B5 | [Notifications](build/B5-notifications.md) | notifications table + badge wired to B3's transitions + workflow triggers | B3 |
| B6 | [Admin directory management](build/B6-admin-directory.md) | Grid/table, filters, search, actions + confirm modals + audit log page, CSV export, isFeatured, accounts view, overview cards | B3 |
| B7 | [Photos / media](build/B7-media.md) | Convex file storage uploads + editor photo section + gallery on profile | B3 |
| B8 | [Restaurant vertical](build/B8-restaurant.md) | Menu modules + customization + order workflow + owner order list | B3, B7 |
| B9 | [Salon vertical](build/B9-salon.md) | Services/stylists modules + booking workflow + owner booking list + cancel token | B3, B7 |
| B10 | [Quote workflow + non-exemplar stubs](build/B10-quote-stubs.md) | quoteRequests workflow + vet booking + legal/auto/food-drink/retail/professional vertical configs rendering generic profiles | B9 |
| B11 | [States + accessibility + tokens pass](build/B11-polish.md) | Empty/loading/error/validation states everywhere, responsive verification, accessibility pass, token audit vs AGENTS.md | B4, B6, B8, B9, B10 |

Decision trace: B1←T02/T03, B2←T01/T04/T10, B3←T01/T03/T06/T07, B4←T04/T08, B5←T07/Notes, B6←T07, B7←Notes, B8/B9/B10←T04/T05/T10, B11←T08/AGENTS.
