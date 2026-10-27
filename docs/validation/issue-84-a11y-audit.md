# Accessibility Audit — Issue #84 Task 15 (owner board + customer receipt)

> Rule-by-rule audit of `docs/order-commitment-protocol.md` **§6.7 `:1443-1444`** over the
> owner orders board and the customer receipt.
> **Report-only: no implementation file was modified.** Only `verified` means a runtime verdict
> held; `source-inspected` means the attribute was read in source and never exercised in a browser;
> `BLOCKED` means the check could not be performed here. Nothing in this file is inferred as passing.

## Scope

| Field | Value |
|---|---|
| Parent issue | [#84 — Order protocol T10: measurement, hardening, runbook](https://github.com/Calel33/dircteshop/issues/84) |
| Task | Task 15 (Phase 7) — accessibility audit record |
| Binding rules | `docs/order-commitment-protocol.md` §6.7 **`:1443`** (mobile/interaction) and **`:1444`** (accessibility) |
| Surfaces | owner board (`app/owner/business/[id]/orders-panel.tsx`, `-dialogs.tsx`, `-row.tsx`) and customer receipt (`components/order/receipt.tsx`, `app/order/[token]/page.tsx`) |
| Audited | 2026-10-27 |
| Branch / HEAD | `fix/issue-84-order-protocol-t10-measurement-hardening-runbook` / `d9a52f1` |
| Result | **Partial — receipt runtime-proved on 4 of 10 rules; owner board BLOCKED behind the Clerk gate; screen-reader rows BLOCKED (no SR in this environment).** |

## Environment

| Item | Value |
|---|---|
| Base URL | `http://localhost:3000` (dev server already running — **not started, restarted or reconfigured by this audit**) |
| Browser driven | Reticle-leased Chromium context (`npx @reticlehq/server`, lease `lease-c1b7a0c5-784b-4c39-bca0-d53460a0cced`). **The leased browser's exact Chromium build is not exposed by Reticle**, so no version number is claimed for it. |
| Host browsers present | Google Chrome `155.0.8059.85`, Microsoft Edge `156.0.4314.42` (not used for the passes below) |
| OS | Microsoft Windows 11 Pro `10.0.26200` |
| **Screen reader** | **None available.** NVDA is not installed (`C:\Program Files (x86)\NVDA\nvda.exe` and `%APPDATA%\nvda` both absent), JAWS is not installed (`C:\Program Files\Freedom Scientific` absent), VoiceOver is macOS-only. `C:\Windows\System32\Narrator.exe` exists but was not running and cannot be scripted or listened to from this environment. **No SR name or version is recorded because no SR pass was performed.** |
| Screen-reader rows | **BLOCKED** — every row that requires an actual announcement/verbosity check is marked so below. |
| Console errors during receipt drive | 0 (`summary.consoleErrors: 0` on every verdict-producing call) |
| Data written | One order was placed through the app to obtain a `new` receipt token (`/order/Da0EB86j6gWMB-YINlvqzZlFTlMcQrXOSHBffdknw7s`, reference `XM5EN8`, business `Basket QA Cafe`), then cancelled from its receipt. This writes normal order rows to the **shared dev deployment**; no probe/load-test business was touched (`__T9 proof__` is a different seed set). |

## Method

1. Read the binding rules at `docs/order-commitment-protocol.md:1443-1444` and enumerated them as
   10 discrete rules (below). No rule was merged or dropped.
2. Enumerated the a11y idioms in the two surfaces with a source scan (`aria-*`, `role`, `tabIndex`,
   `onKeyDown`, `<h1>`–`<h6>`), then read each hit in context.
3. Drove the **anonymous receipt** with Reticle on three real tokens found in saved flows
   (`.reticle/flows/elite-next-starter-0991ad35/`): an `expired` order, an `accepted` order
   (`J2PZ3V`), and a `new` order obtained through the UI (`XM5EN8`). Verdict-producing calls only
   (`reticle_act_and_wait`, `reticle_act { steps }`, `reticle_assert`).
4. Attempted the **owner board** by navigating the leased browser to the real editor route. It
   renders the Clerk gate; the board itself never mounted. No board row therefore reports behaviour
   of the running board — each is `source-inspected`, `gap`, or (R6 only) n/a-`verified`.
5. Recorded findings only. **No code was modified** (see §Verification).

## Results — rule by rule

Legend: **verified** = a Reticle verdict returned `verified: "yes"`; **source-inspected** = read in
source, not exercised; **BLOCKED** = not evaluable here; **gap** = source shows the rule is not met.

| # | Rule (protocol line) | Surface | Status | Evidence |
|---|---|---|---|---|
| R1 | `aria-live="polite"` for status changes (`:1444`) | receipt | **verified** | `receipt.tsx:248` `<div role="status" aria-live="polite">` wrapping the status pill + sentence. Runtime: accessible tree exposes `status "Order received Order received. The business will call you to confirm."`; after cancelling, `status "Cancelled Your order was cancelled."` and the second live region `status "Your order was cancelled."` (`receipt.tsx:383`). Verdict `verified:"yes"` (`/proved`) on the cancel call, with both live regions in `verdict.evidence`. |
| R1 | `aria-live="polite"` for status changes (`:1444`) | owner board | **source-inspected** | `orders-panel.tsx:690` `<p role="status" aria-live="polite">{statusLine}</p>`; `statusLine` is `boardStatusLine(announcement, label, rowCount)` (`:498`, `:158-163`). Every action sets `announcement` (`runFlagAction` `:658-662`). Not runtime-verified (board gated). |
| R2 | Focus moves to the error summary on failure (`:1444`) | receipt | **gap** | The cancel failure renders `role="alert"` (`receipt.tsx:407-424`) but nothing focuses it: `receipt.tsx` contains no `.focus(`, no `tabIndex={-1}`, no `autoFocus`. Announcement happens; focus movement does not. |
| R2 | Focus moves to the error summary on failure (`:1444`) | owner board | **gap** | Row failure `role="alert"` (`orders-panel-row.tsx:178-198`) and dialog failure `role="alert"` (`orders-panel-dialogs.tsx:177-195`) are announced but never focused; no `.focus(` anywhere in `orders-panel*.tsx`. The rule **is** implemented on the adjacent basket (`basket-panel.tsx:286-291`, "Focus-to-error on every failure (§6.7 accessibility)"), so the idiom exists in the repo and was simply not carried to these two surfaces. |
| R3 | Error messages are associated with fields (`:1444`) | receipt | **verified (n/a)** | The receipt has no user-editable field except the cancel dialog (no form input). Nothing to associate. |
| R3 | Error messages are associated with fields (`:1444`) | owner board | **source-inspected** | `ReasonField` sets `aria-invalid={over}` and `aria-describedby={helpId}` and gives the help/error paragraph the same `id` (`orders-panel-dialogs.tsx:221-239`). `BlockContactDialog` reuses it (`:750`). The flag dialog has no free-text field; its only invalid state is "no reason chosen", prevented by `disabled` on submit (`:834`). |
| R4 | Status is text + icon, not colour alone (`:1444`) | receipt | **source-inspected — partial** | The pill is a text label (`STATUS_LABEL`, `receipt.tsx:52-61`, rendered `:249-257`) over a status-specific class set; the stepper marks reached steps with a `<Check aria-hidden>` vs an empty circle (`:128-132`). Colour is never the only signal (text always present), but the status pill itself carries **no icon**. |
| R4 | Status is text + icon, not colour alone (`:1444`) | owner board | **source-inspected — partial** | `StatusPill` is text only (`orders-panel-row.tsx:213-221`); `AgeBadge` is text (`Waiting 3m` / `Age 12m`) plus colour (`:250-256`). Again no colour-only signal, but no icon either. |
| R5 | Honour `prefers-reduced-motion` (`:1444`) | receipt | **gap** | `receipt.tsx` has no reduced-motion handling. The cancel dialog's overlay/content animate (`components/ui/dialog.tsx:45,67`: `data-[state=open]:animate-in … duration-200`) with no `motion-reduce:` guard, and `app/globals.css` has no `@media (prefers-reduced-motion: reduce)` block. |
| R5 | Honour `prefers-reduced-motion` (`:1444`) | owner board | **gap** | Same dialog primitive animates every board dialog (`orders-panel-dialogs.tsx:119` → `DialogContent`) with no guard. The only reduced-motion check in the order flow is `basket-panel.tsx:445` (smooth-scroll for "Review order"), not these surfaces. |
| R6 | Stepper is a list with `aria-current="step"` (`:1444`) | receipt | **verified** | `receipt.tsx:112-147`: `<ol aria-label="Order status">` → `<li aria-current={current ? 'step' : undefined}>`. Runtime on token `XM5EN8`: `list "Order status"` (ref `e343`) with four `listitem`s; current = `listitem "Order received (current step)"`. On token `J2PZ3V`: `listitem "Accepted (current step)"`. The `(current step)` text is the `sr-only` span at `:141`, so the accessible name proves the current marker is exposed. |
| R6 | Stepper is a list with `aria-current="step"` (`:1444`) | owner board | **verified (n/a)** | The board has no status stepper (it is a queue, not a single order's journey). Nearest precedent: the filter bar is `role="group" aria-label="Filter orders by status"` with `aria-pressed` (`orders-panel-filter-bar.tsx:32-44`). |
| R7 | Receipt has a logical heading order (`:1444`) | receipt | **verified** | Runtime tree, token `XM5EN8`: `heading "Order #XM5EN8"` (h1, `receipt.tsx:240`) → `heading "Status"` / `"Items"` / `"Contact"` (h2, `:264,276,317`). No skipped level; each `<section>` is `aria-labelledby` its heading (`:263,275,316`). |
| R7 | Logical heading order (`:1444`) | owner board | **gap** | `editor-header.tsx:18` renders the page `<h1>`; `OrdersPanel`'s card title is a `CardTitle`, which is a **`<div>`, not a heading** (`components/ui/card.tsx:31-39`) — so there is no `<h2>` for the Orders section — and every row then uses `<h3>` (`orders-panel-row.tsx:82`). The document therefore jumps h1 → h3. (Contrast: `AnalyticsPanel` explicitly restores the level with `role="heading" aria-level={2}`, `editor-section-body.tsx:391`.) |
| R8 | 44×44 px targets (`:1443`) | receipt | **source-inspected — partial** | Every receipt action carries `min-h-11` (2.75rem = 44px): copy `:338`, call `:350`, cancel `:358`, browse `:369`, dialog "Keep order" `:430`, dialog "Cancel order" `:439`. **But** the dialog also renders the primitive's icon-only close (`components/ui/dialog.tsx:73-77`): an absolutely-positioned `<XIcon className="size-4">` with no padding or minimum size — a ~16×16 px target. The board deliberately suppresses exactly this control (`orders-panel-dialogs.tsx:129-133`, `showCloseButton={false}`); the receipt does not pass that prop (`receipt.tsx:397`). |
| R8 | 44×44 px targets (`:1443`) | owner board | **source-inspected** | Action buttons `min-h-11` (`orders-panel-row.tsx:107,146,169,188`), dialogs `min-h-11` (`orders-panel-dialogs.tsx:187,824,833`), reason field `min-h-11` (`:229`) and select trigger `min-h-11` (`:861`). The board's dialogs pass `showCloseButton={false}`, so no sub-44px icon control is emitted there. |
| R9 | Quantity stepper text-labelled, not icon-only (`:1443`) | basket (adjacent — named by the rule, outside the two audited surfaces) | **source-inspected** | `components/order/basket-controls.tsx:26-46`: `QuantityStepper` is `role="group"` with an `aria-label` and `sr-only` labels on each control. The receipt has no quantity control (quantity renders as text, `receipt.tsx:284`), and the board has none either. |
| R10 | No hover-only actions (`:1443`) | receipt | **verified** | Every receipt action is a real button/link in the accessible tree (`Copy order link`, `Call Basket QA Cafe`, `Cancel order`, `Browse businesses`) and each performed on click. Nothing is revealed by hover. |
| R10 | No hover-only actions (`:1443`) | owner board | **source-inspected** | All row/dialog actions are `<Button>`/`<a>` (`orders-panel-row.tsx:103-196`, `:338-367`); the note expander is a button with `aria-expanded` (`:387-392`), not a hover reveal. |

### Status distribution

| Status | Rows |
|---|---|
| **verified** (runtime verdict `verified:"yes"`) | **6** — R1 receipt, R3 receipt (n/a), R6 receipt, R6 board (n/a), R7 receipt, R10 receipt |
| **source-inspected** | **8** — R1 board, R3 board, R4 receipt (partial), R4 board (partial), R8 receipt (partial), R8 board, R9 basket, R10 board |
| **gap** (rule not met) | **5** — R2 receipt, R2 board, R5 receipt, R5 board, R7 board |
| **BLOCKED** | **0 rows are BLOCKED outright.** Two limits do apply: (a) **9 board rows** exist and the running board never rendered — 1 is verified only because the rule is structurally n/a (a queue has no stepper), 5 are source-inspected, 3 are gaps; (b) every screen-reader-dependent claim is unavailable (no SR). |

Total: **19 rows** — 6 verified, 8 source-inspected, 5 gap. Only **4 of the 6 verified rows** are
receipt behaviour proved in a browser (R3 receipt is n/a, and R6 board is n/a).

## Receipt pass (drivable) — AC-15.3

Tool calls and verbatim verdicts, in order. Session: `lease-c1b7a0c5-784b-4c39-bca0-d53460a0cced`.

| Step | Call | Verdict |
|---|---|---|
| Obtain tokens | read `.reticle/flows/elite-next-starter-0991ad35/drive-*.json` | three real tokens: `uafRcn…` (`expired`), `SziXbv…` (`cancelled`), `YbGiNQ…` (`accepted`) |
| Stepper on `expired` | `reticle_navigate` + `reticle_look` | `region "Status"` contains only `heading "Status"` — **no stepper** (`StatusStepper` returns `null` when the status is not on the linear track, `receipt.tsx:106-109`) |
| Stepper on `accepted` | `reticle_navigate` + `reticle_look` | `list "Order status"` → `listitem "Accepted (current step)"` ✅ |
| New token | `reticle_act { steps: [… 6 steps …] }` (add item, fill contact, `Send order`) | `verified:"yes"`, `because:"every declared consequence held, but only 2 of 5 steps declared one"` → routed to `/order/Da0EB86j6gWMB-YINlvqzZlFTlMcQrXOSHBffdknw7s` |
| Stepper on `new` | `reticle_look { mode: "full" }` | `list "Order status"` → `listitem "Order received (current step)"` ✅ |
| Headings | same snapshot | `heading "Order #XM5EN8"` → `heading "Status" / "Items" / "Contact"` ✅ |
| Cancel dialog opens | `reticle_act_and_wait { target:{"Cancel order"}, action:"click", until:{dialog visible} }` | `verified:"yes"`, `verifiedReason:"proved"`, `effect.focusMoved:"null->e438"`; dialog tree shows `dialog "Cancel this order?"` with `button "Keep order" [focused]` ✅ |
| Escape closes, no write | `reticle_act_and_wait { target:{dialog}, action:"press", args:{"Escape"}, until:{dialog absent} }` | `verified:"yes"`, `verifiedReason:"proved"`, `verdict.evidence:{"absent":true}`; status still `"Order received"` after close ✅ |
| Focus after close | `reticle_assert { element: Cancel order, state: "focused" }` | `verified:"no"`, `verifiedReason:"assertion_failed"`, `failureReason:"element exists but not in state 'focused'"`, observed states `present, visible, enabled` ❌ **finding F1** |
| Cancel succeeds | `reticle_act_and_wait { ref:"e455", action:"click", until:{allOf[…]} }` | `verified:"yes"`, `verifiedReason:"proved"`; evidence includes `generic "Cancelled"` (`receipt.tsx:249`), `paragraph "Your order was cancelled."` (`:258`) and `status "Your order was cancelled."` (`:383`) ✅ |
| Dialog dismissal | `reticle_assert { role:"dialog", absent:true }` | `verified:"yes"` (`/proved`) — the dialog does close; an earlier mid-animation snapshot still showed it, which is a timing artefact, not a defect ✅ |

**Keyboard activation of the receipt's Cancel button was not proved.** `reticle_act { action:"press", args:{text:"Enter"} }` on a *focused* native `<button>` did not open the dialog (`verified:"no"`, `verifiedReason:"assertion_failed"`, `effect.domMutatedWithin: 1`), and one earlier press attempt instead fired the unrelated copy-link action. A synthetic key event does not trigger a browser's native button activation, so this is recorded as a **method limitation, not an app defect**; the button is `focusable` (`reticle_assert` focused → `verified:"yes"`). Enter/Space activation is therefore **source-inspected** (native `<button>` via `components/ui/button.tsx:35-45`).

## Owner board pass — AC-15.4

Navigation to the real editor route (the exact URL the app itself links to) renders the Clerk gate, not the board. Verbatim accessible tree after `reticle_navigate`:

```
- main
  - generic [grid-cols:398px]
    - text "Business editor"
    - text "Sign in to edit and manage your business listings."
  - button "Sign in" (ref=e502)
  - button "Create an account" (ref=e508)
- alert
```

No owner credentials exist in this environment and none were sought. Consequences:

- **No board behaviour was runtime-verified.** The one board row marked `verified` (R6) is a structural
  n/a — a queue has no status stepper. Every other board row is `source-inspected` or `gap`.
- The second-order claims that depend on interaction could not be observed: focus trap behaviour,
  Escape-during-pending, `aria-busy` announcement timing, and live-region announcement of a flag
  result.

### Source inspection of the board attributes named by AC-15.4

| Attribute | Location | Reading |
|---|---|---|
| Board live region | `orders-panel.tsx:690` | `role="status" aria-live="polite"`; text from `boardStatusLine` (`:158-163`), `announcement` set by every action (`runFlagAction` `:658-662`) |
| Heading order | `editor-header.tsx:18` (h1) → `components/ui/card.tsx:31` (CardTitle is a `div`) → `orders-panel-row.tsx:82` (h3) | **gap** — no h2 for the Orders section |
| Dialog focus handling | `components/ui/dialog.tsx:9-19` (documents "Radix's built-in focus trap, Esc-to-close, and aria wiring"), used via `orders-panel-dialogs.tsx:118-160` | trap and Esc provided by the primitive; Esc and outside-interaction are additionally blocked while `pending` (`:135-144`) |
| `aria-busy` | `orders-panel-dialogs.tsx:128`; `orders-panel-row.tsx:75,134,159` | pending state is exposed per row and per dialog |
| 44×44 on the new flag button | `orders-panel-row.tsx:165-175` (`className="min-h-11"`) | 44px high, text-wide; pass by source |
| Reason `Select` labelling | `orders-panel-dialogs.tsx:846-872` — `<Label id={selectId}-label htmlFor={selectId}>`, `<SelectTrigger id={selectId} aria-labelledby={selectId-label}>` | labelled explicitly on both the label and the trigger |
| Keyboard order | DOM order in `OrderRow`: status/actions block (`:98-121`) → contact controls (`:131-154`) → order flags (`:156-176`) → row failure retry (`:178-198`) | follows reading order; every control is a native button |

## Keyboard audit — new flag button + flag dialog (AC-15.5)

Task 4's surface. All rows below are **source-inspected — not runtime-verified** (Clerk gate).

| Check | Status | Evidence |
|---|---|---|
| Reachable by Tab | **source-inspected** | `Flag fake order` is a native `<Button type="button">` (`orders-panel-row.tsx:165-175`; `components/ui/button.tsx:35-45` renders `<button>`), in DOM order after the contact-controls group. No `tabIndex={-1}` or `disabled` trap on a non-pending row. |
| Activatable by Enter/Space | **source-inspected** | Native `<button>` with `onClick={() => onFlagAction(order)}` (`:172`). Browser-native activation; not exercised (see the `press` limitation above). |
| Opens a dialog | **source-inspected** | `handleFlagAction` sets `flagRequest` (`orders-panel.tsx:679-683`), rendering `<FlagOrderDialog>` keyed by row id (`:753-765`). |
| Dialog traps focus | **source-inspected** | `DialogShell` → `DialogContent` → `DialogPrimitive.Content` (`components/ui/dialog.tsx:64`); Radix FocusScope. The file's own header documents the trap (`:9-19`). |
| Escape closes without writing | **source-inspected** | `onEscapeKeyDown` prevents only while `pending` (`orders-panel-dialogs.tsx:135-139`); `onOpenChange(false)` calls `onClose` (`:121-125`), which clears `flagRequest`/`flagFailure` (`orders-panel.tsx:760-763`). No mutation is reached on that path — `onSubmit` is only called from `handleSubmit` (`:805-810`), bound to the footer button. |
| Reason `Select` operable by keyboard | **source-inspected** | Radix `Select` (`components/ui/select.tsx:9-43`): the trigger is a button/combobox with the primitive's own keyboard model; `disabled` only while pending (`orders-panel-dialogs.tsx:852`). |
| Result is announced | **source-inspected** | Success sets `setAnnouncement` (`orders-panel.tsx:658-662`) into the polite live region (`:690`); failure lands in the dialog as `role="alert"` via `DialogError` (`orders-panel-dialogs.tsx:177-195`, wired `:875`). |
| Screen-reader announcement of either | **BLOCKED** | No screen reader in this environment. |

## §6.7 :1443 / :1444 coverage notes

- **Colour independence (AC-15.6):** no colour-only status signal was found on either surface —
  every status carries its text label (`receipt.tsx:52-61`, `orders-panel-row.tsx:213-221`), and the
  age badge carries `Waiting`/`Age` plus the value (`:250-256`). The *icon* half of the rule is only
  satisfied by the receipt stepper's `Check`/circle marks (`receipt.tsx:128-132`), not by either
  status pill → finding **F6**.
- **`prefers-reduced-motion` (AC-15.6):** implemented **only** at `components/order/basket-panel.tsx:445`
  (smooth `scrollIntoView`), plus two unrelated surfaces (`components/profile/ordering-panel.tsx:192`,
  `components/react-bits/pixel-card.tsx:186`). It is **not** implemented in `components/order/receipt.tsx`,
  in any `orders-panel*` file, in `app/globals.css`, or around the dialog animations
  (`components/ui/dialog.tsx:45,67`) → finding **F4**.

## Findings (recorded only — no code changed)

| # | Finding | Severity | Proposed follow-up |
|---|---|---|---|
| F1 | **Focus is not returned to the trigger when the receipt cancel dialog closes.** Runtime-proved: after Escape, `Cancel order` is `present, visible, enabled` but not `focused` (`verified:"no"`, `assertion_failed`). | Low | Restore focus to the opening control on dialog close (explicit `onCloseAutoFocus` target, or render the trigger through `DialogTrigger`). |
| F2 | **Focus never moves to the error summary on failure** on either audited surface. Receipt cancel error and board row/dialog errors are `role="alert"` only; no `.focus()` exists in `receipt.tsx` or `orders-panel*.tsx`. The identical rule is already implemented on the basket (`basket-panel.tsx:286-291`). | Medium | Port the basket's focus-to-error effect to the receipt cancel error, the board row failure, and `DialogError`. |
| F3 | **The receipt's cancel dialog exposes a ~16×16 px icon-only Close**, below the 44×44 minimum. `components/ui/dialog.tsx:73-77` renders `size-4` with no padding; the receipt does not pass `showCloseButton={false}` while the board's `DialogShell` deliberately does. | Medium | Pass `showCloseButton={false}` on the receipt dialog (matching `DialogShell`) or give the control a 44×44 hit area. |
| F4 | **Dialog open/close animations ignore `prefers-reduced-motion`.** `components/ui/dialog.tsx:45,67` animate on every open/close with no `motion-reduce:` guard and no global media query in `app/globals.css`. | Low | Add `motion-reduce:animate-none` to overlay/content, or a project-wide reduced-motion rule. |
| F5 | **Board heading order skips a level.** Page `h1` (`editor-header.tsx:18`) → row `h3` (`orders-panel-row.tsx:82`) with no `h2` for the Orders section, because `CardTitle` is a `<div>` (`components/ui/card.tsx:31-39`). | Low | Render the Orders card title with `role="heading" aria-level={2}` (the pattern already used at `editor-section-body.tsx:391`). |
| F6 | **Status pills are text + colour without an icon**, while the rule asks for text + icon. Neither `StatusPill` (`orders-panel-row.tsx:213-221`) nor the receipt status pill (`receipt.tsx:249-257`) pairs its label with an icon; only the stepper marks do. | Low | Pair each status pill with a decorative (`aria-hidden`) icon matching the state. |
| F7 | **The stepper disappears entirely for statuses off the linear track** (`declined`, `cancelled`, `expired`, `no_show`), leaving `region "Status"` with only a heading. Runtime-observed on `uafRcn…` (expired) and `Da0EB8…` (cancelled). | Low | Decide whether terminal statuses should render a terminal step (and document it), rather than an empty Status region. |
| F8 | **Context/plan line references are stale for the board.** `tasks/issue-84-context.md` §3.5 places the live region at `orders-panel.tsx:145-150` and names `BlockContactDialog`'s textarea; in the current tree the live region is `:690` and the textarea is `ReasonField` (`orders-panel-dialogs.tsx:218-241`). | Low | Refresh the context map before it is reused as ground truth. |

**Contradiction with a plan claim:** Task 15's text asks for a *recorded manual keyboard pass + screen-reader pass*
over the board. Neither could be performed — the board is Clerk-gated and no screen reader exists here.
This audit records that as a limitation rather than a pass (see §Caveats).

## Verification (nothing committed, nothing modified)

| Check | Result |
|---|---|
| Branch | `fix/issue-84-order-protocol-t10-measurement-hardening-runbook` |
| `git log --oneline -1` before and after | `d9a52f1 Fix #81: Order protocol T9 — abuse controls + concurrency proof` (unchanged) |
| `git status --short` before writing this file | 343 entries (the branch already carried other tasks' in-flight work, including modified `orders-panel*.tsx`, `receipt.tsx`, `schema.ts`) |
| `git status --short` after writing this file | 344 entries — the single added path is `?? docs/validation/issue-84-a11y-audit.md`; no existing file was modified |
| Implementation files changed by this task | **none** |

> AC-15.8 as literally written ("`git status --porcelain` shows only the new doc") is **not** satisfiable on this
> branch: the working tree already contained ~343 uncommitted entries from Tasks 1–14 and earlier work.
> The verifiable claim is the stronger one above — the audit added exactly one path and changed no file.

## Caveats (do not over-read this pass)

1. **No screen reader was available**, so nothing here is evidence about what NVDA/JAWS/VoiceOver
   actually announces. `role="status"`/`aria-live="polite"` presence is proved; announcement quality
   is not.
2. **The owner board was never rendered.** Its seven rows are source reading. A passing source
   inspection of `aria-busy`, `aria-labelledby`, and `min-h-11` says the attributes are written —
   not that the running component honours them.
3. **Two Reticle `press` anomalies** are recorded as tool limitations, not app defects: an
   `Enter` press on a focused native button produced no activation, and one earlier press fired an
   unrelated control (the copy-link action). No app conclusion is drawn from either.
4. **One order was written to the shared dev deployment** to obtain a `new` receipt token. It was
   cancelled immediately and used a non-probe business (`Basket QA Cafe`), so it does not touch the
   `__T9 proof__` seed set used by the concurrent load test.
5. **`StatusStepper` was verified on `accepted` and `new` only** — the two linear-track statuses reachable
   with existing tokens. `ready` and `completed` render the same component with a different index and
   were not driven.
6. **`reticle_act { action:"press" }`/Tab traversal were not used for a full keyboard-order pass**, so
   "keyboard order" on the board is a DOM-order reading, not an observed sequence.

## Reproduce

```bash
# terminal 1 — already running, do not start a second stack
npx convex dev
# terminal 2 — already running on :3000
npm run dev

# receipt: any real token from a saved flow, or place one through the app
npx @reticlehq/server open http://localhost:3000/order/<token>
# then, with reticle_*:
#   reticle_look { action: "page", mode: "full" }            # stepper list + aria-current marker + headings
#   reticle_act_and_wait { target: { role: "button", name: "Cancel order" }, action: "click",
#                          until: { kind: "element", query: { role: "dialog" }, state: "visible" } }
#   reticle_assert { action: "now", predicate: { kind: "element",
#                    query: { role: "button", name: "Cancel order" }, state: "focused" } }   # expect "no"
```

## AC → evidence traceability

| Issue AC | Status | Evidence |
|---|---|---|
| AC-15.1 report exists, house format, environment recorded | ✅ | this file; §Scope, §Environment (browser + explicit SR absence) |
| AC-15.2 rule-by-rule table, no rule omitted | ✅ | §Results — 10 rules / 19 surface rows |
| AC-15.3 receipt driven, verdicts recorded | ✅ partial | stepper, headings, live regions, dialog open/Escape/cancel proved; Enter activation not proved (method) |
| AC-15.4 owner board attempted + source inspection | ✅ | §Owner board — Clerk gate verbatim; attribute table |
| AC-15.5 flag button/dialog keyboard audit | ✅ source-only | §Keyboard audit — every row `source-inspected`, none claimed verified |
| AC-15.6 reduced motion + colour independence located | ✅ | §coverage notes — F4, F6 |
| AC-15.7 findings only, severity + follow-up | ✅ | §Findings — F1–F8, no code changed |
| AC-15.8 nothing committed | ✅ | §Verification — HEAD unchanged, one added path |

## Next

- F2 and F3 are the two findings with real user cost (a keyboard user loses their place; a touch user
  gets a 16 px close target). They should become follow-up tasks on the board and receipt owners.
- A screen-reader pass still has to happen somewhere with NVDA or VoiceOver, and the board pass needs an
  authenticated owner session. Until then, the board's rows in this file stay source-inspected.
