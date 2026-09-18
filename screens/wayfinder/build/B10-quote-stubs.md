# Build Ticket B10: Quote workflow + non-exemplar vertical stubs

Slice owner: SPEC §6 (stub rows), §7 (quote). Decisions from tickets 04, 05, 10. Blocked by: B9.

## End-to-end slice

1. `quoteRequests` workflow (anonymous): name + contact + message + sourceLabel; statuses new/responded/closed (owner transitions); owner notification. Generic UI driven by the ProfileAction label.
2. Vet: Book Appointment → real booking workflow (healthcare services carry durationMinutes); Emergency Line = call link.
3. Legal: "Schedule Consultation" → quote workflow with context label; Send Message → quote.
4. Auto: services rendered as price-list styling (display only); Call + "Request Towing" → quote (custom label).
5. food-drink, retail, professional-services: generic profile configs render correctly (foundation + services/credentials modules only).
6. Team cards degrade to services-list presentation (vet team, legal attorneys).

## Done when (verification evidence)

- Lint + build clean.
- Tracer per stub: seed one business per category → each renders its config actions → quote request from auto (towing label) reaches owner with correct sourceLabel → owner closes it.
- Vet booking goes through the same booking workflow as salon (shared code, not a fork).
