# Issue #76 — Research: Convex schema expand, batched backfill, and CSPRNG in the mutation runtime

**Ticket:** #76 — Order protocol T2, schema expand + legacy backfill (expand step)
**Plan read:** `tasks/issue-76-plan.md`
**Normative source re-read:** `docs/order-commitment-protocol.md` §6.2.2 (L907–1036), §6.2.4 (L1046), §6.2.6 (L1089), §6.2.9 (L1113–1137)
**Date:** 2026-10-20
**Scope:** research only. No implementation files were created or modified.

---

## TL;DR — the five things that change the plan

| # | Finding | Impact on #76 |
|---|---------|---------------|
| 1 | **`crypto.getRandomValues` IS available and allowed inside Convex queries AND mutations.** It is backed by Convex's per-execution seeded ChaCha12 RNG (`provider.rng()`), not the OS CSPRNG. It does **not** throw. | The plan's Task 2 gotcha ("if the Convex mutation runtime lacks `crypto.getRandomValues`, fall back to minting tokens in a `node`-side caller") is **resolved: no fallback needed**. Token minting stays inside `backfillBatch`, as designed. Do not move it to an action. |
| 2 | `crypto.subtle.generateKey` and randomized `crypto.subtle.sign` **do** throw in queries/mutations: `NoCryptoRngInQueriesOrMutations` — "Can't use cryptographic randomness in queries and mutations. Please consider using an action." | Do not use `crypto.subtle` key generation anywhere in the backfill. `crypto.subtle.digest` (SHA-256) is fine and is the right primitive for the later `argsHash` / `contactHash` work. |
| 3 | **Only ONE `.paginate()` call is allowed per function execution** (query *or* mutation). Two throws in production. | `backfillStatus` as planned (`{ordersCount, orderAccessCount}` from one function) is **not implementable as a single call**. Split it per table/per page, or drop exact counts in favour of a driver-side sum. `backfillBatch`'s single page read is correct. |
| 4 | `undefined` is not a Convex value; `{ a: undefined }` in an insert is stored as "field absent", but in `ctx.db.patch` it **removes the field**. | "unitPrice/lineTotal/spread undefined" must be implemented by *omitting the keys*, never by writing `undefined`/`null` over an existing value. `v.optional(v.number())` does not accept `null`. |
| 5 | Adding an index to a large existing table blocks deploy while it backfills; `{ fields: [...], staged: true }` defers it. | `orders.byBusinessIdStatus` is the only risky index. Decide: plain index (fine on small data) or staged (two deploys, cannot be queried until unstaged). |

Everything else in the plan is confirmed API-correct.

---

## Environment / versions actually in the tree

| Package | Declared | Installed |
|---|---|---|
| `convex` | `^1.31.2` (`package.json`) | **1.46.0** (`node_modules/convex/package.json`) |
| `convex-test` | `^0.0.62` | 0.0.62 |
| `@edge-runtime/vm` | `^5.0.0` | 5.0.0 |
| `vitest` | `^4.1.12` | 4.1.12 |
| `typescript` | `^5` | 5.x |

- `convex/_generated/ai/guidelines.md` opens with: **"These guidelines target Convex `^1.44.0`."** The installed 1.46.0 satisfies that; the declared `^1.31.2` is stale metadata, not the runtime in use.
- `vitest.config.ts` sets `environment: 'edge-runtime'` and `include: ['convex/**/*.test.ts']` — matching `guidelines.md` testing section.
- The **backend runtime** is server-side and is not the npm version. Source-level findings below are read from `convex/convex-backend` `main` (last-modified 2026-09-25 / 2026-10-15 for the files cited). Treat them as current-platform behaviour, not as a 1.46.0-specific guarantee.

---

## Q1 — Schema API: optional fields, arrays of objects, validators, indexes

**Sources**
- https://docs.convex.dev/database/schemas (fetched as `.md`)
- https://docs.convex.dev/database/reading-data/indexes
- https://docs.convex.dev/production/state/limits#database

**Confirmed facts**

1. Schema lives in `convex/schema.ts`; `defineSchema` / `defineTable` come from `convex/server`, validators from `convex/values`.
2. `_id` (`v.id(tableName)`) and `_creationTime` (`v.number()`) are added automatically — do **not** declare them.
3. Optional fields: `v.optional(...)`, which maps to TypeScript `?`.
   > "You can describe optional fields by wrapping their type with `v.optional(...)` … This corresponds to marking fields as optional with `?` in TypeScript."
4. Unions/literals: `v.union(v.literal('snapshot'), v.literal('legacyUnknown'))`. Widening `status` to 8 literals is exactly the documented `v.union` + `v.literal` shape.
5. Arrays of objects: `v.array(v.object({...}))`; nested optionals inside the object are allowed. `items[]` with `unitPrice: v.optional(v.number())` is valid.
6. Indexes: `.index('name', ['fieldA', 'fieldB'])`; nested fields use dot paths (`'verification.isVerified'` — already used in this repo). Index columns must be stepped through in declared order in `withIndex`.
7. **Index naming guidance (repo AI guidelines, not a hard rule):** "Include every index field in its name, such as `by_field1_and_field2`". The protocol mandates camelCase names (`byBusinessIdStatus`, `byBusinessIdReference`). **Keep the protocol names** — the names are normative for #76 and T3; note the stylistic deviation in the PR description rather than renaming.
8. Hard platform limits: 32 indexes per table, 16 fields per index, 64-char index names, 1 MiB per document, 1024 top-level fields, nesting depth 16 for documents, 8192 array elements per array.

**Staged indexes (important for `orders.byBusinessIdStatus`)**

> "By default, index creation happens synchronously when you deploy code. For large tables, the process of backfilling the index … can be slow. Staged indexes are a way to create an index on a large table asynchronously without blocking deploy."

```ts
orders: defineTable({ /* ... */ })
  .index('byBusinessId', ['businessId'])
  // deferred: two-deploy path, cannot be queried until `staged` is removed
  .index('byBusinessIdStatus', { fields: ['businessId', 'status'], staged: true }),
```

`guidelines.md` line 48 repeats this as a project rule: *"An index added to a large existing table can block deploy during backfill. Use `.index("by_field", { fields: ["field"], staged: true })`; remove `staged` in a later deploy before querying it."*

**Recommendation for #76:** the plan does not query `byBusinessIdStatus` in T2, so either form works. On a dev/seed-sized `orders` table the plain form is simplest and keeps the schema verbatim vs §6.2.2. If the deployment has a large `orders` table, use `staged: true` and note the second deploy; **T3 must not query it until it is unstaged**.

---

## Q2 — Pagination, cursors, and batched migration idioms

**Sources**
- https://docs.convex.dev/database/pagination
- https://docs.convex.dev/database/writing-data#write-performance-and-limits
- https://github.com/convex/migrations (official `@convex-dev/migrations` component README)
- `node_modules/convex-test` CHANGELOG behaviour (0.0.54) + runtime error text

**Pagination contract**

- Cursor-based: pass `paginationOpts` (`{ numItems, cursor }`); result is
  `{ page, isDone, continueCursor, splitCursor?, pageStatus? }`.
- Validate with `paginationOptsValidator` from `convex/server`; pass it through unchanged. `cursor` is **required and nullable** (`string | null`).
- `maximumRowsRead` / `maximumBytesRead` bound a page; exceeding them returns `splitCursor` + `pageStatus` instead of a full page.
- The default order is ascending `_creationTime`; `.order('asc' | 'desc')` selects direction. Index reads append `_creationTime` as the tie-breaker.

**The single-pagination rule (critical)**

`convex-test` 0.0.54 changelog:

> "Enforce the Convex runtime rule that a single function execution may only run one paginated query (`.paginate()`). Calling it more than once now throws, catching a production-only failure…"

The production error is:

> `This query or mutation function ran multiple paginated queries. Convex only supports a single paginated query in each function.`

Note the wording: **"query or mutation"** — pagination *is* allowed inside a mutation, once. `convex-test` 0.0.62 enforces this (`Only a single paginated query ('.paginate()') is allowed per …`).

**Consequences for #76**

- `backfillBatch` (one page of `orders`, one `.paginate()`) is correct.
- The existence check per order must be an index lookup (`.withIndex('byOrderId', …).first()`), **not** a second paginated query.
- `backfillStatus({ordersCount, orderAccessCount})` in **one** function call is impossible as written. Two viable shapes:
  1. `backfillStatus({ table: v.union(v.literal('orders'), v.literal('orderAccess')), cursor })` → one page per call; the `npx convex run` driver calls it twice per page and sums. Compliant, but N calls.
  2. Keep exact equality for the *final* gate only: run the driver to exhaustion, then verify `orders` and `orderAccess` with the dashboard/`npx convex data` counts or a single summed pass.
- `.collect().length` is explicitly forbidden by `convex/_generated/ai/guidelines.md` ("Never use `.collect().length`; Convex has no built-in count operator"). A migration count gate therefore cannot be a one-liner — say so in the migration doc instead of quietly violating the rule.

**Checkpointing**

- Use `continueCursor` as the checkpoint (opaque, stable, tie-safe). A `_creationTime` cursor is workable here because `_creationTime` is assigned from **function start time** and is immutable, so patching `orders.items[]` does not reorder the table — but pagination cursors are the documented mechanism and avoid tie handling.
- The backfill patches each `orders` row it reads. That is safe for a `by_creation_time` scan (non-indexed fields only), but re-running a cursor after such patches can still surface `InvalidCursor` in edge cases (cf. convex-backend issue #505). The idempotent re-run + "resume from last cursor, restart from null if the cursor is rejected" design covers it.

**Official batched-migration idiom (`@convex-dev/migrations`, not installed here)**

The README describes exactly the expand/contract loop and the batch semantics worth copying:

> 1. Modify your schema to allow old and new values. Typically this is adding a new optional field or marking a field as optional so it can be deleted. As part of this, update your code to handle both versions.
> 2. Define a migration to change the data to the new schema.
> 3. Push the migration and schema changes.
> 4. Run the migration(s) to completion.
> 5. Modify your schema and code to assume the new value.

- Default batch size **100**, processed **serially**, resumable, state-tracked, with `dryRun`.
- `batchSize` is configurable *specifically* to stay under transaction limits and avoid OCC conflicts on hot tables.
- `parallelize: true` exists but is unsafe when callbacks read/write the same document.

The plan's hand-rolled ~50-row, cursor-checkpointed, dry-run-able, idempotent mutation is a faithful (and dependency-free) version of this. `@convex-dev/migrations` is **not** in `package.json` and `convex/migrations/` does not exist yet — do not add a component in T2.

**Scheduler-continuation alternative (docs pattern)**

For long work, the docs recommend processing a bounded batch and self-scheduling:

```ts
await ctx.scheduler.runAfter(0, internal.clearTasks.clearTasks);
break;
```

The plan's explicit `npx convex run` driver loop with `remaining` is acceptable and easier to observe; note in the migration doc that the run must be repeated until `remaining === 0`.

---

## Q3 — CSPRNG inside a Convex mutation (the headline finding)

**Sources (primary, source-level)**
- https://docs.convex.dev/functions/runtimes#web-crypto-apis
- https://docs.convex.dev/functions/runtimes#using-randomness-and-time-in-queries-and-mutations
- https://github.com/convex/convex-backend/blob/main/npm-packages/udf-runtime/src/00_crypto.ts
- https://github.com/convex/convex-backend/blob/main/crates/isolate/src/ops/crypto.rs
- https://github.com/convex/convex-backend/blob/c433164a780a5b529310c089650f41c10566d479/crates/isolate/src/ops/crypto.rs (pre-refactor, same behaviour)
- https://github.com/convex/convex-backend/blob/main/crates/isolate/src/environment/udf/mod.rs
- https://github.com/convex/convex-backend/blob/main/crates/isolate/src/ops/subtle_crypto/mod.rs
- https://github.com/convex/convex-backend/blob/main/crates/function_runner/src/server.rs
- https://github.com/convex/convex-backend/blob/main/crates/udf/src/udf_outcome.rs

### 3.1 It is available and it does not throw

The runtime docs list Web Crypto as supported (`crypto`, `CryptoKey`, `SubtleCrypto`). The JS shim implements `getRandomValues` by calling an op:

```ts
// npm-packages/udf-runtime/src/00_crypto.ts
getRandomValues(typedArray: ArrayBufferView) {
  // ... type checks ...
  const randomValues = performOp("crypto/getRandomValues", typedArray.byteLength);
  typedArray.set(randomValues);
  return typedArray;
}
```

The Rust op uses the **seeded** RNG, not the crypto-only RNG:

```rust
// crates/isolate/src/ops/crypto.rs  (current main AND the 2026-08-31 parent)
#[convex_macro::op]
pub fn op_crypto_get_random_values<P: OpProvider>(
    provider: &mut P,
    byte_length: u32,
) -> anyhow::Result<ByteBuf> {
    let rng = provider.rng()?;            // <-- seeded ChaCha12, NOT crypto_rng()
    let max_byte_length = 65536;
    anyhow::ensure!(byte_length <= max_byte_length, /* TypeError */);
    let mut bytes = vec![0u8; byte_length];
    rng.fill(&mut bytes[..]);
    Ok(ByteBuf::from(bytes))
}
```

And in the UDF (query/mutation) environment:

```rust
// crates/isolate/src/environment/udf/mod.rs
fn rng(&mut self) -> anyhow::Result<&mut ChaCha12Rng> {
    self.phase.rng()                       // allowed
}

fn crypto_rng(&mut self) -> anyhow::Result<CryptoRng> {
    anyhow::bail!(not_allowed_in_udf("CryptoRng", "cryptographic randomness"))
}
```

`not_allowed_in_udf` produces error code `NoCryptoRngInQueriesOrMutations` and the message:

> "Can't use cryptographic randomness in queries and mutations. Please consider using an action. See https://docs.convex.dev/functions/actions for more details."

**So the bail is on `crypto_rng()`, which `getRandomValues` does not use.** `crypto.randomUUID` also uses `provider.rng()` and works. The blocked callers are `crypto.subtle.generateKey` and the randomized `crypto.subtle.sign` path (`provider.crypto_rng()?` in `ops/subtle_crypto/mod.rs`). `crypto.subtle.digest` needs no RNG and works.

### 3.2 How entropy and determinism coexist

- Each execution receives a **32-byte `rng_seed`** (`DatabaseUdfArgs { rng_seed: [u8; 32] }`), generated by the runtime (`crates/function_runner/src/server.rs`: `let rng_seed = self.rt.rng().random();`).
- The seed is used to build a **ChaCha12** stream (`ChaCha12Rng::from_seed`). 32 bytes of seeded keystream = the 256 bits §6.2.4 (`TOKEN_BYTES = 32`) asks for.
- The outcome records `observed_rng` and the seed (`crates/udf/src/udf_outcome.rs`), which is how Convex replays a retried mutation deterministically: **the same execution re-derives the same bytes, so a retried batch mints the same token**. That is desirable for idempotency — a retry cannot produce a second, different access token.
- Import-time (module scope) RNG is seeded at deploy time and frozen. **Generate inside the handler, never at module top level.**
- Max **65,536 bytes per `getRandomValues` call**; 32 is trivially inside it. 50 orders × 32 bytes per batch is one stream, no reuse across seeds.

### 3.3 What this means for `createAccessToken()`

The protocol's literal requirement is satisfiable as written:

```ts
// convex/orderAccess.ts  (shape only — not added by this research task)
const TOKEN_BYTES = 32;

export function createAccessToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);            // works in mutations
  // base64url: btoa is a supported encoding global; no Buffer in the default runtime
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
```

Notes/caveats to carry into the implementation:
- `btoa` **is** listed under "Encoding APIs" in the runtime docs; `Buffer` is not available in the default runtime.
- The token must stay 43 chars for 32 bytes base64url (no padding). A test should pin length/charset (INV-05).
- **Do not** use `crypto.subtle.generateKey` to get randomness — it throws `NoCryptoRngInQueriesOrMutations` in a mutation.
- **Do not** use `Math.random()`: docs call it a *"seeded strong pseudo-random number generator"*, but the protocol explicitly forbids it, and it shares the same stream semantics without the crypto framing. The protocol's literal call is available, so there is no reason to deviate.

### 3.4 Testing caveat (do not be fooled by green tests)

`convex-test` runs under `@edge-runtime/vm`, which forwards the **host** `crypto` global (`node_modules/@edge-runtime/vm/dist/edge-vm.js` passes `crypto`/`Crypto`/`SubtleCrypto` through). `convex-test`'s transaction-global blocklist only forbids `fetch`, `setTimeout`/`clearTimeout`, `setInterval`/`clearInterval` (`transactionGlobalOverrides()`), **not** `crypto`.

Therefore:
- A unit test that calls `crypto.getRandomValues` will pass under vitest with the host's OS CSPRNG — it proves the *code shape*, not the Convex seeded behaviour.
- Conversely, any future use of `crypto.subtle.generateKey` would also pass in tests but **fail in production**. Add a code-review/`grep` guard for `crypto.subtle.generateKey` and `crypto.subtle.sign` in `convex/` rather than relying on a test.
- Useful tests that *do* hold: 43-char base64url charset, uniqueness within a batch, 6-char reference alphabet, collision-retry path.

---

## Q4 — Internal functions for the backfill driver

**Source:** https://docs.convex.dev/functions/internal-functions

- Define with `internalQuery` / `internalMutation` / `internalAction` from `./_generated/server`; reference via `internal` from `./_generated/api`.
- "Internal functions can only be called by other functions and cannot be called directly from a Convex client." This is exactly the requirement for `backfillBatch` and `backfillStatus`.
- **They can still be run by the operator**: the docs list "Running them from the CLI" and the dashboard as supported callers. `npx convex run migrations/backfillOrderAccess:backfillBatch '{"limit":50}'` works (CLI run accepts JSON args and `--prod`).
- `convex/AGENTS.md` already codifies the repo convention: *"Seeds are `internalMutation` so they are not client callable; run them via `npx convex run`."* The backfill follows the same convention.
- `guidelines.md`: "Never register a function through `api` or `internal`, and always include argument validators for every function kind."

---

## Q5 — Transaction / mutation limits for ~50-row batches

**Source:** https://docs.convex.dev/production/state/limits#transactions

| Limit | Value |
|---|---|
| Data read | 16 MiB |
| Data written | 16 MiB |
| Documents scanned | 32,000 |
| Index ranges read | 4,096 (`db.get` + `db.query` calls) |
| Documents written | 16,000 |
| Function return value | 16 MiB |
| Query/mutation execution time (user code) | 1 second |
| Mutation write throughput (concurrent, S16) | 4 MiB |

Per batch of 50 orders, the backfill does roughly: 1 paginated read (50 docs) + 50 `byOrderId` lookups + up to 50 reference lookups + 50 `orderAccess` inserts + 50 `orders` patches ≈ **100 writes, ~150 reads** — three orders of magnitude under the limits. The 50-row cap is conservative and safe.

**Bound the page explicitly.** `paginationOpts: { numItems: 50, cursor }` plus optional `maximumRowsRead` / `maximumBytesRead` is the documented way to keep a page bounded when documents are large.

**Multi-table atomicity:** an internal mutation's reads and writes are one transaction; all 50 `orderAccess` inserts and 50 `orders` patches commit together. That is the property the plan wants ("token/reference generation must run inside the mutation"). If the batch throws, nothing is written and the cursor stays put — rerun is safe because the skip-check is by `byOrderId`.

---

## Q6 — Rules in `convex/_generated/ai/guidelines.md` that constrain this work

Read in full (286 lines). The binding ones for #76:

| Rule | Consequence |
|---|---|
| "These guidelines target Convex `^1.44.0`." | Installed 1.46.0 is in range. |
| Validators: `v.array`, `v.union`, `v.object`, `v.record`; `v.object` supports `.pick/.omit/.partial/.extend`. | §6.2.2 shapes are expressible verbatim. |
| "`undefined` is not a Convex value and is returned to clients as `null`; use `null`." | **Do not write `unitPrice: undefined`.** Omit the key. Never `null` in a `v.optional(v.number())` field. |
| "Register private functions with `internalQuery/internalMutation/internalAction` … A function used only by your own code … is internal." | Backfill and status are `internal*`. |
| "Validate `paginationOpts` with `paginationOptsValidator` … pass `args.paginationOpts` unchanged." | If a cursor arg is exposed, validate it; do not hand-roll `{numItems, cursor}` reconstruction. |
| "A paginated query returns `page`, `isDone`, `continueCursor` …" | Cursor checkpoint contract. |
| "Include every index field in its name…" | Advisory; protocol names win, note the deviation. |
| "Do not put an unbounded list in one document." | `items[]` is bounded by `MAX_LINES = 20`; acceptable. |
| "An index added to a large existing table can block deploy… use `staged: true`." | See Q1 decision for `byBusinessIdStatus`. |
| "Never use `.collect().length`; Convex has no built-in count operator." | The count gate cannot be a `.collect().length` one-liner (see Q2). |
| "Do not read the wall clock in a query… `Date.now()` is fine in mutations and actions." | `createdAt` in the backfill mutation is fine; it is frozen for the whole execution, so a batch's rows share one timestamp — irrelevant for `orderAccess.createdAt`. |
| "For large mutation work, process a batch and schedule a continuation…" | Alternative to the CLI loop. |
| "Use `.unique()` for one document; it throws when multiple match." | Existence check should be `.first()` (skip is a boolean), or `.unique()` only where uniqueness is guaranteed. |
| "Use `ctx.db.replace` … `ctx.db.patch` for a shallow merge. Both throw when the document does not exist." | Backfill patches existing orders only. |
| "Test files belong under `convex/`… `convexTest(schema, modules)`… `environment: 'edge-runtime'`." | Matches the existing `convex/orders.test.ts` setup. |

---

## Q7 — Official expand/contract guidance for additive schema changes

**Sources**
- https://docs.convex.dev/database/schemas#schema-validation
- https://docs.convex.dev/database/schemas#staged-validators
- https://github.com/convex/migrations (README "Typical steps")
- https://docs.convex.dev/database/types#working-with-undefined

1. **Additive-first is the documented norm.** The migrations component's step 1 is literally "modify your schema to allow old and new values — typically adding a new optional field or marking a field optional"; step 5 is "modify your schema and code to assume the new value", and pushing that only succeeds once every document matches. This is precisely §6.2.9 steps 1–6.
2. **Schema push validates existing documents.** "The first push after a schema is added or modified will validate that all existing documents match the schema. If there are documents that fail validation, the push will fail." Because every new `orders` field is `v.optional` and `menuItemId`/`selections` become optional, legacy rows remain valid — that is the whole reason the expand deploy is safe.
3. **Tightening later has a dedicated tool.** `.staged({...})` runs the revalidation in the background while the current validator stays enforced, then you promote. Not needed in T2, but it is the answer for the eventual contract step (making `items[]` required, dropping legacy fields).
4. **`undefined` semantics matter for "no fabricated prices".** In stored documents `{a: undefined}` collapses to `{}`; the only difference is `ctx.db.patch`, where `{a: undefined}` *removes* field `a`. So:
   - backfilled line = `{ menuItemId, name, quantity, selections }` with `unitPrice`/`lineTotal` **absent**;
   - `subtotal` **absent** on the order;
   - never `patch({ unitPrice: undefined })` on a row that might later hold a price under a different path.
5. **No destructive step exists in T2**, which matches the plan's rollback note: additive schema remains, nothing is dropped, nothing to undo.

---

## Code examples to reuse

### Additive `orders` expand (exact §6.2.2 shape, trimmed)

```ts
orders: defineTable({
  businessId: v.id('businesses'),

  items: v.optional(
    v.array(
      v.object({
        menuItemId: v.id('menuItems'),
        name: v.string(),
        unitPrice: v.optional(v.number()),      // integer cents; absent = unpriced
        quantity: v.number(),
        selections: v.array(
          v.object({
            optionName: v.string(),
            choiceName: v.string(),
            priceAdjustment: v.optional(v.number()),
          })
        ),
        lineTotal: v.optional(v.number()),
      })
    )
  ),
  subtotal: v.optional(v.number()),
  pricingSource: v.optional(
    v.union(v.literal('snapshot'), v.literal('legacyUnknown'))
  ),

  customerName: v.string(),
  contactPhone: v.optional(v.string()),
  contactEmail: v.optional(v.string()),
  note: v.optional(v.string()),

  status: v.union(
    v.literal('new'), v.literal('accepted'), v.literal('ready'),
    v.literal('completed'), v.literal('declined'), v.literal('cancelled'),
    v.literal('expired'), v.literal('no_show')
  ),
  statusReason: v.optional(v.string()),
  statusUpdatedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  customerUserId: v.optional(v.id('users')),

  createdAt: v.number(),

  menuItemId: v.optional(v.id('menuItems')),
  selections: v.optional(
    v.array(v.object({ optionName: v.string(), choiceName: v.string() }))
  ),
})
  .index('byBusinessId', ['businessId'])
  .index('byBusinessIdStatus', ['businessId', 'status']),
```

### One-page backfill read (single `.paginate()` per invocation)

```ts
const { page, isDone, continueCursor } = await ctx.db
  .query('orders')
  .order('asc')                        // _creationTime asc = default
  .paginate({ numItems: limit, cursor: args.cursor ?? null });
```

`limit` must be validated (`v.optional(v.number())` + clamp, e.g. `Math.min(args.limit ?? 50, 50)`) — args come from the CLI, not a client, but the guideline to validate every function's args still applies.

### Existence check (never a second `.paginate()`)

```ts
const existing = await ctx.db
  .query('orderAccess')
  .withIndex('byOrderId', (q) => q.eq('orderId', order._id))
  .first();
if (existing) { skipped++; continue; }
```

### Reference minting with the protocol alphabet

```ts
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 chars, no 0/O/1/I
// 6 chars, retry <= 5 on (businessId, reference) collision, then 7 chars
```

Collision check uses `byBusinessIdReference` inside the same transaction — safe because the mutation is the serialization point, and Convex does **not** enforce unique indexes (protocol §6.2.3 says the same; uniqueness is a transaction-level check).

---

## Warnings / traps (ranked)

1. **Do not move token minting out of the mutation.** `getRandomValues` works; the plan's fallback would add an action/CLI hop, break batch atomicity, and add a failure mode for no gain.
2. **Do not call `crypto.subtle.generateKey`/randomized `sign`** in `convex/` — it is the one Web Crypto path that throws in queries/mutations.
3. **One `.paginate()` per function** — including inside a mutation. The planned `backfillStatus` must be split; `.collect().length` is banned by repo guidelines. Decide the count-gate shape before writing the function.
4. **`undefined` vs absent vs `null`.** Absent key = unpriced (correct). `patch({ unitPrice: undefined })` = delete the field (dangerous if ever run on a priced row). `null` is not accepted by `v.optional(v.number())`.
5. **`convex-test` does not emulate the crypto restriction.** Green tests do not prove prod safety for `crypto.subtle`.
6. **Staged index trade-off:** plain index deploys synchronously (may block on a big table); `staged: true` needs a second deploy and cannot be queried until unstaged. `byBusinessIdStatus` is unused in T2.
7. **Schema push scans all existing docs.** Any new non-optional field on `orders` (or `businesses`/`menuGroups`) will fail the deploy. Everything added must be `v.optional`.
8. **`_creationTime` is function-start-based**, so all rows written in one mutation share it. Irrelevant for this backfill (each legacy order came from its own `submitOrder`), but do not use it as a uniqueness key.
9. **Batch row count vs transaction limits:** 50 is far below 16,000 writes / 16 MiB; the real risk is OCC retries on a hot `orders` row, not size.

---

## Answers to the seven research questions (one line each)

1. **Schema/validators/indexes:** `v.optional`, `v.union`/`v.literal`, `v.array(v.object(...))`, `.index('name', ['a','b'])` with dot paths for nested fields; 32 indexes/table, 16 fields/index; staged indexes exist for large tables.
2. **Pagination/migrations:** cursor pagination with `paginationOptsValidator` and `{page,isDone,continueCursor}`; **one** `.paginate()` per function; official batched-migration pattern is schema-allows-both → migrate in batches (100 default) → run to completion → tighten; dry-run and resumability are first-class in `@convex-dev/migrations`, hand-rolled here.
3. **CSPRNG:** `crypto.getRandomValues` **is** available and allowed in mutations, backed by a per-execution seeded ChaCha12 stream (32-byte `rng_seed`, replayed on retry); only `crypto.subtle.generateKey`/randomized `sign` are blocked (`NoCryptoRngInQueriesOrMutations`). No fallback needed.
4. **Internal functions:** use `internalQuery`/`internalMutation`; not client-callable; runnable via `npx convex run` from the CLI.
5. **Limits:** 16,000 documents written / 16 MiB written / 32,000 scanned / 4,096 index ranges per transaction — 50-row batches are far inside.
6. **`guidelines.md`:** optional-field/validator rules, `undefined`-is-not-a-value, internal-only registration, pagination validator, single-paginate, staged-index warning, no `.collect().length`, test setup under `convex/` with edge-runtime.
7. **Expand/contract:** additive optional fields first (each push revalidates existing docs), backfill, switch behind a flag, tighten later with `.staged()`; no destructive step in T2.

---

## Gaps and conflicts

- **Backend source is `main`, not a pinned 1.46.0 tag.** The getRandomValues implementation is identical at the 2026-08-31 parent and current main, so this is not a recent regression; still, the deployed backend version is a platform detail, not the npm version. If the first real batch were to throw, the error would be `NoCryptoRngInQueriesOrMutations` — cheap to detect on batch 1.
- **Exact entropy source of `runtime.rng()` was not read to the line.** `rng_seed` is 32 bytes from the runtime RNG (`function_runner/src/server.rs`) and feeds ChaCha12; Convex documents the result as a "strong pseudo-random number generator". This satisfies the protocol's 256-bit requirement in practice, but it is **not** the OS CSPRNG that `crypto.getRandomValues` is on the web — the protocol text assumes web semantics. Worth one sentence in the migration doc; no code change.
- **Seeded-replay semantics are inferred from the `rng_seed`/`observed_rng` plumbing**, not from a doc sentence. The docs only say the seed "is an implicit parameter to your function" and that retries are automatic. The inference (retry reproduces the same token) is consistent with the code and is the only way determinism can hold.
- **`convex-test` pagination-limit enforcement** is documented in its CHANGELOG (0.0.54) and present in 0.0.62's dist; the production error string is quoted from user reports, not from the docs site.
- **`backfillStatus` design is unresolved by research** — it is a product/implementation decision between (a) per-table, per-page count calls, and (b) a final verification via dashboard/`npx convex data`. The plan's two-counts-in-one-call signature cannot ship.
- **No GitHub issue/PR found** discussing `crypto.getRandomValues` being blocked — because it is not blocked. Community claims to the contrary (LLM review comments on unrelated PRs) were checked and are wrong for `getRandomValues`; they are right for `crypto.subtle.generateKey`.
- **`docs.convex.dev/database/advanced/migrations` does not exist.** The correct sources are the pagination/writing-data pages and the `@convex-dev/migrations` README linked from `convex.dev/components`.

---

## Sources (all consulted)

**Official docs**
- https://docs.convex.dev/database/schemas — validators, `v.optional`, unions, staged validators, schema validation on push
- https://docs.convex.dev/database/reading-data/indexes — `.index`, multi-field order, staged indexes
- https://docs.convex.dev/database/pagination — cursor contract, `paginationOptsValidator`, `continueCursor`/`isDone`
- https://docs.convex.dev/database/writing-data — write performance, transaction-limit tooling, scheduler continuation
- https://docs.convex.dev/database/types#working-with-undefined — `undefined` vs absent vs `patch`
- https://docs.convex.dev/database/advanced/commit-timestamp — `_creationTime` is function-start based
- https://docs.convex.dev/production/state/limits#transactions — 16k writes / 16 MiB / 32k scanned / 4,096 ranges
- https://docs.convex.dev/functions/internal-functions — internal functions, CLI/dashboard invocation
- https://docs.convex.dev/functions/runtimes — supported Web Crypto, determinism, seeded `Math.random`
- https://docs.convex.dev/functions/mutation-functions — transactional/deterministic mutations
- https://docs.convex.dev/cli/reference/run — JSON args, `--prod`

**Official code**
- https://github.com/convex/convex-backend/blob/main/npm-packages/udf-runtime/src/00_crypto.ts
- https://github.com/convex/convex-backend/blob/main/crates/isolate/src/ops/crypto.rs
- https://github.com/convex/convex-backend/blob/c433164a780a5b529310c089650f41c10566d479/crates/isolate/src/ops/crypto.rs
- https://github.com/convex/convex-backend/blob/main/crates/isolate/src/environment/udf/mod.rs
- https://github.com/convex/convex-backend/blob/main/crates/isolate/src/ops/subtle_crypto/mod.rs
- https://github.com/convex/convex-backend/blob/main/crates/function_runner/src/server.rs
- https://github.com/convex/convex-backend/blob/main/crates/udf/src/udf_outcome.rs
- https://github.com/convex/migrations — official migrations component README (batch size, dry run, serial execution, expand/contract steps)
- https://github.com/convex/convex-test/blob/main/CHANGELOG.md — 0.0.54 single-paginate enforcement

**Repo**
- `convex/_generated/ai/guidelines.md` (286 lines, read in full)
- `convex/AGENTS.md` (internal-mutation seed convention, `npx convex run`)
- `tasks/issue-76-plan.md`
- `docs/order-commitment-protocol.md` §6.2.1–§6.2.9
- `convex/schema.ts` L39–119 (`businesses`, `menuGroups`), L183–203 (`orders`)
- `node_modules/convex/package.json`, `node_modules/convex-test/dist/index.js`, `node_modules/@edge-runtime/vm/dist/edge-vm.js`, `vitest.config.ts`, `package.json`
