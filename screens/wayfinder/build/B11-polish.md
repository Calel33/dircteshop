# Build Ticket B11: States, accessibility, responsive + token audit pass

Slice owner: SPEC §13 (open items that bind every flow). Decisions from ticket 08 + AGENTS.md rules. Blocked by: B4, B6, B8, B9, B10.

## End-to-end slice

A cross-cutting pass over every surface:

1. **Empty/loading/error/validation states per flow:** skeleton loaders on all lists; hidden empty sections on landing; standard results empty state; form validation messages (editor, workflows, auth); error boundaries + retry affordances on data fetches.
2. **Accessibility:** keyboard paths for modals (confirm dialogs, reason modals), focus trap + return focus, aria-labels on icon buttons, alt text enforced on gallery images, color-contrast on status chips/banners.
3. **Responsive:** two-column→one-column collapse on profiles + admin directory; mobile owner editor (compact view per ticket 06); chip row wrapping.
4. **Token audit vs AGENTS.md:** no hardcoded px (small details only), rem/em text+spacing, %/fr layout; verify against the product brand palette — replace the starter's neutral globals.css tokens (root `design.md` is landing-scoped; both decided in the issue #20 prototype session); run the design-system lint.
5. Confirm public-only visibility invariant: no route or query leaks non-approved businesses anywhere.

## Done when (verification evidence)

- Lint + build clean; design-system lint clean.
- Keyboard-only walkthrough of one full tracer (book a salon appointment) succeeds.
- Every surface has visible loading and empty states; validation errors shown on required-reason modal + editor required fields.
- Grep-level audit: no hardcoded values outside the px-small-detail allowance.
