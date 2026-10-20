import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { requireBusinessOwner } from './authz';
import { insertNotification } from './notificationHelpers';
import { nextOrderStatus, validateOrderContact, validateOrderSelections } from './orderPolicy';

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
 * Owner-only board read: newest first and bounded. `byBusinessId` appends
 * `_creationTime` as its tie-breaker, so descending order on the equality range
 * is descending creation time. Item name/price are read once per distinct
 * `menuItemId`; a deleted item degrades to a placeholder instead of failing the
 * board. No price snapshot exists in v1 (plan §3), so the price shown is the
 * item's current price.
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

    const itemIds = [...new Set(orders.map((order) => order.menuItemId))];
    const items = await Promise.all(itemIds.map((itemId) => ctx.db.get('menuItems', itemId)));
    const itemById = new Map<Id<'menuItems'>, Doc<'menuItems'> | null>(
      itemIds.map((itemId, index) => [itemId, items[index]])
    );

    return orders.map((order) => {
      const item = itemById.get(order.menuItemId) ?? null;
      return {
        _id: order._id,
        menuItemId: order.menuItemId,
        itemName: item?.name ?? 'Unavailable item',
        itemPrice: item?.price ?? null,
        selections: order.selections,
        customerName: order.customerName,
        contactPhone: order.contactPhone ?? null,
        contactEmail: order.contactEmail ?? null,
        note: order.note ?? null,
        status: order.status,
        createdAt: order.createdAt,
      };
    });
  },
});

/**
 * Owner-only forward-only transition. The client supplies an action; the target
 * status is resolved server-side by `nextOrderStatus`, and anything other than
 * the one legal next step is rejected with a user-facing error.
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
