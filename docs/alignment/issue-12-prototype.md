# Prototype Alignment Report — Issue #12 / B3a vs approved prototype (#19)

> Advisory only — this check modified no code.
> Baseline: the approved owner-workspace prototype decisions recorded on **#19** and propagated, scoped to B3a, on **#12**.
> Artifact: merged `main` at `9cfc459` (PR #37). The merge tree is byte-identical to PR head `13aba4b` (`git diff origin/main 13aba4b` → empty).
> Reviewed: 2026-10-03. Companion to `docs/alignment/issue-12.md`, which covers **library/API** alignment only — prototype UX decisions were not part of it.

## Scope

- **Artifact type:** merged code for B3a (owner home, Add Your Business, editor core, submit, post-submit states).
- **Decision sources:** #19 approval comment (full prototype decisions table); #12 "Prototype reference — issue #19 approved" comment (B3a-scoped decisions); `screens/wayfinder/prototype/owner-workspace.html` (interaction artifact).
- **Out of scope by design:** B3b #13 (admin approvals queue) and B3c #14 (queue polish, hours presets, undo/redo/reset, mobile compact editor, preview depth). Their prototype decisions are not evaluated here.

## Method

1. Extracted the B3a-scoped decision table from #12 (propagated from #19).
2. Located each decision's implementation with graft (`find_code` / `find_all` / `file_api`) before reading files.
3. Spot-checked the prototype artifact at the cited lines.
4. Ran the merged test suite (`npm test`) as validation.

## Decision matrix

| # | Decision (prototype → #12) | Implementation evidence | Status |
|---|---|---|---|
| 1 | Owner home `/owner`: hub — business cards + status chips + "Add Your Business" CTA + empty state | `app/owner/owner-businesses.tsx:39-82`, `business-card.tsx:23-45`, `status-chip.tsx:7-15`, `listing-status.ts:20-51` (all six statuses) | ✅ Aligned |
| 2 | "My Businesses" switcher in the editor header | `business-switcher.tsx:27-71` (fed by owner-scoped `listMine`), mounted in `editor-header.tsx:24-27` | ✅ Aligned |
| 3 | Add Your Business: any signed-in user → **blank draft** opens in the editor | `createDraft` derives owner, no role literal (`convex/businesses/mutations.ts:81-122`); **but** a 2-field form (name + category) gates creation (`create-business-form.tsx:26-121`) | ⚠️ Documented deviation |
| 4 | Explicit **Save Draft** only — no autosave; dirty indicator | Save only through `handleSave` (`editor-shell.tsx:179-202`); no `useEffect`/timers anywhere in `app/owner`; "Unsaved changes" / "All changes saved" (`editor-save-bar.tsx:26-31`) | ✅ Aligned |
| 5 | Preview Live renders the profile from **unsaved** form state (WYSIWYS) with dirty note | `preview-adapter.ts:37-55` maps the client `form` (not the persisted doc) → `editor-preview.tsx:16-34`; note "Previewing unsaved changes" | ✅ Aligned |
| 6 | Submit for Approval: `draft → pendingReview`, commits the form, editor becomes read-only | `handleSubmit` persists dirty fields, then `transition('submitForReview')` (`editor-shell.tsx:204-223`); reactive `getMine` flips the shell read-only | ✅ Aligned |
| 7 | pendingReview: read-only + banner with submission date; Submit unavailable | `editor-status.ts:54-58` excludes it from editable; banner carries `submittedAt`, rendered in `editor-banner.tsx:31-35` | ✅ Aligned* |
| 8 | changesRequested: `moderationReason` banner, editing re-enabled, resubmit → pendingReview | `editor-status.ts:170-179`; editable set includes the status; primary action `submit` | ✅ Aligned |
| 9 | rejected: reason banner + "Revise listing" (`rejected → draft`), then resubmit | Banner `editor-status.ts:180-189`; primary `revise` (`:78-80`); `handleRevise` → `reopenAsDraft` (`editor-shell.tsx:245-256`) | ✅ Aligned |
| 10 | Core fields (name, category, description, address) **tagged in UI**; identity edits re-review on submit; content edits publish immediately | Core badges `section-editors.tsx:72,87,112,179`; content badges `:130,139,148,218,361`. Server: approved save = content-only (`mutations.ts:139-173`); `saveAndResubmit` atomic identity + `pendingReview` (`:244-291`) | ✅ Aligned |
| 11 | Approved: content save stays approved; identity submit flips to pendingReview | Same as #10 — one atomic `ctx.db.patch`; unreviewed identity never becomes public | ✅ Aligned |
| 12 | Sections: 6 real + Change History trail (no field diffs); **stubbed** Analytics, Settings | 6 real + history (`editor-sections.tsx`; trail `editor-status.ts:221-257`) + nav-only `ANALYTICS_SECTION`/`SETTINGS_SECTION` (`stub: true`) with a `stub` Badge in `EditorSectionNav`, and placeholder Card panels (`editor-shell.tsx`) | ✅ Aligned |
| 13 | Hours: basic weekly entry; quick-fill presets deferred to B3c | `section-editors.tsx:356-376`; no preset UI | ✅ Aligned (as planned) |
| 14 | `design.md` + `globals.css` tokens govern; prototype hex/radii not copied | Token additions in `app/globals.css` (`--font-display/body/label`, `--radius-card: 1rem`, `--radius-control: 0.5rem`, spacing scale); no hex literals under `app/owner` | ✅ Aligned |
| 15 | Mobile compact editor (tab strip, stacked preview) — B3c scope | Single-column grid below `lg`; no tab strip | ↔️ Deferred to B3c |

`*` Behaviorally equivalent — the prototype says "Submit disabled"; production hides the Save and primary controls. Cosmetic only.

## Findings

### 1. (⚠️) Blank-draft entry replaced by a 2-field create form — documented compromise

The prototype's flow is "Add Your Business → creates a blank draft and opens the editor" (prototype L1018). Production requires a name and a category first (`create-business-form.tsx:26-121` → `createDraft`, `mutations.ts:81-122`). This was a deliberate, pre-recorded compromise: the frozen contract (`tasks/issue-12-contract.md` §6) and the plan (decision 1) both state the "blank draft" wording is resolved and not escalated, because strict blank creation needs a separate schema/product decision. No action required unless product wants strict blank creation later.

### 2. (✅ resolved) Analytics/Settings nav stubs are now present

The #12 decision table calls Analytics and Settings "stubbed"; the prototype renders them as nav items with a `stub` badge (prototype L369/L371). Production originally rendered neither, consistent with the frozen contract's "analytics/settings surfaces (stubs stay out)" (§2). The follow-up on `fix/b3a-prototype-alignment` adds nav-only `ANALYTICS_SECTION`/`SETTINGS_SECTION` (`editor-sections.tsx`, marked `stub: true`) with a `stub` Badge in `EditorSectionNav`, and placeholder Card panels carrying the prototype stub notes (`editor-shell.tsx`). No data fetching, no fabricated stats.

### 3. (✅ resolved) Copy/affordance deltas — resolved on `fix/b3a-prototype-alignment`

- Save button on an approved listing now reads "Save changes" (`getSaveActionLabel`, `editor-status.ts`); every other status still reads "Save draft". The save bar renders the status-derived label (`editor-save-bar.tsx`).
- Approved content-only edits now expose a "Publish changes" primary (`getPrimaryAction` → `publish`, `editor-status.ts`). It reuses the existing Save-draft persist path (`saveDraft` + `reconcileSavedFields`/`mergeSavedFields` in `editor-shell.tsx`) with no status change, so content publishes in place.
- Resubmit now reads "Submit changes for review" (`PRIMARY_ACTION_LABELS.resubmit`, `editor-status.ts`), replacing "Save & resubmit for review".

Pinned by `editor-status.test.ts` (99/99 green).

### 4. Verified — post-review fixes present in the merged tree

CodeRabbit's review targeted `5c4c044`; two follow-up commits landed before the merge and are present in `main`:

- Blank/whitespace name rejected server-side — `mutations.ts:84-88, 368-372` (commit `13aba4b`).
- Unchanged-identity resubmit refused (no delisting an approved listing for a no-op) — `mutations.ts:262-266` (commit `13aba4b`).
- Mid-save edit loss repaired via `reconcileSavedFields` / `mergeSavedFields` — `editor-shell.tsx:194-196, 235-237` (commit `dcabab5`).

## Verification performed

- `npm test` on the merged tree — **96/96 pass, 0 fail** (supersedes the 78 reported in the PR body; the count rose with the two fix commits).
- `pnpm build` clean and changed-files lint clean per the PR body; the repo-wide lint debt (241 pre-existing issues) remains outside this change set, as does the manual two-account E2E walkthrough (disclosed in the PR).

## Summary

| Status | Count | Items |
|---|---|---|
| ✅ Aligned | 13 | Decisions 1, 2, 4–14 (all except 3) — behavior matches the approved prototype |
| ⚠️ Documented deviation | 1 | Decision 3 (blank draft → 2-field form; contract §6) |
| ↔️ Deferred as planned | 1 | Decision 15 (mobile compact view → B3c) |
| Cosmetic copy deltas | 0 | None — the three deltas resolved on `fix/b3a-prototype-alignment` |

**Verdict:** behaviorally aligned with the prototype decisions on every B3a-scoped item. Every previously actionable delta (save label, Publish-changes affordance, resubmit label, Analytics/Settings nav stubs) is now closed. The only remaining deviation is decision 3 (blank-draft creation), a pre-recorded product/schema decision, and decision 15 is deferred to B3c as planned. There is no silent drift.

**Follow-up (2026-10-03, `fix/b3a-prototype-alignment`):** the three copy/affordance deltas and the two Analytics/Settings nav stubs were implemented as a scoped follow-up. Decision 12's deviation and the "cosmetic" finding are updated in place to resolved (status only); the historical audit is otherwise unchanged. Validation: `npm test` 99/99, changed-files eslint clean, `npm run build` exit 0.

## Notes

- This report is advisory; it made no code changes.
- Library/API alignment lives in `docs/alignment/issue-12.md` (24 ALIGNED / 4 DRIFT / 4 VERSION-GAP / 2 UNVERIFIABLE — all pre-existing or disclosed).
- If the remaining deviation is re-decided (strict blank draft), it needs a separate product/slice decision, not a hotfix to B3a.
