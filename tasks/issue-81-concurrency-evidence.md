# Issue #81 — order-protocol concurrency evidence (T9 / Phase 5)

**Verdict: PASS**

| field | value |
|---|---|
| Issue | #81 — order commitment protocol hardening (T9 concurrency proof) |
| Branch | `fix/issue-81-order-protocol-t9-abuse-controls-concurrency-proof` |
| Deployment | `https://agile-husky-366.convex.cloud` |
| Run id | `proof-1793040031617` |
| Node | `v24.18.0` |
| Generated at | 2026-10-26T18:40:31.617Z |
| Command | `node --env-file=.env.local scripts/order-concurrency-proof.ts` |
| Probe business | `jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5` · menu item `k570gjkzang2hjhdnghhaa114d8h0ffm` |

Scenarios: §7.3 `docs/order-commitment-protocol.md` L1740–1749.

## Scenario results

| # | scenario | verdict |
|---|---|---|
| 1 | two placeOrder, same (businessId, idempotencyKey), same args | **PASS** |
| 2 | accept vs decline in parallel | **PASS** |
| 3 | two accepts in parallel | **PASS** |
| 4 | expire vs accept in parallel on a due order | **PASS** |

## Scenario 1 — two placeOrder, same (businessId, idempotencyKey), same args

**Verdict: PASS**

Asserted:

- attempt 1: both calls resolved with the same orderId `kh74sdwbsb47vfgnx6y6kqscxs8h1gpc`
- attempt 1: exactly 1 order / 1 event / 1 notification / 1 idempotency row (deltas 1/1/1/1)
- attempt 1: exactly one row per throttle key, counts business:jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5:10m=1, contact:jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5:550a457b24abf72a986100ac56e3a4ae9ec3477f21bbce9ed9a5be3295eb51f3:10m=1, contact:jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5:550a457b24abf72a986100ac56e3a4ae9ec3477f21bbce9ed9a5be3295eb51f3:24h=1
- attempt 1: an OCC conflict is visible in the log stream (occInfo/willRetry)
- at least one placeOrder execution shows `occInfo` non-null / `willRetry: true` in the log stream

- Note: attempt 1: the losing execution recorded `occInfo` with `willRetry: true`, was retried under the same `requestId`, and the retry returned the winner’s receipt from the fast path — which is why the throttle windows still counted exactly one accepted submission.

| call | transport | function | marker | start (UTC) | end (UTC) | ms | outcome | requestId | executionId | caller | identityType | executionTime | occInfo | willRetry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
 | placeOrder #1 | ConvexHttpClient | `orders:placeOrder` | `idempotencyKey=proof-1793040031617-dup-1` | 2026-10-26T18:40:37.712Z | 2026-10-26T18:40:38.019Z | 307 | ok | 1a17915ab91315ee | 0ea3962e-950f-4952-87e9-eca36465a3dd | HttpApi | unknown | 0.053605009s | `{"tableName":"orderIdempotency","documentId":"md78e9z87m4002a235d09mzcwx8h15dy","writeSource":"orders.js:placeOrder","componentPath":null,"retryCount":0}` | true | 
 | placeOrder #2 | ConvexHttpClient | `orders:placeOrder` | `idempotencyKey=proof-1793040031617-dup-1` | 2026-10-26T18:40:37.713Z | 2026-10-26T18:40:38.089Z | 376 | ok | 1a12e1a9042f6792 | 32b6d146-624c-4c9a-9595-560e9f35b19b | HttpApi | unknown | 0.053069539s | null | false | 

- **placeOrder #1:** 2 Completion records share this request id (retry attempts): 0ea3962e-950f-4952-87e9-eca36465a3dd, e59206fc-2069-4840-b36b-f5362b0a0e67

#### placeOrder #1 — `orders:placeOrder`

- marker: `idempotencyKey=proof-1793040031617-dup-1`
- result: `{"accessToken":"<redacted>","business":{"name":"__T9 proof proof-1793040031617__","phone":"+1 555 0199"},"contact":{"phone":"***-9001"},"createdAt":1793040037864,"items":[{"name":"__T9 proof item__","quantity":1,"selections":[]}],"orderId":"kh74sdwbsb47vfgnx6y6kqscxs8h1gpc","reference":"5RYY68","status":"new","statusReason":null,"subtotal":1250}`
- log fields: requestId=1a17915ab91315ee · executionId=0ea3962e-950f-4952-87e9-eca36465a3dd · caller=HttpApi · identityType=unknown · executionTime=0.053605009s · occInfo={"tableName":"orderIdempotency","documentId":"md78e9z87m4002a235d09mzcwx8h15dy","writeSource":"orders.js:placeOrder","componentPath":null,"retryCount":0} · willRetry=true<br>requestId=1a17915ab91315ee · executionId=e59206fc-2069-4840-b36b-f5362b0a0e67 · caller=HttpApi · identityType=unknown · executionTime=0.031917195s · occInfo=null · willRetry=false

#### placeOrder #2 — `orders:placeOrder`

- marker: `idempotencyKey=proof-1793040031617-dup-1`
- result: `{"accessToken":"<redacted>","business":{"name":"__T9 proof proof-1793040031617__","phone":"+1 555 0199"},"contact":{"phone":"***-9001"},"createdAt":1793040037864,"items":[{"name":"__T9 proof item__","quantity":1,"selections":[]}],"orderId":"kh74sdwbsb47vfgnx6y6kqscxs8h1gpc","reference":"5RYY68","status":"new","statusReason":null,"subtotal":1250}`
- log fields: requestId=1a12e1a9042f6792 · executionId=32b6d146-624c-4c9a-9595-560e9f35b19b · caller=HttpApi · identityType=unknown · executionTime=0.053069539s · occInfo=null · willRetry=false

### Scenario 1 attempt 1 — rows after the pair

Idempotency key: `proof-1793040031617-dup-1` · order: `kh74sdwbsb47vfgnx6y6kqscxs8h1gpc`

**Counts:**

```json
{
  "notifications": 1,
  "orderBlocks": 0,
  "orderEvents": 1,
  "orderIdempotency": 1,
  "orderThrottle": 3,
  "orders": 1
}
```

**Orders:**

| order id | status | statusReason | createdAt (UTC) | statusUpdatedAt (UTC) | subtotal |
|---|---|---|---|---|---|
| `kh74sdwbsb47vfgnx6y6kqscxs8h1gpc` | new | — | 2026-10-26T18:40:37.864Z | — | 1250 |

**orderEvents:**

| event id | orderId | actorType | actorUserId | action | fromStatus | toStatus | reason | createdAt (UTC) |
|---|---|---|---|---|---|---|---|---|
| `m57bq7ey48nvjkqjm5bkgs73r18h00zh` | `kh74sdwbsb47vfgnx6y6kqscxs8h1gpc` | customer | — | submitted | — | new | — | 2026-10-26T18:40:37.864Z |

**notifications:**

| notification id | userId | businessId | type | createdAt (UTC) |
|---|---|---|---|---|
| `kd79bdr3rd70fn86xxm6qsh47d8h14ze` | `j97ahh97ne5m45m14ash7txanx8eqtjb` | `jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5` | new_order | 2026-10-26T18:40:37.864Z |

**orderIdempotency:**

| id | key | orderId | argsHash (short) | createdAt (UTC) |
|---|---|---|---|---|
| `md78e9z87m4002a235d09mzcwx8h15dy` | `proof-1793040031617-dup-1` | `kh74sdwbsb47vfgnx6y6kqscxs8h1gpc` | `c6be21028ceab4cb…` | 2026-10-26T18:40:37.864Z |

**orderThrottle:**

| key | windowStart (UTC) | count |
|---|---|---|
| `business:jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5:10m` | 2026-10-26T18:40:37.864Z | 1 |
| `contact:jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5:550a457b24abf72a986100ac56e3a4ae9ec3477f21bbce9ed9a5be3295eb51f3:10m` | 2026-10-26T18:40:37.864Z | 1 |
| `contact:jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5:550a457b24abf72a986100ac56e3a4ae9ec3477f21bbce9ed9a5be3295eb51f3:24h` | 2026-10-26T18:40:37.864Z | 1 |

**orderBlocks:**

| id | businessId | contactHash (short) | createdAt (UTC) |
|---|---|---|---|

## Scenario 2 — accept vs decline in parallel

**Verdict: PASS**

Asserted:

- exactly one winner: decline (accept exit 1, decline exit 0)
- loser failed with ORDER_ALREADY_DECIDED
- final status `declined`; exactly 1 owner event `declined`

| call | transport | function | marker | start (UTC) | end (UTC) | ms | outcome | requestId | executionId | caller | identityType | executionTime | occInfo | willRetry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
 | accept | convex run | `orders:transitionOrderStatus` | `orderId=kh72tbjw96z4t5rd8jexbsd7d18h092z` | 2026-10-26T18:40:42.241Z | 2026-10-26T18:40:43.275Z | 1034 | **error** | c521c7f15e553d67 | a94131d2-03fe-4875-9929-724ec67af084 | HttpApi | member_acting_user | 0.014708644s | `{"tableName":"orders","documentId":"kh72tbjw96z4t5rd8jexbsd7d18h092z","writeSource":"orders.js:transitionOrderStatus","componentPath":null,"retryCount":0}` | true | 
 | decline | convex run | `orders:transitionOrderStatus` | `orderId=kh72tbjw96z4t5rd8jexbsd7d18h092z` | 2026-10-26T18:40:42.247Z | 2026-10-26T18:40:43.275Z | 1028 | ok | 6fded6e36acc53c1 | b03bdb22-d7fa-4771-aba5-e23f3d160fcf | HttpApi | member_acting_user | 0.014609961s | null | false | 

- **accept:** 2 Completion records share this request id (retry attempts): a94131d2-03fe-4875-9929-724ec67af084, ca3233ee-e90e-4a62-82dc-21bba96c05d5

#### accept — `orders:transitionOrderStatus`

- marker: `orderId=kh72tbjw96z4t5rd8jexbsd7d18h092z`
- result: `null`
- log fields: requestId=c521c7f15e553d67 · executionId=a94131d2-03fe-4875-9929-724ec67af084 · caller=HttpApi · identityType=member_acting_user · executionTime=0.014708644s · occInfo={"tableName":"orders","documentId":"kh72tbjw96z4t5rd8jexbsd7d18h092z","writeSource":"orders.js:transitionOrderStatus","componentPath":null,"retryCount":0} · willRetry=true<br>requestId=c521c7f15e553d67 · executionId=ca3233ee-e90e-4a62-82dc-21bba96c05d5 · caller=HttpApi · identityType=member_acting_user · executionTime=0.012494706s · occInfo=null · willRetry=false
- `[Request ID: …]` from the failure text: `c521c7f15e553d67`

```text
✖ Failed to run function "orders:transitionOrderStatus": ConvexError: [Request ID: c521c7f15e553d67] Server Error Uncaught ConvexError: {"code":"ORDER_ALREADY_DECIDED","message":"Someone already updated this order. Refresh the board."} at orderError (../convex/orders.ts:646:0) at handler (../convex/orders.ts:513:16)
```

#### decline — `orders:transitionOrderStatus`

- marker: `orderId=kh72tbjw96z4t5rd8jexbsd7d18h092z`
- result: `{"reused":false,"status":"declined"}`
- log fields: requestId=6fded6e36acc53c1 · executionId=b03bdb22-d7fa-4771-aba5-e23f3d160fcf · caller=HttpApi · identityType=member_acting_user · executionTime=0.014609961s · occInfo=null · willRetry=false

### Scenario 2 — final rows for order `kh72tbjw96z4t5rd8jexbsd7d18h092z`

**Order:**

| order id | status | statusReason | createdAt (UTC) | statusUpdatedAt (UTC) | subtotal |
|---|---|---|---|---|---|
| `kh72tbjw96z4t5rd8jexbsd7d18h092z` | declined | T9 proof decline | 2026-10-26T18:40:42.052Z | 2026-10-26T18:40:42.989Z | — |

**orderEvents:**

| event id | orderId | actorType | actorUserId | action | fromStatus | toStatus | reason | createdAt (UTC) |
|---|---|---|---|---|---|---|---|---|
| `m57a15p68pmv5aaawrrgb6trqd8h1aam` | `kh72tbjw96z4t5rd8jexbsd7d18h092z` | owner | j97ahh97ne5m45m14ash7txanx8eqtjb | declined | new | declined | T9 proof decline | 2026-10-26T18:40:42.989Z |

**Full probe counts at this point:**

```json
{
  "notifications": 1,
  "orderBlocks": 0,
  "orderEvents": 2,
  "orderIdempotency": 1,
  "orderThrottle": 3,
  "orders": 2
}
```

## Scenario 3 — two accepts in parallel

**Verdict: PASS**

Asserted:

- both accepts succeeded with status "accepted" (1 reused, 1 moved)
- exactly 1 accepted event; final status `accepted`
- first child to return: accept #1 (46 ms apart)

| call | transport | function | marker | start (UTC) | end (UTC) | ms | outcome | requestId | executionId | caller | identityType | executionTime | occInfo | willRetry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
 | accept #1 | convex run | `orders:transitionOrderStatus` | `orderId=kh718mbgazy7542zx4qbcnw5q98h0dyj` | 2026-10-26T18:40:44.945Z | 2026-10-26T18:40:45.707Z | 762 | ok | 332a83492773e79e | f6b3c98f-30ee-49cf-8b54-84db17e4853d | HttpApi | member_acting_user | 0.010879763s | null | false | 
 | accept #2 | convex run | `orders:transitionOrderStatus` | `orderId=kh718mbgazy7542zx4qbcnw5q98h0dyj` | 2026-10-26T18:40:44.968Z | 2026-10-26T18:40:45.753Z | 785 | ok | 40e8cd56f50ab3d2 | e6ea6134-01f6-48ae-bcf8-e1a7af00a470 | HttpApi | member_acting_user | 0.013699495s | null | false | 


#### accept #1 — `orders:transitionOrderStatus`

- marker: `orderId=kh718mbgazy7542zx4qbcnw5q98h0dyj`
- result: `{"reused":false,"status":"accepted"}`
- log fields: requestId=332a83492773e79e · executionId=f6b3c98f-30ee-49cf-8b54-84db17e4853d · caller=HttpApi · identityType=member_acting_user · executionTime=0.010879763s · occInfo=null · willRetry=false

#### accept #2 — `orders:transitionOrderStatus`

- marker: `orderId=kh718mbgazy7542zx4qbcnw5q98h0dyj`
- result: `{"reused":true,"status":"accepted"}`
- log fields: requestId=40e8cd56f50ab3d2 · executionId=e6ea6134-01f6-48ae-bcf8-e1a7af00a470 · caller=HttpApi · identityType=member_acting_user · executionTime=0.013699495s · occInfo=null · willRetry=false

### Scenario 3 — final rows for order `kh718mbgazy7542zx4qbcnw5q98h0dyj`

**Order:**

| order id | status | statusReason | createdAt (UTC) | statusUpdatedAt (UTC) | subtotal |
|---|---|---|---|---|---|
| `kh718mbgazy7542zx4qbcnw5q98h0dyj` | accepted | — | 2026-10-26T18:40:44.815Z | 2026-10-26T18:40:45.578Z | — |

**orderEvents:**

| event id | orderId | actorType | actorUserId | action | fromStatus | toStatus | reason | createdAt (UTC) |
|---|---|---|---|---|---|---|---|---|
| `m576j0gv6t04wchm88prc17cax8h0z3j` | `kh718mbgazy7542zx4qbcnw5q98h0dyj` | owner | j97ahh97ne5m45m14ash7txanx8eqtjb | accepted | new | accepted | — | 2026-10-26T18:40:45.578Z |

**Full probe counts at this point:**

```json
{
  "notifications": 1,
  "orderBlocks": 0,
  "orderEvents": 3,
  "orderIdempotency": 1,
  "orderThrottle": 3,
  "orders": 3
}
```

## Scenario 4 — expire vs accept in parallel on a due order

**Verdict: PASS**

Asserted:

- expire won: status `expired`, 1 system expired event, 0 accepted events
- losing accept failed with ORDER_EXPIRED/ORDER_ALREADY_DECIDED

- Note: due-expiry row created immediately before the pair; pair fired at 2026-10-26T18:40:47.982Z (wall clock; the cron interval is 5 minutes and its phase is not exposed).

| call | transport | function | marker | start (UTC) | end (UTC) | ms | outcome | requestId | executionId | caller | identityType | executionTime | occInfo | willRetry |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
 | expireOrder | convex run | `orderExpiry:expireOrder` | `orderId=kh71qwedhjdr2b8wnrnyx02bs58h0w5y` | 2026-10-26T18:40:47.982Z | 2026-10-26T18:40:48.790Z | 808 | ok | b951e94b3545e946 | c2506bf8-d5e7-49c8-abb8-8d359f302daf | HttpApi | instance_admin | 0.009192204s | null | false | 
 | accept | convex run | `orders:transitionOrderStatus` | `orderId=kh71qwedhjdr2b8wnrnyx02bs58h0w5y` | 2026-10-26T18:40:47.988Z | 2026-10-26T18:40:48.775Z | 787 | **error** | fd9562bbce64c9c7 | 21d8c3c6-ed2a-4fd3-b976-ec3ceda1208d | HttpApi | member_acting_user | 0.013922492s | null | false | 


#### expireOrder — `orderExpiry:expireOrder`

- marker: `orderId=kh71qwedhjdr2b8wnrnyx02bs58h0w5y`
- result: `null`
- log fields: requestId=b951e94b3545e946 · executionId=c2506bf8-d5e7-49c8-abb8-8d359f302daf · caller=HttpApi · identityType=instance_admin · executionTime=0.009192204s · occInfo=null · willRetry=false

#### accept — `orders:transitionOrderStatus`

- marker: `orderId=kh71qwedhjdr2b8wnrnyx02bs58h0w5y`
- result: `null`
- log fields: requestId=fd9562bbce64c9c7 · executionId=21d8c3c6-ed2a-4fd3-b976-ec3ceda1208d · caller=HttpApi · identityType=member_acting_user · executionTime=0.013922492s · occInfo=null · willRetry=false
- `[Request ID: …]` from the failure text: `fd9562bbce64c9c7`

```text
✖ Failed to run function "orders:transitionOrderStatus": ConvexError: [Request ID: fd9562bbce64c9c7] Server Error Uncaught ConvexError: {"code":"ORDER_EXPIRED","message":"This order expired before it was accepted. Place a new order."} at orderError (../convex/orders.ts:646:0) at handler (../convex/orders.ts:509:20)
```

Pair fired at 2026-10-26T18:40:47.982Z (wall clock); the cron interval is 5 minutes and its phase is not exposed.

### Scenario 4 — final rows for order `kh71qwedhjdr2b8wnrnyx02bs58h0w5y`

**Order:**

| order id | status | statusReason | createdAt (UTC) | statusUpdatedAt (UTC) | subtotal |
|---|---|---|---|---|---|
| `kh71qwedhjdr2b8wnrnyx02bs58h0w5y` | expired | Not accepted within 60 minutes | 2026-10-26T18:40:47.126Z | 2026-10-26T18:40:48.673Z | — |

**orderEvents:**

| event id | orderId | actorType | actorUserId | action | fromStatus | toStatus | reason | createdAt (UTC) |
|---|---|---|---|---|---|---|---|---|
| `m57125nv6zpv1g14f3q990p6x18h050n` | `kh71qwedhjdr2b8wnrnyx02bs58h0w5y` | system | — | expired | new | expired | Not accepted within 60 minutes | 2026-10-26T18:40:48.673Z |

**Full probe counts at this point:**

```json
{
  "notifications": 1,
  "orderBlocks": 0,
  "orderEvents": 4,
  "orderIdempotency": 1,
  "orderThrottle": 3,
  "orders": 4
}
```

## Final probe rows (before cleanup)

**Counts:**

```json
{
  "notifications": 1,
  "orderBlocks": 0,
  "orderEvents": 4,
  "orderIdempotency": 1,
  "orderThrottle": 3,
  "orders": 4
}
```

**Orders:**

| order id | status | statusReason | createdAt (UTC) | statusUpdatedAt (UTC) | subtotal |
|---|---|---|---|---|---|
| `kh74sdwbsb47vfgnx6y6kqscxs8h1gpc` | new | — | 2026-10-26T18:40:37.864Z | — | 1250 |
| `kh72tbjw96z4t5rd8jexbsd7d18h092z` | declined | T9 proof decline | 2026-10-26T18:40:42.052Z | 2026-10-26T18:40:42.989Z | — |
| `kh718mbgazy7542zx4qbcnw5q98h0dyj` | accepted | — | 2026-10-26T18:40:44.815Z | 2026-10-26T18:40:45.578Z | — |
| `kh71qwedhjdr2b8wnrnyx02bs58h0w5y` | expired | Not accepted within 60 minutes | 2026-10-26T18:40:47.126Z | 2026-10-26T18:40:48.673Z | — |

**orderEvents:**

| event id | orderId | actorType | actorUserId | action | fromStatus | toStatus | reason | createdAt (UTC) |
|---|---|---|---|---|---|---|---|---|
| `m57bq7ey48nvjkqjm5bkgs73r18h00zh` | `kh74sdwbsb47vfgnx6y6kqscxs8h1gpc` | customer | — | submitted | — | new | — | 2026-10-26T18:40:37.864Z |
| `m57a15p68pmv5aaawrrgb6trqd8h1aam` | `kh72tbjw96z4t5rd8jexbsd7d18h092z` | owner | j97ahh97ne5m45m14ash7txanx8eqtjb | declined | new | declined | T9 proof decline | 2026-10-26T18:40:42.989Z |
| `m576j0gv6t04wchm88prc17cax8h0z3j` | `kh718mbgazy7542zx4qbcnw5q98h0dyj` | owner | j97ahh97ne5m45m14ash7txanx8eqtjb | accepted | new | accepted | — | 2026-10-26T18:40:45.578Z |
| `m57125nv6zpv1g14f3q990p6x18h050n` | `kh71qwedhjdr2b8wnrnyx02bs58h0w5y` | system | — | expired | new | expired | Not accepted within 60 minutes | 2026-10-26T18:40:48.673Z |

**notifications:**

| notification id | userId | businessId | type | createdAt (UTC) |
|---|---|---|---|---|
| `kd79bdr3rd70fn86xxm6qsh47d8h14ze` | `j97ahh97ne5m45m14ash7txanx8eqtjb` | `jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5` | new_order | 2026-10-26T18:40:37.864Z |

**orderIdempotency:**

| id | key | orderId | argsHash (short) | createdAt (UTC) |
|---|---|---|---|---|
| `md78e9z87m4002a235d09mzcwx8h15dy` | `proof-1793040031617-dup-1` | `kh74sdwbsb47vfgnx6y6kqscxs8h1gpc` | `c6be21028ceab4cb…` | 2026-10-26T18:40:37.864Z |

**orderThrottle:**

| key | windowStart (UTC) | count |
|---|---|---|
| `business:jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5:10m` | 2026-10-26T18:40:37.864Z | 1 |
| `contact:jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5:550a457b24abf72a986100ac56e3a4ae9ec3477f21bbce9ed9a5be3295eb51f3:10m` | 2026-10-26T18:40:37.864Z | 1 |
| `contact:jh7cc4kzsf7pe3zbeg1pg3pw6d8h14b5:550a457b24abf72a986100ac56e3a4ae9ec3477f21bbce9ed9a5be3295eb51f3:24h` | 2026-10-26T18:40:37.864Z | 1 |

**orderBlocks:**

| id | businessId | contactHash (short) | createdAt (UTC) |
|---|---|---|---|

## Cron interference

`orderExpiry:sweepExpiredOrders` executions observed in the capture window: **0**.

The dev deployment runs `crons.interval("sweep expired orders", { minutes: 5 }, …)`; scenario 4 creates its due row immediately before the pair, so this count bounds (but cannot eliminate) sweep interference.

## Limitations (explicit)

1. **No client-side request id.** Convex does not expose a request id on the `ConvexHttpClient` result (`node_modules/convex/dist/esm/browser/http_client.js` has no request-id handling). Ids here are correlated from the deployment log stream (`node node_modules/convex/bin/main.js logs --jsonl --success --history 0`), started before the scenarios and stopped afterwards. Records are grouped by `requestId` first — a mutation that conflicts is retried inside the same HTTP request, so its conflict attempt and its retry share one id (`occInfo` + `willRetry: true` on the first, clean on the second). Failed CLI calls additionally print `[Request ID: …]`, matched exactly; the remaining calls take the nearest unclaimed group with the same `identifier` inside ±5 s of the call finishing. A call that cannot be joined says so in its row.
2. **`--identity` is impersonation, not authentication.** Owner-side calls run the public `orders:transitionOrderStatus` through `convex run --identity '{"subject":"<owner>"}'`, which authenticates with the developer’s deployment admin key and makes `ctx.auth.getUserIdentity()` return the injected subject. The deployment logs these executions as `identityType: "member_acting_user"`. This requires a logged-in developer and must never reach a browser or CI.
2a. **`ConvexHttpClient` queues mutations by default.** `mutation()` pushes onto a per-instance `mutationQueue` and processes one at a time (`node_modules/convex/dist/esm/browser/http_client.js` L302–323), so two calls in one `Promise.all` are serialized unless the documented `{ skipQueue: true }` option is passed (`http_client.d.ts` L10–15). Scenario 1 passes it, and warms the connection pool first, so the two `placeOrder` mutations are genuinely in flight together. A harness that omits `skipQueue` cannot produce this race.
3. **The 5-minute expiry cron runs concurrently** on this shared dev deployment (see above). Scenario 4 accepts that a sweep may win the race before the pair fires; the assertions hold for either winner.
4. **Shared dev data.** Every fixture is scoped by the run id (`__T9 proof <runId>__` business); no pilot or seed row is read or written by the harness.
5. **No `convex-test` substitute.** These results come from the real deployment’s serializable transactions; `convex-test` executes mutations serially and cannot prove OCC behavior (protocol L1742).
6. **Capability tokens are redacted.** Every `accessToken` value in a serialized receipt is rendered as `<redacted>` (key kept, value dropped), so this artifact carries no working order link.

## Cleanup

`devProof:cleanupProbe` runs in a `finally` block, including on failure.

```json
{
  "deleted": {
    "businesses": 1,
    "menuGroups": 1,
    "menuItems": 1,
    "notifications": 1,
    "orderAccess": 4,
    "orderBlocks": 0,
    "orderEvents": 4,
    "orderExpiry": 1,
    "orderIdempotency": 1,
    "orderThrottle": 3,
    "orders": 4
  }
}
```

Log stream dump (local, not committed): `C:\Users\calvi\AppData\Local\Temp\t9-concurrency-logs-1793040031617.jsonl`

**VERDICT: PASS**
