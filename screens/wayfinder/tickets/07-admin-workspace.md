# Ticket: Specify the admin workspace — pending approvals queue + directory management on the starter dashboard

Parent: [map.md](../map.md)
Labels: wayfinder:grilling — **RESOLVED**

## Question

`Admin Dashboard UI.html` (approvals) + `Admin Panel UI.html` (directory) on top of the starter's existing dashboard shell:

1. Which starter dashboard components (sidebar, cards, charts, tables) are reused vs replaced for the admin workspace?
2. Approvals queue contract: card fields, filters (category/priority/time), selection + bulk approve — which mutations and confirmation UX?
3. Directory management: grid/table/map views — is Map view v1-real or stubbed (geolocation is out of scope)? Search + filters contract.
4. Destructive-action safety per spec guardrail: reject/suspend/delete/restore — confirmation modal + audit log design (what table records who did what, when)?
5. "Changes requested" moderation: free-text message from Super Admin back to owner — stored where, how the owner consumes it.
6. Owner/user accounts view + export: what's v1-real.
7. Summary cards (total/pending/verified/revenue): revenue is billing-deferred — what replaces it?

## Resolution

All seven decided by the human (grilling session):

1. **Starter reuse — reuse shell, replace content.** Keep the starter's dashboard layout/sidebar pattern (app-sidebar, collapsible, user menu) but build a separate `app/admin/*` tree with LocalHub Admin navigation and its own server layout gate (ticket 02's 404 gate). Landing + billing routes untouched.
2. **Approvals queue — action + reason, confirm modal on reject.** Approve fires `pendingReview → approved` (verification stamped per ticket 01). Changes/Reject open a modal with **required reason text** → becomes the owner's change-request feedback. Bulk: only bulk approve in v1, confirm modal listing the count. Selection state per the mockup's confirmed select-all/indeterminate behavior.
3. **Directory views — Grid + Table real, Map stubbed.** Grid (cards) and Table (dense rows) on the same data; Map renders a "coming soon" placeholder (geolocation out of scope, map Notes). **Add Business** = admin-created listing via the same flow as owner self-serve; admin supplies the owner's email to assign ownership.
4. **Destructive safety — confirm modal + audit table.** Every status-changing admin action (approve/changes/reject/suspend/restore) and delete shows a confirm modal stating consequences, then writes an `auditLogs` row: `{actorUserId, action, targetType, targetId, fromStatus, toStatus, reason?, createdAt}`. Delete = hard delete of business + children after **typing the business name** — the one irreversible action. Audit log viewable read-only + filterable in admin. New table: `auditLogs`.
5. **Change-request messaging — reason on business + in-app notification.** `moderationReason` + `moderatedAt` fields on businesses; owner sees a banner in the editor + notifications entry carrying the reason; revise → resubmit (`changesRequested → pendingReview` per ticket 01).
6. **Accounts + export — read-only list + CSV.** User Accounts = read-only table (users, their business count, role). Export = server-generated CSV of businesses (name, category, status, owner, rating, dates). No account suspension/reassignment in v1.
7. **Summary cards — Total Businesses, Pending Approval (clickable → queue), Verified Active, Submissions This Month.** Revenue card dropped (billing deferred); returns if billing lands.

**Admin nav (per mockups):** Overview, Pending Approvals (badge count), All Businesses, Business Owners, Categories, Analytics (stub in v1 — see fog), Flagged Content (stub — see fog), Audit Log, Settings (stub).

**Schema deltas (feed into final spec):** `auditLogs` table + `moderationReason`/`moderatedAt` on businesses (answers ticket 01's open "reason schema" question).
