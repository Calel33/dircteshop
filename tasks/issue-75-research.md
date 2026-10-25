# Research — Issue #75: Order protocol T3 — Pure commit policy + test matrix

> Researched 2026-10-20 against primary sources (nodejs.org, docs.convex.dev, rfc-editor.org) plus
> direct probes of the repo's installed runtime. Scope limited to the six pure functions, the 8×9
> matrix, and the `node --test` harness — no handler, schema, or UI research.
>
> **Task Contract** — TYPE: research · TARGET: issue #75 dependency surface · GOAL: remove every
> runtime/API unknown before implementation · DONE-WHEN: each claim cited or probed locally, risks
> named with mitigations.

---

## Summary

Everything issue #75 depends on is available and already proven in this repo. The installed Node is
**v24.18.0**, where TypeScript **type stripping is stable** (stable in v24.12.0) and `node --test`
**discovers `*.test.ts` natively**, so `scripts/order-commit-policy.test.ts` needs no new tooling —
`npm test`'s existing `"scripts/**/*.test.ts"` glob picks it up automatically. `globalThis.crypto.subtle`
exists in both Node (v15+, no flag since v19) and the **Convex default runtime** (Web Crypto APIs are
explicitly listed: `crypto`, `CryptoKey`, `SubtleCrypto`), which makes async SHA-256 the correct
portable hash. `Buffer` is **not** available in the Convex default runtime and `node:crypto` is not in
its supported-API list — both must be avoided. The only genuine hazards are (a) `engines: ">=22.6"`
understates the real floor for `.ts` test execution (>= 22.18), (b) DST fall-back produces a repeated
wall-clock hour that a pure wall-clock predicate cannot distinguish, and (c) type stripping forbids
`enum`/`namespace`-with-runtime-code/parameter properties.

---

## Environment facts (probed, not assumed)

| Fact | Evidence |
|---|---|
| Installed runtime | `node -v` → **v24.18.0**; V8 `13.6.233.17-node.50` |
| TypeScript compiler | `npx tsc -v` → **5.8.3** (matches Node's recommended ≥ 5.8 for type stripping) |
| `package.json` engines | `"node": ">=22.6"` — **stricter floor actually required, see W1** |
| Test script | `"test": "node scripts/verify-state-machine.ts && node --test \"app/**/*.test.ts\" \"lib/**/*.test.ts\" \"scripts/**/*.test.ts\" && vitest run"` |
| `globalThis.crypto` / `.subtle` in plain Node | `object` / `object`; SHA-256("abc") = `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` (FIPS 180-4 test vector ✔) |
| `crypto.subtle` **inside a `node --test` child process** | Probed with a temp `*.test.ts`: passed (test isolation is `'process'`, but each child is a normal Node process with the same globals) |
| Existing pattern works | `node --test scripts/order-policy.test.ts` → **27 pass / 0 fail** |
| `tsconfig.json` | `"module": "esnext"`, `"moduleResolution": "bundler"`, `"allowImportingTsExtensions": true`, `"isolatedModules": true`, **no** `erasableSyntaxOnly` |
| `convex.json` | **absent** → default `convex/` functions dir, no custom `node.nodeVersion` |
| `node:crypto` / `Buffer` already absent from `convex/**/*.ts` | `rg -n "node:crypto|Buffer\.|require\(" convex --glob "*.ts"` → no matches |
| No `convex/` file imports outside `convex/` today | `rg "from '\.\./\.\./" convex` → no matches |

---

## Detailed findings

### 1. `node --test` — official behavior (Node docs)

**Source**: [Test runner — nodejs.org/api/test.html](https://nodejs.org/api/test.html) (Stability 2 — Stable since v20.0.0)
**Authority**: primary Node.js API documentation.

Verbatim, the default discovery patterns:

> By default, Node.js will run all files matching these patterns:
> `**/*.test.{cjs,mjs,js}` `**/*-test.{cjs,mjs,js}` `**/*_test.{cjs,mjs,js}` `**/test-*.{cjs,mjs,js}` `**/test.{cjs,mjs,js}` `**/test/**/*.{cjs,mjs,js}`
>
> **Unless `--no-strip-types` is supplied**, the following additional patterns are also matched:
> `**/*.test.{cts,mts,ts}` `**/*-test.{cts,mts,ts}` `**/*_test.{cts,mts,ts}` `**/test-*.{cts,mts,ts}` `**/test.{cts,mts,ts}` `**/test/**/*.{cts,mts,ts}`

Also relevant:
- Explicit globs may be passed as trailing arguments **and must be quoted** — "Glob patterns follow the behavior of `glob(7)`. The glob patterns should be enclosed in double quotes on the command line to prevent shell expansion". The repo already quotes them; the Node learn page adds: "globs require node v21+, and the globs must themselves be wrapped in quotes".
- `isolation` defaults to `'process'` — each test file runs in its own child process.

**Consequence for #75**: `scripts/order-commit-policy.test.ts` is picked up by the existing
`"scripts/**/*.test.ts"` argument with zero `package.json` changes. No `tsx`, no `--experimental-*`.

### 2. Type stripping — official behavior and syntax limits

**Source**: [Modules: TypeScript — nodejs.org/api/typescript.html](https://nodejs.org/api/typescript.html) and [Running TypeScript Natively — nodejs.org/learn/typescript/run-natively](https://nodejs.org/learn/typescript/run-natively)

Version history quoted from the docs:

| Version | Change |
|---|---|
| v25.2.0, **v24.12.0** | **Type stripping is now stable** |
| v24.3.0, v22.18.0 | No longer emits an experimental warning |
| v23.6.0, **v22.18.0** | **Enabled by default** |
| v22.7.0 | Added `--experimental-transform-types` |

Critical restrictions (all quoted/paraphrased from the same page):
- "Node.js does not type check your code when it runs TypeScript files."
- "Node.js ignores `tsconfig.json` files" — so `paths` aliases, `target` down-levelling, and any
  tsconfig-dependent feature do not apply at runtime.
- Features that require code generation **error** with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`:
  **`enum` declarations**, **`namespace` containing runtime code**, **parameter properties**,
  **import aliases**, decorators.
- "the `type` keyword is necessary to correctly strip type imports … `import type { T } from './m.ts'`.
  Without the `type` keyword, Node.js will treat the import as a value import, which will result in a
  runtime error."
- `.tsx` is unsupported by the loader; Node refuses to type-strip inside `node_modules`.
- The built-in TypeScript parser **requires WebAssembly** (`ERR_WEBASSEMBLY_NOT_SUPPORTED` otherwise).

**Consequence for #75**: the module and test must use `import type` for every type-only import
(`OrderCustomizationGroup`, `BusinessHours`, `OrderDbStatus`), no `enum` for statuses/actions/codes
(use `as const` arrays + union types — which is exactly what `convex/orderPolicy.ts` already does),
and no parameter properties. The repo's existing `.ts` files demonstrate the compliant style.

### 3. Web Crypto in Node.js — available, no import needed

**Source**: [Web Crypto API — nodejs.org/docs/latest-v24.x/api/webcrypto.html](https://nodejs.org/docs/latest-v24.x/api/webcrypto.html), [Global objects — nodejs.org/api/globals.html](https://nodejs.org/api/globals.html)

- "Use `globalThis.crypto` or `require('node:crypto').webcrypto` to access this module."
- `Class: Crypto` — "Added in: v15.0.0"; history: **v23.0.0 No longer experimental**, v19.0.0 "No
  longer behind `--experimental-global-webcrypto` CLI flag".
- `crypto.subtle` — "Added in: v15.0.0".
- Caveat quoted: the global "is available only if the Node.js binary was compiled with including
  support for the `node:crypto` module" — true of official builds.

`SubtleCrypto.digest(algorithm, data)` returns a `Promise<ArrayBuffer>`; `"SHA-256"` is supported
([MDN: SubtleCrypto.digest()](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)).
Note the API is **not streaming** — the whole input is read into memory, which is fine for a
≤ 20-line basket + contact block.

### 4. Convex default runtime — Web Crypto yes, `node:crypto`/`Buffer` no

**Source**: [Runtimes — docs.convex.dev/functions/runtimes](https://docs.convex.dev/functions/runtimes)
**Authority**: official Convex platform documentation (the authority on what the deployed module may call).

Verbatim, the supported-API surface of the default runtime:

> **Web Crypto APIs** — `crypto` · `CryptoKey` · `SubtleCrypto`
>
> **Node APIs** — A few Node.js APIs are available in the default runtime. … `process.env` (see the
> Environment variables docs) · `AsyncLocalStorage` · `AsyncResource`

`node:crypto`, `Buffer`, `require`, and `fs` are **not** on that list. The runtime is described as
"a custom JavaScript runtime very similar to the Cloudflare Workers runtime with access to most web
standard globals". A real-world confirmation of the `Buffer` gap: [get-convex/r2 issue #62](https://github.com/get-convex/r2/issues/62)
— "Uncaught ReferenceError: **Buffer is not defined**" from an action without `"use node"`, with the
maintainer-diagnosed cause being exactly that the default V8 runtime has no global `Buffer`.

Consequences for #75:
- `crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))` is valid in **both** runtimes.
- `Buffer.from(digest).toString('hex')` is **invalid in Convex** — hex must be built from
  `new Uint8Array(digest)` with `toString(16).padStart(2, '0')` (the pattern Convex's own
  `get-convex/agent` uses in `src/client/files.ts`).
- `node:crypto` is only reachable in a `"use node"` action, which cannot host the queries/mutations
  that will call this module — so it is not an option.

Determinism constraint (same page): "Query and mutation functions are further restricted by the
runtime to be deterministic… `Date.now()` will return the same result for the entirety of your
function's execution" and `Math.random()` is seeded. Pure hashing/validation adds no determinism
risk; `createReference` must therefore keep taking randomness from `crypto.getRandomValues` or an
injected RNG, never from `Math.random()`.

### 5. Convex bundling/import boundaries

**Source**: [Bundling for Convex — docs.convex.dev/functions/bundling](https://docs.convex.dev/functions/bundling), [Runtimes](https://docs.convex.dev/functions/runtimes)

Verbatim:

> When you push code either via `npx convex dev` or `npx convex deploy`, the Convex CLI uses **esbuild
> to traverse your `convex/` folder and bundle your functions and all of their used dependencies** into
> a source code bundle.

> Every `.ts` and `.js` file in the convex directory is bundled either for the default Convex
> JavaScript runtime or Node.js, **along with any code it imports**.

> Files without the `"use node"` directive should not import any files with the `"use node"` directive.
> Files that contain no Convex functions, like a `convex/utils.ts` file, also need the "use node"
> directive if they use Node.js-specific libraries.

> Dynamic dependencies … These imports are not supported by the default Convex runtime and will throw
> an error at runtime.

Reading:
- A **pure module inside `convex/`** (`convex/orderCommitPolicy.ts`) importing another pure module
  inside `convex/` (`convex/orderPolicy.ts`, `convex/businesses/publicHours.ts`) is exactly the
  supported case. Nothing extra is needed — no `"use node"`, no config.
- Importing **from `scripts/`** would technically be followed by esbuild, but it is out of bounds:
  `scripts/` is dev-only tooling, the CLI only watches `convex/`, and it would drag test helpers into
  the deployment bundle. The plan correctly forbids it (D4/D5: caller-supplied `CatalogEntry`,
  structural type, no `_generated` value imports).
- The bundler's entry-point walk **skips filenames with multiple dots**, i.e. `*.test.ts` inside
  `convex/` is never deployed. `convex/orders.test.ts` (vitest) relies on this today. It is *not* a
  reason to put the new test in `convex/` — spec §7.3 names `scripts/order-commit-policy.test.ts`.
- Community corroboration that shared code should not leak Convex function modules into client code
  (a different problem, but the same boundary): Convex maintainer `erquhart` — "Best practice is to
  move any code that is shared between convex code an non-convex code outside of the convex
  directory" ([discord-questions.convex.dev/m/1399733535136284724](https://discord-questions.convex.dev/m/1399733535136284724)).

### 6. `Intl` / IANA zones / DST — what the existing evaluator does and what it cannot do

**Source**: repo `convex/businesses/publicHours.ts:51-74, 120-176` and `scripts/public-hours.test.ts:79-110`; probe output below.

The repo builds one `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short',
hour: '2-digit', minute: '2-digit' })` per zone and reads `formatToParts` — never `Date#getHours()`.
`openStatusAt` is **wall-clock only** (`{ weekday, minutes }`) and handles overnight carry-over by
also checking the previous day's wrapping periods.

Probe (America/New_York, `hourCycle: 'h23'`):

| Instant (UTC) | Local |
|---|---|
| `2026-03-08T06:30:00Z` | `Sun 01:30` (EST) |
| `2026-03-08T07:30:00Z` | `Sun 03:30` (EDT) ← spring-forward gap skips 02:00–02:59 |
| `2026-11-01T05:30:00Z` | `Sun 01:30` (EDT) |
| `2026-11-01T06:30:00Z` | `Sun 01:30` (EST) ← **the repeated hour** |

Existing repo DST pins (`scripts/public-hours.test.ts:93-101`) use exactly
`Date.UTC(2026, 2, 8, 6, 30)` → `{ weekday:0, minutes:90 }` and `Date.UTC(2026, 2, 8, 7, 30)` →
`{ weekday:0, minutes:210 }`. Reuse these instants for `isEffectiveOpen`; add the fall-back pair.

**Important caveat for the test matrix**: on fall-back both 01:30 EDT and 01:30 EST map to
`{ weekday: 0, minutes: 90 }`. A wall-clock predicate necessarily returns the **same** answer for both.
The test must assert that equality (documenting the limitation), not invent a distinction. Likewise a
period `02:00–03:00` is unreachable on spring-forward day, so a "closed at 02:30 local" assertion
cannot be written against a real instant — assert on the `BusinessClock` seam instead, or choose a
period that does not sit inside the gap.

### 7. Canonical JSON hashing — RFC 8785 status and whether it is the right reference

**Source**: [RFC 8785 — JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/info/rfc8785/), [IETF announcement](https://mailarchive.ietf.org/arch/msg/ietf-announce/T60l8KmmvpTom--50mnjcSj4FZk/)

- Published **June 2020**, **Category: Informational**, Independent Submission stream. Verbatim:
  "This document is not an Internet Standards Track specification; it is published for informational
  purposes." It is **not** a standard.
- What it prescribes: deterministic property sorting, the ECMAScript serialization of primitives,
  restriction to the I-JSON subset (rejects lone surrogates, requires finite numbers).
- Verbatim: "This specification defines how to create a canonical representation of JSON data by
  building on the strict serialization methods for JSON primitives defined by ECMAScript … and by
  using deterministic property sorting."

**Recommendation for `canonicalArgsHash`**: use JCS as a *reference for the rules* (recursive key
sort, no whitespace, normalized contact before hashing, stable line ordering), but **do not** take a
JCS dependency or claim conformance. The hash is private to `orderIdempotency.argsHash` and is only
ever compared against hashes produced by the same module on the same deployment — cross-system
interop is not a requirement, and JCS's number/surrogate edge cases cannot arise from the
validator-gated input (invoice-free integers, ≤ 500-char strings). Pin the canonical form in tests
instead of citing the RFC.

### 8. Error envelope — confirming the pure module's shape

**Source**: [Application Errors — docs.convex.dev/functions/error-handling/application-errors](https://docs.convex.dev/functions/error-handling/application-errors)

`ConvexError` carries `data` of any argument-compatible type; spec §6.5 already mandates
`throw new ConvexError({ code, message, actualSubtotal })`. That is fully supported. The pure module
must therefore export the **catalog only** (`ORDER_ERRORS: Record<code, { message, recovery }>` and
the code union) and never import `convex/values` — importing `ConvexError` would be a runtime
dependency, violating "no DB imports" and the spec's "pure module" constraint. The handler throws.

---

## Code examples (from primary sources)

**Hex from WebCrypto without `Buffer`** (portable to the Convex V8 runtime; pattern mirrors
`get-convex/agent`'s `src/client/files.ts`):

```ts
export async function sha256Hex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
```

**`node --test` conventions already in the repo** (`scripts/order-policy.test.ts:1-42`) — copy them
verbatim for the new file: shebang, header doc naming the spec section, `import assert from
'node:assert/strict'`, `import { test } from 'node:test'`, `.ts` import specifiers, and
"assert non-empty, don't pin wording" for messages the module owns.

**Wall-clock seam for DST tests** (`convex/businesses/publicHours.ts:62-74`):

```ts
const clock = businessClock(createBusinessFormatter('America/New_York'), Date.UTC(2026, 2, 8, 7, 30));
// => { weekday: 0, minutes: 210 }  (03:30 EDT; 02:xx does not exist that day)
```

---

## Warnings / risks for this ticket

| # | Warning | Why it matters | Mitigation |
|---|---|---|---|
| **W1** | `engines: ">=22.6"` understates the real floor. Type stripping is **default from v22.18.0**; on 22.6–22.17 `node --test "scripts/**/*.test.ts"` and `node scripts/verify-state-machine.ts` fail unless `--experimental-strip-types` is passed. | Pre-existing latent CI risk, not introduced by #75, but #75 adds more `.ts` tests to the same path. | Do not change `engines` in this ticket (out of scope). Record the discrepancy; if CI ever pins 22.6–22.17 it needs `NODE_OPTIONS=--experimental-strip-types` or a floor bump in a separate ticket. |
| **W2** | Type stripping rejects `enum`, runtime `namespace`, parameter properties, import aliases. `tsconfig.json` here has **no `erasableSyntaxOnly`**, so `tsc` would *accept* code that `node` rejects at test time. | A green `tsc --noEmit` is not proof the test file runs. | Use `as const` arrays + union types (already the repo style). Verify by actually running `node --test scripts/order-commit-policy.test.ts`. |
| **W3** | `import type` is mandatory. `import { OrderCustomizationGroup } from './orderPolicy.ts'` throws at runtime. | Easy silent break in a new file. | `verbatimModuleSyntax` is recommended by Node docs; at minimum use `import type` / inline `type` modifiers, as `scripts/order-policy.test.ts:29-35` does. |
| **W4** | `Buffer` is unavailable in the Convex default runtime, and `node:crypto` is not in its API list. | A `Buffer.from(...).toString('hex')` hash helper would pass every local `node --test` and crash in production. | Only `Uint8Array` + `TextEncoder`; add a grep gate (`node:crypto|Buffer\.|require\(`) to the verification step. |
| **W5** | `crypto.subtle.digest` is **async**; the module's hashing functions must be async. | A caller written as `const h = canonicalArgsHash(a)` silently gets a `Promise` — compare would always be truthy/undefined. | Type the return as `Promise<string>` and `await` in every test; assert `typeof result === 'string'` after await. |
| **W6** | Convex mutations are deterministic; `Date.now()` is frozen per execution and `Math.random()` is seeded. | Any time-based logic inside the pure module (e.g. reading `Date.now()` in `isEffectiveOpen`) would be untestable and would break the injected-`now` contract. | `isEffectiveOpen(business, now)` must take `now` as an argument — the plan already specifies this; no `Date.now()` inside the module. |
| **W7** | DST fall-back repeats a wall-clock hour; `openStatusAt` cannot distinguish the two 01:30s. | A test asserting "open before / closed after the fall-back" is unwritable and will fail or be a lie. | Assert the documented limitation (both instants → same clock) rather than a difference; test spring-forward via the gap instants already pinned in `scripts/public-hours.test.ts:93-101`. |
| **W8** | Node's glob quoting is load-bearing. Unquoted globs are expanded by the shell and "may first appear to be working but isn't". | On Windows `cmd.exe` an unquoted `**` is not expanded, so Node receives a literal and finds nothing. | Keep the existing double-quoted form in `package.json`; when running ad hoc, quote the pattern or pass an explicit path. |
| **W9** | `--test` defaults to `isolation: 'process'`. Each test file is a separate process; module-level state does not cross files. | Sharing a memoized formatter or RNG across test files will not work. | Keep per-file fixtures; no cross-file singletons. |
| **W10** | RFC 8785 is **Informational**, not a standard, and JCS's number/surrogate rules differ from naive `JSON.stringify` + sorted keys. | Claiming "RFC 8785 compliant" in a comment invites a conformance review the module will not pass. | Document the canonical form as module-private and pinned by tests; reference JCS only as design inspiration. |
| **W11** | `Intl` output can differ between Node's ICU and the Convex V8 ICU for exotic zones (protocol U9). | A DST test green in Node is not proof for the deployment. | Use only `America/New_York` + `Europe/London` (already exercised by `public-hours.test.ts`); re-prove at the handler layer in S1. |

---

## Gaps / conflicts

- **No official Convex statement forbids importing a file outside `convex/`.** The docs describe the
  bundle as "your `convex/` folder … and all of their used dependencies", which implies esbuild
  follows relative imports outward, but there is no page confirming watch/invalidations for such
  files. This is **not** a blocker for #75: the plan keeps every import inside `convex/` and forbids
  `scripts/` imports. Marked `UNVERIFIED` rather than asserted.
- **No published comparison of `crypto.subtle` throughput between Node and the Convex isolate.**
  Irrelevant at basket scale (≤ 20 lines, two hashes per request) but unmeasured.
- **Convex's exact ICU build/tzdata version is not documented.** The repo's own protocol doc already
  lists this as uncertainty U9; this research does not resolve it.
- **`node --test` on Node 22.6–22.17 with `.ts` inputs was inferred from the documented version
  history, not executed** (only v24.18.0 is installed here). The inference is direct from the
  "enabled by default in v22.18.0" row, but it is not a local probe.

---

## Additional resources

- [Test runner](https://nodejs.org/api/test.html) — discovery patterns, glob quoting, `isolation`, `testNamePatterns`.
- [Modules: TypeScript](https://nodejs.org/api/typescript.html) — type-stripping version history and the exact unsupported-syntax list.
- [Running TypeScript Natively](https://nodejs.org/learn/typescript/run-natively) — the v22.18 default-on statement.
- [Using Node.js's test runner](https://nodejs.org/learn/test-runner/using-test-runner) — "globs require node v21+ … must themselves be wrapped in quotes".
- [Web Crypto API (Node)](https://nodejs.org/docs/latest-v24.x/api/webcrypto.html) — `globalThis.crypto`, `subtle`.
- [Global objects: Crypto](https://nodejs.org/api/globals.html) — v19 flag removal, v23 stability.
- [Convex — Runtimes](https://docs.convex.dev/functions/runtimes) — Web Crypto list, Node-API list, determinism rules.
- [Convex — Bundling](https://docs.convex.dev/functions/bundling) — esbuild traversal, dynamic-import limits.
- [Convex — Application errors](https://docs.convex.dev/functions/error-handling/application-errors) — `ConvexError` data payload.
- [RFC 8785 (JCS)](https://www.rfc-editor.org/info/rfc8785/) — Informational, June 2020.
- [get-convex/r2 #62](https://github.com/get-convex/r2/issues/62) — `Buffer is not defined` in the default runtime.
- [MDN — SubtleCrypto.digest()](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest) — non-streaming, `Promise<ArrayBuffer>`.

---

## Mapping to the implementation plan (no changes required)

| Plan item | Research verdict |
|---|---|
| D1 protocol machine added to `convex/orderPolicy.ts`, re-exported | ✔ consistent with bundling rules; both files live in `convex/` |
| D2 `createReference` port + injectable RNG | ✔ `crypto.getRandomValues` is available in Convex; `Math.random()` is seeded and must not be used |
| D3 async SHA-256 via `globalThis.crypto.subtle` | ✔ **confirmed**: listed Web Crypto support in Convex + Node ≥ 15; `node:crypto`/`Buffer` correctly avoided |
| D4 structural `CatalogEntry` | ✔ avoids `_generated` value imports and keeps the module bundler-neutral |
| D5 canonicalization rules | ✔ scope to module-private canonical form; do not claim RFC 8785 conformance |
| D6 legacy frozen | ✔ nothing in the research suggests touching the legacy machine; `publicHours.ts` is already pure and type-only-imported |
| Test file `scripts/order-commit-policy.test.ts` | ✔ auto-discovered by the existing quoted `"scripts/**/*.test.ts"` glob on Node ≥ 22.18 |

---

## WORK SUMMARY

| TYPE | TARGET | GOAL | DONE-WHEN | STATUS | EVIDENCE |
|---|---|---|---|---|---|
| Research | Issue #75 dependency surface (Node `--test`, type stripping, WebCrypto, Convex runtime, Intl/DST, JCS) | Remove every runtime/API unknown before implementation | Each claim cited to a primary source or probed locally | **DONE** | 6 primary-source pages cited; 4 local probes (node -v, crypto.subtle digest vector, `node --test` 27 pass, DST formatter output); warnings W1–W11 |

**COMPLIANCE** — P0: task contract formed; context mapped with graft before source reads; no guessing
(every gap labelled); no deletions; no production files touched; docs treated as source of truth.
P1: findings cross-referenced across ≥ 2 sources per topic where available.

**Skills activated**: `firecrawl` (research tooling, with Exa MCP as the actual transport).
**Docs activated**: `docs/order-commitment-protocol.md` §6.1, §6.2.4–§6.2.6, §6.5, §7.2, §7.3;
`screens/SPEC.md` ordering sections; `tasks/issue-75-plan.md`; `convex/AGENTS.md`.
**Tools used**: graft (`repo_map`, `find_code` ×4), Exa MCP (`web_search_exa` ×9), Read, Grep, Glob,
Shell (node probes, `node --test`).
**Violations**: none.

🌱 graft saved ~489k tokens this turn (sum of the reported per-call savings).
