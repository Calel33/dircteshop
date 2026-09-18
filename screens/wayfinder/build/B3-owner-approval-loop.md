# Build Ticket B3: Owner onboarding + LocalHub editor + approval loop

Slice owner: SPEC §5, §9 (+ §10 approvals queue portion). Decisions from tickets 01, 03, 06, 07. Blocked by: B2.

## End-to-end slice

The full listing lifecycle, end to end:

1. "Add Your Business" path: any signed-in user creates a first draft (ownership derived — no role literal). Owner home `/owner` with My Businesses switcher (multiple businesses per owner).
2. LocalHub editor `/owner/business/[id]`: section nav (Basic Info, Hours w/ quick-fill presets, Contact, Location (address only), Categories & Tags, Features & Amenities); explicit Save Draft; **Preview Live renders the foundation from unsaved form state**; client-only Undo/Redo/Reset Section; Submit for Approval fires `draft → pendingReview`.
3. Read-only + status banner while pendingReview; moderationReason banner on changesRequested; rejected → reason + resubmit.
4. Admin approvals queue `/admin/approvals`: cards, filters, selection w/ indeterminate select-all, per-card Approve / Changes / Reject (required-reason modal), View Full Details side panel, bulk approve, pagination. Every admin action → confirm modal + `auditLogs` row (audit log page itself comes in B6).
5. Core identity edits on an approved business trigger `approved → pendingReview` (content edits do NOT — policy per ticket 05; the editor distinguishes these fields).

Reference prototype for editor UX: [wayfinder/prototype/owner-workspace.html](../prototype/owner-workspace.html).

## Done when (verification evidence)

- Lint + build clean.
- Tracer: sign up fresh → create draft → submit → Super Admin approves w/ verification stamp → business visible publicly; second tracer: admin requests changes with reason → owner sees banner → revises → resubmits → approved.
- Owner A cannot open owner B's editor (server-side guard throws).
- auditLogs rows exist for every admin action taken.
