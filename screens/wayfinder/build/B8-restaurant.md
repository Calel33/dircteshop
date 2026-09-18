# Build Ticket B8: Restaurant vertical — menu modules + order workflow

Slice owner: SPEC §6 (restaurants row), §7 (ordering). Decisions from tickets 04, 05. Blocked by: B3, B7.

## End-to-end slice

1. Editor: menu management for restaurants — menuGroups + menuItems CRUD (name, description, price, image, customizationOptions, ordering, isAvailable, optional nutrition display fields). Edits go live immediately for approved businesses (no re-review).
2. Profile modules: `menuTabs` (groups as tabs), `orderingPanel` (customize + order). Order Online action → order workflow.
3. `orders` workflow: single-item customize → submit (anonymous: name + contact) → owner in-app notification → owner list w/ status transitions new/accepted/ready/completed.

## Done when (verification evidence)

- Lint + build clean.
- Tracer: seeded restaurant → visitor customizes a bowl (base/protein/sauce selections recorded) → submits → owner notified → owner transitions to completed → order shows in owner list with correct selections.
- Menu edits by owner appear publicly without re-approval.
