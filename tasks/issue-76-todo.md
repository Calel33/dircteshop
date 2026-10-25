# Todo: Issue #76 — Order protocol T2 (schema expand + legacy backfill)

Branch: `fix/issue-76-order-protocol-t2-schema-expand-legacy-backfill-expand-step`
Plan: `tasks/issue-76-plan.md` · Normative: `docs/order-commitment-protocol.md` §6.2, §6.2.9

## Task 1 — Schema expand + type-compat (functionality)
- [ ] `convex/schema.ts`: add 6 side tables (`orderAccess`, `orderIdempotency`, `orderExpiry`, `orderEvents`, `orderThrottle`, `orderBlocks`) with exact §6.2.2 names + indexes
- [ ] `convex/schema.ts`: optional `orders` fields (`items[]`, `subtotal`, `pricingSource`, `statusReason`, `statusUpdatedAt`, `expiresAt`, `customerUserId`); `status` widened to 8 literals; `menuItemId`/`selections` optional; add `byBusinessIdStatus`
- [ ] `convex/schema.ts`: `businesses.orderProtocol/acceptingOrders/acceptingOrdersUntil/acceptingOrdersNote` (optional); `menuGroups.isAvailable` (optional)
- [ ] `convex/orderPolicy.ts`: `ORDER_DB_STATUSES` + `isLegacyOrderStatus` guard (transition matrix unchanged)
- [ ] `convex/orders.ts`: `transitionOrderStatus` uses the guard; `listOrders` handles optional `menuItemId` + `items[]`-or-legacy fallback (`itemPrice=null` for `legacyUnknown`)
- [ ] Codegen: one `npx convex dev` run
- [ ] **Checkpoint 1**: `npx tsc --noEmit` clean; `pnpm exec vitest run convex/orders.test.ts` 10/10; `node --test scripts/order-policy.test.ts` green

## Task 2 — Backfill module + access helpers (functionality)
- [ ] `convex/orderAccess.ts` (new): `createAccessToken` (32 B base64url), `createReference` (6-char alphabet, ≤5 retries then 7), `insertOrderAccess`, `hasOrderAccess`
- [ ] `convex/migrations/backfillOrderAccess.ts` (new, internal only): `backfillStatus` count gate; `backfillBatch` {cursor, dryRun?, limit=50}: idempotent skip via `byOrderId`, one-line `items[]` (`name` or `(item removed)`, qty 1, legacy selections, unitPrice/lineTotal undefined), `pricingSource: 'legacyUnknown'`, subtotal untouched
- [ ] NEVER: patch `status`, set `expiresAt`, insert `orderExpiry`, write any price
- [ ] Verify `crypto.getRandomValues` works in the mutation runtime (first batch); fallback = mint in node caller

## Task 3 — Handler test matrix (functionality)
- [ ] `convex/orders.test.ts`: legacy-only shape → board legacy join (`itemPrice=1200`), status projection unchanged
- [ ] `items[]` shape → board projects snapshot, `itemPrice=null`, status projection unchanged
- [ ] Backfill rerun idempotent (second run changes nothing); `ordersCount === orderAccessCount`; exactly one `orderAccess`/order
- [ ] No fabricated price after a menu price edit (R11 guard)
- [ ] Legacy `new`: no `orderExpiry` row, no `expiresAt`
- [ ] Legacy `completed`: still terminal
- [ ] Deleted item → `(item removed)`, unpriced
- [ ] Dry run reports counts, writes nothing
- [ ] **Checkpoint 2**: `pnpm exec vitest run convex/orders.test.ts` all green

## Task 4 — Dry run, record, full validation (functionality)
- [ ] `docs/migrations/order-protocol-t2-backfill.md`: dry-run output, counts (orders == orderAccess), by-status counts, rollback note (additive schema remains; nothing dropped)
- [ ] Real backfill loop until `remaining === 0`; rerun `backfillStatus` to prove equality
- [ ] **Final gates**: `npm test` · `npm run lint` · `npx tsc --noEmit` · `npm run build`

## Acceptance criteria (from issue)
- [ ] AC1 schema additive, all optional, S0 10/10 — Task 1
- [ ] AC2 idempotent; orders == orderAccess — Tasks 2–4
- [ ] AC3 "price not recorded / Total at pickup", no fabricated number — Tasks 2–3
- [ ] AC4 legacy `new` has no `orderExpiry` row — Tasks 2–3
- [ ] AC5 `completed` terminal; board items[]-or-legacy fallback — Tasks 1, 3
- [ ] AC6 handler tests cover both shapes — Task 3
- [ ] AC7 recorded dry run + rollback note — Task 4
