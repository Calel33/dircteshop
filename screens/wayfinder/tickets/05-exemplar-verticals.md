# Ticket: Specify the two exemplar verticals — restaurant ordering and salon booking end-to-end

Parent: [map.md](../map.md)
Labels: wayfinder:grilling — **RESOLVED**

## Question

The two fully-built verticals. For each, decide the workflow contract:

**Restaurant (LocalConnect Page.html):**
1. Menu data model: tabs → item groups → items with options/customizations (bowl bases, proteins, sauces) — final shape.
2. "Order Online" in v1: the charting decision says native workflows, but ordering-with-payment was never decided. Is v1 ordering = an order record + owner notification (no payment), or deferred entirely with menu browsing only?
3. Nutrition guide + rewards: display-only data or out of scope?

**Salon (LocalConnect Site.html):**
4. Booking data model: service, stylist, date, time — plus availability. Where does availability come from in v1 (business hours + slot picker, no per-stylist calendar)?
5. Booking lifecycle: requested → confirmed/declined/cancelled — who transitions, what notifies, timezone handling.

**Both:**
6. Request-a-quote generic workflow (also serves auto shop's quote/towing actions as stubs): fields, storage, owner reply path, status.

## Resolution

All six decided by the human (grilling session):

**Restaurant:**
1. **"Order Online" = order record + owner notification, no payment.** Visitor customizes an item (menu item + customization selections from ticket-01's `customizationOptions`), submits → order stored in Convex with status `new → accepted → ready → completed` → owner notified in-app. No cart beyond one item set, no checkout, no payment. Matches the mockup's single-bowl customize+order flow.
2. **Nutrition = display-only optional item fields; Rewards = out of scope.** Nutrition Guide becomes optional fields on menuItems (rendered when present). Green Rewards is account/billing-adjacent — dropped. New table: `orders`.

**Salon:**
3. **Availability = business hours + service duration slot picker.** Slots derived from hours + `durationMinutes`; no per-stylist calendar, naive slot marking only (no conflict engine in v1). Matches the mockup's date + time control.
4. **Booking lifecycle:** `requested → confirmed | declined` (owner action); `requested/confirmed → cancelled` (visitor via tokenized cancel link — anonymous forms have no account). Timezone: store UTC + business timezone string, render local. Owner notified in-app on request. New tables: `bookings`, plus a cancel-token field.

**Both:**
5. **Quote workflow:** fields = name, phone/email, message (prefilled with action context, e.g. "Request Towing"). Statuses: `new → responded → closed` (owner transitions). Owner reply in v1 is phone/email contact — no in-app messaging thread. Stored per-business, in-app notification to owner. New table: `quoteRequests`.
6. **Content re-review policy:** menu/services/stylists/photos edit **live** for approved businesses — no re-approval. Only core identity fields (name, categoryId, address, description) trigger `approved → pendingReview` per ticket-01's transition table. Rationale: content churn would drown the approval queue.

**Schema deltas for ticket 01's proposal (feed into final spec):**
```ts
orders: { businessId, menuItemId, selections[{optionName, choiceName}], customerName, contactPhone?, contactEmail?, status: new|accepted|ready|completed, createdAt }
bookings: { businessId, serviceOfferingId, stylistId?, customerName, customerPhone, customerEmail, startAt (UTC), cancelToken, status: requested|confirmed|declined|cancelled }
quoteRequests: { businessId, customerName, customerContact, message, sourceLabel (e.g. 'Request Towing'), status: new|responded|closed, createdAt }
```
All three notify the owner in-app (per map Notes: notifications table + badge — trigger matrix detail still in fog).
