# Ticket: Specify the public directory landing page + search behavior

Parent: [map.md](../map.md)
Labels: wayfinder:grilling — **RESOLVED**

## Question

`LocalConnect.html` into a buildable landing experience:

1. Landing sections in v1 order: hero + search, Explore by Category, Trending This Week, filter tags (Open Now / Highly Rated / Newly Verified / Special Offers — which are real filters vs static in v1?), New to LocalConnect, Recently Verified. What powers "Trending" with no analytics (admin-pinned? recency?)
2. Search contract: Convex searchIndex query shape — what fields are searched, how category navigation and search combine, pagination.
3. Business card component contract: the shared card used across landing, directory results, and admin grid — one component, which props.
4. Category browse page (nav has "Categories"): dedicated page vs directory filtered — decision.
5. Empty/loading/error states per the spec's unknown list (§1 Not established).

## Resolution

All five decided by the human (grilling session):

1. **Filter tags — Open Now + Highly Rated real; rest static.** Open Now computed from hours vs current time; Highly Rated = `rating ≥ 4.5 && ratingCount > 0` (index filter). Trending / Special Offers / Nearby render **disabled with tooltip** (no analytics, no offers field, no geo) — honest non-filtering chips.
2. **Trending = admin-pinned `isFeatured`.** New `isFeatured: boolean` on businesses (schema delta to ticket 01), set by the Super Admin in the directory view. "Trending This Week" = featured approved businesses ordered by lastUpdatedAt.
3. **Search + categories share one results component.** `/categories` index page (from the categories table) → `/categories/[slug]` renders `BusinessResults` filtered by `categoryId` via the searchIndex `filterFields` (ticket 01); `/search?q=` renders it with a text query. Pagination: "Load more" cursor style, no page numbers. Public queries: `status === 'approved'` only.
4. **One shared BusinessCard with density variants.** Public = rich photo card; admin grid = same card; admin table = separate row component. Card props: business doc + resolved category + primary actions (ticket 04's ProfileAction union, capped to 2 on cards).
5. **All sections + graceful empties.** Order: hero+search, Explore by Category, Trending This Week (featured), filter chips, New to LocalConnect (newest approved), Recently Verified. Empty data sections **hide entirely**; search/category results get standard empty state (message + clear-filters CTA + browse-categories link); skeleton loaders everywhere.

**Routes established (feed into final spec):** `/` (landing), `/search`, `/categories`, `/categories/[slug]`, `/business/[id]` (public profile, ticket 04 foundation).
