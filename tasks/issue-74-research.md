# Issue #74 — Research: Repair environment + Convex codegen (order protocol T0)

**Date:** 2026-10-20
**Repo:** `D:\Dev\dircteshop-1`
**Type:** research only (no source changes, no installs, no process kills)

## Task contract

| Field | Value |
|---|---|
| TYPE | Research / environment forensics |
| TARGET | dependency manifests, `node_modules` layout, `convex/_generated`, `vitest.config.ts`, official pnpm / Vitest / Convex / Next.js docs |
| GOAL | Record exact versions, explain each reported failure from primary sources, and give a supported repair path |
| DONE-WHEN | This file with a `## Versions` table read from manifests, an `## Official docs consulted` list, root causes, and ordered recommendations |

## Headline verdict

**The issue text is stale relative to the current tree.** Measured on 2026-10-20:

- `@clerk/nextjs` (7.9.15) and `@edge-runtime/vm` (5.0.0) are **populated**, not empty.
- `node_modules/.bin/vitest` **exists** and `vitest run convex/orders.test.ts` passes **10/10** under the repo's `edge-runtime` environment.
- `npm test` **passes end to end**: 527 Node tests + 41 Vitest tests (7 files).
- `pnpm install --dry-run` reports **"Already up to date"** — no `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR`.
- `next build` now **compiles successfully** (Turbopack, 2.6 s); the `@ampproject/remapping` error is **not reproducible**.
- `tsc --noEmit` still fails with **exactly one error**: `TS2339` at `app/owner/business/[id]/photos-panel.tsx:116:56`.
- `next build` fails at its TypeScript gate with that same single error.
- A live `next dev` server still owns port 3000 (PID 11140, child 8656), so the "owner must stop it" step is still real for a full install/restart.

**The remaining work for #74 is therefore: (1) stop the dev server by its owner, run a real `pnpm install` to certify repair, (2) remove the stale `generateUploadUrl` client call — which is the actual `photoUploads` defect, not stale codegen, and (3) verify `tsc` + `next build`.** Regenerating Convex code is **not** the fix and would change nothing (see F5).

---

## Versions

Read from `package.json`, `pnpm-lock.yaml` (lockfileVersion 9.0), and each installed `node_modules/<pkg>/package.json`. `@ampproject/remapping` and `@tailwindcss/node` are transitive (not declared).

| Package | Declared (`package.json`) | Locked (`pnpm-lock.yaml`) | Installed (`node_modules`) | Notes |
|---|---|---|---|---|
| next | `16.3.5` (exact) | `16.3.5` | `16.3.5` | Turbopack is the default bundler in Next 16 |
| react | `^19.2.3` | `19.3.0` | `19.3.0` | |
| react-dom | `^19.2.3` | `19.3.0` | `19.3.0` | |
| typescript | `^5` | `5.8.3` | `5.8.3` | Next 16 minimum is 5.1 |
| vitest | `^4.1.12` | `4.1.12` | `4.1.12` | `bin: { "vitest": "./vitest.mjs" }` |
| vite | `^6.4.4` | `6.4.4` | `6.4.4` | Vitest peer |
| @clerk/nextjs | `^7.9.4` | `7.9.15` | `7.9.15` | populated (issue said empty) |
| @clerk/backend | `^3.18.1` | `3.23.2` | `3.23.2` | |
| @clerk/shared | transitive | `4.40.0` (also `3.11.0` for an older consumer) | `4.40.0` | |
| @clerk/ui | `^1.33.1` | `1.40.1` | `1.40.1` | |
| @edge-runtime/vm | `^5.0.0` | `5.0.0` | `5.0.0` | populated; required by Vitest `edge-runtime` |
| @ampproject/remapping | transitive | `2.3.0` | **absent at root**; `2.3.0` present in `.pnpm` | normal for isolated linker; see F3 |
| tailwindcss | `^4` | `4.1.11` | `4.1.11` | |
| @tailwindcss/postcss | `^4` | `4.1.11` | `4.1.11` | |
| @tailwindcss/node | transitive | `4.1.11` | **`4.3.3` as a stray real directory at root**; `4.1.11` in `.pnpm` | version + layout anomaly; see F3 |
| convex | `^1.31.2` | `1.46.0` | `1.46.0` | |
| convex-test | `^0.0.62` | `0.0.62` | `0.0.62` | |
| @types/node | `^24.13.5` | `24.19.2` | not re-checked | |
| Node.js | `engines.node: ">=22.6"` | — | `v24.18.0` | `>=22.6` is for running `scripts/*.ts` directly |
| pnpm | — | `.modules.yaml: packageManager: pnpm@12.3.4` | `12.3.4` | latest is `12.14.0`; Windows lock-retry fix landed later |
| node linker | — | `.modules.yaml: nodeLinker: isolated` | `node_modules/.pnpm` virtual store | layoutVersion 5 |

`pnpm-lock.yaml` settings: `autoInstallPeers: true`, `excludeLinksFromLockfile: false`.

---

## Findings

### F1 — `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR`: cause and supported remedy

**Cause (primary sources).** pnpm raises this while it removes/replaces a package directory under `node_modules`. On Windows, an open handle on that directory produces `ERROR_ACCESS_DENIED (os error 5)`. pnpm issue **#15080** reproduces exactly this on the **default isolated** linker with pnpm **12.5.0**, and states the lock holder can be "a genuine running process (any editor extension holding a local dependency — Oxc, Tailwind IntelliSense, etc.)" — or a Next dev server. The same issue notes **"Running the exact same command a second time works"** because the handle is released in the interim.

**Fix status.** pnpm **#15081** tracks the general case and **PR #15409** ("fix(fs): wait out Windows file locks when removing packages") was **merged 2026-09-23**. It makes `remove_dirent` retry transient locks: up to **60 s** for sharing violations and **5 s** for access-denied, covering `pnpm clean / update / add / install`. The local **12.3.4 predates that fix** and is not the latest (12.14.0).

**Supported remedies, in order:**

1. **Stop the process holding `node_modules`** (the dev server or an editor extension). This is the documented cause, and the issue's manual gate. Nothing may kill a process the agent did not start.
2. **`pnpm install` again.** pnpm's own install docs document `--force` as: *"Force reinstall dependencies: refetch packages modified in store, recreate a lockfile and/or modules directory created by a non-compatible version of pnpm."* That is the documented non-destructive repair.
3. Retrying the same command is a known workaround for a transient lock (per #15080), not a repair.
4. **Do not delete `node_modules`** unless the owner explicitly approves it (AGENTS.md rule 8). It is not required by the docs above, and on Windows a recursive delete fails on the same handles.

**Measured locally:** `pnpm install --dry-run` → `Already up to date` / `Done in 43ms using pnpm v12.3.4`. A real install was **not** run by this research node (it writes `node_modules` while the dev server is live).

### F2 — `node_modules/.bin` and `node-linker`

- pnpm's default **`nodeLinker: isolated`** symlinks (junctions on Windows) direct dependencies into the root `node_modules` and keeps the real trees in `node_modules/.pnpm`; transitive dependencies are linked inside each package's own `node_modules` ("Symlinked `node_modules` structure"). Root absence of a transitive package is therefore **expected**, not corruption.
- Executable binaries are shimmed into `node_modules/.bin`. `pnpm exec` documents: *"`node_modules/.bin` is added to the `PATH`, so `pnpm exec` allows executing commands of dependencies."* npm does the same for scripts: *"those executables will be added to the `PATH` for executing the scripts … exported into the `node_modules/.bin` directory on `npm install`."*
- `vitest`'s package `bin` field is `{"vitest":"./vitest.mjs"}`. `node_modules/.bin/vitest` is present (2,173-byte shim) plus `.cmd`/`.ps1`.
- **Conclusion:** the missing `.bin/vitest` in the protocol was a symptom of the partial install, not a `node-linker` configuration problem. No config change is needed or recommended.

### F3 — `@ampproject/remapping` and the Tailwind v4 chain

**What it is.** `@ampproject/remapping` remaps sequential sourcemaps through transformations (*"Remap sequential sourcemaps through transformations to point at the original source code"*), and is a Babel-ecosystem dependency.

**Why Tailwind loads it.** It is a **direct dependency of `@tailwindcss/node@4.1.11`**: `"@ampproject/remapping": "^2.3.0"` (verified in both `pnpm-lock.yaml` and the package manifest in `.pnpm`). The CSS chain is `app/globals.css` → `@tailwindcss/postcss@4.1.11` → `@tailwindcss/node@4.1.11` → `@ampproject/remapping@2.3.0`. Note `@tailwindcss/node@4.3.3` instead depends on `@jridgewell/remapping` — the two majors differ.

**Measured layout anomaly (the real defect):**

| Path | State |
|---|---|
| `node_modules/.pnpm/@ampproject+remapping@2.3.0/.../remapping` | present, version 2.3.0 |
| `.pnpm/@tailwindcss+node@4.1.11/node_modules/` | contains links for `@ampproject`, `enhanced-resolve`, `jiti`, `lightningcss`, `magic-string`, `source-map-js`, `tailwindcss` |
| `require.resolve('@ampproject/remapping', { paths: ['.pnpm/@tailwindcss+node@4.1.11/...'] })` | **resolves** to `@ampproject/remapping@2.3.0` |
| `node_modules/@tailwindcss/node` (root) | **real directory, version 4.3.3, no junction, no nested `node_modules`** |
| `require.resolve('@ampproject/remapping', { paths: ['node_modules/@tailwindcss/node'] })` | **FAIL: MODULE_NOT_FOUND** |
| `node_modules/@ampproject` (root) | absent (expected for a transitive dep under isolated linking) |

So a **stray, pnpm-unmanaged `@tailwindcss/node@4.3.3`** shadows the managed `4.1.11`. Any resolver that starts from the root path cannot find its dependencies. This is the mechanism behind the protocol's *"Cannot find module '@ampproject/remapping' (from @tailwindcss/node)"*.

**Current behaviour:** `npx next build` compiled successfully, so that error is **not reproducible today**; the stray directory is a **latent** defect. Repairing it is still required for a trustworthy install: after install, `node_modules/@tailwindcss/node` should be a junction to `.pnpm/@tailwindcss+node@4.1.11` with version 4.1.11.

### F4 — Vitest `edge-runtime` environment

- Vitest documents `edge-runtime` as a built-in environment that *"emulates Vercel's edge-runtime, uses `@edge-runtime/vm` package"*. It must be installed in the project (it is, as a devDependency).
- Lock evidence: `vitest@4.1.12(@edge-runtime/vm@5.0.0)(...)`.
- Repo config (`vitest.config.ts`): `environment: 'edge-runtime'`, `include: ['convex/**/*.test.ts']`.
- **Measured:** `npx vitest run convex/orders.test.ts --reporter=dot` → **1 file passed, 10/10 tests, 505 ms**. `npm test` → 527 Node tests + **7 Vitest files / 41 tests passed**.
- The protocol's `--environment node` workaround is **no longer needed**; the repo's own config works.

### F5 — Convex codegen and the `photoUploads` TS2339 (root cause)

**How generated code works (official).** `npx convex dev` creates `convex/_generated/` containing `api.js`/`api.d.ts`, `dataModel.d.ts`, `server.js`/`server.d.ts`. The generated `api.d.ts` header in this repo says: *"THIS CODE IS AUTOMATICALLY GENERATED. To regenerate, run `npx convex dev`."* The docs define `api` as *"An object of type `API` describing your app's public Convex API"* and `internal` as *"another object of type `API` describing your app's internal Convex API."*

**The generated file is not stale.** `convex/_generated/api.d.ts` already contains **both** modules:

```ts
import type * as businesses_photoStorage from "../businesses/photoStorage.js";
import type * as businesses_photoUploads from "../businesses/photoUploads.js";
...
"businesses/photoStorage": typeof businesses_photoStorage;
"businesses/photoUploads": typeof businesses_photoUploads;
```

**Why `api.businesses.photoUploads` still does not exist.** The public `api` is:

```ts
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
```

`FilterApi` keeps only **public** function references. `convex/businesses/photoUploads.ts` exports:

| Export | Kind |
|---|---|
| `authorizePhotoUpload` | `internalQuery` |
| `registerStorageUpload` | `internalMutation` |
| `uploadPhoto`, `uploadPhotoOptions` | `httpAction` |
| `backfillStorageUploads` | `internalMutation` |

It has **no public function**, so the module is filtered out of `api.businesses` — exactly matching the TypeScript message (the type shows `photoStorage` but not `photoUploads`). `generateUploadUrl` **does not exist anywhere in `convex/`**; grep finds only the explanatory comment in `convex/http.ts`:

> `// generateUploadUrl` was removed because a raw POST to its URL bypasses the registry and would only produce ids the attach gate must reject.

Uploads now go through the authenticated HTTP action: **`POST /photos/upload?businessId=<id>`**, body = file bytes, `Authorization: Bearer <Clerk token>` (`photoUploads.ts:93-140`, routed in `http.ts:61-62`). The ownership row is inserted by `registerStorageUpload`.

**Why the client is stale.** Commit `a5c35b7 feat(media): owner Photos & Media panel (#7)` introduced `useMutation(api.businesses.photoUploads.generateUploadUrl)` in `photos-panel.tsx:116`. Commit `f92f564 feat(photos): bind storage ids to their uploading listing` replaced that design with the HTTP action, but the panel call was never migrated.

**Conclusion:** regenerating the Convex API cannot fix this; the generated API is correct. The fix is to migrate the panel's upload path to the HTTP endpoint (using `NEXT_PUBLIC_CONVEX_SITE_URL`, which is already in `.env.local`, and a Clerk token from `useAuth().getToken()`; `ConvexProviderWithClerk` internally requests the `convex` JWT template). Reintroducing a public `generateUploadUrl` mutation is **not** acceptable: it is the bypass `http.ts` explicitly removed.

### F6 — Next.js 16 / Node requirements and build behaviour

- Next.js 16 system requirements: **Node.js 20.9+**, TypeScript **5.1+** (official installation page). Next 16's release notes state **Turbopack is the default bundler for all apps** and `next build --webpack` opts out.
- The repo's stricter `engines.node: ">=22.6"` is a **repo** requirement: `npm run seed` and `npm test` execute `scripts/*.ts` directly with Node's type stripping. Actual runtime is `v24.18.0`, satisfying it.
- **Measured `next build`:** `▲ Next.js 16.3.5 (Turbopack)` → `✓ Compiled successfully in 2.6s` → `Running TypeScript ...` → the single `TS2339` → `Failed to type check.` Exit 1. So the build gate is now **typecheck-only**, not a missing-module failure.
- Non-blocking warning observed: `middleware.ts` is deprecated in favour of `proxy.ts` (Next 16). Out of scope for #74.

---

## Acceptance criteria — measured status (2026-10-20)

| Criterion | Observed | Status |
|---|---|---|
| Dev server stopped by owner; `pnpm install` completes without `ERR_PNPM…` | Dev server **still running** (PID 11140 `next dev`, child 8656 on :3000). `pnpm install --dry-run` = "Already up to date". Real install not run. | **OPEN (manual + verify)** |
| `@clerk/nextjs` and `@edge-runtime/vm` populated; remapping error gone | Both populated (7.9.15 / 5.0.0); `.bin/vitest` present; `next build` compiles; remapping error not reproducible | **MET (re-verify after install)** |
| `tsc --noEmit` exits 0 | Exits 1 with exactly one error: `photos-panel.tsx:116:56 TS2339` | **OPEN (code fix)** |
| `next build` exits 0 | Compiles, then fails the TypeScript gate on the same single error | **OPEN (same code fix)** |
| `npm test` passes end to end | 527 Node tests + 41 Vitest tests (7 files), all pass, under `edge-runtime` | **MET** |
| `photoUploads` TS2339 resolved as separate concern | Root cause proven: internal-only module + stale client call to a removed `generateUploadUrl`; codegen is current | **OPEN (code fix; separate commit)** |
| Five user-edited files untouched | `git status` shows exactly the five ` M` files: 3 menu panels, ordering-panel-sections, `screens/SPEC.md` | **MET** |

Stray `node_modules/@tailwindcss/node@4.3.3` is an additional install-integrity defect not named in the issue.

---

## Recommended actions (ordered)

1. **Manual gate — owner stops the dev server.** PID **11140** (`node ... next dev`), child **8656** (`next-server`), listening on **:3000**, started 11:30. The agent must not kill it. Confirm the port is free.
2. **Repair the install:** `pnpm install` from `D:\Dev\dircteshop-1`. Expected: no `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR`. If it still fails after the owner stopped the server, use the documented `pnpm install --force` (recreates the modules directory). **Do not delete `node_modules` without explicit approval.**
3. **Verify the stray directory is gone/replaced:** `node -e "console.log(require('./node_modules/@tailwindcss/node/package.json').version)"` should print `4.1.11`, and `node -e "require.resolve('@ampproject/remapping',{paths:['./node_modules/@tailwindcss/node']})"` should resolve. If the 4.3.3 real directory survives `pnpm install --force`, targeted removal needs approval.
4. **Fix the codegen mismatch as its own commit** (do not mix with order work): replace `useMutation(api.businesses.photoUploads.generateUploadUrl)` in `app/owner/business/[id]/photos-panel.tsx` with a `POST` to `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/photos/upload?businessId=${businessId}`, sending the file as the body and `Authorization: Bearer <token>` from `useAuth().getToken()`. Keep the existing `readStorageId` parsing. Do **not** regenerate codegen and do **not** re-add a public `generateUploadUrl` mutation.
5. **Gate:** `pnpm exec tsc --noEmit` (exit 0) → `npx next build` (exit 0) → `npm test` (green) → lint. Then record evidence in the ticket; the `@ampproject/remapping` note can be closed as no longer reproducible.
6. **Optional hardening (not #74):** upgrade the global pnpm from 12.3.4 to a current 12.x (latest 12.14.0) so Windows lock retries from PR #15409 apply. Do not bundle a global tooling change into this ticket.
7. **Cosmetic:** `tsconfig.json` has duplicate `allowImportingTsExtensions` at lines 10 and 13 (esbuild warning on every Vitest/tsx run). Harmless; separate cleanup.

---

## Official docs consulted

- pnpm — `install` options, `--force`: https://pnpm.io/cli/install
- pnpm — Symlinked `node_modules` structure (isolated linker, `.pnpm`, hoisting): https://pnpm.io/symlinked-node-modules-structure
- pnpm — `exec` (`node_modules/.bin` on `PATH`): https://pnpm.io/cli/exec
- pnpm — errors index (`ERR_PNPM_*`): https://pnpm.io/errors
- pnpm issue #15080 — `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR…` on Windows, isolated linker, running process holds a package: https://github.com/pnpm/pnpm/issues/15080
- pnpm issue #15081 — broader Windows removal-lock case: https://github.com/pnpm/pnpm/issues/15081
- pnpm PR #15409 — merged fix, retry transient Windows lock errors in `remove_dirent`: https://github.com/pnpm/pnpm/pull/15409
- pnpm issue #14790 — purging `node_modules` fails when it holds a directory link (closed by #14798): https://github.com/pnpm/pnpm/issues/14790
- pnpm issue #14349 — Windows staging-swap access denied (prior fix #14366): https://github.com/pnpm/pnpm/issues/14349
- npm docs — scripts `PATH` includes `node_modules/.bin`: https://docs.npmjs.com/cli/v11/using-npm/scripts#path
- npm — `@ampproject/remapping` 2.3.0 README / dependents: https://www.npmjs.com/package/@ampproject/remapping
- Vitest — Test Environment (`edge-runtime` uses `@edge-runtime/vm`): https://vitest.dev/guide/environment
- Convex — Generated Code (`npx convex dev` creates `_generated`): https://docs.convex.dev/generated-api/
- Convex — `api.js` (`api` = public API, `internal` = internal API): https://docs.convex.dev/generated-api/api
- Next.js — Installation / system requirements (Node 20.9+, TS 5.1+): https://nextjs.org/docs/app/getting-started/installation
- Next.js 16 — release notes (Turbopack default, Node 20.9+): https://nextjs.org/blog/next-16

## Sources in this repository

- `package.json` (engines, scripts, dependency specifiers)
- `pnpm-lock.yaml` (lockfileVersion 9.0, resolved versions, `@tailwindcss/node@4.1.11` → `@ampproject/remapping@2.3.0`, `vitest@4.1.12(@edge-runtime/vm@5.0.0)`)
- `node_modules/.modules.yaml` (`nodeLinker: isolated`, `packageManager: pnpm@12.3.4`)
- `vitest.config.ts` (`environment: 'edge-runtime'`, `include: convex/**/*.test.ts`)
- `convex/_generated/api.d.ts` (both modules listed; `api` = `FilterApi<…, "public">`)
- `convex/businesses/photoUploads.ts` (internal-only + `httpAction`; no `generateUploadUrl`)
- `convex/http.ts:58-62` (why `generateUploadUrl` was removed; `POST /photos/upload` routes)
- `app/owner/business/[id]/photos-panel.tsx:116-160` (stale call + POST body handling)
- `components/ConvexClientProvider.tsx` (`ConvexProviderWithClerk`)
- `docs/order-commitment-protocol.md` §7.4 (prior results, U11, R22)
- `convex/_generated/ai/guidelines.md` (Convex authority pointer in `AGENTS.md`)

## Evidence log (commands run by this research node)

| Command | Result |
|---|---|
| `node -v` / `pnpm -v` | `v24.18.0` / `12.3.4` |
| `npx tsc --noEmit` | 1 error: `photos-panel.tsx(116,56): TS2339` |
| `npx next build` | compiled OK (2.6 s), then failed TypeScript check on the same error |
| `npm test` | 527 Node tests pass; 7 Vitest files / 41 tests pass |
| `npx vitest run convex/orders.test.ts` | 10/10 pass, 505 ms, `edge-runtime` |
| `pnpm install --dry-run` | `Already up to date` (43 ms) |
| `require.resolve('@ampproject/remapping', {paths:['node_modules/@tailwindcss/node']})` | `MODULE_NOT_FOUND` |
| same, from `.pnpm/@tailwindcss+node@4.1.11/...` | resolves `@ampproject/remapping@2.3.0` |
| `Get-NetTCPConnection -LocalPort 3000` + CIM command line | PID 11140 `next dev`, child 8656 serving :3000 |
| `git status --porcelain` | exactly the five pre-existing ` M` user files |

## Gaps and conflicts

- **Issue text vs. measurement:** the issue says `@clerk/*` / `@edge-runtime/vm` are empty and the install is blocked; both are false now. Re-verify at execution time rather than trusting either snapshot.
- **Real `pnpm install` not executed here.** It writes `node_modules` while the dev server runs; the ticket's gate must run it after the owner stops PID 11140.
- **`@ampproject/remapping` failure not reproduced** in the current `next build`. The stray `@tailwindcss/node@4.3.3` demonstrably cannot resolve it, but the current build path does not load that copy.
- **No browser E2E** was run: the app cannot be trusted until `tsc`/`build` are green.
- **No upstream Convex issue** was found for `photoStorage` / `photoUploads`; the evidence points to a local rename/refactor (`f92f564`) leaving a stale client call, not a library bug.
- `@types/node` installed version was not re-read; not relevant to the acceptance criteria.
