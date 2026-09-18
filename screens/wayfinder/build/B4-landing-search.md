# Build Ticket B4: Public landing + search + category browse

Slice owner: SPEC §8. Decisions from tickets 04, 08. Blocked by: B2.

## End-to-end slice

1. Landing `/`: hero + search control, Explore by Category (from categories table), Trending This Week (isFeatured approved, ordered by lastUpdatedAt), filter chips (Open Now computed from hours vs current time; Highly Rated rating ≥ 4.5 && ratingCount > 0; Trending/Special Offers/Nearby disabled w/ tooltip), New to LocalConnect (newest approved), Recently Verified. Empty sections hide entirely; skeleton loaders.
2. Shared `BusinessCard` component (density prop; public = rich card; card actions capped to 2) + `BusinessResults` component.
3. `/search?q=` and `/categories` + `/categories/[slug]` — one BusinessResults component, searchIndex query with filterFields (status=approved, categoryId), "Load more" cursor pagination.
4. Standard empty state on results: message + clear-filters CTA + browse-categories link.

## Done when (verification evidence)

- Lint + build clean.
- With ≥3 seeded businesses (mixed statuses/categories): only approved appear anywhere public; category page filters correctly; search finds by name/keyword; chips filter live; empty section hides when its data is absent; narrow-width responsive verified.
