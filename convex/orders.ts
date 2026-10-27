import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireBusinessOwner, requireBusinessOwnerUser } from './authz';
import { insertNotification } from './notificationHelpers';
import { insertOrderAccess } from './orderAccess';
import {
  canonicalArgsHash,
  contactChannelHashes,
  DEFAULT_NO_SHOW_REASON,
  DEFAULT_TTL_MS,
  effectiveOpenReason,
  maskContact,
  ORDER_ERRORS,
  parseContact,
  priceBasket,
  validateBasket,
  validateTransitionReason,
  VISITOR_CANCEL_REASON,
} from './orderCommitPolicy';
import type {
  BasketFailure,
  BasketLineInput,
  Catalog,
  CatalogEntry,
  OrderErrorCode,
} from './orderCommitPolicy';
import {
  EVENT_FOR_ACTION,
  ORDER_DB_STATUSES,
  resolveOwnerDecision,
  validateOrderContact,
  validateOrderSelections,
} from './orderPolicy';
import type { OrderOwnerAction } from './orderPolicy';
import {
  assertContactNotBlocked,
  claimBusinessThrottle,
  claimContactThrottle,
} from './orderThrottle';

// B8 (issue #8) anonymous order workflow. The visitor submits one item with its
// customization selections and a name + contact channel (no Clerk account);
// the owner works a forward-only board (`new → accepted → ready → completed`).
// `submitOrder` is a public write surface, so every business rule is enforced
// here — approved business only, item belongs to that business and is
// available, and the selections match the item's current customization groups.
// The owner notice is written in the same transaction as the order (plain
// helper, no `ctx.runMutation`), so neither commits alone.
//
// Docs: https://docs.convex.dev/functions/error-handling (ConvexError text)

const ORDER_LIST_LIMIT = 100;
const ORDER_PAGE_SIZE = 50;
const MAX_ORDER_NOTE_LENGTH = 500;
// Anonymous public surface: bounds the per-submission validation loop (Convex
// caps arrays at 8192 elements, far more than any real order needs).
const MAX_ORDER_SELECTIONS = 32;
// Basket catalog read bounds, matching `menus.ts`'s house limits. Every read is
// bounded; a menu item outside the window is simply absent from the catalog and
// prices as `ITEM_UNAVAILABLE` rather than triggering an unbounded scan.
const MAX_GROUPS = 50;
const MAX_ITEMS = 200;

const selectionValidator = v.object({
  optionName: v.string(),
  choiceName: v.string(),
});

/** Loads an orderable business or rejects the submission (public surface). */
async function approvedBusinessOrThrow(
  ctx: MutationCtx,
  businessId: Id<'businesses'>
): Promise<Doc<'businesses'>> {
  const business = await ctx.db.get('businesses', businessId);
  if (business === null || business.status !== 'approved') {
    throw new ConvexError('This business is not accepting orders.');
  }
  return business;
}

/** Loads a menu item that belongs to `businessId` and is orderable. */
async function availableItemOrThrow(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  menuItemId: Id<'menuItems'>
): Promise<Doc<'menuItems'>> {
  const item = await ctx.db.get('menuItems', menuItemId);
  if (item === null || item.businessId !== businessId || !item.isAvailable) {
    throw new ConvexError('This item is not available for ordering.');
  }
  return item;
}

/** Trims the optional note, rejects an over-long one, and drops a blank one. */
function normalizedNoteOrThrow(note: string | undefined): string | undefined {
  const trimmed = note?.trim() || undefined;
  if (trimmed !== undefined && trimmed.length > MAX_ORDER_NOTE_LENGTH) {
    throw new ConvexError(`Note must be ${MAX_ORDER_NOTE_LENGTH} characters or fewer.`);
  }
  return trimmed;
}

/**
 * Places one anonymous order and notifies the business owner. Business/item
 * checks happen before any validation message so an unavailable item never
 * leaks another business's menu data. Returns the new order id.
 */
export const submitOrder = mutation({
  args: {
    businessId: v.id('businesses'),
    menuItemId: v.id('menuItems'),
    selections: v.array(selectionValidator),
    customerName: v.string(),
    contactPhone: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const business = await approvedBusinessOrThrow(ctx, args.businessId);
    const item = await availableItemOrThrow(ctx, args.businessId, args.menuItemId);

    const contactError = validateOrderContact({
      customerName: args.customerName,
      contactPhone: args.contactPhone,
      contactEmail: args.contactEmail,
    });
    if (contactError !== null) {
      throw new ConvexError(contactError);
    }

    const note = normalizedNoteOrThrow(args.note);

    if (args.selections.length > MAX_ORDER_SELECTIONS) {
      throw new ConvexError(
        `Too many selections — an order can include at most ${MAX_ORDER_SELECTIONS}.`
      );
    }

    const selectionError = validateOrderSelections(item.customizationOptions, args.selections);
    if (selectionError !== null) {
      throw new ConvexError(selectionError);
    }

    const orderId = await ctx.db.insert('orders', {
      businessId: args.businessId,
      menuItemId: args.menuItemId,
      selections: args.selections,
      customerName: args.customerName.trim(),
      contactPhone: args.contactPhone?.trim() || undefined,
      contactEmail: args.contactEmail?.trim() || undefined,
      note,
      status: 'new',
      createdAt: Date.now(),
    });

    await insertNotification(ctx, business.ownerId, {
      type: 'new_order',
      businessId: args.businessId,
      businessName: business.name,
      reason: undefined,
    });

    return orderId;
  },
});

/**
 * Projects one board row from either order shape. A committed `items[]`
 * snapshot wins; a `legacyUnknown` row never borrows the live price, and a
 * legacy-only row keeps the live-join fallback (protocol §6.2.9).
 *
 * `reference` is joined from `orderAccess` by the caller for the page's rows
 * only. The capability `accessToken` lives on the same table and must never
 * reach a projection, so it is not readable from here: the reference arrives as
 * a scalar.
 */
function projectOrderRow(
  order: Doc<'orders'>,
  legacyItem: Doc<'menuItems'> | null,
  reference: string | null
) {
  const snapshot = order.items?.[0];

  let itemPrice: number | null;
  if (order.pricingSource === 'legacyUnknown') {
    itemPrice = null;
  } else if (snapshot !== undefined) {
    itemPrice = snapshot.unitPrice ?? null;
  } else {
    itemPrice = legacyItem?.price ?? null;
  }

  return {
    _id: order._id,
    reference,
    itemName: snapshot?.name ?? legacyItem?.name ?? 'Unavailable item',
    itemPrice,
    pricingSource: order.pricingSource ?? null,
    // Full committed line snapshots when the order has them; legacy rows keep
    // the single-item fields above and leave this null.
    items:
      order.items === undefined
        ? null
        : order.items.map((line) => ({
            name: line.name,
            quantity: line.quantity,
            unitPrice: line.unitPrice ?? null,
            lineTotal: line.lineTotal ?? null,
            selections: line.selections.map((selection) => ({
              optionName: selection.optionName,
              choiceName: selection.choiceName,
            })),
          })),
    subtotal: order.subtotal ?? null,
    // Always defined: the board renders `selections.length` and `.map`.
    selections: (snapshot?.selections ?? order.selections ?? []).map((selection) => ({
      optionName: selection.optionName,
      choiceName: selection.choiceName,
    })),
    customerName: order.customerName,
    contactPhone: order.contactPhone ?? null,
    contactEmail: order.contactEmail ?? null,
    note: order.note ?? null,
    status: order.status,
    // D7: the board shows why an order was declined/cancelled; legacy rows
    // without a stamp fall back to their creation time.
    statusReason: order.statusReason ?? null,
    statusUpdatedAt: order.statusUpdatedAt ?? order.createdAt,
    expiresAt: order.expiresAt ?? null,
    createdAt: order.createdAt,
  };
}

/**
 * Projects one page of rows. Only the page's rows are joined to `orderAccess`
 * (reference only) and, for legacy-shaped rows, to the live menu item — one
 * read per distinct `menuItemId`; a deleted item degrades to a placeholder
 * instead of failing the board. A `legacyUnknown` row never borrows the live
 * price — the historical price is unrecoverable (protocol §6.2.9 / R11).
 */
async function projectOrderRows(ctx: QueryCtx, orders: Doc<'orders'>[]) {
  const legacyItemIds: Id<'menuItems'>[] = [];
  for (const order of orders) {
    if (order.items === undefined && order.menuItemId !== undefined) {
      legacyItemIds.push(order.menuItemId);
    }
  }
  const uniqueItemIds = [...new Set(legacyItemIds)];

  const [items, accessRows] = await Promise.all([
    Promise.all(uniqueItemIds.map((itemId) => ctx.db.get('menuItems', itemId))),
    Promise.all(
      orders.map((order) =>
        ctx.db
          .query('orderAccess')
          .withIndex('byOrderId', (q) => q.eq('orderId', order._id))
          .first()
      )
    ),
  ]);

  const itemById = new Map<Id<'menuItems'>, Doc<'menuItems'> | null>(
    uniqueItemIds.map((itemId, index) => [itemId, items[index]])
  );

  return orders.map((order, index) => {
    const legacyItem =
      order.items === undefined && order.menuItemId !== undefined
        ? (itemById.get(order.menuItemId) ?? null)
        : null;
    return projectOrderRow(order, legacyItem, accessRows[index]?.reference ?? null);
  });
}

/** The board's filter set: every protocol status plus the aggregate `all`. */
const STATUS_FILTERS = [...ORDER_DB_STATUSES, 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

const statusFilterValidator = v.union(...STATUS_FILTERS.map((status) => v.literal(status)));

/** Clamps a client page size; the default page is 50 and larger asks are capped. */
function clampPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return ORDER_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(requested), 1), ORDER_PAGE_SIZE);
}

/**
 * Owner-only board read (protocol §6.8, §7.2 S2). Every filter is index-range
 * work — never a post-`take` filter, which is the starvation bug AC1 names.
 *
 * - `new` (default) paginates the `byBusinessIdStatus` prefix oldest first, 50
 *   per page. The index appends `_creationTime` as its tie-breaker, so the
 *   order is insertion order, which equals `createdAt` for rows written by
 *   `submitOrder`/`placeOrder`. Completed history can never push a `new` row out
 *   of view.
 * - every other single status reads at most 101 rows from the same prefix: 100
 *   are returned and the 101st only proves `capped`. No cursor — the spec caps
 *   these filters at 100 with a visible count.
 * - `all` does the same over the `byBusinessId` prefix.
 */
export const listOrders = query({
  args: {
    businessId: v.id('businesses'),
    status: v.optional(statusFilterValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireBusinessOwner(ctx, args.businessId);

    const status = args.status ?? 'new';

    if (status === 'new') {
      const page = await ctx.db
        .query('orders')
        .withIndex('byBusinessIdStatus', (q) =>
          q.eq('businessId', args.businessId).eq('status', 'new')
        )
        .order('asc')
        .paginate({
          numItems: clampPageSize(args.numItems),
          cursor: args.cursor ?? null,
        });

      return {
        rows: await projectOrderRows(ctx, page.page),
        isDone: page.isDone,
        continueCursor: page.continueCursor,
        capped: false,
      };
    }

    const bounded =
      status === 'all'
        ? await ctx.db
            .query('orders')
            .withIndex('byBusinessId', (q) => q.eq('businessId', args.businessId))
            .order('asc')
            .take(ORDER_LIST_LIMIT + 1)
        : await ctx.db
            .query('orders')
            .withIndex('byBusinessIdStatus', (q) =>
              q.eq('businessId', args.businessId).eq('status', status)
            )
            .order('asc')
            .take(ORDER_LIST_LIMIT + 1);

    const capped = bounded.length > ORDER_LIST_LIMIT;

    return {
      rows: await projectOrderRows(ctx, capped ? bounded.slice(0, ORDER_LIST_LIMIT) : bounded),
      isDone: true,
      continueCursor: '',
      capped,
    };
  },
});

/**
 * Owner-only per-filter counts for the board chips (protocol §6.8: "counts show
 * `99+` when capped; do not run an unbounded count on every render").
 *
 * Deliberate deviation from the Convex guidelines' `@convex-dev/aggregate`
 * recommendation (research Q4): the component is not installed, and adopting it
 * would require every order write (`placeOrder`, `transitionOrderStatus`,
 * `cancelOrder`, expiry) to maintain a counter in the same transaction — out of
 * scope for this read-path ticket. Each status is instead a bounded
 * `.take(101)` read (the extra row detects the cap), 9 in `Promise.all`, so one
 * call reads at most 909 documents. Swap to an aggregate component only if a
 * business's per-status volume approaches ~1k.
 */
export const listOrderCounts = query({
  args: { businessId: v.id('businesses') },
  handler: async (ctx, args) => {
    await requireBusinessOwner(ctx, args.businessId);

    const countOf = (rows: Doc<'orders'>[]) => ({
      // The chip's visible count saturates at the cap; `capped` says "or more".
      count: Math.min(rows.length, ORDER_LIST_LIMIT),
      capped: rows.length > ORDER_LIST_LIMIT,
    });

    const readStatus = (status: (typeof ORDER_DB_STATUSES)[number]) =>
      ctx.db
        .query('orders')
        .withIndex('byBusinessIdStatus', (q) =>
          q.eq('businessId', args.businessId).eq('status', status)
        )
        .take(ORDER_LIST_LIMIT + 1);

    const [
      newRows,
      acceptedRows,
      readyRows,
      completedRows,
      declinedRows,
      cancelledRows,
      expiredRows,
      noShowRows,
      allRows,
    ] = await Promise.all([
      readStatus('new'),
      readStatus('accepted'),
      readStatus('ready'),
      readStatus('completed'),
      readStatus('declined'),
      readStatus('cancelled'),
      readStatus('expired'),
      readStatus('no_show'),
      ctx.db
        .query('orders')
        .withIndex('byBusinessId', (q) => q.eq('businessId', args.businessId))
        .take(ORDER_LIST_LIMIT + 1),
    ]);

    return {
      new: countOf(newRows),
      accepted: countOf(acceptedRows),
      ready: countOf(readyRows),
      completed: countOf(completedRows),
      declined: countOf(declinedRows),
      cancelled: countOf(cancelledRows),
      expired: countOf(expiredRows),
      no_show: countOf(noShowRows),
      all: countOf(allRows),
    };
  },
});

/** §6.1: decline and cancel require a reason; every other owner action does not. */
function reasonRequiredFor(action: OrderOwnerAction): boolean {
  return action === 'decline' || action === 'cancel';
}

/**
 * Owner-only protocol transition (§6.1, plan D3). The client supplies an action;
 * the target status is resolved server-side by `resolveOwnerDecision`, which
 * keeps the accept/decline conflict codes (REVISED D1) and delegates the other
 * four actions to the frozen 8-state matrix.
 *
 * Pipeline: owner guard → order scope guard → reason policy → expiry boundary
 * guard (D8) → verdict → `reused` short-circuit → one transactional move
 * (status patch, expiry-row sweep, owner event). Repeating the action that
 * produced the current status returns `{ reused: true }` and writes nothing.
 */
export const transitionOrderStatus = mutation({
  args: {
    businessId: v.id('businesses'),
    orderId: v.id('orders'),
    action: v.union(
      v.literal('accept'),
      v.literal('decline'),
      v.literal('cancel'),
      v.literal('ready'),
      v.literal('complete'),
      v.literal('noShow')
    ),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireBusinessOwnerUser(ctx, args.businessId);

    const order = await ctx.db.get('orders', args.orderId);
    if (order === null || order.businessId !== args.businessId) {
      throw orderError('ORDER_NOT_FOUND', { message: 'Order not found' });
    }

    const validation = validateTransitionReason(args.reason, reasonRequiredFor(args.action));
    if (validation === 'missing') {
      throw orderError('REASON_REQUIRED');
    }
    if (validation === 'too_long') {
      // D2: no dedicated code for an over-long reason; the envelope message
      // carries the limit instead.
      throw orderError('REASON_REQUIRED', {
        message: 'Keep the reason under 200 characters.',
      });
    }

    const trimmedReason = args.reason?.trim();
    const storedReason =
      trimmedReason === undefined || trimmedReason.length === 0
        ? args.action === 'noShow'
          ? DEFAULT_NO_SHOW_REASON
          : undefined
        : trimmedReason;
    const now = Date.now();

    // D8: a due-but-unswept `new` order is expired in effect. Only the system
    // sweep writes the `expired` status, so this rejects without any write.
    // The guard scan is kept and reused as the cleanup scan below: within one
    // transaction the patch touches only the order row, so this collect stays
    // authoritative for both checks (OQ-10 variants).
    const guardExpiryRows: readonly Doc<'orderExpiry'>[] | null =
      args.action === 'accept' && order.status === 'new'
        ? await ctx.db
            .query('orderExpiry')
            .withIndex('byOrderId', (q) => q.eq('orderId', order._id))
            .collect()
        : null;
    if (guardExpiryRows?.some((row) => row.expiresAt <= now)) {
      throw orderError('ORDER_EXPIRED');
    }

    const verdict = resolveOwnerDecision(order.status, args.action);
    if (verdict.kind === 'error') {
      throw orderError(verdict.code);
    }
    if (verdict.kind === 'reused') {
      return { status: order.status, reused: true };
    }

    await ctx.db.patch('orders', order._id, {
      status: verdict.to,
      statusReason: storedReason,
      statusUpdatedAt: now,
    });

    // OQ-9: plain collect + loop. A duplicate stale row is exactly what this
    // clears, and an empty loop is the correct no-op. The accept path reuses
    // the D8 guard's scan (see above) instead of collecting a second time.
    const expiryRows = guardExpiryRows ?? (await ctx.db
        .query('orderExpiry')
        .withIndex('byOrderId', (q) => q.eq('orderId', order._id))
        .collect());
    for (const row of expiryRows) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.insert('orderEvents', {
      orderId: order._id,
      businessId: args.businessId,
      actorType: 'owner',
      actorUserId: user._id,
      action: EVENT_FOR_ACTION[args.action],
      fromStatus: order.status,
      toStatus: verdict.to,
      reason: storedReason,
      createdAt: now,
    });

    return { status: verdict.to, reused: false };
  },
});

/**
 * Public status-only projection for the visitor confirmation view. Accepted v1
 * limitation (plan §3): the order id is the only handle — no visitor token, unlike
 * `bookings.cancelToken`, and Convex does not document document ids as
 * unguessable. The projection therefore returns status + creation time only —
 * never customer data, selections, item, or business fields — so a leaked or
 * guessed id discloses at most order progress. Revisit with a token link
 * (`convex/AGENTS.md` convention) if this surface grows.
 */
export const getOrderStatus = query({
  args: { orderId: v.id('orders') },
  handler: async (ctx, args) => {
    const order = await ctx.db.get('orders', args.orderId);
    if (order === null) {
      return null;
    }

    return { status: order.status, createdAt: order.createdAt };
  },
});

// ---------------------------------------------------------------------------
// Basket commit (issue #78, T4) — protocol §6.2.3/§6.2.5/§6.2.6/§6.5
//
// Everything below is additive. `submitOrder` above stays byte-identical: it
// keeps its plain-string `ConvexError` and its legacy single-item row shape.
// The new surface is reachable only when `businesses.orderProtocol === 'basket'`.
// ---------------------------------------------------------------------------

/**
 * §6.2.6 L1089-1093 receipt projection: an allowlist and nothing else.
 *
 * Never emitted: raw phone/email, `customerName`, `customerUserId`, unit prices
 * or line totals, the args hash, or any token other than `accessToken`. A
 * missing business doc (hard-delete edge) omits the block rather than throwing —
 * the order and its token are still valid records.
 */
function projectOrderReceipt(
  order: Doc<'orders'>,
  access: { accessToken: string; reference: string },
  business: Doc<'businesses'> | null
) {
  const receipt = {
    orderId: order._id,
    accessToken: access.accessToken,
    reference: access.reference,
    subtotal: order.subtotal ?? null,
    status: order.status,
    // D7/§6.2.6: the receipt carries the decision reason (never the expiry
    // timestamp — `orders.expiresAt` is deferred, OQ-10).
    statusReason: order.statusReason ?? null,
    // Snapshot lines only; §6.2.6 lists name, quantity, and selections.
    items: (order.items ?? []).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      selections: item.selections.map((selection) => ({
        optionName: selection.optionName,
        choiceName: selection.choiceName,
      })),
    })),
    contact: maskContact({ phone: order.contactPhone, email: order.contactEmail }),
    createdAt: order.createdAt,
  };

  if (business === null) {
    return receipt;
  }
  return {
    ...receipt,
    business:
      business.phone === undefined
        ? { name: business.name }
        : { name: business.name, phone: business.phone },
  };
}

/**
 * The §6.5 object envelope for the basket path: `{ code, message }`, plus
 * `actualSubtotal` on `PRICE_CHANGED`. Messages come from `ORDER_ERRORS`; the
 * handler substitutes `{phone}`/`{item}` and the throttle helper owns `{n}`.
 */
function orderError(
  code: OrderErrorCode,
  extras: { message?: string; actualSubtotal?: number; lineIndex?: number } = {}
): ConvexError<Record<string, string | number>> {
  const data: Record<string, string | number> = {
    code,
    message: extras.message ?? ORDER_ERRORS[code].message,
  };
  if (extras.actualSubtotal !== undefined) {
    data.actualSubtotal = extras.actualSubtotal;
  }
  if (extras.lineIndex !== undefined) {
    data.lineIndex = extras.lineIndex;
  }
  return new ConvexError(data);
}

/** Substitutes the §6.5 `{phone}` placeholder (`the business` when absent). */
function withPhone(message: string, phone: string | undefined): string {
  return message.replace('{phone}', phone ?? 'the business');
}

/**
 * Builds the T3 `Catalog` from the business's menu, bounded like `menus.ts`.
 *
 * A missing group makes its items unorderable (`groupAvailable: false`); an
 * unavailable item stays in the map so pricing reports `ITEM_UNAVAILABLE`
 * instead of silently treating the line as an unknown item.
 */
async function loadBasketCatalog(
  ctx: MutationCtx,
  businessId: Id<'businesses'>
): Promise<Catalog> {
  const [groups, items] = await Promise.all([
    ctx.db
      .query('menuGroups')
      .withIndex('byBusinessIdOrdering', (q) => q.eq('businessId', businessId))
      .take(MAX_GROUPS),
    ctx.db
      .query('menuItems')
      .withIndex('byBusinessIdOrdering', (q) => q.eq('businessId', businessId))
      .take(MAX_ITEMS),
  ]);

  const groupAvailable = new Map(
    groups.map((group) => [group._id, group.isAvailable ?? true])
  );
  const catalog = new Map<string, CatalogEntry>();
  for (const item of items) {
    catalog.set(item._id, {
      businessId: item.businessId,
      name: item.name,
      unitPrice: item.price,
      isAvailable: item.isAvailable,
      groupAvailable: groupAvailable.get(item.groupId) ?? false,
      groups: item.customizationOptions,
    });
  }
  return catalog;
}

/**
 * Maps a policy failure to its §6.5 envelope. `PRICE_CHANGED` carries the
 * server's total; `SELECTION_INVALID` names the offending item when the failing
 * line is known. `{n}` is never substituted here — the throttle helper owns it.
 */
function basketFailureError(
  failure: BasketFailure,
  lines: readonly BasketLineInput[],
  catalog: Catalog
): ConvexError<Record<string, string | number>> {
  if (failure.code === 'SELECTION_INVALID') {
    const line = failure.lineIndex === undefined ? undefined : lines[failure.lineIndex];
    const itemName = line === undefined ? undefined : catalog.get(line.menuItemId)?.name;
    return orderError('SELECTION_INVALID', {
      message: ORDER_ERRORS.SELECTION_INVALID.message.replace(
        '{item}',
        itemName ?? 'this item'
      ),
      ...(failure.lineIndex === undefined ? {} : { lineIndex: failure.lineIndex }),
    });
  }
  if (failure.code === 'PRICE_CHANGED') {
    return orderError('PRICE_CHANGED', { actualSubtotal: failure.actualSubtotal });
  }
  // `lineIndex` lets the basket UI mark the rejected line without guessing
  // (ITEM_UNAVAILABLE / GROUP_UNAVAILABLE / QUANTITY_INVALID).
  return orderError(
    failure.code,
    failure.lineIndex === undefined ? {} : { lineIndex: failure.lineIndex }
  );
}

/**
 * Resolves a repeat of `(businessId, key)` to the original receipt, or `null`
 * when no row exists.
 *
 * A row with a different canonical hash is `IDEMPOTENCY_CONFLICT`. A row whose
 * order/access pair is missing is `INTERNAL` — this never mints a second token
 * ("one token per order", §6.2.6 L1129). Replay does not re-run supply guards
 * (D5b): the point of the fast path is that a repeat gets the original answer.
 */
async function findReplayReceipt(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  idempotencyKey: string,
  argsHash: string
) {
  const row = await ctx.db
    .query('orderIdempotency')
    .withIndex('byBusinessIdKey', (q) =>
      q.eq('businessId', businessId).eq('key', idempotencyKey)
    )
    .first();
  if (row === null) {
    return null;
  }
  if (row.argsHash !== argsHash) {
    throw orderError('IDEMPOTENCY_CONFLICT');
  }

  const [order, access] = await Promise.all([
    ctx.db.get('orders', row.orderId),
    ctx.db
      .query('orderAccess')
      .withIndex('byOrderId', (q) => q.eq('orderId', row.orderId))
      .first(),
  ]);
  if (order === null || access === null) {
    throw orderError('INTERNAL');
  }
  const business = await ctx.db.get('businesses', order.businessId);
  return projectOrderReceipt(order, access, business);
}

/**
 * Places one basket order on a `orderProtocol: 'basket'` business and returns
 * the token receipt. Order of operations (§6.2.3 L1044, §6.5 L1264, §9 L1363):
 *
 * 1. contact normalisation, then the canonical args hash (the fast path needs
 *    the hash; `canonicalArgsHash` throws on an invalid contact, so
 *    `parseContact` runs first and a malformed retry raises `CONTACT_INVALID`);
 * 2. fast-path idempotency — a conflict is raised before any supply guard;
 * 3. supply guards: approved → flag → pause/until → hours;
 * 4. catalog read, `validateBasket`, `priceBasket` (the request carries no price);
 * 5. critical section: throttle write → idempotency re-check → six inserts.
 *
 * A failed order writes nothing, so it consumes no throttle slot. `now` is read
 * once; the mutation has no client clock argument (it would defeat
 * `acceptingOrdersUntil`, the throttle window, and `expiresAt`).
 *
 * Deferred deliberately: `customerUserId` (§6.2.7 L1099 permits the anonymous
 * "no actorUserId" form) and the schema comment's 16..64 `idempotencyKey`
 * length (§6.2.3 L1041 is a comment, not a validator; no spec constant exists).
 */
export const placeOrder = mutation({
  args: {
    businessId: v.id('businesses'),
    lines: v.array(
      v.object({
        menuItemId: v.id('menuItems'),
        // `v.number()`, not `v.int64()`: the policy type is a JS number and
        // integer-ness is `validateBasket`'s rule, not the validator's.
        quantity: v.number(),
        selections: v.optional(v.array(selectionValidator)),
      })
    ),
    customerName: v.string(),
    contactPhone: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    note: v.optional(v.string()),
    expectedSubtotal: v.optional(v.union(v.number(), v.null())),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // The wire names differ from the policy names (Q6/P6): map explicitly
    // rather than passing the args object through.
    const contactInput = {
      customerName: args.customerName,
      phone: args.contactPhone,
      email: args.contactEmail,
    };

    // D5/Q1: parse first so an invalid contact raises the envelope, not the raw
    // `Error` `canonicalArgsHash` throws for invalid input. This precedes the
    // supply guards because the fast-path lookup cannot run without the hash —
    // so a malformed retry on a closed business is CONTACT_INVALID.
    const parsed = await parseContact(contactInput);
    if (!parsed.ok) {
      throw orderError('CONTACT_INVALID');
    }
    const contact = parsed.contact;

    const argsHash = await canonicalArgsHash({
      businessId: args.businessId,
      lines: args.lines,
      contact: contactInput,
      note: args.note,
      idempotencyKey: args.idempotencyKey,
    });

    // Fast path: a repeat returns the original receipt and never re-runs the
    // supply guards (D5b). Same key with different args conflicts here, before
    // any supply state can be observed.
    const replay = await findReplayReceipt(
      ctx,
      args.businessId,
      args.idempotencyKey,
      argsHash
    );
    if (replay !== null) {
      return replay;
    }

    // Supply guards, in §6.5 precedence order and before the throttle write, so
    // a failed order consumes no quota slot (`:1363`).
    const business = await ctx.db.get('businesses', args.businessId);
    if (business === null || business.status !== 'approved') {
      throw orderError('BUSINESS_UNAVAILABLE');
    }
    if (business.orderProtocol !== 'basket') {
      throw orderError('ORDERING_CLOSED', {
        message: withPhone(ORDER_ERRORS.ORDERING_CLOSED.message, business.phone),
      });
    }
    const openReason = effectiveOpenReason(business, now);
    if (openReason === 'accepting_off' || openReason === 'until_passed') {
      throw orderError('ORDERING_CLOSED', {
        message: withPhone(ORDER_ERRORS.ORDERING_CLOSED.message, business.phone),
      });
    }
    if (openReason === 'outside_hours') {
      throw orderError('OUTSIDE_HOURS', {
        message: withPhone(ORDER_ERRORS.OUTSIDE_HOURS.message, business.phone),
      });
    }

    const catalog = await loadBasketCatalog(ctx, args.businessId);
    const validation = validateBasket({ lines: args.lines, note: args.note }, catalog);
    if (!validation.ok) {
      throw basketFailureError(validation, args.lines, catalog);
    }
    const priced = priceBasket(
      { lines: args.lines, expectedSubtotal: args.expectedSubtotal },
      catalog
    );
    if (!priced.ok) {
      throw basketFailureError(priced, args.lines, catalog);
    }

    // Critical section. `claimBusinessThrottle`'s patch is the serialization
    // write; the re-check after it is what makes check-then-insert safe when a
    // concurrent transaction inserted while this one waited (OCC retry).
    await claimBusinessThrottle(ctx, { businessId: args.businessId, now });

    const replayAfterClaim = await findReplayReceipt(
      ctx,
      args.businessId,
      args.idempotencyKey,
      argsHash
    );
    if (replayAfterClaim !== null) {
      return replayAfterClaim;
    }

    // §6.2.3 L1044 step (4): contact block check, then the contact throttle.
    // Blocking first means a blocked contact burns no contact quota row. (The
    // business-wide 10-minute counter above still counts the attempt — that is
    // S1's shared cap, not a contact row.) Both run after
    // the post-claim idempotency re-check, so a duplicate submit never consumes a
    // contact slot (fast path L838 and re-check L889 both return before this).
    await assertContactNotBlocked(ctx, {
      businessId: args.businessId,
      channelHashes: await contactChannelHashes(contact),
    });
    await claimContactThrottle(ctx, {
      businessId: args.businessId,
      contactHash: parsed.contactHash,
      now,
    });

    const orderId = await ctx.db.insert('orders', {
      businessId: args.businessId,
      // The priced lines are the server's price record. `menuItemId` is the
      // catalog map key it was priced from, so the id cast is lossless.
      items: priced.items.map((line) => ({
        ...line,
        menuItemId: line.menuItemId as Id<'menuItems'>,
      })),
      subtotal: priced.subtotal ?? undefined,
      pricingSource: 'snapshot',
      customerName: contact.customerName,
      contactPhone: contact.phone,
      contactEmail: contact.email,
      note: args.note?.trim() || undefined,
      status: 'new',
      createdAt: now,
    });

    const access = await insertOrderAccess(ctx, {
      orderId,
      businessId: args.businessId,
    });

    await ctx.db.insert('orderIdempotency', {
      businessId: args.businessId,
      key: args.idempotencyKey,
      argsHash,
      orderId,
      createdAt: now,
    });
    await ctx.db.insert('orderEvents', {
      orderId,
      businessId: args.businessId,
      actorType: 'customer',
      action: 'submitted',
      toStatus: 'new',
      createdAt: now,
    });
    await ctx.db.insert('orderExpiry', {
      orderId,
      businessId: args.businessId,
      expiresAt: now + DEFAULT_TTL_MS,
    });
    // `business.ownerId` is already a `users` id (Q5): no join, same as legacy.
    // `now` is passed so the notice shares the handler's single clock read.
    await insertNotification(
      ctx,
      business.ownerId,
      {
        type: 'new_order',
        businessId: args.businessId,
        businessName: business.name,
        reason: undefined,
      },
      now
    );

    const order = await ctx.db.get('orders', orderId);
    if (order === null) {
      throw orderError('INTERNAL');
    }
    return projectOrderReceipt(order, access, business);
  },
});

/**
 * Public token-capability receipt read (§7.2 S1 L1573, §6.2.6 L1089-1093; D10).
 *
 * The token is the capability: the lookup is `orderAccess.byAccessToken` and
 * there is no identity check and no S1 throttle — 256 bits of entropy is the
 * stated control (INV-05). A miss is always the one `ORDER_NOT_FOUND` envelope
 * (error table L1296): an unknown token, an access row whose order is gone
 * (never a partial receipt), and an INV-06 scope mismatch all throw rather than
 * returning `null` (`:1573` "or null" recorded variance, Q7/P7).
 *
 * The projection is `projectOrderReceipt`, the same function `placeOrder`
 * returns, so the receipt a customer sees after committing is byte-for-byte the
 * one this query serves. A hard-deleted business omits the business block and
 * still answers (Q8); the order and its token remain valid records.
 */
export const getOrderByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const access = await ctx.db
      .query('orderAccess')
      .withIndex('byAccessToken', (q) => q.eq('accessToken', args.token))
      .first();
    const order = access === null ? null : await ctx.db.get('orders', access.orderId);
    // One envelope for all three misses: unknown token, an access row whose
    // order is gone, and an INV-06 scope mismatch.
    if (access === null || order === null || order.businessId !== access.businessId) {
      throw orderError('ORDER_NOT_FOUND');
    }

    const business = await ctx.db.get('businesses', order.businessId);
    return projectOrderReceipt(order, access, business);
  },
});

/**
 * Public visitor cancel by token (D4, REVISED). Identity-free like
 * `getOrderByToken`: the token is the capability, and every lookup miss — an
 * unknown token, an access row whose order is gone, an INV-06 scope mismatch —
 * throws the same `ORDER_NOT_FOUND` envelope, so a wrong token never reveals
 * which check failed.
 *
 * Only a `new` order may move. `cancelled` repeats are idempotent and write
 * nothing; the accepted window (`accepted`/`ready`) is `CANNOT_CANCEL`; the
 * remaining closed states are terminal. A `new` order with a due-but-unswept
 * `orderExpiry` row is expired in effect (D8): it rejects `ORDER_EXPIRED` with
 * no write, because only the system sweep may write `expired`.
 *
 * The successful move is one transaction: status patch, expiry-row cleanup
 * (plain collect + loop, zero-row tolerant for legacy backfilled orders), the
 * `customer` event, and the owner's `order_cancelled` notice.
 */
export const cancelOrder = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const access = await ctx.db
      .query('orderAccess')
      .withIndex('byAccessToken', (q) => q.eq('accessToken', args.token))
      .first();
    const order = access === null ? null : await ctx.db.get('orders', access.orderId);
    if (access === null || order === null || order.businessId !== access.businessId) {
      throw orderError('ORDER_NOT_FOUND');
    }

    switch (order.status) {
      case 'cancelled':
        // Idempotent: no event, no expiry deletion, no second notice.
        return { status: 'cancelled' as const };
      case 'accepted':
      case 'ready':
        throw orderError('CANNOT_CANCEL');
      case 'completed':
      case 'declined':
      case 'no_show':
        throw orderError('ORDER_TERMINAL');
      case 'expired':
        throw orderError('ORDER_EXPIRED');
      case 'new':
        break;
    }

    const now = Date.now();
    const expiryRows = await ctx.db
      .query('orderExpiry')
      .withIndex('byOrderId', (q) => q.eq('orderId', order._id))
      .collect();
    if (expiryRows.some((row) => row.expiresAt <= now)) {
      throw orderError('ORDER_EXPIRED');
    }

    await ctx.db.patch('orders', order._id, {
      status: 'cancelled',
      statusReason: VISITOR_CANCEL_REASON,
      statusUpdatedAt: now,
    });

    for (const row of expiryRows) {
      await ctx.db.delete(row._id);
    }

    await ctx.db.insert('orderEvents', {
      orderId: order._id,
      businessId: order.businessId,
      actorType: 'customer',
      action: 'cancelled',
      fromStatus: 'new',
      toStatus: 'cancelled',
      reason: VISITOR_CANCEL_REASON,
      createdAt: now,
    });

    const business = await ctx.db.get('businesses', order.businessId);
    if (business === null) {
      throw orderError('ORDER_NOT_FOUND');
    }
    await insertNotification(
      ctx,
      business.ownerId,
      {
        type: 'order_cancelled',
        businessId: order.businessId,
        businessName: business.name,
        reason: undefined,
      },
      now
    );

    return { status: 'cancelled' as const };
  },
});
