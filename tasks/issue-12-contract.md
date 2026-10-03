# B3a Data & Action Contract — Issue #12

**Status:** FROZEN (Phase 0 contract checkpoint, todo #1)
**Type:** Data/action contract + contract-level code. No behavior implementation.
**Repo:** `Calel33/dircteshop` · B3a of epic #3
**Date:** 2026-10-02 · **Author:** coder session A1
**Consumers:** todo #3 (owner reads), todo #5 (owner mutations), todo #6 (state-machine tests), todo #9/#10 (editor status/save behavior).

## 0. Sources of truth

- `screens/SPEC.md` §5 (state machine + re-review policy, L72–90), §9 (owner editor, L132–139).
- `convex/businesses/helpers.ts` (transition table), `convex/businesses/mutations.ts` (create + transition), `convex/businesses/queries.ts` (public approved-only reads), `convex/authz.ts` (`requireBusinessOwner`).
- `tasks/issue-12-plan.md` (confirmed planning decisions 1–7), `tasks/issue-12-todo.md`.
- `screens/wayfinder/build/B3-owner-approval-loop.md`.

## 1. Editable-field allowlist and core-vs-content classification

**Rule (SPEC §5 L90):** on an `approved` listing, editing a **core identity** field must send the listing back to review (`approved → pendingReview`); editing a **content** field publishes immediately. Only these four are core identity: `name`, `categoryId`, `description`, `address`.

| Field         | Class    | B3a editor section             | Effect of an edit while `approved`       |
| ------------- | -------- | ------------------------------ | ---------------------------------------- |
| `name`        | **core** | Basic Info                     | staged client-side until atomic resubmit |
| `categoryId`  | **core** | Basic Info / Categories & Tags | staged client-side until atomic resubmit |
| `description` | **core** | Basic Info                     | staged client-side until atomic resubmit |
| `address`     | **core** | Location (address fields only) | staged client-side until atomic resubmit |
| `hours`       | content  | Operating Hours                | persists immediately, stays public       |
| `phone`       | content  | Contact                        | persists immediately, stays public       |
| `email`       | content  | Contact                        | persists immediately, stays public       |
| `website`     | content  | Contact                        | persists immediately, stays public       |
| `tags`        | content  | Categories & Tags              | persists immediately, stays public       |
| `amenities`   | content  | Features & Amenities           | persists immediately, stays public       |

**Frozen in code:** `convex/businessTypes.ts` exports `CoreIdentityField`, `ContentField`, `EditableBusinessField`, and `EDITABLE_FIELD_CLASS` (data/types only). `scripts/field-policy.test.ts` pins the classification. Mutations must treat `EDITABLE_FIELD_CLASS` as the allowlist source; anything absent from it is never patchable.

**Not editable in B3a (absent from the allowlist):** `status`, `ownerId`, `searchText`, `verification`, `rating`, `ratingCount`, `photos`, `services`, `credentials`, `keywords`, `timezone`, `isFeatured`, `moderationReason`, `moderatedAt`, `submittedAt`, `lastSavedAt`, `lastUpdatedAt`, `createdAt`. Server derives/owns all of these.

## 2. Explicitly NOT in B3a

Photo uploads / media (B7 / B3c); autosave; hours quick-fill presets (B3c); undo/redo/copy-template/reset (B3c); analytics and settings surfaces (stubs stay out); map embed / geocoding; expanded change history (only a savedAt/status trail is in scope); B3b admin approvals queue/decisions/bulk actions; new roles or an owner `users.role` literal; new infrastructure or dependencies.

## 3. Persistence change: `tags` / `amenities`

Add **optional** `tags: v.optional(v.array(v.string()))` and `amenities: v.optional(v.array(v.string()))` to the `businesses` table. Rationale: the B3a editor needs free-form values now; a taxonomy/child-table design is not justified by any product evidence and would add query/index complexity. No new tables, no new indexes. Existing documents without the fields remain valid (backward compatible); `createDraft` may omit or initialize them as it prefers, since they are optional.

## 4. Convex function surface (owner flows)

Authorization invariant, applying to **every** function below:

- `ownerId` is always **server-derived** (identity → `users` row → `ownerId`). Clients never send `ownerId`.
- Clients never send `status`; the server resolves it from the action/current document.
- Every mutation on an **existing** listing calls `requireBusinessOwner(ctx, businessId)` before any write (fails closed: anonymous, missing business, and foreign owner all throw `Forbidden`/`Unauthorized`).

### 4.1 Owner-scoped reads — todo #3 (`convex/businesses/queries.ts`)

| Function   | Args                                 | Auth behavior                                                                                                                | Returns                                                     |
| ---------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `listMine` | `{}`                                 | Resolve current user; anonymous → `[]` (no private data). Never accepts an owner id.                                         | Owned-listing summaries via the existing `byOwnerId` index. |
| `getMine`  | `{ businessId: v.id('businesses') }` | Resolve current user; anonymous / malformed id / missing / foreign owner → `null` (consistent not-found, no existence leak). | The owned editor document.                                  |

Public reads (`getPublic`, `searchPublic`) are **unchanged** and remain `status === 'approved'` only.

### 4.2 Owner writes — todo #5 (`convex/businesses/mutations.ts`)

| Function                            | Status                          | Args                                                                                           | Behavior / auth                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createDraft`                       | existing, unchanged             | `{ name: v.string(), categoryId: v.id('categories') }`                                         | Derives `ownerId` and initial `status: 'draft'` server-side via `getCurrentUserOrThrow`. Name trimmed/non-empty; category must exist.                                                                                                                                                                                                                                                                                                                 |
| `saveDraft`                         | **new**                         | `{ businessId, patch }` where `patch` allows only `EDITABLE_FIELD_CLASS` fields (all optional) | `requireBusinessOwner`. Rejects `pendingReview`/`suspended` (read-only) and `rejected` (revise to `draft` first). Non-approved editable states persist all editable fields. **`approved`:** persists content fields and leaves core identity fields client-staged (ignored by the server). Sets `lastSavedAt`/`lastUpdatedAt`; recomputes `searchText` when `name`/`description` change. Never accepts `status`/`ownerId`.                            |
| `submit` (draft / changesRequested) | **reuse** existing `transition` | `{ businessId, action: 'submitForReview' }`                                                    | Owner-authorized by `requireBusinessOwner` via `resolveTransition`; sets `submittedAt`. No new mutation needed.                                                                                                                                                                                                                                                                                                                                       |
| `revise` (rejected → draft)         | **reuse** existing `transition` | `{ businessId, action: 'reopenAsDraft' }`                                                      | Owner-authorized; `rejected → draft`. Direct owner `submitForReview` from `rejected` is superAdmin-only by the existing role override, so the owner must revise first.                                                                                                                                                                                                                                                                                |
| `saveAndResubmit`                   | **new**                         | `{ businessId, patch }` (patch must contain ≥1 core identity field)                            | `requireBusinessOwner`. Asserts current `status === 'approved'`. Validates the patch against `EDITABLE_FIELD_CLASS`. In **one atomic `ctx.db.patch`**, writes the identity fields + recomputed `searchText` + `status: 'pendingReview'` + `submittedAt` + `lastUpdatedAt`. Derives the target from `STATUS_TRANSITIONS` / `resolveTransition` (single source of truth) and deliberately does **not** route through the generic `transition` mutation. |

**Existing generic-submit refusal (kept):** `mutations.ts:182–184` rejects the plain `submitForReview` action when the current status is `approved`; this guard stays. The approved-identity re-review path is exclusively `saveAndResubmit`. The `T3 boundary` comment at `mutations.ts:162–172` already reserves this path.

**`transition` reuse rationale:** `helpers.ts` already supports owner `draft → pendingReview`, `changesRequested → pendingReview`, and `rejected → draft` (`reopenAsDraft`). Reusing `transition` for the standard submit/revise flows keeps one state-machine entry point; only the approved-identity case (blocked by design) gets a dedicated atomic mutation.

## 5. Status and visibility semantics

Public visibility is **`status === 'approved'` only** — unchanged.

| Current status     | Owner-can-edit? | Owner action                             | Result                    | Public during/after      |
| ------------------ | --------------- | ---------------------------------------- | ------------------------- | ------------------------ |
| `draft`            | yes             | `saveDraft`                              | stays `draft`             | hidden                   |
| `draft`            | yes             | `submit`                                 | `pendingReview`           | hidden                   |
| `changesRequested` | yes             | `saveDraft` / `submit`                   | stays / `pendingReview`   | hidden                   |
| `rejected`         | no (read-only)  | `revise` → then edit → `submit`          | `draft` → `pendingReview` | hidden                   |
| `approved`         | yes (split)     | `saveDraft` (content only)               | stays `approved`          | stays public             |
| `approved`         | yes (split)     | core edit staged, then `saveAndResubmit` | `pendingReview`           | hidden until re-approved |
| `pendingReview`    | no (read-only)  | —                                        | —                         | hidden                   |
| `suspended`        | no (read-only)  | —                                        | admin `restore` only      | hidden                   |

Staged-identity rule: an approved core-identity edit is never written by `saveDraft`; it lives in client form state and is persisted atomically together with `approved → pendingReview` by `saveAndResubmit`, so unreviewed identity values never become public and no approved-baseline snapshot is required.

## 6. Create-form compromise (plan decision 1)

Keep `createDraft`'s required `name` + `categoryId`. B3a ships a minimal first-step create form that collects those two values, creates the draft, and opens the editor. This is a deliberate compromise with the prototype's literal "blank draft opens" flow; the "blank draft" wording is **resolved** and is not escalated. If strict blank creation is later required, it needs a separate schema/product decision.

## 7. Hours

Basic weekly entry only: the seven `hoursValidator` day keys, each an optional list of `{ opensAt, closesAt }`; an absent/empty day renders "Closed". Quick-fill presets (Standard / Coffee Shop / Weekend Only / Custom) are B3c and are **not** persisted by B3a.

## 8. Contract-level code freeze

`convex/businessTypes.ts` (data/types only — no behavior):

- `type CoreIdentityField = 'name' | 'categoryId' | 'description' | 'address'`
- `type ContentField = 'hours' | 'phone' | 'email' | 'website' | 'tags' | 'amenities'`
- `type EditableBusinessField = CoreIdentityField | ContentField`
- `const EDITABLE_FIELD_CLASS: Record<EditableBusinessField, 'core' | 'content'>`

Patch validators and the `saveDraft`/`saveAndResubmit` handlers are **todo #5 implementation**, not part of this checkpoint.

`scripts/field-policy.test.ts` (node:test) pins: the core set, the content set, the exact allowlist, excluded non-editable fields, class disjointness, and existing transition semantics that pass today.

## 9. OPEN items (not decided here)

1. **`moderationReason` lifecycle on owner resubmit.** Whether an owner `submit`/`saveAndResubmit` clears `moderationReason`/`moderatedAt` is not specified by SPEC §5. Current `transition` does not clear them on owner submit. Decide and test explicitly in todo #5/#6 (banner logic keys off `status`, but stale reasons may still surface).
2. **`rejected` reason retention through `revise`.** `reopenAsDraft` currently leaves `moderationReason` in place; SPEC §5 does not say whether the rejected reason is retained or cleared when the owner revises. Decide in todo #5/#6.
3. **Owner-deletion / dangling `ownerId`.** Pre-existing SPEC §3 L57 open item, out of B3a scope.
4. **Owner-list pagination.** Not added; owner cardinality is assumed modest. Revisit only with measured need.
5. **Exact editor-detail projection shape.** `getMine` returns the owned document; a narrower projection can be introduced in todo #3 without changing this contract's auth/visibility semantics.

## 10. Needs orchestrator approval

**None.** All choices above stay within the plan's confirmed decisions and its stated file/API latitude. The mapping of standard `submit`/`revise` onto the existing `transition` mutation (instead of new wrapper mutations) is a contract simplification consistent with the plan and research findings; it does not change scope.

## 11. Verification for this checkpoint

- `node --test scripts/field-policy.test.ts` — classification + transition sanity (green).
- `node scripts/verify-state-machine.ts` — 6 statuses / 11 actor rows pinned (green).
- `npm run lint` — see run report.
