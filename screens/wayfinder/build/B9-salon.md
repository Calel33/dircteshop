# Build Ticket B9: Salon vertical — services/stylists + booking workflow

Slice owner: SPEC §6 (beauty-wellness row), §7 (booking). Decisions from tickets 04, 05. Blocked by: B3, B7.

## End-to-end slice

1. Editor: serviceOfferings (name, description, price, durationMinutes, ordering, isAvailable) + stylists (name, bio, photo, serviceOfferingIds, ordering, isActive) CRUD. Live for approved businesses.
2. Profile modules: `stylistsCard`, `servicesPriceList`, `bookingForm` (service, stylist?, date, time slots), `portfolio` (gallery-based). Book Appointment action → booking workflow.
3. `bookings` workflow: slots derived from business hours + service durationMinutes (naive slot marking, no conflict engine); anonymous form (name/phone/email); stored startAt UTC + business timezone; owner confirms/declines; visitor cancel via tokenized link; statuses requested/confirmed/declined/cancelled.

## Done when (verification evidence)

- Lint + build clean.
- Tracer: visitor books a 45-min service → slot list derived from hours → request → owner notified → confirmed → visitor's cancel link flips it to cancelled → owner list shows the trail.
- Timezone: booking stored UTC, rendered in the business's timezone.
