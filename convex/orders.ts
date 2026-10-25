import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { requireBusinessOwner } from './authz';
import { insertNotification } from './notificationHelpers';
import { insertOrderAccess } from './orderAccess';
import {
  canonicalArgsHash,
  DEFAULT_TTL_MS,
  effectiveOpenReason,
  maskContact,
  ORDER_ERRORS,
  parseContact,
  priceBasket,
  validateBasket,
} from './orderCommitPolicy';
import type {
  BasketFailure,
  BasketLineInput,
  Catalog,
  CatalogEntry,
  OrderErrorCode,
} from './orderCommitPolicy';
import {
  isLegacyOrderStatus,
  nextOrderStatus,
  validateOrderContact,
  validateOrderSelections,
} from './orderPolicy';
import { claimBusinessThrottle } from './orderThrottle';

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
 */
function projectOrderRow(order: Doc<'orders'>, legacyItem: Doc<'menuItems'> | null) {
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
    itemName: snapshot?.name ?? legacyItem?.name ?? 'Unavailable item',
    itemPrice,
    pricingSource: order.pricingSource ?? null,
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
    createdAt: order.createdAt,
  };
}

/**
 * Owner-only board read: newest first and bounded. `byBusinessId` appends
 * `_creationTime` as its tie-breaker, so descending order on the equality range
 * is descending creation time.
 *
 * Rows carry both order shapes during expand: a committed `items[]` snapshot
 * wins; a legacy-only row falls back to the live menu item (one read per
 * distinct `menuItemId`; a deleted item degrades to a placeholder instead of
 * failing the board). A `legacyUnknown` row never borrows the live price — the
 * historical price is unrecoverable (protocol §6.2.9 / R11).
 */
export const listOrders = query({
  args: { businessId: v.id('businesses') },
  handler: async (ctx, args) => {
    await requireBusinessOwner(ctx, args.businessId);

    const orders = await ctx.db
      .query('orders')
      .withIndex('byBusinessId', (q) => q.eq('businessId', args.businessId))
      .order('desc')
      .take(ORDER_LIST_LIMIT);

    // Only legacy-shaped rows need the live menu join; snapshot rows already
    // carry their own name, price and selections.
    const legacyItemIds: Id<'menuItems'>[] = [];
    for (const order of orders) {
      if (order.items === undefined && order.menuItemId !== undefined) {
        legacyItemIds.push(order.menuItemId);
      }
    }
    const uniqueItemIds = [...new Set(legacyItemIds)];
    const items = await Promise.all(
      uniqueItemIds.map((itemId) => ctx.db.get('menuItems', itemId))
    );
    const itemById = new Map<Id<'menuItems'>, Doc<'menuItems'> | null>(
      uniqueItemIds.map((itemId, index) => [itemId, items[index]])
    );

    return orders.map((order) => {
      const legacyItem =
        order.items === undefined && order.menuItemId !== undefined
          ? itemById.get(order.menuItemId) ?? null
          : null;
      return projectOrderRow(order, legacyItem);
    });
  },
});

/**
 * Owner-only forward-only transition. The client supplies an action; the target
 * status is resolved server-side by `nextOrderStatus`, and anything other than
 * the one legal next step is rejected with a user-facing error.
 *
 * `orders.status` is widened to the protocol's 8-state union (§6.2.2), but the
 * 4-state machine cannot represent the four new states and nothing writes them
 * until T3. A row already in one is rejected rather than misjudged.
 */
export const transitionOrderStatus = mutation({
  args: {
    businessId: v.id('businesses'),
    orderId: v.id('orders'),
    action: v.union(v.literal('accept'), v.literal('ready'), v.literal('complete')),
  },
  handler: async (ctx, args) => {
    await requireBusinessOwner(ctx, args.businessId);

    const order = await ctx.db.get('orders', args.orderId);
    if (order === null || order.businessId !== args.businessId) {
      throw new ConvexError('Order not found');
    }

    if (!isLegacyOrderStatus(order.status)) {
      throw new ConvexError('Invalid status transition');
    }

    const target = nextOrderStatus(order.status, args.action);
    if (target === null) {
      throw new ConvexError('Invalid status transition');
    }

    await ctx.db.patch('orders', args.orderId, { status: target });
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
  extras: { message?: string; actualSubtotal?: number } = {}
): ConvexError<Record<string, string | number>> {
  const data: Record<string, string | number> = {
    code,
    message: extras.message ?? ORDER_ERRORS[code].message,
  };
  if (extras.actualSubtotal !== undefined) {
    data.actualSubtotal = extras.actualSubtotal;
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
    });
  }
  if (failure.code === 'PRICE_CHANGED') {
    return orderError('PRICE_CHANGED', { actualSubtotal: failure.actualSubtotal });
  }
  return orderError(failure.code);
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
