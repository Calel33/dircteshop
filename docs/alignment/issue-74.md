# Alignment Report — Issue #74 · Order protocol T0 (environment repair + `photoUploads` codegen mismatch)

> Mandatory output shape for the alignment skill. Filled 2026-10-20. Read-only pass: no implementation file was modified.

## Scope

- **Artifact type:** code (single-file client change) + ticket-level environment claims
- **Artifact location:** `app/owner/business/[id]/photos-panel.tsx` (+23/−12, staged); ticket https://github.com/Calel33/dircteshop/issues/74; upstream contract `convex/http.ts:61-62` → `convex/businesses/photoUploads.ts:98-140`
- **Reviewed:** 2026-10-20
- **Focus:** all libraries on the changed surface — `@clerk/nextjs` (`useAuth`, `getToken` with JWT template), Convex (`httpAction`, `http.route`, generated `api`, site URL, `ctx.auth`), Next.js 16 App Router client components, `NEXT_PUBLIC_*`, Web `fetch` + `File` body
- **Out of scope:** the five pre-existing user-edited files (menu panels, `ordering-panel-sections.tsx`, `screens/SPEC.md`), order-work code, and the unstaged Convex backend (unchanged by this ticket)

## Stack detected

Versions read from `node_modules/<pkg>/package.json` on 2026-10-20 (not from memory, not from the issue text). Declared ranges in `package.json`; lockfile `pnpm-lock.yaml`.

| Library / technology | Installed version | Source of truth (manifest) | Docs target |
|----------------------|-------------------|----------------------------|-------------|
| next | 16.3.5 | `package.json:51` (exact pin) | latest stable |
| react / react-dom | 19.3.0 | `package.json:53-54` (`^19.2.3`) | latest stable |
| typescript | 5.8.3 | `package.json:84` (`^5`) | latest stable |
| @clerk/nextjs | 7.9.15 | `package.json:25` (`^7.9.4`) | latest stable |
| @clerk/backend | 3.23.2 | `package.json:24` (`^3.18.1`) | latest stable |
| convex | 1.46.0 | `package.json:48` (`^1.31.2`) | latest stable |
| convex-test | 0.0.62 | `package.json:75` (`^0.0.62`) | latest stable |
| @edge-runtime/vm | 5.0.0 | `package.json:64` (`^5.0.0`) | latest stable |
| vitest | 4.1.12 | `package.json:87` (`^4.1.12`) | latest stable |
| vite | 6.4.4 | `package.json:86` (`^6.4.4`) | latest stable |
| tailwindcss / @tailwindcss/postcss | 4.1.11 / 4.1.11 | `package.json:69,82` (`^4`) | latest stable |
| @tailwindcss/node (transitive) | **4.3.3, real dir at root** | transitive of `@tailwindcss/postcss` | latest stable |
| @ampproject/remapping (transitive) | **absent at root** (2.3.0 in `.pnpm`) | transitive of `@tailwindcss/node@4.1.11` | latest stable |
| Node.js | v24.18.0 | `package.json:7` (`>=22.6`) | latest stable |
| pnpm | 12.3.4 | `node_modules/.modules.yaml` | latest stable |

Registry `latest` at review time (from `npm view <pkg> version`): next 16.4.2 · convex 1.47.0 · @clerk/nextjs 7.9.17 · vitest 5.0.5 · typescript 7.0.2 · @edge-runtime/vm 5.0.0 · convex-test 0.0.62.

## Sources consulted

| Source | URL | Covers version |
|--------|-----|----------------|
| Clerk — `useAuth()` reference (last updated Oct 16, 2026) | https://clerk.com/docs/nextjs/reference/hooks/use-auth | latest (Next.js SDK 7.x) |
| Clerk — `Session.getToken()` / `GetTokenOptions` | https://clerk.com/docs/nextjs/reference/objects/session#gettoken | latest |
| Clerk — Integrate Convex with Clerk | https://clerk.com/docs/guides/development/integrations/databases/convex | latest |
| Convex — HTTP Actions (CORS, Authentication, Limits) | https://docs.convex.dev/functions/http-actions | latest |
| Convex — Auth in Functions (incl. HTTP Actions) | https://docs.convex.dev/auth/functions-auth | latest |
| Convex — Actions (authentication propagation) | https://docs.convex.dev/functions/actions | latest |
| Convex — Uploading Files (HTTP action flow, limits) | https://docs.convex.dev/file-storage/upload-files | latest |
| Convex — Generated `api` / `internal` | https://docs.convex.dev/generated-api/api | latest |
| Convex — Environment Variables (`CONVEX_SITE_URL`) | https://docs.convex.dev/production/environment-variables | latest |
| Convex — Convex & Clerk (`applicationID: "convex"`) | https://docs.convex.dev/auth/clerk | latest |
| Next.js — `use client` directive | https://nextjs.org/docs/app/api-reference/directives/use-client | latest (16.x) |
| Next.js — Environment Variables (`NEXT_PUBLIC_`) | https://nextjs.org/docs/app/guides/environment-variables | latest (16.x) |
| MDN — Cross-Origin Resource Sharing (CORS) | https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS | web standard |
| Vitest — "Vitest 5.0 is out" (Sep 3, 2026) | https://vitest.dev/blog/vitest-5.html | 5.0 |
| Microsoft — Announcing TypeScript 7.0 | https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ | 7.0 |
| Installed package source — `ConvexProviderWithClerk` | `node_modules/convex/dist/esm/react-clerk/ConvexProviderWithClerk.js:33-35` | 1.46.0 |

## Findings

| # | Label | Severity | Artifact location | Claim / usage | What the docs say | Source |
|---|-------|----------|-------------------|---------------|-------------------|--------|
| 1 | ALIGNED | — | `photos-panel.tsx:1,3,118` | `'use client'` at the top of the file, then `import { useAuth } from '@clerk/nextjs'` and `const { getToken } = useAuth()` in the component body | `'use client'` "declares an entry point for the components to be rendered on the client side … add the `'use client'` directive **at the top of the file**, before any imports". Clerk's own reference example is `'use client'` + `import { useAuth } from '@clerk/nextjs'` + destructured `getToken` | https://nextjs.org/docs/app/api-reference/directives/use-client ; https://clerk.com/docs/nextjs/reference/hooks/use-auth |
| 2 | ALIGNED | — | `photos-panel.tsx:144` | `getToken({ template: 'convex' })` | `GetTokenOptions` includes `template?: string` — "The name of the JWT template … to generate a new token from." The Convex integration registers an `applicationID` of `"convex"`, and the installed `ConvexProviderWithClerk` itself calls `getToken({ template: "convex", skipCache: forceRefreshToken })` — the manual call mirrors the provider exactly | https://clerk.com/docs/nextjs/reference/objects/session#gettoken ; https://docs.convex.dev/auth/clerk ; `node_modules/convex/dist/esm/react-clerk/ConvexProviderWithClerk.js:33-35` |
| 3 | ALIGNED | — | `photos-panel.tsx:145-147` | `if (token === null) throw …` | `getToken()` is typed `(options?: GetTokenOptions) => Promise<null \| string>` — `null` is the documented "not signed in / no token" return, so the null guard matches the type | https://clerk.com/docs/nextjs/reference/objects/session#gettoken |
| 4 | ALIGNED | — | `photos-panel.tsx:149-153` | `POST ${siteUrl}/photos/upload?businessId=…` with `Authorization: Bearer <token>` | Convex documents exactly this for authenticated HTTP actions: "call your endpoint with an `Authorization` header including a JWT token: `Authorization: \`Bearer ${jwtToken}\``" against `https://<deployment name>.convex.site/myAction`; `ctx.auth.getUserIdentity()` then resolves it | https://docs.convex.dev/functions/http-actions (Authentication) ; https://docs.convex.dev/auth/functions-auth (HTTP Actions) |
| 5 | ALIGNED | — | `photos-panel.tsx:151-152` | Raw `File` as `body` with `Content-Type: file.type` (no `FormData`) | Convex's documented "Calling the upload HTTP action from a web page" example is the same shape: `headers: { "Content-Type": selectedImage!.type }, body: selectedImage` | https://docs.convex.dev/file-storage/upload-files |
| 6 | ALIGNED | — | `photos-panel.tsx:151-152` | Raw-byte body rather than `multipart/form-data` | "There is no specific limit on request size, **except `multipart/form-data` bodies, which are limited to 20 MiB**"; the raw-body form side-steps that cap, and `PHOTO_LIMITS.maxBytes` is 5 MB (`convex/businesses/photoPolicy.ts:28`) | https://docs.convex.dev/functions/http-actions (Limits) |
| 7 | ALIGNED | — | `photos-panel.tsx:151` + `convex/http.ts:61-62` | Sends `Authorization` and `Content-Type` cross-origin; server registers `POST` and `OPTIONS` for `/photos/upload` | "To make requests to HTTP actions from a website you need to add CORS headers … and potentially add a handler for the pre-flight `OPTIONS` request". Route table registers both verbs and `Access-Control-Allow-Headers: Authorization, Content-Type` (`photoUploads.ts:28-32`) | https://docs.convex.dev/functions/http-actions (CORS) |
| 8 | ALIGNED | — | `convex/businesses/photoUploads.ts:28-32` | `Access-Control-Allow-Origin: '*'` on an authenticated route | Permitted because the request is **non-credentialed**: "For requests without credentials, the `*` wildcard tells browsers to allow any origin… The wildcard is **not** allowed with credentials." Auth rides in a bearer header, not a cookie (see #9) | https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS ; https://docs.convex.dev/functions/http-actions (CORS) |
| 9 | ALIGNED | — | `photos-panel.tsx:149-153` | `fetch` with no `credentials` option | Browser default is `same-origin`, so no cookies are sent to `*.convex.site`; the bearer header carries identity. This is what keeps the `*` origin legal (see #8) and matches Convex's documented browser example, which sets only `Content-Type` | https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS ; https://docs.convex.dev/file-storage/upload-files |
| 10 | ALIGNED | — | `photos-panel.tsx:144` → `photoUploads.ts:106` | The token is validated server-side only indirectly: `httpAction` → `ctx.runQuery(internal.businesses.photoUploads.authorizePhotoUpload)` → `requireBusinessOwner` → `ctx.auth.getUserIdentity()` | Documented and load-bearing: "To check user authentication use the `auth` field. **Auth is propagated automatically when calling queries and mutations from the action.**" Without that guarantee the ownership gate inside an `internalQuery` would see no identity | https://docs.convex.dev/functions/actions (Action context) ; https://docs.convex.dev/auth/functions-auth |
| 11 | ALIGNED | — | `photos-panel.tsx` (whole file) | `api.businesses.photoUploads.generateUploadUrl` is gone; the fix was to stop referencing it, not to regenerate `_generated` | `api` is `FilterApi<typeof fullApi, FunctionReference<any, "public">>` (`convex/_generated/api.d.ts:109-112`) and docs define it as "An object of type `API` describing your app's **public** Convex API" (`internal` is the internal one). `photoUploads.ts` exports only `internalQuery` / `internalMutation` / `httpAction`, so the module can never appear under `api` — the TS2339 was correct behaviour, and dropping the reference is the documented-correct resolution | https://docs.convex.dev/generated-api/api |
| 12 | ALIGNED | — | `photos-panel.tsx:138-171` | Upload performed through a custom authenticated HTTP action instead of `ctx.storage.generateUploadUrl()` | Docs present this as a first-class, supported alternative: "The file upload process can be more tightly controlled by leveraging HTTP actions, performing the whole upload flow using a single request, but requiring correct CORS headers configuration. The custom upload HTTP action can control who can upload files" — which is precisely the ownership reason recorded in `convex/http.ts:58-60` | https://docs.convex.dev/file-storage/upload-files (§Uploading files via an HTTP action) |
| 13 | ALIGNED | — | `photos-panel.tsx:139-142` | `process.env.NEXT_PUBLIC_CONVEX_SITE_URL` read inside a client component | Next.js: non-`NEXT_PUBLIC_` variables "aren't accessible to the browser"; prefixing makes Next "inline a value, at build time … replacing all references to `process.env.[variable]`". Direct member access is the inlinable form (dynamic lookups are not), which is what the code uses | https://nextjs.org/docs/app/guides/environment-variables |
| 14 | ALIGNED | — | `photos-panel.tsx:159-170` | `await response.json()` then `readStorageId(payload)` (`photos-panel-helpers.ts:31-40`) | `request`/`Response` bodies via `.json()`, `.blob()`, `.text()`, `.arrayBuffer()` are the documented body types for HTTP actions; the server answers with `jsonResponse(200, { storageId })` (`photoUploads.ts:139,191-196`), so the parsed shape matches the producer | https://docs.convex.dev/functions/http-actions (Limits) |
| 15 | ALIGNED | — | `photos-panel.tsx:155-157` | Non-OK responses routed through `uploadErrorMessage()` (`menu-panel-helpers.ts:103-113`), which reads `{ error }` | Convex documents that HTTP actions "may have side-effects and will not be automatically retried by Convex when errors occur. It is a responsibility of the caller to handle errors" — the client does exactly that and degrades to a status-based message when the body is unparseable | https://docs.convex.dev/functions/http-actions (Limits) |
| 16 | ALIGNED | — | `photos-panel.tsx:151` + `photoPolicy.ts:40-58` | `Content-Type: file.type` is only ever a real MIME type | The server rejects an empty type outright ("a missing or empty `type` … is a rejection, never a soft pass"), and `validateSelection` (`photos-panel-helpers.ts:60-71`) runs the same predicate before any byte leaves the browser — so the header can never be empty for an accepted file | https://docs.convex.dev/functions/http-actions (`.blob()` derives the stored content type from `Content-Type`) |
| 17 | VERSION-GAP | — | `package.json:84`; `vitest.config.ts` | Toolchain pinned to vitest 4.1.12 | Installed **4.1.12**, latest stable **5.0.5** (announced Sep 3, 2026). Vitest 5 "requires Vite >= 6.4.0 and Node.js >= 22.12.0" — the repo already satisfies both (vite 6.4.4, Node 24.18.0) — and "has several breaking changes … review the detailed Migration Guide before upgrading". Nothing in the changed client surface depends on it; the ticket's `npm test` gate is green on 4.1.12 | https://vitest.dev/blog/vitest-5.html |
| 18 | VERSION-GAP | — | `package.json:84`; `npx tsc --noEmit` gate | TypeScript `^5` resolves to 5.8.3 | Installed **5.8.3**, latest stable **7.0.2** — "TypeScript 7, a 10x faster native port of TypeScript". The code uses no API removed in the port; the gap is a toolchain-major decision for the repo, not a defect in this change | https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ |
| 19 | UNVERIFIABLE | — | `photos-panel.tsx:139`; `.env.local:5` | `NEXT_PUBLIC_CONVEX_SITE_URL` as the client-side site URL | Convex documents only the **backend** system variable: "`CONVEX_SITE_URL` — Your deployment site URL (eg. `https://dusty-nightingale-847.convex.site`) for use with HTTP Actions". No official page documents a `NEXT_PUBLIC_CONVEX_SITE_URL` client mirror; searched the Convex environment-variables page, the HTTP-actions page, the Convex & Clerk guide and the Clerk Convex integration guide. The value in `.env.local` is well-formed (`https://agile-husky-366.convex.site`) and the name follows Next.js `NEXT_PUBLIC_` rules, but it is a project convention, not documented API | — |
| 20 | UNVERIFIABLE | — | `photoUploads.ts:139,191-196` ↔ `photos-panel.tsx:159-170` | Response envelope `{ storageId }` on success, `{ error }` on failure | Convex HTTP-action docs describe returning a `Response` but define no payload envelope; the contract is app-internal. It is *consistent* between producer and consumer in this repo, but no external authority specifies it | — |

## Summary

| Label | Count |
|-------|-------|
| ALIGNED | 16 |
| DRIFT | 0 |
| VERSION-GAP | 2 |
| UNVERIFIABLE | 2 |

**Top DRIFT findings:** none. No usage in the changed surface contradicts current official documentation.

## Recommendations (advisory)

1. **Document the client-side site URL.** `NEXT_PUBLIC_CONVEX_SITE_URL` is load-bearing for the upload path but absent from `.env.example` (finding #19). Add it there with the `https://<deployment>.convex.site` shape, next to `NEXT_PUBLIC_CONVEX_URL`, so a fresh clone fails loudly at config time rather than at first upload.
2. **Leave the API shape as is.** Do not re-add a public `generateUploadUrl` mutation to "unbreak" `api.businesses.photoUploads` — `api` is public-only by construction (#11), and `convex/http.ts:58-60` records why the bypass was removed.
3. **Keep `Origin: *` only while auth stays header-based** (#8/#9). If a cookie/`credentials: 'include'` path is ever introduced on this route, the wildcard must become an explicit origin (`env.CLIENT_ORIGIN`) plus `Vary: origin`, per the Convex CORS example.
4. **Consider the Vitest 5 major on its own ticket** (#17): Vite and Node prerequisites are already met; read the migration guide first. Likewise, treat TypeScript 7 (#18) as a repo-wide toolchain decision, not part of this fix.
5. **Environment integrity is still partial (advisory, not a docs finding).** Verified on disk: `node_modules/@ampproject/remapping` is absent at the root and `node_modules/@tailwindcss/node` is still a real `4.3.3` directory rather than a link to `.pnpm/@tailwindcss+node@4.1.11`. `next build` and `tsc` are green today, so the acceptance criterion (the remapping *error* is gone) holds, but the stray copy is the latent mechanism described in `tasks/issue-74-research.md` F3 and will resurface for any resolver that starts from the root path.

## Notes

- **Artifact unchanged.** No implementation file was edited during this pass; the only write is this report.
- **Ticket-level environment claims are not doc-verifiable here.** `ERR_PNPM_PACKAGE_MANAGER_REMOVE_MODULES_DIR`, "empty `@clerk/*` directories", and the dev server on port 3000 are runtime/process facts, not documentation claims; they belong to the `validate` node's evidence, which reports `npm test` 527+41 green, `tsc` 0, `next build` 0, eslint 0 errors.
- **Working-tree state at review:** `git status` shows `M ` (staged) only `app/owner/business/[id]/photos-panel.tsx`; the five user-edited files (`menu-panel-groups.tsx`, `menu-panel-item-editor.tsx`, `menu-panel.tsx`, `ordering-panel-sections.tsx`, `screens/SPEC.md`) remain ` M` — untouched by this change, matching the acceptance criterion.
- **No stale references remain:** a content search of `app/**` for `photoUploads` / `generateUploadUrl` returns nothing; the only `useMutation` hits are unrelated (`app/owner/create-business-form.tsx`).
- **Version currency not assessed in depth:** next 16.3.5 (latest 16.4.2), convex 1.46.0 (latest 1.47.0) and @clerk/nextjs 7.9.15 (latest 7.9.17) trail by patch/minor releases. No release note was found that supersedes any usage in this change (the Convex releases page carried no 1.47.0 entry at review time), so these are recorded as trailing versions rather than VERSION-GAP findings — per the skill's rule that a patch gap with no documented usage change is not a finding.
- **`'use client'` boundary is narrow by design:** the panel is a Client Component entry point; its props (`businessId`, `photos`, callbacks) are serializable, matching the `use client` serializability requirement.
- **Doc conflict check:** none. Clerk and Convex agree on the `convex` JWT template name (`applicationID: "convex"` / `getToken({ template: "convex" })`), and both agree that bearer-token HTTP calls need no cookie credentials.
