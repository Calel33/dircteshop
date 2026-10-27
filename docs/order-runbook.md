# Order protocol runbook

**Audience:** the owner operating a business day to day, and the team supporting them.
**Scope:** the measured order protocol — the owner board, the recovery controls, the abuse
controls, order retention, and how to read the order metrics.
**Normative source:** `docs/order-commitment-protocol.md`. Section and line references in this
document (`§6.8 :1506-1512`) point at that file; the code references (`convex/orderBlocks.ts:211`)
point at this repository.

This runbook states what the shipped code does. Where the protocol or the plan describes
something the code does not do, the runbook says so in a **Known gap** note rather than
describing intended behaviour. The Known gaps are collected in Section 9.

The order surface has no push, no SMS, and no dashboard charts in v1. The owner board is the
queue; this document is the procedure around it.

---

## 1. Daily checklist (one screen, five items)

Source: §6.8 :1506-1512. The board defaults to the **New** filter, oldest first, so the
longest-waiting order is at the top (§6.8 :1451-1454).

1. **Open the New filter; clear the queue or decline with a reason.**
   Declining requires a reason from the coded list (`Sold out`, `Unreachable`, `Too busy`,
   `Duplicate`, `Other`) — §6.8 :1470-1476. The customer sees the reason label on the receipt
   (§6.7 :1422).
2. **Check Ready for pickups; complete or no-show after the window.**
   `Complete` only from `ready`; `No-show` only from `ready`, and only after the pickup window
   has passed — §6.8 :1482-1484.
3. **Check Paused and Hours; resume if the pause was accidental.**
   The board shows a paused banner with the deadline and note, plus a one-tap **Resume**
   (Section 2.1). Hours are checked in the **Operating Hours** editor section (Section 2.2).
4. **Check Sold out items; un-86 anything that is back.**
   Availability lives in the menu panel, per item and per group (Section 2.3).
5. **Review yesterday's declines; note `Sold out` / `Unreachable` causes.**
   The same two reasons drive the weekly review thresholds in §6.8 :1478 — `Unreachable` above
   5% of new orders means the contact requirement or the verification script needs work;
   `Sold out` above 2% means the 86 process is stale.

**Why the checklist, and not a notification:** v1 has no push or SMS, so nothing arrives on its
own. Section 6, and §6.8 :1497-1498, explain the compensating habit: keep the board open and run
this list at open, mid-service, and close.

---

## 2. Recovery paths

Each path states what the owner clicks and what the customer sees. Customer copy is the §6.7
table (:1409-1434), which is normative for the customer-facing text.

### 2.1 Pause and resume ordering

**What the owner clicks** (`app/owner/business/[id]/orders-panel-pause.tsx`):

- The board control reads **Pause orders** (or **Change pause** when already paused).
- The dialog offers **Pause for**: `30 min`, `1 hour`, `Rest of day`, `Custom`, plus an
  optional **Note** (up to 200 characters) and a **Pause orders** submit button.
- While paused, the board shows a banner and a one-tap **Resume** button. The banner reads
  `Paused until {time} — {note}` (or `Ordering paused — {note}` with no deadline). Once the
  deadline has passed it reads `Pause ended {time} — press Resume`
  (`orders-panel-pause.tsx:191-206`).
- **Resume** clears both the pause flag and the deadline in one action
  (`orders-panel-pause.tsx:403-415`).

**What the customer sees:** the browse-only "Ordering paused" state — order buttons disabled,
menu still browsable, copy "Ordering is paused. Call {phone} to order." (§6.7 :1415). A stale
client that submits anyway receives `ORDERING_CLOSED` (§6.5; `effectiveOpenReason` returns
`accepting_off` or `until_passed`, `convex/orderCommitPolicy.ts:1190-1213`).

**Pausing never touches pending orders.** Orders already `new`/`accepted`/`ready` stay
actionable and their receipts keep working (INV-17 :313, §6.8 :1489).

> **Known gap — auto-resume.** §6.8 :1489 says "the `until` makes the business open again
> automatically". The code does **not** do that: `isEffectiveOpen` requires
> `acceptingOrders` to be true *and* the deadline not reached
> (`convex/orderCommitPolicy.ts:1145-1157`), so a passed deadline leaves ordering closed until
> the owner presses **Resume**. The pause control documents this deliberately
> (`orders-panel-pause.tsx:186-190`). Treat a pause as open-ended: the deadline is a reminder,
> not a timer.

### 2.2 Editing opening hours

**What the owner clicks:** the **Operating Hours** editor section
(`app/owner/business/[id]/editor-sections.tsx:17`), with weekly rows plus quick-fill presets
(`hours-section.tsx:122-186`). Save through the editor's normal save path.

**What the customer sees:** outside configured hours, the browse-only "Outside hours" state —
"Closed right now. Call {phone} or check the hours." (§6.7 :1416). A submit receives
`OUTSIDE_HOURS`; the reason splitter returns `outside_hours`
(`convex/orderCommitPolicy.ts:1203-1210`).

The order path and the public "Open now" badge use the same `openStatusAt` evaluator, so they
cannot disagree (§6.8 :1490). If no hours are configured, ordering is allowed — the explicit
no-hours policy (INV-10 :306, §6.8 :1490).

### 2.3 86 / un-86 a stale item

**What the owner clicks:** in the menu panel, toggle an item's availability switch
(`app/owner/business/[id]/menu-panel-item-editor.tsx:353-354`) or a whole group's availability
toggle (`menu-panel.tsx:218-241`). The panel labels the state **Available** / **Sold out**
(`menu-panel-groups.tsx:31`), and a change is announced as "{item} is now sold out." /
"{item} is now available." (`menu-panel.tsx:226-241`).

**What the customer sees:** a sold-out item shows the "Sold out" chip with no add button
(§6.7 :1413); an unavailable group shows the section with a banner, "This section is
unavailable right now." (§6.7 :1414). A direct order that slips through is rejected with
`ITEM_UNAVAILABLE` / `GROUP_UNAVAILABLE` and the basket is kept for correction (INV-19 :315).

Every availability toggle writes an `auditLogs` row with the actor (INV-22 :318, §6.8 :1493).

> **Known gap — no "sold out since".** §6.8 :1491 asks the owner menu to show "Sold out since
> {time}" so a stale 86 is visible. The menu panel shows only the Available / Sold out state;
> no timestamp is rendered. Use the change announcement and the audit log for now, and check
> the menu panel on the daily checklist.

### 2.4 Related recovery rules worth knowing

- **Sold out after accept:** call the customer, cancel with `Sold out`; never edit lines
  (§6.8 :1499).
- **Customer calls to cancel after accept:** cancel with `Customer request` as an `Other`
  reason (§6.8 :1500).
- **Duplicate:** decline one with `Duplicate`; if both were accepted, call and cancel one
  (§6.8 :1501).
- **No watcher:** an unaccepted order expires after 60 minutes (`DEFAULT_TTL_MS`,
  `convex/orderCommitPolicy.ts:57`); the customer sees `expired`, the owner sees the expired
  row and can call the customer to re-place (§6.8 :1498).

---

## 3. Throttle false-positive path

The per-contact throttle is a rate limit, not a block. It exists to bound repeat attempts from
one phone/email, and it produces false positives when a real customer retries after a genuine
failure. The owner can clear it for one order's contact.

### 3.1 What the customer sees before the clear

The contact allowance is **3 submissions per 10 minutes** and **10 per 24 hours**
(`CONTACT_THROTTLE_10M`, `CONTACT_THROTTLE_24H`, `CONTACT_THROTTLE_WINDOW_24H_MS`,
`convex/orderCommitPolicy.ts:62-70`). The limit is per contact hash, per business, and the
customer name is excluded from the key (`orderBlocks.ts:198-204`).

On the next attempt the customer gets `TOO_MANY_REQUESTS` with `retryAfterMs`; the message
substitutes `{n}` with whole minutes, floored at 1
(`convex/orderThrottle.ts:101-115`). The customer sees:

> "Too many order attempts. Try again in {n} minutes or call the business."

The `{n}` is computed per window (10-minute or 24-hour), so the customer is told which wait
applies to the window they hit.

### 3.2 What the owner clicks

From the order row's contact actions, choose **Clear throttle**
(`ORDER_CONTACT_ACTION_LABELS.clear_throttle`,
`app/owner/business/[id]/orders-panel-helpers.ts:48-52`). The action calls
`orderBlocks.clearContactThrottle({ businessId, orderId })` (`convex/orderBlocks.ts:211-269`).

What the mutation does, and does not do:

- It re-reads the order, requires it to belong to the owner's business, and recomputes the
  contact hash from that order's stored contact. A missing or foreign order answers
  `ORDER_NOT_FOUND`, identically in both cases, so a cross-business id does not disclose that
  the order exists (`orderBlocks.ts:219-224`).
- It deletes **both** contact throttle rows for that hash — the 10-minute and the 24-hour
  window (`orderBlocks.ts:238-251`). The allowance restarts; the next attempt counts as the
  first in each window.
- It **never touches `orderBlocks`**. Clearing a throttle cannot unblock a blocked contact;
  a block persists until **Unblock contact** is used (§7.2 S4 :1631,
  `orderBlocks.ts:206-207`).
- It writes one `auditLogs` row, action `order.clear_throttle`, with the masked contact
  (`***-0100` / `a***@example.com`) and the order id, only when a row was actually removed
  (`orderBlocks.ts:253-265`).

The board announces the result in its live region: "Cleared the throttle for {name}'s order."
or "There was no throttle to clear for {name}'s order."
(`orders-panel-helpers.ts:74-77`). The second message is the honest no-op: the windows had
already reset.

### 3.3 What the customer sees after the clear

Nothing changes on the receipt or the order; the customer simply retries and the attempt is
counted again. Their next successful submission proceeds to the normal state. Do not tell the
customer they were "blocked" — they were rate-limited, and the message they saw said so.

### 3.4 When to escalate

Clear once for a plausible false positive (a retry after a network error, a genuine correction
of contact details). **If the same contact hits the throttle again after a clear, treat it as
abuse**: use **Block contact** on the order row instead
(`orderBlocks.blockContact`, `convex/orderBlocks.ts:77-134`). A block is per business, covers
both the phone and the email hashes, and is idempotent (§7.2 S4 :1633).

A blocked customer receives the generic refusal `ORDER_NOT_ACCEPTED` — "We can't accept this
order online. Please call the business." (INV-16 :312, §6.7 :1429,
`convex/orderCommitPolicy.ts:273-276`). The refusal never discloses the block.

Two limits to know:

- **The business-wide throttle has no owner clear.** 60 submissions per 10 minutes per
  business (`BUSINESS_THROTTLE_10M`, `BUSINESS_THROTTLE_WINDOW_MS`) recovers only when the
  window rolls over (`convex/orderThrottle.ts:54`). This is a demand spike or scripted-abuse
  signal; it is not clearable per order.
- **Clearing a throttle is not a retention action.** Throttle rows follow their own cleanup
  (Section 4.3), not the order's lifecycle.

---

## 4. Retention policy

Source: E74 :282 (privacy risk row), INV-30 :326, plan decision D5. The windows are **decided
values**, not spec numbers: E74 prints its examples with "e.g." and records retention as "not
implemented v1". The decided values live in `convex/orderCommitPolicy.ts:113-115` and are
enforced by `convex/orderRetention.ts:purgeRetainedOrders`.

### 4.1 Windows and scope

| Stored status | Retention | Constant |
| --- | --- | --- |
| `declined`, `cancelled`, `expired`, `no_show` | **90 days** | `RETENTION_TERMINAL_DAYS_MS` |
| `completed` | **365 days** | `RETENTION_COMPLETED_DAYS_MS` |
| `new`, `accepted`, `ready` | never deleted, at any age | `null` in `RETENTION_WINDOW_MS` |

**Age basis:** `statusUpdatedAt ?? createdAt` — the time the order reached its current status,
falling back to creation time on legacy rows that predate the stamp
(`convex/orderRetention.ts:184-189`). An order is in scope when `Date.now() - age >= window`.

**Per-run bound:** `RETENTION_BATCH = 50` orders are examined per run
(`convex/orderCommitPolicy.ts:115`). A backlog larger than the batch drains across daily runs;
one run never scans the table.

**Operational consequence:** because `new`/`accepted`/`ready` are never in scope, an order left
in one of those states is kept forever. Finish or close the queue — retention does not clean up
an abandoned active order.

### 4.2 What is deleted with the order

The order row and exactly these companion tables, in the same transaction
(`convex/orderRetention.ts:19-20,196-202`):

| Companion table | Read path |
| --- | --- |
| `orderEvents` | `byOrderIdCreatedAt`, all rows |
| `orderFlags` | `byOrderId`, all rows |
| `orderAccess` | `byOrderId`, all rows |
| `orderIdempotency` | `byBusinessIdKey`, filtered to the order |
| `orderExpiry` | `byOrderId`, all rows |

This is INV-30's "live and die together" rule :326: an order and the rows that exist only to
serve it are removed as one unit.

### 4.3 What is **not** deleted, and why

- **`notifications` — deliberately NOT a companion.** Research OQ-7: the table has **no
  `orderId` field** (`convex/schema.ts:410-428`). Rows are user-keyed with an optional
  `businessId`, written as business-level history (`New order for "{business}".` /
  `Order for "{business}" was cancelled.`). Adding them to the per-order set would delete
  unrelated notices — actively wrong. **Order notices survive purged orders by design**, and
  nothing in the UI links from a notice to `/order/`.
- **`orderThrottle` / `orderBlocks`** follow their own lifecycle: throttle rows are swept
  daily at 04:00 UTC by `cleanup stale order throttle`, and `orderBlocks` is owner-managed
  state that is never swept (`convex/crons.ts:9-15`).
- **`orderMetricCounters`** are per-business aggregate counters, not per-order rows
  (`convex/orderRetention.ts:26`). They are not touched by retention.
- **`auditLogs`** are immutable admin/business evidence, keyed by actor and target.
- **`businesses` / `menuItems`** are catalog data the order referenced, not owned by it — the
  order snapshot is what made the order readable (INV-13 :309).

### 4.4 The schedule and the dry-run-then-wet-run procedure

The job runs daily at **05:00 UTC** as `purge retained orders`
(`convex/crons.ts:19-24`), passing `{ dryRun: false }` explicitly. `dryRun` **defaults to
`true`** for a manual run, so an operator always inspects before deleting
(`convex/orderRetention.ts:36-37,165`).

Procedure before changing a window or after a long pause:

1. **Dry run first.** Run the mutation with no arguments so `dryRun` takes its default:
   `npx convex run orderRetention:purgeRetainedOrders`
2. **Read the result.** The handler returns
   `{ dryRun, scanned, eligible, deleted, companions }`
   (`convex/orderRetention.ts:151-161`):
   - `scanned` — rows examined, at most `RETENTION_BATCH`;
   - `eligible` — examined rows whose status and age put them in scope;
   - `deleted` — always `0` on a dry run;
   - `companions` — all `0` on a dry run, because a dry run reads no companion table.
3. **Confirm the numbers are what you expect** — in particular that `eligible` is not larger
   than the batch you intended to drain in one day.
4. **Wet run only when the dry run is understood:**
   `npx convex run orderRetention:purgeRetainedOrders '{"dryRun":false}'`
   (the daily cron is the normal wet path; a manual wet run is for a backlog or a window
   change).
5. **Verify afterwards** with a second dry run: `deleted` should be back to `0` once the
   backlog is drained, and `eligible` should reflect only newly aged rows.

### 4.5 Raising or lowering a window

The values are constants, not configuration:

- terminal window → `RETENTION_TERMINAL_DAYS_MS` (`convex/orderCommitPolicy.ts:113`)
- completed window → `RETENTION_COMPLETED_DAYS_MS` (`convex/orderCommitPolicy.ts:114`)
- per-run bound → `RETENTION_BATCH` (`convex/orderCommitPolicy.ts:115`)

Changing any of them is a code change with tests, not an operator setting. **Lowering a window
immediately makes existing rows eligible** — run a dry run first and read `eligible` before the
next 05:00 UTC run. `RETENTION_WINDOW_MS` in `convex/orderRetention.ts:56-65` is exhaustive over
the stored statuses, so adding a status to the protocol fails type-checking here until its
retention is decided.

### 4.6 Dead receipt links (expected, not a bug)

After retention removes an order, its `orderAccess` row is gone too, so `/order/<token>`
resolves to nothing and renders the `ORDER_NOT_FOUND` copy: "We couldn't find that order. Check
the link or call the business." (§6.5, `app/order/[token]/page.tsx:19,52`). The receipt-view
beacon on that page (`recordReceiptView`) returns `{ recorded: false }` and writes nothing
(`convex/orderMetrics.ts:98-111`).

This is the accepted cost of a bounded retention policy. If a customer needs an order older than
its window, the order no longer exists; do not promise a lookup the database cannot serve.

---

## 5. Hard-delete guard: a business with orders cannot be permanently deleted

Source: INV-30 :326, E68 :276, plan decision D6.

**The rule:** a business that owns **any** order is never hard-deleted. The admin delete path
refuses before it reads or removes a single child row.

- The guard runs inside the delete transaction, as the first step of
  `cascadeHardDeleteBusiness` (`convex/businesses/adminDeletion.ts:216-228`). It performs a
  bounded `.take(1)` read on `orders.byBusinessId` — one document is enough to prove the
  business has order history.
- On refusal it throws `ConvexError({ code: 'HAS_ORDERS', message: "This business has order
  history, so it cannot be permanently deleted. Archive it instead to keep past orders
  intact." })` (`adminDeletion.ts:70-78`).
- The throw rolls back every write the caller already made, including the `delete` audit row,
  because it happens inside the same mutation transaction. **A refused delete leaves no audit
  row and no partial cascade** (`adminDeletion.ts:66-68,200-205`).

**Why:** order rows are ledger evidence. INV-30 requires that a retention policy exists and that
hard-deleting a business does not silently cascade-delete order history; E68 lists the same
control as the admin guard. A cascade would also orphan `orderEvents` and the other companion
rows that INV-30 binds to the order's lifetime.

**What to do instead:** keep the business and its history, and take it off the public surface.

- For an **approved** listing, use **Suspend** in the admin directory (`approved → suspended`,
  `convex/businesses/helpers.ts:20,54`). A suspended business is not on the approved public
  listings (`convex/businesses/queries.ts:36`) and new orders are refused with
  `BUSINESS_UNAVAILABLE` (`convex/orders.ts:852`; E65 :273). Existing orders stay readable and
  actionable, and their receipts keep working.
- For a listing still in review, use **Reject** (or leave it unapproved) — an unapproved
  business is never orderable (INV-18 :314).

> **Known gap — "Archive" is not a status.** The refusal message tells the operator to
> "Archive it instead", but the listing state machine has no `archived` status: the statuses are
> `draft`, `pendingReview`, `approved`, `changesRequested`, `rejected`, `suspended`
> (`convex/businesses/helpers.ts:9-23`). The available equivalent is **Suspend** for an approved
> listing. Until an archive state exists, treat "archive" as "suspend, keep the data".

---

## 6. v1 has no push or SMS — keep the board open

Source: §6.8 :1497-1498, INV-28 :324, E60 :268.

There is no push notification and no SMS for a new order. A backgrounded or closed board
receives nothing; the owner learns about an order by opening the board.

**The consequence if nobody watches:** an unaccepted order expires after 60 minutes
(`DEFAULT_TTL_MS`, `convex/orderCommitPolicy.ts:57`). The customer sees `expired`; the owner
sees the expired row and can call the customer to re-place (§6.8 :1498). This is a failure mode,
not a silent loss — but it is a lost order.

**The compensating habit** is the daily checklist in Section 1, run at predictable points:

- at open, so the overnight queue is cleared before service;
- mid-service, so `new` and `ready` do not age past the customer's patience;
- at close, so the day's declines are reviewed while the reasons are still fresh.

Keep the board tab open during service. The board subscribes to its query, so a new order
appears without a refresh (§6.8 :1455). Treat "the tab is open" as part of opening the shop,
the same way the lights are.

---

## 7. §4.4 escalation thresholds, restated against the real metrics

Source: §4.4 :658-666 (thresholds), §4.5 :668-686 (measurement plan). The protocol calls these
thresholds **hypotheses, not evidence**, and says they must be revised with real data (:666).
They are reproduced here only so the team knows which metric decides each row.

All names below are fields of `OrderMetricsOverview` (`convex/orderMetrics.ts:210-254`). The
owner analytics read is `orderMetrics.overview({ businessId, windowDays })`.

| §4.4 observation | Metric in `OrderMetricsOverview` | How to read it |
| --- | --- | --- |
| Fake/abusive orders **< 0.5%** of submissions; owner call time > 30s/order | `ownerFlags.abuseRate` (owner-flagged orders ÷ submissions) | Below 0.005. Stay on option B; optimize the accept flow; do not add deposits. |
| Fake/abusive orders **0.5–2%**; `Unreachable` declines **< 5%** | `ownerFlags.abuseRate`; `declines.reasonMix` | Abuse rate between 0.005 and 0.02. The `Unreachable` entry's `count` ÷ `submissions` below 0.05. B is sufficient; tighten throttle/block, not deposits. |
| Fake/abusive orders **> 2% for 2 consecutive weeks**, or food-cost loss **> 2% of revenue** | `ownerFlags.abuseRate` only | Above 0.02 in two consecutive weeks. Food-cost loss has **no metric** (see below). Pilot option C. |
| Owner cannot sustain calls at volume | No direct metric | Read with `latency.p50` / `latency.p95` and the board's queue; decide from the owner interview. |
| Honest customers abandon at the verification step | No metric | Conversion funnel events are out of scope in v1 (see below). Owner interview only. |

**Reason-mix percentages are derived, not stored.** `declines.reasonMix` is an array of
`{ reason, count }`; the percentage the thresholds talk about is
`count ÷ submissions` (the `submissions` field), because §6.8 :1478 states the `Unreachable`
and `Sold out` triggers as percentages **of new orders**. Do not divide by `declines.count`
unless you mean "share of declines", which is a different number.

**What is not instrumented — do not pretend otherwise:**

- **Owner call time** (the "> 30s/order" input). The platform cannot observe the call. §4.5
  :684 replaces it with an owner interview after two weeks: "How many calls did you make? How
  long? Which orders did you decline? What did you do when you couldn't reach someone?"
- **Food-cost loss as a percentage of revenue.** There is no revenue or cost field and no
  payment in v1, so the second half of the "> 2%" row cannot be computed from the app.
- **Conversion: menu view → basket start → submit** (§4.5 :679). The customer menu funnel is
  not instrumented; it is recorded as a limitation in the plan (out of scope).

### 7.1 "Client-reported, best-effort" — which numbers carry that label

Plan decision D4 (design A) accepts that a rejection cannot be counted where it happens: every
rejection path ends in a thrown `ConvexError`, and a Convex mutation discards its writes when it
throws. The counters are therefore written by the customer's client, in a separate mutation
that commits (`convex/orderMetrics.ts:9-22`).

Affected fields — **treat as best-effort, never as an audited count**:

- `rejectionRates` (per-code `count` and `perThousandSubmissions`);
- `throttleHits.count` / `throttleHits.perThousandSubmissions`;
- `blockHits.count` / `blockHits.perThousandSubmissions`;
- `receiptViews`.

Why: a caller that does not report is not counted, and an anonymous caller can inflate a count.
`recordOrderRejection` is deliberately anonymous — the traffic it measures includes anonymous
throttled and blocked customers (`orderMetrics.ts:26-45`). The receipt-view beacon is anonymous
and fire-and-forget for the same reason (`orderMetrics.ts:72-112`).

Server-observed fields, written on the business's own transactions, are `submissions`,
`latency`, `declines`, `cancellations`, `ownerFlags`, and `basketSize`. Those are the numbers to
lean on for an operating decision.

### 7.2 Escalation path if the decision must be spoof-proof

If the §4.4 decision (whether to pilot option C) must rest on numbers a caller cannot inflate,
**implement the server-observed variant first**: a public action `placeOrderTracked` that wraps
`ctx.runMutation(placeOrder)` and bumps the counters inside the same committed path (plan D4,
alternative B). Do that before acting on the thresholds.

The recorded tradeoff: an action→mutation hop on every successful order pollutes the p95 latency
the same issue measures, and the customer panel moves from `useMutation` to `useAction`. That is
why design A shipped for v1; it is not a reason to trust an inflated number for a product
decision.

### 7.3 The closed vocabularies behind the counters

- **Rejection counters accept exactly the six `REJECTION_CODES`**: `throttle_rejected`,
  `block_hit`, `price_changed`, `item_unavailable`, `ordering_closed`, `outside_hours`
  (`convex/orderCommitPolicy.ts:145-152`). An out-of-list code is a silent no-op with no write
  (`convex/orderMetrics.ts:54-59`) — the closed list is what stops a public beacon becoming an
  arbitrary key-value writer.
- **The receipt-view key is `RECEIPT_VIEW_CODE = 'receipt_viewed'`**
  (`convex/orderMetrics.ts:70`). It is deliberately **not** a rejection code: a view is not a
  rejected attempt.
- **The owner flag reasons are exactly the five `FLAG_REASONS`**: `Fake order`, `Wrong number`,
  `Duplicate`, `Prank`, `Other` (`convex/orderCommitPolicy.ts:125-131`). A flag is one label from
  that list, so no free text reaches an `auditLogs` row.
- **A flag is corrected by `orderFlags.unflagOrder`**, which sets `active: false` and writes an
  `order.unflag` audit row (`convex/orderFlags.ts:142-180`). It is idempotent — `{ changed: false }`
  when the order has no active flag — so an accidental second unflag writes nothing. There is
  **no board control for it** (Known gap 5): the board wires only `flagOrder`
  (`app/owner/business/[id]/orders-panel.tsx`), so a mis-flag is corrected through the CLI today.

---

## 8. Reading the numbers: privacy, floors, and what is absent

### 8.1 No PII, no export

- The metrics read selects ids, counts, codes, and window bounds only. No contact field is
  selected, and `orderAccess` is never read (`convex/orderMetrics.ts:114-120`). This is INV-25
  :321: no phone, email, name, note, or token in logs or analytics.
- **There is no bulk export** (E72 :280). Contact is shown per order on the board, not as a
  report: there is no export path to add one.

### 8.2 "Fail visibly, never a false total"

`capped` is `true` when **any** bounded read hit its cap (`eventWindow`, `flagWindow`, or
`orderWindow`; `convex/orderMetrics.ts:616`). The caps are:

| Read | Cap | Constant |
| --- | --- | --- |
| `orderEvents` in the window | 5,000 | `METRICS_WINDOW_EVENT_LIMIT` |
| `orderFlags` in the window | 1,000 | `METRICS_WINDOW_FLAG_LIMIT` |
| `orders` for basket distributions | 1,000 | `METRICS_WINDOW_ORDER_LIMIT` |

When `capped` is `true`, the affected figures are **floors**: the true value is that number
**or more**. Say "at least", never present it as an exact total. A floor is honest; a truncated
number presented as complete is a false total.

Other reading rules that prevent misreads:

- **The window is explicit.** `windowDays` is clamped to 1–365 and defaults to 30
  (`METRICS_DEFAULT_WINDOW_DAYS`, `METRICS_MIN_WINDOW_DAYS`, `METRICS_MAX_WINDOW_DAYS`,
  `convex/orderMetrics.ts:131-133`). `windowStart` and `windowEnd` echo the bounds actually
  used. Two reports from different windows are not comparable.
- **Rates are fractions.** `declines.rate` and `ownerFlags.abuseRate` are `0.05` for 5%, not
  `5`. `perThousandSubmissions` is already multiplied by 1,000. A zero denominator yields `0`,
  never `NaN` (`orderMetrics.ts:284-291`).
- **Empty latency is `null`, not zero.** `latency.p50` and `latency.p95` are `null` when
  `latency.sampleSize` is `0`; `0` would mean "instant", which is a different claim
  (`orderMetrics.ts:203-206`).
- **`receiptViews` is per tab mount, not per customer.** The beacon fires once per tab; there is
  no unique-person dedupe (plan Task 6: dedupe is per-tab only, aggregate-only).

### 8.3 `profile_views` / `contact_clicks` are not instrumented

Those two labels are **not** metrics. Nothing writes `profile_views` or `contact_clicks`
anywhere in the repository; the names survive only in design/prototype material. Do not read
them as data, and do not quote them in a report.

The analytics panel now shows the **order** metrics instead: it runs
`useQuery(api.orderMetrics.overview, { businessId })` and renders the overview — the stat grid
(Submissions, Accepted latency p50/p95, Decline rate, Throttle hits, Block hits, Abuse rate,
Receipt views), the decline reasons, the per-code rejection rates, and the basket-size
distributions — plus a "Partial window" notice when `capped` is true
(`app/owner/business/[id]/editor-section-body.tsx`, `AnalyticsContent` / `AnalyticsMetrics`).
The panel's three placeholder labels (`Profile views`, `Contact clicks`, `Orders / bookings`)
are gone.

The panel is a view, not the contract: `orderMetrics.overview` is the authoritative shape, so
read a field from the query rather than inferring it from what the panel happens to render.

---

## 9. Known gaps (code vs. protocol / plan)

Every item below was observed in the code while writing this runbook. None is fixed here — the
runbook documents the shipped behaviour and names the gap.

| # | Where the protocol/plan says | What the code does | Operator workaround |
| --- | --- | --- | --- |
| 1 | "The `until` makes the business open again automatically" (§6.8 :1489) | `isEffectiveOpen` still requires `acceptingOrders === true`; a passed deadline keeps ordering closed until **Resume** (`orderCommitPolicy.ts:1145-1157`; `orders-panel-pause.tsx:186-190`) | Treat every pause as open-ended; the banner says "Pause ended {time} — press Resume" |
| 2 | Show "Sold out since {time}" in the owner menu (§6.8 :1491) | The menu shows only Available / Sold out, with a change announcement; no timestamp (`menu-panel-groups.tsx:31`, `menu-panel.tsx:226-241`) | Check the menu panel on the daily checklist; use the audit log for change time |
| 3 | "Archive it instead" on a refused hard delete (`adminDeletion.ts:75`) | No `archived` listing status exists (`helpers.ts:9-23`) | Use **Suspend** for an approved listing; it leaves the approved public surface and keeps the data |
| 4 | §4.4 rows that use owner call time, food-cost loss, and verification-step abandonment (:660-664) | No field measures any of them; §4.5 :684's owner interview is the only source for call time, and the funnel is out of scope | Use `ownerFlags.abuseRate` and `declines.reasonMix` for what is measured; record the rest in the two-week owner interview |
| 5 | §7.2 S5 lets the owner flag **and unflag** an order | `orderFlags.unflagOrder` (`convex/orderFlags.ts:142-180`) is shipped, but no UI calls it — the board offers only **Flag fake order** (`orders-panel.tsx` imports `flagOrder` alone) until a follow-up ships | Correct a mis-flag with `npx convex run orderFlags:unflagOrder '{"businessId":"<business id>","orderId":"<order id>"}' --identity '{"subject":"<owner subject>"}'`; a flag on an inactive or nonexistent flag row is a no-op |

---

## 10. Source index

Protocol anchors used above, all in `docs/order-commitment-protocol.md`:

| Reference | Subject |
| --- | --- |
| §4.4 :658-666 | Escalation thresholds (hypotheses) |
| §4.5 :668-686 | Measurement plan, owner interview, privacy |
| §6.7 :1405-1445 | Customer UX states, copy, accessibility interaction rules |
| §6.8 :1447-1513 | Owner operator workflow; daily checklist :1506-1512 |
| §6.8 :1487-1493 | Pause, hours, availability |
| §6.8 :1497-1498 | No push; no watcher / expiry |
| §6.8 :1504 | Business deletion warning |
| E60 :268, E65 :273, E68 :276, E72 :280, E74 :282 | Operator/privacy risk rows |
| INV-13 :309, INV-16 :312, INV-17 :313, INV-18 :314, INV-19 :315, INV-22 :318, INV-25 :321, INV-28 :324, INV-30 :326 | Invariants cited above |

Code anchors used above, all relative to this repository:

| Concern | File |
| --- | --- |
| Metric shape (`OrderMetricsOverview`), caps, window clamp, receipt-view key | `convex/orderMetrics.ts` |
| Retention windows, batch, rejection codes, flag reasons, TTL, throttle limits | `convex/orderCommitPolicy.ts` |
| Retention job (scope, companions, dry run) | `convex/orderRetention.ts` |
| Daily cron names and times | `convex/crons.ts` |
| Hard-delete guard and refusal | `convex/businesses/adminDeletion.ts` |
| Clear throttle, block/unblock | `convex/orderBlocks.ts` |
| Pause dialog and resume banner | `app/owner/business/[id]/orders-panel-pause.tsx` |
| Contact action labels and announcements | `app/owner/business/[id]/orders-panel-helpers.ts` |

