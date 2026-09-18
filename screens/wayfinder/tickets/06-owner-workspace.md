# Ticket: Specify the owner workspace — LocalHub editor, live preview, and submission flow

Parent: [map.md](../map.md)
Labels: wayfinder:prototype — **RESOLVED**

## Question

Turn `LocalHub Editor.html` + `Biz Listing UI.html` into a buildable owner experience:

1. Which of the two mockups is the primary owner surface, and is the compact manager a reduced view of the same editor or a separate page?
2. Editor sections (Basic Info, Hours, Photos, Contact, Location/Map, Categories/Tags, Features/Amenities, Analytics, Change History, Settings): which are v1-real vs stubbed, and which need new Convex mutations?
3. Autosave vs explicit save: draft/preview/save/submit actions — when does a draft exist (Convex draft row?) and what is "Preview Live" rendered from?
4. Hours presets (Standard, Coffee Shop, Weekend Only, Custom): stored as reusable templates or UI quick-fills?
5. Undo/Redo/Copy-from-Template/Reset: client-side form state only, or persisted?
6. What the owner sees post-submit: status visibility, change-request feedback loop.

Build a cheap prototype (route skeleton + section nav + live preview panel against mock data) for the human to react to before the spec is written.

## Resolution

All six decided by the human (grilling session):

1. **Primary surface — LocalHub Editor.** The sectioned workspace IS the owner editor. The compact Biz Listing UI manager becomes the mobile/simple view of the same editor, not a separate page.
2. **Save model — explicit save to draft; preview renders from unsaved form state.** Edits live in client form state; "Save Draft" persists to Convex (`draft` status, or state-preserved when resubmitting); "Preview Live" renders the real profile foundation (ticket 04) from CURRENT unsaved form state — WYSIWYS. "Submit for Approval" fires the ticket-01 transition. No autosave in v1.
3. **Hours presets — UI quick-fills, not persisted.** Preset buttons stamp predefined values into the form; result is ordinary editable data. No preset CRUD.
4. **Editor tools — client-only in v1.** Undo/redo operate on session form state; Copy from Template stamps shared hour presets; Reset Section restores from last-saved Convex state. Nothing new persisted.
5. **Post-submit UX — read-only with banners.** pendingReview: editor read-only + status banner + submission date. changesRequested: `moderationReason` banner (ticket 07), editing re-enabled. rejected: reason banner + resubmit path (`rejected → draft` per ticket 01). Analytics section: v1 stub showing counts (views/orders/bookings) from existing tables.
6. **Change History — simple savedAt trail.** `lastSavedAt` + status-change timestamps shown read-only; no field-level diffs. Field-level revision UI deferred.

**Editor sections v1-real vs stubbed:**
- Real: Basic Information, Operating Hours (quick-fills), Photos & Media (Convex file storage, ordering, alt text), Contact Details, Categories & Tags, Features & Amenities (services/credentials arrays), live preview.
- Simplified: Location & Map (address fields + lat/lng stored; NO map embed in v1 — geolocation out of scope), Change History (trail only).
- Stubbed: Analytics (counts), Settings (placeholder).

**Prototype artifact:** `prototype/owner-workspace.html` — a static interactive mock of the editor demonstrating the section nav, hours quick-fills, client undo/redo, unsaved-state live preview, and the pending/changes-requested banner states, for the human to react to before the spec is written. (Build step follows this resolution.)
