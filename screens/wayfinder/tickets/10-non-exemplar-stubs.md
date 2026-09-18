# Ticket: Configure the four non-exemplar vertical stubs — bakery, auto, vet, legal

Parent: [map.md](../map.md)
Labels: wayfinder:grilling — **RESOLVED**

## Question

With the profile foundation (ticket 04) resolving every category through the `lib/verticals.ts` code registry, the four non-exemplar verticals need their concrete config decided:

1. **Per-vertical module lists:** beyond the foundation slots (hero, identityBar, actionsBar, info card, hours card), which generic modules does each get? (e.g. services list — auto; credentials — vet/legal; gallery emphasis — bakery.)
2. **Per-vertical action sets:** bakery = Call/Directions/Website; auto = Call + Quote workflow ("Request Towing" maps to quote with custom label per ticket 04's union); vet = Call + Book? (vet mockup has "Book Appointment" — does vet get the booking workflow or stay link-out in v1?); legal = "Schedule Consultation" — booking workflow or quote?
3. **Which data fields each stub relies on:** confirm ticket-01's `services`, `credentials` arrays + description suffice, or whether any mockup module (e.g. vet's team cards, legal's attorneys) degrades to a services-list presentation in v1.
4. **Category seeding:** the exact category list (slugs, names, icons, ordering) to seed in the categories table for v1.

## Resolution

All four decided by the human (grilling session):

1. **Workflow mapping — vet gets real booking; legal gets quote.** Vet's "Book Appointment" maps to the booking workflow (ticket 05 contract; vet services carry `durationMinutes`). Legal's "Schedule Consultation" maps to the quote workflow (lead-gen conversation, "Free Consultation" context label). Booking is no longer salon-exclusive.
2. **Modules — all four get services + credentials; auto adds price-list styling.** Bakery: gallery emphasis + services. Auto: services rendered as the mockup's priced service-estimate list (name + price + duration, display only, no per-item booking). Vet: services (specializations) + credentials (certifications). Legal: services (practice areas) + credentials (memberships). Team cards (vet team, legal attorneys) degrade to services-list presentation in v1.
3. **Category seed — the mockup taxonomy.** Seed the spec's taxonomy: restaurants, automotive, healthcare, legal services, beauty & wellness, retail, professional services (+ Food & Drink for exemplars). Each with slug, icon, ordering; `lib/verticals.ts` configs map onto these slugs. Seeded via Super Admin-only seed mutation or script.
4. **Category admin — Super Admin CRUD, no self-serve.** Admin Categories page: full CRUD + ordering (Super Admin only per ticket 02's boundary). Deleting a category with businesses is **blocked** (reassign first). Owners pick from the list in the editor.

**Resulting `lib/verticals.ts` config (feed into final spec):**

| slug | modules beyond foundation | actions |
|---|---|---|
| restaurants | menuTabs, orderingPanel (exemplar) | Order Online (order workflow), Call, Directions, Website |
| beauty-wellness | stylistsCard, servicesPriceList, bookingForm, portfolio (exemplar) | Book Appointment (booking workflow), Call, Portfolio link |
| food-drink | gallery emphasis, services | Call, Directions, Website |
| automotive | services (price-list styling) | Call, Request Towing → quote workflow (custom label), Quote |
| healthcare | services (specializations), credentials | Book Appointment (booking workflow), Call, Emergency Line (call link) |
| legal-services | services (practice areas), credentials | Schedule Consultation → quote workflow (custom label), Call, Send Message → quote |
| retail | services | Call, Directions, Website |
| professional-services | services, credentials | Quote, Call |
