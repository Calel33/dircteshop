# Order protocol T2 — `orderAccess` + `items[]` backfill

**Issue:** #76 (order protocol T2, expand step) · **Protocol:** `docs/order-commitment-protocol.md` §6.2.9 step 2
**Recorded:** 2026-10-20 against the **dev** deployment (`dev:agile-husky-366`) — never `--prod`.
**Modules:** `convex/orderAccess.ts`, `convex/migrations/backfillOrderAccess.ts` (both internal-only).

## Purpose and expand/contract position

This is the **backfill half of the expand step**, not a contract step:

- Step 1 (§6.2.9) added optional fields and six side tables; legacy rows stayed valid.
- Step 2 (this migration) gives every legacy order one `orderAccess` row and, only when it has no `items[]` yet, a one-line snapshot with `pricingSource: 'legacyUnknown'`.
- Steps 3–6 (flag, pilot, default, contract) are out of scope here.

**Rollback is a no-op at the data layer.** The schema is additive only: no table, field, or index was dropped or renamed, and no legacy value was overwritten except the additive `orders.items[]` / `orders.pricingSource` it writes. Stopping the migration leaves the deployment in a valid expand state; setting a business back to `legacy` (later slices) needs no data undo. Nothing here expires, transitions, or deletes an order.

## Count gate — `backfillStatus`

```bash
npx convex run migrations/backfillOrderAccess:backfillStatus '{"table":"orders","paginationOpts":{"numItems":500,"cursor":null}}'
npx convex run migrations/backfillOrderAccess:backfillStatus '{"table":"orderAccess","paginationOpts":{"numItems":500,"cursor":null}}'
```

Signature: `{ table: 'orders' | 'orderAccess', paginationOpts: { numItems: number, cursor: string | null }, maxNumItems?: number }` — `paginationOpts` is validated by `paginationOptsValidator` and passed to `.paginate()` unchanged (project Convex guideline: do not reconstruct it), so the native read-budget fields (`maximumRowsRead`, `maximumBytesRead`) remain available; `maxNumItems` is an optional convenience clamp (≤500).
Returns: `{ table, count, isDone, nextCursor }` — where `count` is **this page's row count** (`page.length`), not the table total.

**Why the operator must loop and sum:** a single function execution may run **exactly one** `.paginate()` (Convex throws on a second, in queries and mutations alike), `.collect().length` is forbidden by `convex/_generated/ai/guidelines.md` ("never use `.collect().length`"), and the installed Convex types expose no `.count()` on queries. A single call therefore cannot return both tables' totals — and cannot even return one table's total in one page beyond `MAX_STATUS_PAGE = 500`. The recipe is:

```text
total = 0; cursor = null
repeat:
  page = backfillStatus({ table, paginationOpts: { numItems: 500, cursor } })
  total += page.count
  cursor = page.nextCursor
until page.isDone
```

`isDone: true` means the page just returned was the last page. The two totals are the completion gate: `orders === orderAccess`.

## Batch loop — `backfillBatch`

```bash
# 1. Dry run first: same would-do counts, zero writes, cursor still advances.
npx convex run migrations/backfillOrderAccess:backfillBatch '{"paginationOpts":{"numItems":50,"cursor":null},"dryRun":true}'

# 2. Repeat the real batch with the returned nextCursor until isDone:
npx convex run migrations/backfillOrderAccess:backfillBatch '{"paginationOpts":{"numItems":50,"cursor":null}}'
#    next page (only when isDone was false):
npx convex run migrations/backfillOrderAccess:backfillBatch '{"paginationOpts":{"numItems":50,"cursor":"<nextCursor>"}}'
```

Signature: `{ paginationOpts: { numItems: number, cursor: string | null }, dryRun?: boolean, maxBatchSize?: number }` — the same validated-passthrough rule; `maxBatchSize` clamps at 50.
Returns: `{ processed, inserted, skipped, patched, unpatchable, dryRun, isDone, nextCursor }`

- `processed` — rows read on this page.
- `inserted` — `orderAccess` rows written. In `dryRun` this is the **would-insert** count; `dryRun: true` is the signal that no write happened.
- `skipped` — orders that already had an `orderAccess` row (no write at all).
- `patched` — orders whose missing `items[]` was (or would be) added.
- `unpatchable` — orders with neither `menuItemId` nor `items[]`. They still get access; no line is fabricated because `menuItemId` is required inside `items[]`.
- `isDone` / `nextCursor` — from the page read, in both dry and real runs, so a dry run can walk the whole table.

**There is deliberately no `remaining` field.** A real remaining count would need a second paginate or an unbounded scan, both disallowed. The operator knows it is done when `isDone: true`; the count gate then proves `orders === orderAccess`.

> PowerShell note: native argument passing strips inner double quotes, so the run above used JSON5 single-quoted values, e.g. `"{table:'orders',paginationOpts:{numItems:500,cursor:null}}"` and `"{paginationOpts:{numItems:50,cursor:null},dryRun:true}"`. Both forms reach the same handler.

## Recorded run — dev deployment, 2026-10-20

### Before

| Table         | Count |
| ------------- | ----- |
| `orders`      | **5** |
| `orderAccess` | **0** |

Both `backfillStatus` calls returned `isDone: true` on page 1 (5 and 0 rows).

By-status at this point: `new = 5` (all five). By-status counts came from `npx convex data orders --format json --limit 100` grouped locally — not from a fabricated query.

### Dry run (actual output)

```bash
npx convex run migrations/backfillOrderAccess:backfillBatch "{paginationOpts:{numItems:50,cursor:null},dryRun:true}"
```

```json
{
  "dryRun": true,
  "inserted": 5,
  "isDone": true,
  "nextCursor": "07d4330f…a5cae2fcf1755569",
  "patched": 5,
  "processed": 5,
  "skipped": 0,
  "unpatchable": 0
}
```

### Real run (actual output)

```bash
npx convex run migrations/backfillOrderAccess:backfillBatch "{paginationOpts:{numItems:50,cursor:null}}"
```

```json
{
  "dryRun": false,
  "inserted": 5,
  "isDone": true,
  "nextCursor": "07d4330f…a5cae2fcf1755569",
  "patched": 5,
  "processed": 5,
  "skipped": 0,
  "unpatchable": 0
}
```

One page sufficed; the loop never needed a second cursor. This run also proved `crypto.getRandomValues` works inside a Convex mutation — no token fallback was used.

### Idempotency rerun (actual output)

```json
{
  "dryRun": false,
  "inserted": 0,
  "isDone": true,
  "nextCursor": "07d4330f…a5cae2fcf1755569",
  "patched": 0,
  "processed": 5,
  "skipped": 5,
  "unpatchable": 0
}
```

### After

| Table         | Before | After |
| ------------- | ------ | ----- |
| `orders`      | 5      | **5** |
| `orderAccess` | 0      | **5** |

Gate: `orders (5) === orderAccess (5)`.

By-status after: `new = 5`. Data-shape spot check over all five orders:

- `pricingSource: 'legacyUnknown'` on 5/5.
- `orders.subtotal` key present on 0/5; `orders.expiresAt` key present on 0/5.
- Backfilled line keys are exactly `menuItemId, name, quantity, selections` — no `unitPrice`, no `lineTotal`.
- `orderAccess`: 5 unique tokens (all 43 chars) for 5 distinct order ids; 5 unique 6-char references.

## Invariants this migration guarantees

1. **No fabricated prices.** The backfilled line omits `unitPrice` and `lineTotal`; the order omits `subtotal`; `pricingSource` is `'legacyUnknown'`. The live menu join is never copied into history — a later menu price change cannot surface as the order's price (R11 guard). Absence is by key omission, never `undefined` or `null`.
2. **No expiry.** Legacy orders get no `orderExpiry` row and no `orders.expiresAt`, so the expiry sweep (which reads `orderExpiry.byExpiresAt`) can never expire them. A legacy `new` order stays `new`.
3. **Status untouched.** The batch never patches `status` (nor `statusReason`/`statusUpdatedAt`); a legacy `completed` order remains terminal and rejects further transitions.

## Entropy limitation (honest note)

`crypto.getRandomValues` in a Convex mutation is backed by the per-execution **seeded ChaCha12** stream (32-byte `rng_seed`, replayed on retry), not the host OS CSPRNG. It provides the 256 bits §6.2.4 asks for in practice, but it is not the web `crypto` semantics the protocol text assumes. The seeded replay is also what makes a retried batch mint the same bytes rather than a second token. `convex-test` runs under `@edge-runtime/vm`, which forwards the **host** `crypto`; the handler tests therefore prove token/reference **shape** (length, charset, uniqueness), not the deployed RNG.

## Re-run at flag switch (protocol §6.2.9 step 5)

Orders created between this backfill and the per-business `basket` switch still need receipts. **Re-run `backfillBatch` to `isDone` for the affected business when its flag is switched.** The skip-by-`orderAccess` check makes the rerun cheap and safe; do not assume this one-time run covers future legacy orders.

## Known follow-up outside this slice

`HARD_DELETE_CHILD_TABLES` (`convex/businesses/adminDeletion.ts`) still lists the pre-expand child tables only. The six new side tables (`orderAccess`, `orderIdempotency`, `orderExpiry`, `orderEvents`, `orderThrottle`, `orderBlocks`) are **not yet cascaded** on business hard delete. That is a separate change; this migration does not touch it.

## Files

- `convex/orderAccess.ts` — token/reference minting, `insertOrderAccess`, `hasOrderAccess`.
- `convex/migrations/backfillOrderAccess.ts` — `backfillStatus` (count gate) and `backfillBatch` (paginated, dry-run, idempotent).
- `convex/orders.test.ts` — S0 suite (10) plus 10 backfill/shape tests.
