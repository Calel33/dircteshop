# Ticket: Consolidate everything into the build-ready spec + tracer-bullet tickets

Parent: [map.md](../map.md)
Labels: wayfinder:task — **RESOLVED**

## Question

Once tickets 01–08 are resolved, assemble the final deliverable:

1. `SPEC.md` next to the screen spec: architecture (routes, Convex schema, roles, module system), per-surface build specs, workflow contracts, state machines, tokens/responsive rules, and open stubs explicitly marked.
2. Tracer-bullet ticket set: ordered, each ticket a thin end-to-end slice (e.g. "seed one business → render its profile publicly", "owner edits hours → admin approves → status flips → public profile updates"), each declaring blocking edges.
3. Every decision traceable to a closed ticket; any surviving fog becomes explicit "deferred" markers in the spec.

This ticket closes the map: the destination is reached when a fresh build session could start ticket #1 with zero unresolved decisions.

## Resolution

Delivered (destination reached):

1. **`../../SPEC.md`** — the build-ready v1 implementation spec: product summary, routes, roles/auth (superuser boundary + owner guard), full Convex schema + state machine, profile module system + vertical configs, workflow contracts (order/booking/quote), landing + search, owner workspace, admin workspace, notifications, media, explicit open/deferred items, and the tracer-bullet table. Every section cites its source ticket.
2. **Tracer-bullet ticket set** — `../build/B1`–`B11`, ordered, each a thin end-to-end slice with stated blockers and done-when verification evidence:
   - B1 bootstrap + superuser boundary (no blockers)
   - B2 schema + categories + seeded business → public profile
   - B3 owner onboarding + editor + approval loop
   - B4 landing + search + category browse
   - B5 notifications · B6 admin directory + audit + export · B7 media
   - B8 restaurant vertical · B9 salon vertical · B10 quote + stubs
   - B11 states/accessibility/responsive/token audit

Open items preserved as explicit deferred markers (SPEC §13), each assigned to the build ticket that must resolve it (e.g. owner-deletion policy → B1 follow-up). All remaining fog (flagged content, analytics definitions, full notification matrix, upload limits) is marked deferred — none blocks the tracer bullets.

The map is complete: no decision tickets remain.
