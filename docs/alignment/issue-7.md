# Alignment Report — B7: Photos / media via Convex file storage (issue #7)

> Mandatory output shape for the alignment skill. Fill every section. Delete nothing; write "none" where empty.
> Write to `docs/alignment/<slug>.md`.

## Scope

- **Artifact type:** code
- **Artifact location:** staged diff on `fix/issue-7-b7-photos-media-via-convex-file-storage` (26 files):
  `convex/businesses/photoPolicy.ts` (new), `convex/businesses/photoStorage.ts` (new), `convex/businesses/photoUploads.ts` (new),
  `convex/businesses/mutations.ts`, `convex/businesses/queries.ts`, `convex/businessTypes.ts`, `convex/_generated/api.d.ts`,
  `app/owner/business/[id]/photos-panel.tsx` (new), `editor-section-body.tsx`, `editor-sections.tsx`, `editor-shell.tsx`,
  `editor-form.ts`, `editor-preview.tsx`, `preview-adapter.ts`, `editor-session-history.ts` (+ tests),
  `app/business/[id]/page.tsx`, `components/profile/BusinessProfile.tsx`, `components/profile/profile-types.ts`,
  `scripts/photo-policy.test.ts` (new), `scripts/field-policy.test.ts`, `scripts/owner-save-policy.test.ts`.
  Rendering path also includes `components/profile/ProfileHero.tsx` (unchanged file, now receives resolved URLs).
- **Reviewed:** 2026-10-18
- **Focus:** all libraries — Convex file storage + React client, React 19, Next.js 16 App Router, WCAG 2.2

## Stack detected

| Library / technology | Installed version | Source of truth (manifest) | Docs target |
|----------------------|-------------------|----------------------------|-------------|
| convex | 1.46.0 | `package.json` range `^1.31.2`; installed resolved by `pnpm list --depth 0` and `node_modules/convex/package.json` | latest stable (1.47.0) |
| next | 16.3.5 (pinned) | `package.json` exact `16.3.5`; `node_modules/next/package.json` | latest stable (16.4.2) |
| react | 19.3.0 | `package.json` range `^19.2.3`; `pnpm list --depth 0` | latest stable (19.3.1) |
| react-dom | 19.3.0 | `package.json` range `^19.2.3`; `pnpm list --depth 0` | latest stable (19.3.1) |
| typescript | 5.8.3 | `package.json` range `^5`; `pnpm list --depth 0` | latest stable |
| node | 24.18.0 | `engines.node >=22.6`; runtime `node -v` | — |
| WCAG | 2.2 (W3C Recommendation) | web standard, not a dependency | latest published guidance (updated 2026-08-10) |
| Convex React client (`convex/react`) | bundled with convex 1.46.0 | same package | latest stable |

## Sources consulted

| Source | URL | Covers version |
|--------|-----|----------------|
| Uploading and Storing Files | https://docs.convex.dev/file-storage/upload-files | latest |
| Serving Files | https://docs.convex.dev/file-storage/serve-files | latest |
| File Storage (security model) | https://docs.convex.dev/file-storage/overview | latest |
| Deleting Files | https://docs.convex.dev/file-storage/delete-files | latest |
| Accessing File Metadata | https://docs.convex.dev/file-storage/file-metadata | latest |
| Interface: StorageWriter | https://docs.convex.dev/api/interfaces/server.StorageWriter | latest |
| Interface: StorageReader | https://docs.convex.dev/api/interfaces/server.StorageReader | latest |
| Mutations (Transactions) | https://docs.convex.dev/functions/mutation-functions | latest |
| Error Handling | https://docs.convex.dev/functions/error-handling | latest |
| Application Errors | https://docs.convex.dev/functions/error-handling/application-errors | latest |
| Convex React client (Skipping queries) | https://docs.convex.dev/client/react | latest |
| Limits | https://docs.convex.dev/production/state/limits | latest |
| Next.js Image Component | https://nextjs.org/docs/app/api-reference/components/image | 16.x (lastUpdated 2026-09-28) |
| Next.js Image Optimization guide | https://nextjs.org/docs/app/getting-started/images | 16.x |
| Next.js `page.js` convention | https://nextjs.org/docs/app/api-reference/file-conventions/page | 16.x |
| WCAG 2.2 SC 2.5.7 Dragging Movements | https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html | WCAG 2.2 |
| WCAG 2.2 SC 1.1.1 Non-text Content | https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html | WCAG 2.2 |
| WCAG 2.2 SC 3.3.1 Error Identification | https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html | WCAG 2.2 |
| WCAG 2.2 SC 3.3.3 Error Suggestion | https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html | WCAG 2.2 |
| npm dist-tags — convex | https://registry.npmjs.org/-/package/convex/dist-tags | live registry |
| npm dist-tags — next | https://registry.npmjs.org/-/package/next/dist-tags | live registry |
| npm dist-tags — react | https://registry.npmjs.org/-/package/react/dist-tags | live registry |
| convex-js CHANGELOG (1.47.0) | https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md | 1.47.0 |

## Findings

| # | Label | Severity | Artifact location | Claim / usage | What the docs say | Source |
|---|-------|----------|-------------------|---------------|-------------------|--------|
| 1 | ALIGNED | — | `convex/businesses/photoUploads.ts:15-25`, `app/owner/business/[id]/photos-panel.tsx:170-194` | 3-step upload: mutation returns `generateUploadUrl()`, browser POSTs the file with `Content-Type`, response `{ storageId }` is read and appended to form state | Docs prescribe exactly these three requests, and show the same `fetch(postUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file })` shape | https://docs.convex.dev/file-storage/upload-files |
| 2 | ALIGNED | — | `photos-panel.tsx:171-177` | Upload URL is requested per file, immediately before the POST | "The upload URL expires in 1 hour and so should be fetched shortly before the upload is made." | https://docs.convex.dev/file-storage/upload-files |
| 3 | ALIGNED | — | `convex/businesses/photoUploads.ts:15-21` | Ownership + listing save-mode gate lives in the mutation that generates the upload URL | "In the first mutation that generates the upload URL you can control who can upload files to your Convex storage." | https://docs.convex.dev/file-storage/upload-files |
| 4 | ALIGNED | — | `convex/businesses/mutations.ts:141-175` | Storage id reaches the database only through the normal owner save mutation (`saveDraft`/`saveAndResubmit`) | Step 3 is "Save the storage ID into your data model via another mutation." | https://docs.convex.dev/file-storage/upload-files |
| 5 | ALIGNED | — | `convex/businessTypes.ts:54-58`, `convex/businesses/photoStorage.ts:44-49` | Storage ids validated as `v.id('_storage')` in the photo validator and the `photoUrls` query args | "Storage IDs correspond to documents in the `"_storage"` system table … so they can be validated using the `v.id("_storage")`." | https://docs.convex.dev/file-storage/delete-files |
| 6 | ALIGNED | — | `photoStorage.ts:143-154`, `131-135` | `getUrl` result is `string \| null`; `null` (file gone) is omitted so the renderer falls back to a placeholder | `getUrl` "Returns … A URL which fetches the file via an HTTP GET, or `null` if the file no longer exists." | https://docs.convex.dev/api/interfaces/server.StorageWriter |
| 7 | ALIGNED | — | `photoStorage.ts:10-16` (module comment), `queries.ts:74-77` | URLs are public bearer URLs with no time-based expiry; the only revocation is deleting the file | "anyone with the URL can access the file without another app-level authorization check. The only way to revoke a file URL is by deleting the file." / "If you need file URLs that automatically expire after some time, consider the Cloudflare R2 component." | https://docs.convex.dev/file-storage/overview |
| 8 | ALIGNED | — | `photoStorage.ts:82`, `131` | Attach-time size/type gate reads `ctx.db.system.get('_storage', storageId)` | Metadata is read "via `db.system.get` and `db.system.query`"; `storage.getMetadata()` is marked **Deprecated** in favour of `ctx.db.system.get("_storage", storageId)` | https://docs.convex.dev/file-storage/file-metadata · https://docs.convex.dev/api/interfaces/server.StorageReader |
| 9 | ALIGNED | — | `convex/businesses/photoPolicy.ts:40-58`, `photoStorage.ts:86-93` | A missing/empty `contentType` is a hard rejection, never a soft pass | "`contentType`: the `ContentType` of the file **if it was provided on upload**" — the field is optional | https://docs.convex.dev/file-storage/file-metadata |
| 10 | ALIGNED | — | `photoPolicy.ts:31`, `photoStorage.ts:12-14` | Convex imposes no per-file cap, so the 5 MiB limit is enforced at attach time from `_storage` metadata; `generateUploadUrl` accepts no constraints | "The file size is not limited, but upload POST request has a 2 minute timeout." / `generateUploadUrl(): Promise<string>` takes no parameters | https://docs.convex.dev/file-storage/upload-files · https://docs.convex.dev/api/interfaces/server.StorageWriter |
| 11 | ALIGNED | — | `mutations.ts:141-158`, `521-532`, `555-560` | Validation runs before `ctx.db.patch`; storage reconciliation runs after every database write, so a rolled-back commit cannot leave the row pointing at a deleted file | "All database writes get committed together. If the mutation writes some data to the database, but later throws an error, no data is actually written to the database." | https://docs.convex.dev/functions/mutation-functions |
| 12 | ALIGNED | — | `photoStorage.ts:70`, `74-80`, `photoUploads.ts:20-22` | Expected failures throw `ConvexError` (string payload), not generic `Error` | "Convex provides an error subclass, `ConvexError`, which can be used to carry information from the backend to the client"; "throwing an error will prevent the mutation transaction from committing" | https://docs.convex.dev/functions/error-handling/application-errors |
| 13 | ALIGNED | — | `photos-panel.tsx:151`, `153-156` | `useMutation(api.…)` and `useQuery(api.…)` from `convex/react`, args passed as the second hook argument | Documented hook usage: `useMutation(api.functions.x)`, `useQuery(api.functions.y, { a, b })` | https://docs.convex.dev/client/react |
| 14 | ALIGNED | — | `app/owner/business/[id]/editor-preview.tsx:57-66` | `useQuery(..., 'skip')` used instead of a conditional hook call | "`useQuery` can be 'disabled' by passing in `"skip"` instead of its arguments … When `"skip"` is used the `useQuery` doesn't talk to your backend at all and returns `undefined`." | https://docs.convex.dev/client/react |
| 15 | ALIGNED | — | `editor-preview.tsx:44-80` | The hook is called unconditionally at the top of `PreviewContent`; the early return happens after it | The docs' skip example exists precisely because "hooks cannot be placed inside conditionals or after early returns" | https://docs.convex.dev/client/react |
| 16 | ALIGNED | — | `app/business/[id]/page.tsx:56-70` | `BusinessPage` is an async Server Component awaiting `params: Promise<{ id: string }>` and passing `photoUrls` into the profile | "`params`: A promise that resolves to an object containing the dynamic route parameters" — `Promise<{ id: '…' }>` for `app/business/[id]/page.js` | https://nextjs.org/docs/app/api-reference/file-conventions/page |
| 17 | ALIGNED | — | `photos-panel.tsx:261-277`, `381-410` | Reordering is done with up/down buttons (no drag), focus is retained, and moves are announced | SC 2.5.7 requires a single-pointer alternative; the Understanding doc's own example is "A sortable list … provide adjacent controls for moving the element up or down in the list by simply tapping or clicking" | https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html |
| 18 | ALIGNED | — | `photos-panel.tsx:344-355` | Rejections are listed in text inside `role="alert"`, tied to the input via `aria-invalid` + `aria-describedby` | SC 3.3.1: "the item that is in error is identified and the error is described to the user in text"; errors "could also be listed in an alert" | https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html |
| 19 | ALIGNED | — | `photoPolicy.ts:44-56`, `92-97` | Messages name the allowed formats and the next action ("Choose a JPEG, PNG or WebP image.", "Remove one before adding another.") | SC 3.3.3: where corrections are known, "the suggestions are provided to the user" | https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html |
| 20 | ALIGNED | — | `components/profile/ProfileHero.tsx:59`, `photos-panel.tsx:100` | Every rendered gallery image carries an `alt` attribute (public gallery falls back to the business name) | SC 1.1.1 requires a text alternative for non-text content presented to the user; `alt` is a required `next/image` prop and "should be an empty string (`alt=""`)" only when the image is purely decorative | https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html · https://nextjs.org/docs/app/api-reference/components/image |
| 23 | DRIFT | Low | `components/profile/ProfileHero.tsx:57` (now fed live URLs by this change); `photos-panel.tsx:100` | Gallery images are plain `<img src={convexUrl}>`, bypassing the framework image component | Next.js documents `next/image` as the component that "extends the HTML `<img>` element for automatic image optimization" (size optimization, layout-shift prevention, lazy loading) and requires `remotePatterns` for absolute external URLs. A raw `<img>` is not forbidden, but it opts out of the documented path | https://nextjs.org/docs/app/getting-started/images · https://nextjs.org/docs/app/api-reference/components/image |
| 24 | VERSION-GAP | — | `package.json:48`, installed `node_modules/convex` | Convex usage (`generateUploadUrl`, `getUrl`, `delete`, `db.system.get`, `ConvexError`) | Installed **1.46.0**, latest stable **1.47.0**. The 1.47.0 changelog covers CLI/env/MCP/schema-staging and error-message fixes; it records no file-storage API change, so this gap does not affect the surface used here | https://registry.npmjs.org/-/package/convex/dist-tags · https://github.com/get-convex/convex-js/blob/main/CHANGELOG.md |
| 25 | VERSION-GAP | — | `package.json:51`, installed `node_modules/next` | App Router page + client components + `params` promise | Installed **16.3.5**, latest stable **16.4.2** (same major; the fetched Next 16 docs pages describe the APIs used) | https://registry.npmjs.org/-/package/next/dist-tags |
| 26 | VERSION-GAP | — | `package.json:53-54`, installed `node_modules/react` | React 19 hooks (`useId`, `useRef`, `useState`) and hook ordering | Installed **19.3.0**, latest stable **19.3.1** | https://registry.npmjs.org/-/package/react/dist-tags |
| 27 | UNVERIFIABLE | — | `photoStorage.ts:101-141` (rationale for deleting after the DB writes) | "`ctx.storage.delete` is not part of the database transaction" and therefore must run last | No official statement found. `mutation-functions` describes transactions only in terms of database reads/writes; `file-storage/*`, `error-handling`, `database/writing-data` and `understanding/overview` never say whether storage mutations roll back. Searched: the four file-storage pages, `functions/mutation-functions`, `functions/error-handling`, `database/writing-data`, `production/state/limits`, plus an Exa web search for "file storage delete rollback transaction". Only a community book (masteringconvex.com) asserts it is "not documented as part of the mutation transaction" — not authoritative. The code's delete-last ordering is the conservative choice under either semantics | — |
| 28 | UNVERIFIABLE | — | `photoStorage.ts:128-137`, `156-165` | Existence read + swallowed `ctx.storage.delete` failure is used because deleting a missing file must not fail a committed save | `StorageWriter.delete` documents only "Delete a file from Convex storage. Once a file is deleted, any URLs previously generated by `getUrl` will return 404s." It does not state the behaviour for a non-existent id (no-op vs throw). The defensive guard is safe but unverified | — |

Itemize every DRIFT and VERSION-GAP. ALIGNED items may be summarized by count.

## Summary

| Label | Count |
|-------|-------|
| ALIGNED | 20 |
| DRIFT | 1 |
| VERSION-GAP | 3 |
| UNVERIFIABLE | 2 |

**Top DRIFT findings:** 1. **Low** — gallery bypasses `next/image`.

## Recommendations (advisory)

1. **(Low, #23)** Either move the gallery to `next/image` (adding the Convex deployment host to `images.remotePatterns`), or state in the component why the raw `<img>` is deliberate (bearer URLs rotate on delete, no build-time dimensions).
2. **(Version gaps #24-#26)** Bump `convex` to 1.47.0, `next` to 16.4.2 and `react`/`react-dom` to 19.3.1 at the next dependency pass; none of the APIs used here changed.
3. **(#27, #28)** Keep the existence read and the swallowed delete. They are the safe behaviour under every reading of the undocumented semantics, and the orphan-on-failure trade-off is bounded by the 5 MiB cap.

## Notes

- **Source conflict (resolved):** `https://registry.npmjs.org/convex/latest` (and the equivalent `next`/`react` endpoints) returned stale snapshot payloads (convex 1.46.0, next 16.3.4, react 19.2.8) while the live `dist-tags` endpoints report convex 1.47.0, next 16.4.2, react 19.3.1 and `npm view <pkg> version` agrees with the dist-tags. The report uses the dist-tags values; the discrepancy is a caching artefact, not a real version conflict.
- **Manifest ranges vs installed:** `package.json` declares `convex ^1.31.2` and `react ^19.2.3`; the lockfile resolution is 1.46.0 / 19.3.0. `next` is pinned exactly at 16.3.5. Alignment used the installed versions, as required.
- **Transaction semantics:** the artifact's central safety argument depends on a behaviour Convex documents nowhere (#27). The code is written so that either semantics is safe (validate → write → delete), which is why this is UNVERIFIABLE rather than DRIFT.
- **Deprecations checked:** `ctx.storage.getMetadata()` is deprecated in favour of `ctx.db.system.get("_storage", id)`; the change uses the documented replacement. The deprecated `StorageId`/`FileStorageId`/`FileMetadata` types (deprecated in convex 1.42.0) are not imported anywhere in the diff.
- **Scope exclusions:** test files, `editor-form.ts` signature plumbing, `editor-session-history.ts` reset-field map and `_generated/api.d.ts` were read for context and classified only where they exercise a documented API.
- **Not edited:** no implementation file was modified by this alignment pass.
