# Build Ticket B5: In-app notifications

Slice owner: SPEC §11. Decisions from map Notes + tickets 05, 07. Blocked by: B3.

## End-to-end slice

1. `notifications` table + queries: list for current user, unread count, mark read/mark all read.
2. Wire triggers (minimum matrix): listing submitted → Super Admin; approved/changesRequested/rejected/suspended (with moderationReason) → owner; new order/booking/quoteRequest → owner (orders/bookings/quotes arrive in B8–B10 — wire what exists at build time, complete on those tickets).
3. Badge in owner + admin shells (bell + count), notifications page/dropdown per surface.

## Done when (verification evidence)

- Lint + build clean.
- Tracer from B3 (submit → approve) produces Super Admin notification on submit and owner notification with result; badge counts update in real time (Convex subscription); mark-all-read clears the badge.
