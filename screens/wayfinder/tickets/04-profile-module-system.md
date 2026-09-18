# Ticket: Specify the shared public profile foundation + data-driven module system

Parent: [map.md](../map.md)
Labels: wayfinder:grilling — **RESOLVED**

## Question

Spec §Template and Scope Decisions mandates one reusable public-profile system with configurable modules. Decisions needed to write it into the build spec:

1. **Module registry shape:** a typed module registry keyed by business type — e.g. `{ hero, identityBar, actionsBar, infoCard, hoursCard, verticalModules[] }` — where vertical modules are components resolved from listing data. What's the exact contract (props, data keys, order)?
2. **Vertical config:** how a category/businessType maps to enabled modules + default actions (e.g. `restaurant → [menuTabs, orderingPanel]`, `salon → [stylistsCard, servicesPriceList, bookingForm, portfolio]`). Config lives where — a constants file, Convex table, or category record?
3. **Actions bar contract:** actions are data-driven (Call / Directions / Website = link actions; Book Appointment / Request Quote = Convex workflow actions). Define the discriminated union of action types and how the profile renders them.
4. **Responsive/token rules:** the two-column-to-one-column collapse pattern and which parts of the mockup visuals become shared primitives vs per-vertical.
5. **Stub floor for non-exemplar verticals:** the minimum that makes bakery/auto/vet/legal render acceptably from config alone.

## Resolution

All five decided by the human (grilling session):

1. **Module registry — typed registry + layout slots.** A typed `ProfileModule` registry keyed by module ID, composed of fixed layout slots: `hero`, `identityBar`, `actionsBar`, `mainContent[]`, `sidebar[]`. One `BusinessProfile` component renders any business; modules are pure components with a shared props contract (`BusinessProfileData` = the business doc + resolved vertical content). Vertical modules resolve by ID from listing data.
2. **Vertical config — code registry keyed by category slug.** `lib/verticals.ts` (constants): slug → `{ modules: ModuleId[], defaultActions: ProfileAction[] }`. Compile-time typed, zero extra DB reads, admin category-slug changes are the only coupling. Verticals are developer artifacts, NOT runtime/admin-editable data in v1.
3. **Actions bar — discriminated union, data-driven.**
   ```ts
   type ProfileAction =
     | { kind: 'call' | 'directions' | 'website'; href: string }
     | { kind: 'book' | 'quote'; workflow: 'booking' | 'quoteRequest'; label?: string };
   ```
   Actions derived from listing data via vertical config. Workflow actions open the native Convex forms (map Notes). Vertical extras (e.g. auto shop's "Request Towing") map to the quote workflow with a custom label.
4. **Shared primitives — extract the bakery (generic) profile first.** Primitive set: breadcrumb, hero/gallery, identity bar (name, verified badge, rating/count, distance, open-until status), actions bar, business info card, hours card, last-updated footer. Foundation owns the two-column→one-column responsive collapse. All tokens per AGENTS.md (rem/em/%, no hardcoded values).
5. **Stub floor for non-exemplars — generic profile + config actions.** Bakery/auto/vet/legal render the generic profile (hero, identity, actions, info, hours, services, credentials — all ticket-01 schema fields) with config-chosen actions (auto gets Call + Quote workflow). No menu/booking/team modules. "Reviews coming soon" stays as-is.

**New fog graduated into a ticket-sized question (needs ticket 05's workflow contracts first):** per-vertical action-to-workflow mapping details (which verticals map which labels onto the booking/quote workflows).

## New tickets spawned

- (see map) **Non-exemplar vertical stub configs** — blocked by exemplar verticals (05) since it reuses the same ProfileAction contract.
