# LocalConnect / LocalHub Screen Specification

## Purpose

This document records what the supplied screen mockups indicate we are building. It is an evidence-based product and screen map, not a claim that every visible control is already connected to production behavior.

Source set reviewed: the 13 HTML mockups in `C:\Users\calvi\Desktop\screens`.

## Product In General

The product is a local-business discovery and management platform. The public-facing product is branded primarily as **LocalConnect**. The owner-facing management experience is branded **LocalHub**, and the administrative experience is branded **LocalConnect Admin** or **LocalHub Admin**.

The product connects three audiences:

1. **Local customers and visitors** discover businesses, browse categories, inspect detailed listings, and take actions such as calling, getting directions, ordering, booking, or requesting a quote.
2. **Business owners and operators** create and maintain their listing content, including business details, descriptions, photos, categories, hours, contact information, services, and other trust-building information.
3. **Platform administrators** manage the directory, review submitted businesses, approve or reject listings, monitor statuses, and perform bulk administrative actions.

The mockups also include a **property listing experience**. That screen uses the LocalConnect brand but is structurally more real-estate-specific than the other screens. It should be treated as either a planned vertical/extension of the directory or a separate product surface until product scope confirms otherwise.

## Core Product Model

The screen set implies these core entities and relationships:

- **Business listing:** name, category, description, address, phone, email, website, photos, hours, status, verification, rating, services, credentials, and owner-maintained update time.
- **Business owner:** the person or organization responsible for creating and maintaining a listing.
- **Category:** directory taxonomy such as restaurants, automotive, healthcare, legal services, beauty and wellness, retail, and professional services.
- **Public business profile:** the customer-facing detail page for one business, with content modules that vary by business type.
- **Listing submission/review:** a new or changed listing can be pending review, approved/verified, suspended, or rejected/requested for changes.
- **Administrative directory record:** the operational view of all listings, including owner, status, rating, verification, submission/update dates, and moderation actions.
- **Action/contact intent:** calls, directions, websites, orders, appointments, quotes, messages, towing, consultations, and similar conversion actions.

## Shared Experience Patterns

### Public directory

- Brand/header navigation includes Directory, Categories, and a path for adding a business.
- Some variants include About, Contact, and Sign In.
- The directory landing page emphasizes category discovery, trending businesses, nearby/open/highly rated filters, special offers, and recently verified listings.
- Search and filter controls are represented visually, but the supplied static mockups do not establish the backend search contract or filtering behavior.

### Public business profile

Most business detail screens share this structure:

- Breadcrumb path from Home through category/subcategory to the business.
- Hero image or gallery.
- Business name, category, verification/trust badge, rating/review count, distance, open/closed status, and short description.
- Primary actions appropriate to the business, such as Call, Get Directions, Visit Website, Book Appointment, Order Online, Schedule Consultation, Request Towing, or Get a Quote.
- Business information card with address and contact channels.
- Hours of operation.
- Business-type-specific content modules.
- Last-updated or owner-maintained freshness signal in several variants.

### Owner management

- Listing editing is form-driven and organized into sections.
- A live preview shows how the listing may appear to directory visitors.
- Editing covers basic information, operating hours, photos/media, contact details, location/map, categories/tags, features/amenities, analytics, change history, and settings.
- The visual workflow includes draft, preview, save, and submit-for-review concepts.

### Administration

- Admin navigation separates overview, pending reviews/approvals, business directory, owners or user accounts, categories, flagged content, analytics, and settings.
- Administrators can search/filter listings and use grid, table, or map views in the broader management screen.
- Moderation supports reviewing, approving, requesting changes, rejecting, suspending, restoring, deleting, exporting, and bulk actions.

## Screen Map

### 1. Public directory landing page

**Source:** `LocalConnect.html`

**Role:** Customer/public visitor.

**Purpose:** Entry point for discovering local businesses.

**Visible content and capabilities:**

- Hero message: “Discover Amazing Local Businesses”.
- Browse Directory, Categories, About, Add Your Business, and Sign In navigation.
- Search control.
- Explore by Category section.
- Trending This Week section with example businesses.
- Filter tags for Trending Now, Open Now, Highly Rated, Nearby, Special Offers, and Newly Verified.
- New to LocalConnect and Recently Verified business groups.
- Business cards with imagery, category/meta information, descriptions, and actions such as View Menu.

**Product requirement implied:** The home page should help a visitor quickly find a relevant business or category and continue into a public business profile.

**Not established by the mockup:** Search ranking, location permission behavior, filter persistence, pagination, empty states, and whether “View Menu” is a generic CTA or a restaurant-specific action.

### 2. Generic public business profile: bakery

**Source:** `Bakery Listing.html`

**Role:** Customer/public visitor.

**Purpose:** Showcase a food-and-drink business with enough information to support a visit or contact decision.

**Visible content and capabilities:**

- Sunrise Bakery & Café profile with gallery, category, verified badge, rating/review count, distance, open-until status, and description.
- Call Now, Get Directions, and Visit Website actions.
- Business information: address, phone, website, and email.
- Hours of operation.
- Credentials and recognition, including business age, licensing, organic ingredients, and community recognition.
- Customer Reviews area currently represented as “Review system coming soon”.
- Owner last-updated indicator.

**Product requirement implied:** A business profile should support trust, discovery, and direct conversion without requiring a visitor to leave the directory to understand the business.

### 3. Public business profile: automotive

**Source:** `Auto Shop Page.html`

**Role:** Customer/public visitor.

**Purpose:** Extend the business profile pattern for a service business with operational and technical detail.

**Visible content and capabilities:**

- Elite Auto Service profile with ASE certification, rating/reviews, distance, open-until status, and available service bays.
- Call for Service, Request Towing, and Schedule Appointment actions.
- Common service estimates with prices and expected durations.
- Diagnostic equipment list.
- Technician certifications.
- Quick actions for a free quote, emergency towing, and booking.
- Contact information, hours, warranty protection, and last-updated metadata.

**Product requirement implied:** Profile modules must be configurable by business type; service businesses need structured services, pricing ranges, durations, availability, certifications, and urgent-action support.

### 4. Public business profile: restaurant with ordering/customization

**Source:** `LocalConnect Page.html`

**Role:** Customer/public visitor.

**Purpose:** Show a restaurant profile with menu browsing and item customization concepts.

**Visible content and capabilities:**

- Green Bowl Co. profile with business hero content and Green Rewards Program.
- Order Online CTA.
- Menu tabs for Build Your Bowl, Signature Bowls, Smoothies, and Sides.
- Bowl-building categories for base, protein, vegetables, and sauces.
- Customize controls and order buttons with prices.
- Nutrition Guide.
- Contact Information, Hours, Features, and Health & Safety cards.

**Product requirement implied:** Some profiles need richer vertical-specific actions and structured commerce/menu content rather than only static business information.

**Not established by the mockup:** Cart behavior, item customization state, ordering provider, checkout, rewards account behavior, nutrition data model, and payment flow.

### 5. Public business profile: beauty and wellness booking

**Source:** `LocalConnect Site.html`

**Role:** Customer/public visitor.

**Purpose:** Show a service profile centered on appointment booking and portfolio trust.

**Visible content and capabilities:**

- Luxe Hair Studio & Spa profile with gallery, category, and breadcrumbs.
- Book Appointment, Call Now, and View Portfolio actions.
- Master stylist cards.
- Services and pricing.
- Before-and-after portfolio.
- Quick Contact, Hours & Location, Special Offers, and Premium Products content.
- Booking form with service, preferred stylist, date, and available time controls.

**Product requirement implied:** Appointment-based businesses need scheduling-oriented profile content and a booking path that can be initiated from the listing.

**Not established by the mockup:** Availability source, timezone rules, booking confirmation, cancellation, payment/deposit, reminders, and staff calendar ownership.

### 6. Public business profile: legal services

**Source:** `Law Firm Layout.html`

**Role:** Customer/public visitor.

**Purpose:** Show a trust-heavy professional-services profile with consultation and educational resources.

**Visible content and capabilities:**

- Sterling & Associates Law Firm profile with practice category and firm overview.
- Practice Areas.
- Our Attorneys with attorney cards.
- Case Results & Achievements.
- Legal Resources including a rights guide, settlement calculator, FAQ, and forms library.
- Schedule Consultation, Call Now, and Send Message actions.
- Free Consultation and 24/7 Emergency Line cards.
- Contact information, office hours, credentials, and memberships.

**Product requirement implied:** Professional listings need credentials, people/team information, outcomes or proof points, educational resources, and lead-generation actions.

### 7. Public business profile: veterinary healthcare

**Sources:** `Vet Clinic Page.html` and `Vet Clinic Page (1).html`

**Role:** Customer/public visitor.

**Purpose:** Show a healthcare profile with routine care and emergency paths.

**Visible content and capabilities:**

- Oakwood Veterinary Clinic profile.
- Specializations.
- Veterinary team with named veterinarian cards.
- Pet care tips.
- Emergency Contact with a prominent emergency phone path.
- Clinic Information, Hours of Operation, Credentials & Certifications.
- Book Appointment, Emergency Line, Call Clinic, and Get Directions actions.

**Relationship between files:** The two files are functionally duplicate mockups of the same screen concept and should not be treated as two separate product requirements.

**Product requirement implied:** Healthcare listings need clear emergency handling, staff credentials, services/specializations, appointment access, and strong contact visibility.

### 8. Business owner listing manager: compact form and preview

**Source:** `Biz Listing UI.html`

**Role:** Business owner/operator.

**Purpose:** Manage a listing while seeing the public-facing result.

**Visible content and capabilities:**

- Manage Your Listing page.
- Navigation for Dashboard, Manage Listing, Analytics, Settings, and Help & Support.
- Preview Live, Save Changes, Save Draft, and Submit for Approval actions.
- Form-oriented listing content and a Live Preview panel.
- Example listing card for The Corner Café.

**Product requirement implied:** Owners need a low-friction way to maintain a listing and understand how edits will appear before submitting them.

**Not established by the mockup:** Whether changes are autosaved, what requires approval, validation rules, revision history, and whether preview is rendered from unsaved state.

### 9. Business owner listing editor: sectioned workspace

**Source:** `LocalHub Editor.html`

**Role:** Business owner/operator.

**Purpose:** Provide a fuller editing workspace for listing content.

**Visible content and capabilities:**

- LocalHub editor layout with sidebar navigation.
- Listing Details sections: Basic Information, Operating Hours, Photos & Media, and Contact Details.
- Advanced sections: Location & Map, Categories & Tags, and Features & Amenities.
- Management sections: Analytics, Change History, and Settings.
- Basic Information form fields for business name, primary category, description, address, city/state, keywords, and photos.
- Operating-hours presets such as Standard Hours, Coffee Shop, Weekend Only, and Custom.
- Undo, Redo, Copy from Template, and Reset Section tools.
- Live Preview panel showing the current listing card.
- Preview and Submit Review actions.

**Product requirement implied:** The owner experience should be structured by content responsibility, support reusable hours presets, expose a live preview, and preserve enough change context for review/history.

**Not established by the mockup:** Permission model, autosave, undo persistence, template ownership, media upload limits, moderation rules, and analytics definitions.

### 10. Administrator pending approvals queue

**Source:** `Admin Dashboard UI.html`

**Role:** Platform administrator/moderator.

**Purpose:** Review and moderate newly submitted or changed business listings.

**Visible content and capabilities:**

- LocalHub Admin sidebar with Overview, Pending Approvals, All Businesses, Business Owners, Flagged Content, and Settings.
- Pending Approvals title with a pending count.
- Export and Approve Selected actions.
- Filters for category, priority, and submission time.
- Select-all and per-card selection.
- Business cards with image, name, category, submission age, owner, priority, address, and owner contact information.
- Per-listing Approve, Changes, Reject, and View Full Details actions.
- Pagination and a business-details side panel.

**Confirmed interaction in the HTML:** The select-all checkbox updates individual selections and reflects checked/indeterminate state. The View Full Details control opens and closes the side panel.

**Not established by the mockup:** Approval authorization, change-request messaging, rejection reasons, audit logs, export format, and server persistence.

### 11. Administrator business directory management

**Source:** `Admin Panel UI.html`

**Role:** Platform administrator/operations team.

**Purpose:** Operate the complete business directory after listings have entered the system.

**Visible content and capabilities:**

- LocalConnect Admin shell with breadcrumb, notifications, admin avatar, and grouped navigation.
- Dashboard and Pending Reviews, plus Business Directory, User Accounts, Categories, Analytics, and Settings.
- Summary cards for total businesses, pending approval, verified active, and monthly revenue.
- Business Listings area with Grid, Table, and Map view options.
- Search by name, owner, or location.
- Filters for category, status, location, and verification.
- Add Business action.
- Business cards showing status such as Verified, Pending, Premium, or Suspended.
- Listing actions such as Edit, View, Approve, Review, Restore, Reject, and Delete.
- Bulk Edit, Suspend, and Delete bar for selected businesses.

**Product requirement implied:** Admin operations need both high-level directory health metrics and detailed listing moderation/management views.

**Important safety boundary:** Delete, suspend, restore, approve, reject, and bulk actions are visible requirements, but their exact confirmation, authorization, audit, and undo behavior are not specified by the mockup.

### 12. Property listing detail page

**Source:** `Property Page Ideas.html`

**Role:** Customer/buyer or property lead.

**Purpose:** Present a real-estate listing with property details, agent contact, showing scheduling, and financing support.

**Visible content and capabilities:**

- Modern Family Home listing with address headline.
- Property Description and Property Details.
- Key Features including garage, floors, fireplace, yard, natural light, and kitchen.
- Floor Plans.
- Neighborhood & Schools.
- Agent card with Contact Agent and Schedule a Showing actions.
- Mortgage Calculator with property price, down payment, interest rate, and loan-term inputs.
- Mortgage quote CTA.
- Similar Properties.
- Home, Directory, About Us, Contact, Log In, and Sign Up navigation.

**Product requirement implied:** If real estate is in scope, LocalConnect can support vertical-specific listing detail and lead-capture modules beyond ordinary business profiles.

**Scope question:** Confirm whether property listings belong in the first release of LocalConnect or represent a separate/future vertical. Do not merge property-specific data or workflows into the core business model without that decision.

## Template and Scope Decisions

### Treat as one reusable public-profile system

The bakery, automotive, restaurant, hair salon, legal, and veterinary screens should be implemented as variations of one public business-profile foundation with configurable modules. The shared foundation is the header, breadcrumb, hero/gallery, identity/trust metadata, primary actions, contact information, hours, and responsive two-column-to-one-column layout.

### Treat as role-specific applications

- Public discovery: directory landing page and public profiles.
- Owner workspace: compact listing manager and full LocalHub editor.
- Admin workspace: pending approvals and directory management.

These role-specific surfaces have different goals and should not be collapsed into one overloaded screen.

### Treat duplicate source files as one requirement

`Vet Clinic Page.html` and `Vet Clinic Page (1).html` describe the same veterinary profile and should map to one implementation/template requirement unless later comparison proves a meaningful difference.

### Keep property scope explicit

`Property Page Ideas.html` is the only real-estate-specific mockup. Record it as an extension candidate, not as proof that property workflows are part of the same first-release data model.

## Visual and Responsive Direction Observed

- Brand language is primarily blue, white, and slate/neutral surfaces with semantic green, amber, and red statuses.
- Typography is generally Inter or a system sans-serif stack.
- Public profiles favor content cards, a large hero/gallery, and a main-content-plus-sidebar layout.
- Admin screens favor persistent navigation, dense operational cards, filters, summary metrics, and bulk actions.
- Owner screens favor forms, section navigation, preview, and editing tools.
- The HTML includes responsive breakpoints that collapse profile sidebars and admin grids on narrower screens.
- Future implementation should use shared design tokens for spacing, typography, colors, radii, and responsive behavior rather than copying hardcoded values from individual mockups.

## Confirmed Versus Unknown

### Confirmed by the supplied screens

- LocalConnect is a local-business directory/discovery concept.
- LocalHub is an owner-facing listing editor concept.
- Admin review and directory management are in scope for the operational experience.
- Public profiles vary by business vertical.
- Listing verification, approval, status, owner data, hours, contact information, and category data are recurring concepts.
- The mockups contain responsive layout intent.

### Still requiring product or technical decisions

- Authentication, roles, permissions, and account recovery.
- Backend/API and database contracts.
- Search, geolocation, ranking, filtering, and pagination behavior.
- Review and rating submission/moderation lifecycle.
- Business onboarding and listing approval state machine.
- Media storage, processing, ordering, and limits.
- Booking, ordering, quote, messaging, payment, and external-provider integrations.
- Notifications, audit history, analytics definitions, and revenue model.
- Whether real estate is part of the initial product scope.
- Empty, loading, error, validation, confirmation, and accessibility states for every interactive flow.

## Implementation Guardrails

- Preserve the distinction between public discovery, owner management, and admin operations.
- Build shared profile primitives before adding vertical-specific modules.
- Make business-type modules data-driven rather than cloning entire pages.
- Treat all mockup links and buttons as visual intent unless behavior is explicitly demonstrated in the source.
- Add explicit confirmation and audit behavior before implementing destructive admin actions.
- Use real design tokens and responsive units in the production implementation.
- Keep the screen names and role mapping stable enough that future work can trace implementation back to this document.

## Source Inventory

| File | Product area | Screen role |
|---|---|---|
| `LocalConnect.html` | Directory discovery | Public visitor |
| `Bakery Listing.html` | Business profile | Public visitor |
| `Auto Shop Page.html` | Service business profile | Public visitor |
| `LocalConnect Page.html` | Restaurant/menu profile | Public visitor |
| `LocalConnect Site.html` | Beauty/booking profile | Public visitor |
| `Law Firm Layout.html` | Legal/professional profile | Public visitor |
| `Vet Clinic Page.html` | Veterinary profile | Public visitor |
| `Vet Clinic Page (1).html` | Duplicate veterinary profile | Public visitor |
| `Biz Listing UI.html` | Listing manager and preview | Business owner |
| `LocalHub Editor.html` | Full listing editor | Business owner |
| `Admin Dashboard UI.html` | Pending approvals | Administrator |
| `Admin Panel UI.html` | Directory management | Administrator |
| `Property Page Ideas.html` | Real-estate listing detail | Scope candidate |
