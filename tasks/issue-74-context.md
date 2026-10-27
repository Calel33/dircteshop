# Issue #74 — Context: Order protocol T0, repair environment + Convex codegen

> Explorer node output. Every claim below is backed by a path:line actually read in
> `D:\Dev\dircteshop-1` on 2026-10-20 (local time ~11:55). This file records what
> exists; it does not propose changes.

## Task contract

| Field | Value |
|---|---|
| TYPE | Read-only exploration + environment inspection |
| TARGET | Issue #74 scope: build/test environment, Convex photo-upload surface, generated API, node_modules, test setup, protected-file status |
| GOAL | A file:line-backed context document at `tasks/issue-74-context.md` |
| DONE-WHEN | This file exists on disk and every numbered context step is answered with evidence |

---

## 0. Environment snapshot (measured, not inferred)

| Fact | Value | Evidence |
|---|---|---|
| Node | `v24.18.0` | `node --version` |
| pnpm | `12.3.4` | `pnpm --version`; `node_modules/.modules.yaml` → `"packageManager": "pnpm@12.3.4"` |
| pnpm store | `D:\.pnpm-store\v11` | `pnpm store path`; `.modules.yaml` `"storeDir"` |
| Linker | `isolated` | `.modules.yaml` → `"nodeLinker": "isolated"` |
| Last pnpm install | `2026-10-20 11:30:38` | `node_modules/.modules.yaml` mtime + `prunedAt: "Tue, 20 Oct 2026 15:30:38 GMT"`; `node_modules/.pnpm/lock.yaml` mtime 11:30:38 |
| Running dev server | **YES** — `next dev` PID 11140, server PID 8656, started 11:30:45, holds port 3000 | `Get-NetTCPConnection -LocalPort 3000`, `Win32_Process` command lines |
| Dev server health | `GET http://localhost:3000/` → **HTTP 200**, 39,985 bytes | `Invoke-WebRequest` |
| Branch | `fix/issue-8-b8-restaurant-vertical-menu-modules-order-workflow` | `git rev-parse --abbrev-ref HEAD` |

The protocol document records the older, broken state (all empty `@clerk/*`, missing
`@ampproject/remapping`, missing `vitest`, blocked `pnpm install`) at
`docs/order-commitment-protocol.md:1781-1806`. Several of those rows no longer match the
disk (see §4). The issue text says the same.

---

## 1. Package manifest and configs

### 1.1 `package.json` (107 lines)

Scripts (`package.json:9-21`):

| Line | Script | Command |
|---|---|---|
| 10 | `dev` | `next dev` |
| 11 | `build` | `next build` |
| 12 | `start` | `next start` |
| 13 | `lint` | `eslint .` |
| 14 | `lint:dead-code` | `knip` |
| 15 | `lint:duplicates` | `jscpd` |
| 16 | `lint:tech-debt` | `node scripts/check-tech-debt.js` |
| 17 | `test` | `node scripts/verify-state-machine.ts && node --test "app/**/*.test.ts" "lib/**/*.test.ts" "scripts/**/*.test.ts" && vitest run` |
| 18 | `format` | `prettier --write .` |
| 19 | `format:check` | `prettier --check .` |
| 20 | `seed` | `node scripts/seed.ts` |
| 21 | `prepare` | `husky install` |

`engines.node` is `>=22.6` (`package.json:6-8`). `"type": "module"` (`:2`).

Dependencies relevant to this ticket (`package.json:23-62`):

| Line | Package | Specifier |
|---|---|---|
| 24 | `@clerk/backend` | `^3.18.1` |
| 25 | `@clerk/nextjs` | `^7.9.4` |
| 26 | `@clerk/ui` | `^1.33.1` |
| 27-30 | `@dnd-kit/core`, `modifiers`, `sortable`, `utilities` | `^6.3.1`, `^9.0.0`, `^10.0.0`, `^3.2.2` |
| 48 | `convex` | `^1.31.2` |
| 51 | `next` | `16.3.5` (pinned) |
| 53-54 | `react`, `react-dom` | `^19.2.3` |

devDependencies relevant to this ticket (`package.json:63-88`):

| Line | Package | Specifier |
|---|---|---|
| 64 | `@edge-runtime/vm` | `^5.0.0` |
| 67-68 | `@reticlehq/next`, `@reticlehq/react` | `3.7.0` |
| 69 | `@tailwindcss/postcss` | `^4` |
| 75 | `convex-test` | `^0.0.62` |
| 82 | `tailwindcss` | `^4` |
| 84 | `typescript` | `^5` |
| 86 | `vite` | `^6.4.4` |
| 87 | `vitest` | `^4.1.12` |

### 1.2 Lockfiles — two package managers coexist

| File | Tracked? | mtime | Notes |
|---|---|---|---|
| `pnpm-lock.yaml` | yes (`git ls-files`) | 2026-10-19 06:21 | `lockfileVersion: '9.0'` (line 1) |
| `package-lock.json` | yes (`git ls-files`) | 2026-10-02 13:56 | `lockfileVersion: 3`, name `elite-next-starter` |
| `pnpm-workspace.yaml` | **untracked** (`??`) | — | contents at lines 1-6: `allowBuilds:` for `@clerk/shared`, `@tailwindcss/oxide`, `core-js`, `esbuild` |

There is **no `.npmrc`** (checked; absent).

### 1.3 `tsconfig.json` (35 lines)

- `strict: true` (`tsconfig.json:7`), `noEmit: true` (`:8`), `moduleResolution: "bundler"` (`:12`).
- `"allowImportingTsExtensions": true` is declared **twice**: `tsconfig.json:10` and `:13`.
  Vite emits a `duplicate-object-key` warning on every run (observed in `npm test` output).
- `paths`: `"@/*": ["./*"]` (`:23-25`).
- `include` covers `next-env.d.ts`, `**/*.ts`, `**/*.tsx`, `.next/types/**/*.ts`,
  `.next/dev/types/**/*.ts` (`:27-33`); `exclude` is `node_modules`, `dircteshop`,
  `.archon`, `.firecrawl` (`:34`).

### 1.4 `next.config.ts` (8 lines)

```ts
import { withReticle } from '@reticlehq/next';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
};

export default withReticle(nextConfig);
```
(`next.config.ts:1-8`)

### 1.5 `vitest.config.ts` (15 lines)

```ts
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    include: ['convex/**/*.test.ts'],
  },
});
```
(`vitest.config.ts:10-15`; comment at `:3-9` explains the `edge-runtime` choice and that
the `node --test` suite under `scripts/` is deliberately separate.)

### 1.6 `convex/` layout

```
convex/
  _generated/            ai/ (guidelines.md 18,290 B; ai-files.state.json), api.d.ts, api.js,
                         dataModel.d.ts, server.d.ts, server.js
  businesses/            adminDeletion, adminMutations, adminOwnerActions, adminPolicy,
                         adminProjections, directoryQuery, helpers, moderationPolicy,
                         moderationProjections, mutations, ownerProjections, ownerSavePolicy,
                         photoPolicy, photoStorage, photoUploads, publicHours, publicProjections,
                         queries, seed, seedFixtures
  adminExportPolicy.ts   adminExports.ts   adminProjections.ts   adminQueries.ts
  auditLogs.ts           auditProjections.ts  auth.config.ts     authz.ts
  businessTypes.ts       categories.ts     categoryAdminPolicy.ts
  http.ts                menus.ts          notificationHelpers.ts  notifications.ts
  orderPolicy.ts         orders.ts         paymentAttempts.ts      paymentAttemptTypes.ts
  schema.ts              tsconfig.json     userName.ts             users.ts
  AGENTS.md              CLAUDE.md         README.md               clerk-webhook-events-catalog.md
```
(`Get-ChildItem convex`; 54 files per graft repo map.)

`convex/tsconfig.json` excludes `./_generated` and includes `./**/*` (lines 28-31).

Test files under `convex/` (7): `adminExports.test.ts`, `adminQueries.test.ts`,
`categories.test.ts`, `orders.test.ts`, `businesses/mutations.test.ts`,
`businesses/photoStorage.test.ts`, `businesses/queries.test.ts`.

`convex/_generated/ai/guidelines.md` exists (18 KB) — the authority `convex/AGENTS.md`
points at. `convex/_generated/ai/ai-files.state.json` is untracked.

---

## 2. Convex photo surface and the generated API

### 2.1 Both modules exist — the issue's premise is stale

| File | Exists | Role | Evidence |
|---|---|---|---|
| `convex/businesses/photoStorage.ts` | **yes** (8,212 B) | DB-side photo policy helpers + the `photoUrls` public query + registry ownership checks | skeleton: `resolvePhotoUrls` L24-38, `assertPhotoAttachmentsValid` L77-121, `reconcilePhotoStorage` L142-165, `isUploadOwnedBy` L172-184, `uniqueStorageIds` L186-188, `resolveStorageUrls` L190-201, `deleteStorageFileQuietly` L203-212; `photoUrls` query at `photoStorage.ts:48` |
| `convex/businesses/photoUploads.ts` | **yes** (7,833 B) | HTTP upload action + upload-registry internals | `export const UPLOAD_PATH = '/photos/upload'` (`photoUploads.ts:23`), `authorizePhotoUpload` (internalQuery, `:44`), `registerStorageUpload` (internalMutation, `:71`), `uploadPhoto` (httpAction, `:98`), `uploadPhotoOptions` (httpAction, `:143`), `backfillStorageUploads` (internalMutation, `:156`) |

`convex/businesses/photoUploads.ts` is tracked and committed (`git log`:
`f92f564 feat(photos): bind storage ids to their uploading listing`, 2026-10-19).
It was **not** created by untracked work.

### 2.2 `photoUploads` references — every occurrence

| File:line | Context |
|---|---|
| `convex/_generated/api.d.ts:33` | `import type * as businesses_photoUploads from "../businesses/photoUploads.js";` |
| `convex/_generated/api.d.ts:81` | `"businesses/photoUploads": typeof businesses_photoUploads;` |
| `convex/businesses/photoUploads.ts:106` | `ctx.runQuery(internal.businesses.photoUploads.authorizePhotoUpload, …)` |
| `convex/businesses/photoUploads.ts:127` | `ctx.runMutation(internal.businesses.photoUploads.registerStorageUpload, …)` |
| `convex/businesses/photoUploads.ts:150` | doc comment: `npx convex run businesses/photoUploads:backfillStorageUploads` |
| `convex/businesses/photoStorage.test.ts:416` | `t.mutation(internal.businesses.photoUploads.backfillStorageUploads, {})` |
| `convex/businesses/photoStorage.test.ts:428` | same, second idempotency call |
| `convex/http.ts:7-11` | `import { UPLOAD_PATH, uploadPhoto, uploadPhotoOptions } from './businesses/photoUploads';` |
| `app/owner/business/[id]/photos-panel.tsx:116` | `useMutation(api.businesses.photoUploads.generateUploadUrl)` |

The generated API **does not** point at a non-existent module: the import target exists
on disk and `api.d.ts` was regenerated 2026-10-20 05:14 (after `schema.ts` at 05:11).

### 2.3 The actual TypeScript failure (`TS2339`)

Reproduced with `node node_modules/typescript/bin/tsc --noEmit` (exit 1, one error):

```
app/owner/business/[id]/photos-panel.tsx(116,56): error TS2339:
Property 'photoUploads' does not exist on type
'{ adminMutations: …; adminOwnerActions: …; mutations: …; photoStorage: …; queries: …; }'.
```

Cause, measured:

- `photoUploads.ts` exports **no public function**. All six exports are
  `internalQuery`, `internalMutation`, or `httpAction` (`photoUploads.ts:44,71,98,143,156`);
  the only non-function export is the string constant `UPLOAD_PATH` (`:23`).
- The `api` type is the public-filtered view (`api.d.ts:109-112` `FilterApi<…, FunctionReference<any,"public">>`).
  The error's own key list omits every internal-only module (`helpers`, `ownerSavePolicy`,
  `photoUploads`, …) and keeps `photoStorage` (which owns the public `photoUrls` query).
- `generateUploadUrl` was **removed** in commit `f92f564`:
  `git show f92f564 -- convex/businesses/photoUploads.ts` shows
  `-export const generateUploadUrl = mutation({` and `- return await ctx.storage.generateUploadUrl();`
  replaced by the HTTP-action design.
- `convex/http.ts:58-60` states it explicitly:
  "`generateUploadUrl` was removed because a raw POST to its URL bypasses the registry".
- `photos-panel.tsx` was **not** part of that commit's 7 files
  (`git show --stat f92f564`: `mutations.test.ts`, `mutations.ts`, `photoStorage.test.ts`,
  `photoStorage.ts`, `photoUploads.ts`, `http.ts`, `schema.ts`).
- `app/owner/business/[id]/photos-panel.tsx` is **clean** in `git status` — the stale call
  is committed at HEAD, so this is not a working-tree regression.

Runtime note: `convex/_generated/api.js:21-23` exports `api = anyApi`, so the generated JS
does not type-check the property at runtime; the call would target the removed
`businesses/photoUploads:generateUploadUrl` reference rather than fail at import.

### 2.4 Photo-related schema tables

| Definition | File:line | Fields |
|---|---|---|
| `businesses.photos` | `convex/schema.ts:50` | `v.array(photoValidator)` |
| `photoValidator` | `convex/businessTypes.ts:54-58` | `storageId: v.id('_storage')`, `altText?: v.string()`, `ordering: v.number()` |
| `storageUploads` | `convex/schema.ts:105-110` | `storageId`, `ownerId`, `businessId`, `createdAt`; index `byStorageId` |
| `stylists.photoStorageId` | `convex/schema.ts:175` | `v.optional(v.id('_storage'))` |

There is no `photoUploads` table. The upload registry table is `storageUploads`
(`schema.ts:101-110`; written at `photoUploads.ts:84-89` and `:170-176`, read at
`photoStorage.ts:178`).

`convex/_generated/dataModel.d.ts` contains no literal table list — it derives
`DataModelFromSchemaDefinition<typeof schema>` from `../schema.js` (lines 10-19, 40-46),
so table membership is type-derived, not code-generated per table.

### 2.5 Correct upload pattern already in the tree

`app/owner/business/[id]/menu-panel-item-editor.tsx:76-94` implements the current
HTTP flow:

```ts
async function uploadItemImage(businessId, file, token): Promise<Id<'_storage'>> {
  const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (siteUrl === undefined || siteUrl.length === 0) {
    throw new Error('Image uploads are not configured for this environment.');
  }
  const response = await fetch(`${siteUrl}/photos/upload?businessId=${businessId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type },
    body: file,
  });
  if (!response.ok) throw new Error(await uploadErrorMessage(response));
  const storageId = readStorageId(await response.json());
  if (storageId === null) throw new Error('The upload did not return an image id. Try again.');
  return storageId;
}
```

Token acquisition at `menu-panel-item-editor.tsx:296` (`const { getToken } = useAuth();`)
and `:318` (`await getToken({ template: 'convex' })`), call at `:320`.

`uploadErrorMessage` is `app/owner/business/[id]/menu-panel-helpers.ts:103-113`
(reads `{ error }`, falls back to `The image upload failed (HTTP <status>). Try again.`).

`NEXT_PUBLIC_CONVEX_SITE_URL` is present in `.env.local` (key list) and absent from
`.env.example`. The only code reference in the repo is
`menu-panel-item-editor.tsx:81`.

---

## 3. Consumers of the photo-upload surface

| Consumer | File:line | What it uses | Public/internal |
|---|---|---|---|
| Photos & Media panel | `app/owner/business/[id]/photos-panel.tsx:116` | `api.businesses.photoUploads.generateUploadUrl` (removed) | public (broken) |
| Photos panel upload body | `app/owner/business/[id]/photos-panel.tsx:136-160` | calls the URL returned above, POSTs bytes, parses `readStorageId` | client |
| Photos panel saved-URL read | `app/owner/business/[id]/photos-panel.tsx:118-121` | `api.businesses.photoStorage.photoUrls` | public, OK |
| Photo panel host | `app/owner/business/[id]/editor-section-body.tsx:21` | `import { PhotosPanel } from './photos-panel'` | React |
| Preview resolver | `app/owner/business/[id]/editor-preview.tsx:71-72` | `api.businesses.photoStorage.photoUrls` | public, OK |
| HTTP router | `convex/http.ts:7-11`, routes at `:61-62` | `UPLOAD_PATH`, `uploadPhoto`, `uploadPhotoOptions` | HTTP |
| Backfill tests | `convex/businesses/photoStorage.test.ts:416,428` | `internal.businesses.photoUploads.backfillStorageUploads` | internal |
| Menu item uploader (pattern) | `app/owner/business/[id]/menu-panel-item-editor.tsx:76-94,296,318-320` | `${NEXT_PUBLIC_CONVEX_SITE_URL}/photos/upload` + bearer token | HTTP |

No other application file references `photoUploads`. Repo-wide search for
`generateUploadUrl` returns only `photos-panel.tsx:116,137`.

---

## 4. `node_modules` state (read-only inspection)

### 4.1 Top-level packages

| Path | State | Detail |
|---|---|---|
| `node_modules/@clerk/nextjs` | **present, populated** | Junction → `.pnpm/@clerk+nextjs@7.9.15_next@1_c0b48dbd…`; `package.json` present; resolves |
| `node_modules/@edge-runtime/vm` | **present, populated** | Junction → `.pnpm/@edge-runtime+vm@5.0.0/…`; `package.json` present; resolves |
| `node_modules/@clerk/backend`, `@clerk/ui`, `@dnd-kit/*` | present | `package.json` present; all resolve |
| `node_modules/@ampproject/remapping` | **MISSING at top level** | `require.resolve` → `MODULE_NOT_FOUND`; no `node_modules/@ampproject` directory at all |
| `node_modules/.pnpm/@ampproject+remapping@2.3.0` | present, populated | its `node_modules/@ampproject/remapping` exists |
| `node_modules/@tailwindcss/node` | present, **real directory (not a link)**, version **4.3.3** | installed 2026-10-02; no nested `node_modules` |
| `node_modules/.pnpm/@tailwindcss+node@4.1.11` | present | has a junction `node_modules/@ampproject/remapping` → `…/@ampproject+remapping@2.3.0/…` |

### 4.2 Binaries

`node_modules/.bin` contains `vitest`, `vitest.CMD`, `next`, `tsc`, `convex`, `eslint`
(all `EXISTS`; `vitest`/`vitest.CMD` mtime 2026-10-20 11:30:38). The issue's
"`node_modules/.bin` lacks the vitest binary" no longer holds.

### 4.3 Installed versions

| Package | Installed |
|---|---|
| `@clerk/nextjs` | 7.9.15 |
| `@edge-runtime/vm` | 5.0.0 |
| `vitest` | 4.1.12 |
| `next` | 16.3.5 |
| `convex` | 1.46.0 |
| `tailwindcss` | 4.1.11 |
| `typescript` | 5.8.3 |

### 4.4 Remapping resolution — the build chain actually works today

- `require.resolve('@ampproject/remapping')` from the repo root fails (`MODULE_NOT_FOUND`).
- `require('@tailwindcss/node')` from the repo root resolves to the **npm-era 4.3.3**
  directory, whose `package.json` dependencies are `@jridgewell/remapping` (not
  `@ampproject/remapping`) and which loads successfully.
- `@tailwindcss/postcss` resolves to `.pnpm/@tailwindcss+postcss@4.1.11/…`, which pins
  `@tailwindcss/node: 4.1.11`; that copy resolves to
  `.pnpm/@tailwindcss+node@4.1.11/…`, where the `@ampproject/remapping` junction exists.
- Direct probe using PostCSS with the repo's own `postcss.config.mjs` plugin list and
  `app/globals.css` as `from`:
  **`POSTCSS OK len=130984`** (Tailwind compiled; no remapping error).
- `pnpm-lock.yaml` records `@tailwindcss/node@4.1.11` → `@ampproject/remapping: 2.3.0`
  (`pnpm-lock.yaml:5105-5107`); `package-lock.json` has no `@ampproject` entry at all
  (lockfileVersion 3, `node_modules/@tailwindcss/node` 4.3.3).

**Observed implication:** the historical `@ampproject/remapping` build error is not
reproducible through the PostCSS/Tailwind chain in the current tree. It was last
recorded in `docs/order-commitment-protocol.md:1795,1799`. The surviving top-level
resolve failure is real but is not on the build's resolution path.

### 4.5 Install repair state

- `node_modules/.modules.yaml` `prunedAt` = **today 11:30:38**; `node_modules/.pnpm/lock.yaml`
  same mtime; `@clerk/nextjs` junction mtime 11:30:37; `vitest` bin 11:30:38.
- The dev server started **7 seconds later** (11:30:45/46), i.e. after that install.
- `package-lock.json` is tracked and its stray npm installs (2026-10-02) coexist with the
  pnpm layout (top-level `@tailwindcss/node@4.3.3` real dir vs `.pnpm/…@4.1.11`).
- A fresh `pnpm install` was **not** run by this exploration (it writes `node_modules` and
  the running dev server is user-owned). The failure mode named in the issue
  (`ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR`) therefore remains unverified-on-disk,
  not disproven.

### 4.6 Current command results (measured now)

| Command | Result | Exit |
|---|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` | 1 error: `photos-panel.tsx(116,56) TS2339` | **1** |
| `node node_modules/eslint/bin/eslint.js .` | 0 errors, 4 warnings (complexity at `app/admin/directory/directory-route.tsx:118`, `app/admin/directory/page.tsx:89,177`; max-lines at `convex/menus.ts:611`) | **0** |
| `npm test` | verify-state-machine OK; **527** Node tests pass; then vitest **7 files / 41 tests pass** under `edge-runtime` | **0** |
| `node node_modules/vitest/vitest.mjs run convex/orders.test.ts` | `Test Files 1 passed`, `Tests 10 passed`, 523 ms, environment 60 ms | **0** |
| PostCSS/Tailwind probe | `POSTCSS OK len=130984` | 0 |
| `next build` | **not run** — the user-owned dev server is live on `.next`; last recorded run is 2026-10-16 (`build-output.log`: `✓ Compiled successfully in 1979ms`, route table, no errors) | n/a |

`build-output.log` (2026-10-16 17:42, untracked) is a **successful** full build log
(`✓ Compiled successfully`, `Finished TypeScript in 4.1s`, 13/13 static pages). It
predates the 2026-10-19 B7 refactor that removed `generateUploadUrl`, which is why it
does not show the current TS2339.

---

## 5. Test setup

| Aspect | Value | Evidence |
|---|---|---|
| Vitest config | `environment: 'edge-runtime'`, `include: ['convex/**/*.test.ts']` | `vitest.config.ts:10-15` |
| Why edge-runtime | matches Convex function runtime; `convex-test` mock backend | `vitest.config.ts:3-9` |
| `@edge-runtime/vm` needed by | that environment only | same; package at `package.json:64` |
| Vitest test files | 7: `convex/adminExports.test.ts`, `convex/adminQueries.test.ts`, `convex/categories.test.ts`, `convex/orders.test.ts`, `convex/businesses/mutations.test.ts`, `convex/businesses/photoStorage.test.ts`, `convex/businesses/queries.test.ts` | `Get-ChildItem -Recurse -Filter *.test.ts convex` |
| Node `--test` suites | `app/**` (12 files), `lib/**` (1 file), `scripts/**` (29 files) = 42 files | `package.json:17`; `Get-ChildItem -Filter *.test.ts` counts |
| Test naming | siblings of source: `foo.ts` → `foo.test.ts`; pure-helper tests next to components (`photos-panel.test.ts`) | observed layout |
| Photos panel tests | pure helpers only — `stampOrdering`, `withAltText`, `normalizePhotos`, `readStorageId`, `messageForError`, `validateSelection` | `app/owner/business/[id]/photos-panel.test.ts:1-123` |
| Photo storage handler tests | `convex-test` (`convexTest(schema)`), imports `assertPhotoAttachmentsValid` directly, calls `api.businesses.photoStorage.photoUrls` and `internal.businesses.photoUploads.backfillStorageUploads` | `convex/businesses/photoStorage.test.ts:17,130,188,256-271,416-428` |
| Header convention | each test file starts with a purpose comment and a `Run:` line | e.g. `photoStorage.test.ts:8`, `photos-panel.test.ts:7` |

Test commands currently green: `npm test` (527 + 41) and the single-file vitest run.
`@edge-runtime/vm` is loaded successfully by the repo's own config (the run reports
`environment 60ms`), so the workaround described at
`docs/order-commitment-protocol.md:2088` (`--environment node`) is no longer needed.

---

## 6. Protected files — current git status

`git status --porcelain=v1` lists exactly five modified tracked files, and all five are
the user-edited files named in the issue. No other tracked file is modified.

| File | Status | Diffstat |
|---|---|---|
| `app/owner/business/[id]/menu-panel-groups.tsx` | `M` | 45 changed lines (`45 +++…`) |
| `app/owner/business/[id]/menu-panel-item-editor.tsx` | `M` | 18 changed |
| `app/owner/business/[id]/menu-panel.tsx` | `M` | 9 changed |
| `components/profile/ordering-panel-sections.tsx` | `M` | 1 insertion |
| `screens/SPEC.md` | `M` | 39 changed |

Combined `git diff --stat`: `5 files changed, 99 insertions(+), 13 deletions(-)`.

`app/owner/business/[id]/photos-panel.tsx` — the file carrying the TS2339 — is **clean**
(not in `git status`), so editing it does not touch user work.

Untracked artifacts present at the time of inspection include `docs/order-commitment-protocol.md`,
`convex/orders.test.ts`, `build-output.log`, `tsc-output.log`, `lint-output.log`,
`review-*.log`, `test-output.log`, `pnpm-workspace.yaml`, `prompts/`, `tasks/`, `pr/`,
`.reticle*`, `.archon/`, `.firecrawl/`.

---

## 7. Import-graph / call-chain impact

### 7.1 Changing the consumer (`photos-panel.tsx`)

```
editor-section-body.tsx:21  ──imports──▶  photos-panel.tsx
                                              │ L116 api.businesses.photoUploads.generateUploadUrl  (public, absent)
                                              │ L118 api.businesses.photoStorage.photoUrls         (public, present)
                                              │ L136-160 fetch(uploadUrl) → readStorageId
                                              ▼
                                   photos-panel-helpers.ts  (readStorageId L31-40, messageForError L42, validateSelection L53)
```

No test imports `PhotosPanel` itself; `photos-panel.test.ts` imports only the helpers.
So the component's transport change has no test-file import edge.

### 7.2 Changing/renaming the Convex module

```
convex/http.ts:7-11 ──▶ businesses/photoUploads.ts
photoUploads.ts:106,127 ──▶ internal.businesses.photoUploads.{authorizePhotoUpload,registerStorageUpload} (self)
convex/businesses/photoStorage.test.ts:416,428 ──▶ internal.businesses.photoUploads.backfillStorageUploads
convex/_generated/api.d.ts:33,81 ──▶ businesses/photoUploads.js  (generated module map)
```

- The **module name is load-bearing** for `internal.*` references in source and tests
  (5 call sites) and for the generated module map. Renaming it would require touching all
  of them and re-running codegen.
- The **public API surface** contains no `photoUploads` entry because the module exports
  no `query`/`mutation`/`action`. Regenerating codegen cannot create
  `generateUploadUrl` unless that export is reintroduced in source
  (removed in `f92f564`).
- `photoStorage.ts` is a different module with a different role: its only public export
  is the `photoUrls` query (`photoStorage.ts:48`); everything else is exported helper
  functions consumed by `businesses/mutations.ts:44`, `businesses/queries.ts:31`,
  `menus.ts:13`, and tests.
- `convex/_generated/api.js:21-23` is `anyApi`, so generated JS is unaffected by the
  module map; only `api.d.ts` carries the types.

### 7.3 Codegen regeneration cost/inputs

`convex/_generated/*` is CLI-owned (`convex/AGENTS.md`: "Never edit it by hand";
`api.d.ts:7`: "To regenerate, run `npx convex dev`"). Regeneration writes
`api.d.ts`, `api.js`, `dataModel.d.ts`, `server.d.ts`, `server.js`; `api.d.ts` currently
lists 40 modules (`api.d.ts:11-50`) and its mtime (2026-10-20 05:14) is already newer
than `schema.ts` (05:11) and `photoUploads.ts` (2026-10-19 13:59).

---

## 8. Conventions relevant to the repair

| Convention | Evidence |
|---|---|
| Convex functions live flat in `convex/` or grouped in `convex/businesses/` | directory listing; `convex/AGENTS.md` "Key files" table |
| `_generated/` is never hand-edited | `convex/AGENTS.md`; `api.d.ts:5-7` |
| Server internals use `internalQuery` / `internalMutation`; client-callable use `query` / `mutation` | `photoUploads.ts:44,71,156` vs `photoStorage.ts:48` |
| Seeds/backfills are `internalMutation`, run via `npx convex run` | `convex/AGENTS.md`; `photoUploads.ts:147-156` |
| Owner writes go through `requireBusinessOwner` | `photoUploads.ts:49,74`; `photoStorage.ts:54` |
| HTTP endpoints are registered in `convex/http.ts` with `http.route({ path, method, handler })` | `http.ts:15-19,61-62` |
| Upload auth is a Clerk bearer token (`template: 'convex'`) to the Convex **site** URL, never a cookie | `photoUploads.ts:25-32,94-97`; `menu-panel-item-editor.tsx:85-88,318` |
| Client upload responses are parsed with `readStorageId`; errors with `messageForError` | `photos-panel-helpers.ts:31,42` |
| Component tests that need no React runtime live in `*.test.ts` siblings and use `node:test` | `photos-panel.test.ts:9-10`; `package.json:17` |
| Convex handler tests are `*.test.ts` under `convex/`, run by vitest + `convex-test` | `photoStorage.test.ts:1-20`; `vitest.config.ts:13` |
| Task artifacts are named `tasks/issue-<n>-<kind>.md` (`context`, `research`, `plan`, `todo`, …) | `tasks/` listing (e.g. `tasks/issue-8-context.md`, `tasks/issue-13-context.md`) |
| Prettier config exists (`.prettierrc`, 239 B); ESLint flat config (`eslint.config.js`, 3,567 B) | directory listing |

---

## 9. Step-by-step answers (index)

1. **package/config contents** → §1.
2. **Photo upload surface, references, generated API, schema tables** → §2 (module exists;
   all `photoUploads` hits; `api.d.ts:33,81`; tables `businesses.photos`,
   `storageUploads`, `stylists.photoStorageId`).
3. **Consumers** → §3 (only `photos-panel.tsx:116` is a public consumer; internal refs in
   `http.ts`, `photoStorage.test.ts`, self).
4. **`node_modules` state** → §4 (`@clerk/nextjs` and `@edge-runtime/vm` populated;
   top-level `@ampproject/remapping` missing but the build path resolves a copy under
   `.pnpm`; `.bin` has vitest/next/tsc; `.pnpm` entries confirmed; `.modules.yaml` read).
5. **Test setup** → §5 (`edge-runtime`, `convex/**/*.test.ts`, 7 vitest files, green).
6. **Five protected files** → §6 (all `M`, no other tracked modifications;
   `photos-panel.tsx` clean).
7. **Call-chain impact** → §7.
8. **Conventions** → §8.

## 10. Facts that contradict the ticket text (recorded, not judged)

| Ticket statement | Measured state | Evidence |
|---|---|---|
| "`@clerk/*` and `@edge-runtime/vm` package directories are empty" | Populated junctions; both `package.json` files present | §4.1 |
| "`@ampproject/remapping` is missing (breaks the Tailwind build chain)" | Missing at top level, but the PostCSS chain resolves `@tailwindcss/node@4.1.11` from `.pnpm`, where `@ampproject/remapping` is linked; Tailwind compiles (`POSTCSS OK len=130984`) | §4.4 |
| "`node_modules/.bin` lacks the vitest binary" | `node_modules/.bin/vitest` present (mtime 11:30:38) | §4.2 |
| "a stale dev server holds `node_modules` so `pnpm install` fails" | A dev server is running (PID 11140/8656, started 11:30:45). A pnpm install completed at 11:30:38, 7 s before that start. A fresh install was not attempted here. | §0, §4.5 |
| "generated API references `photoUploads` while the source file is `photoStorage.ts`" | Both `photoUploads.ts` and `photoStorage.ts` exist; the import target exists. `TS2339` arises because `photoUploads.ts` exports no public function (the `generateUploadUrl` mutation was removed in `f92f564`) while `photos-panel.tsx:116` still calls it | §2.1-2.3 |
| "`npm test` fails (vitest binary missing)" | `npm test` exits 0: 527 node tests + 41 vitest tests | §4.6 |
| "`tsc --noEmit` fails broadly on `@clerk`/`@dnd-kit` `TS2307`" | Exactly one error remains: `photos-panel.tsx(116,56) TS2339` | §4.6 |

## 11. Unverified items (no claim made)

- A fresh `pnpm install` exit code (not run: user-owned dev server holds the tree).
- `next build` exit code in the current tree (not run: live dev server on `.next`;
  last recorded successful build is the 2026-10-16 log).
- Whether `next build`'s TypeScript phase fails on the same single TS2339 (expected from
  `tsc --noEmit`, not executed).
- Browser E2E (no order route under `app/order`; `Test-Path` recorded as false in
  `docs/order-commitment-protocol.md:1800`).
