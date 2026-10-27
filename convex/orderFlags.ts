import { ConvexError, v } from 'convex/values';

import { mutation } from './_generated/server';
import { requireBusinessOwnerUser } from './authz';
import { FLAG_REASONS, maskContact, ORDER_ERRORS } from './orderCommitPolicy';

// Owner fake-order flag (issue #84, T10 / protocol §7.2 S5 :1645; plan D1).
//
// A flag lives in its own `orderFlags` table, one row per order, so a mis-flag
// is correctable (`active: false`) without a compensating entry in the
// append-only `orderEvents` ledger. `transitionOrderStatus`'s action union
// (`orderPolicy.ts`) and `orderEvents.action` (`schema.ts`) are deliberately
// untouched: flagging is not a status transition.
//
// Both mutations run the owner guard before any read (`orderBlocks.ts:85`
// precedent) and scope the order to `args.businessId`; an unknown or another
// business's order answers the same `ORDER_NOT_FOUND` envelope, so a caller
// cannot learn that a foreign order exists.
//
// Idempotent: re-flagging an active flag and unflagging a non-active one are
// no-op successes with no write and therefore no audit row (INV-21 spirit;
// `orderBlocks.ts:120-130` precedent). A flag row is never deleted —
// `unflagOrder` sets `active: false`.
//
// `./orders` is deliberately not imported (documented cycle prohibition,
// `orderBlocks.ts:33-34`); the error envelope is built from `ORDER_ERRORS`.

/**
 * The closed reason list at the wire: `FLAG_REASONS` derives the validator, so
 * the handler's `args.reason` is the literal union and never arbitrary text.
 */
const flagReasonValidator = v.union(...FLAG_REASONS.map((reason) => v.literal(reason)));

/**
 * The audit `targetName` for a flag action: the order's masked contact
 * (`***-0100` / `a***@example.com`), the same shape `clearContactThrottle`
 * writes (`orderBlocks.ts:259-262`). Never the raw contact and never the
 * customer name (free text the customer controls). `targetId` carries the
 * exact order id.
 */
function maskedContactLabel(contact: { phone?: string; email?: string }): string | undefined {
  const masked = maskContact(contact);
  const parts: string[] = [];
  if (masked.phone !== undefined) {
    parts.push(masked.phone);
  }
  if (masked.email !== undefined) {
    parts.push(masked.email);
  }
  return parts.length === 0 ? undefined : parts.join(' / ');
}

/** Every non-authz failure in this module: catalog copy, never an inline string. */
function orderNotFoundError(): ConvexError<Record<string, string>> {
  return new ConvexError({
    code: 'ORDER_NOT_FOUND',
    message: ORDER_ERRORS.ORDER_NOT_FOUND.message,
  });
}

/**
 * Flags one order as a fake/abusive order (§4.4 abuse rate, §7.2 S5).
 *
 * Pipeline: owner guard → order scope guard → flag-row read → one write and,
 * only when the row actually changed, one audit row. Re-flagging an order that
 * is already active returns `{ changed: false }` and writes nothing. A
 * previously unflagged order is reactivated in place (one row per order), not
 * duplicated: the `byOrderId` read joins the read set, so a concurrent insert
 * of the same order conflicts and the loser retries into the no-op branch (the
 * `orderBlocks.ts:69-75` OCC argument).
 */
export const flagOrder = mutation({
  args: {
    businessId: v.id('businesses'),
    orderId: v.id('orders'),
    reason: flagReasonValidator,
  },
  handler: async (ctx, args) => {
    const { user } = await requireBusinessOwnerUser(ctx, args.businessId);

    const order = await ctx.db.get('orders', args.orderId);
    if (order === null || order.businessId !== args.businessId) {
      // Deliberately identical for "missing" and "another business's order":
      // a cross-business id must not disclose that the order exists.
      throw orderNotFoundError();
    }

    const existing = await ctx.db
      .query('orderFlags')
      .withIndex('byOrderId', (q) => q.eq('orderId', args.orderId))
      .first();

    if (existing !== null && existing.active) {
      return { changed: false };
    }

    const now = Date.now();
    if (existing === null) {
      await ctx.db.insert('orderFlags', {
        businessId: args.businessId,
        orderId: args.orderId,
        actorUserId: user._id,
        active: true,
        createdAt: now,
      });
    } else {
      // Re-flag after an unflag: reactivate the single row and stamp this
      // flag's actor and time, so `createdAt` is always the latest flag time.
      await ctx.db.patch(existing._id, {
        actorUserId: user._id,
        active: true,
        createdAt: now,
      });
    }

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: 'order.flag',
      targetType: 'order',
      targetId: String(args.orderId),
      targetName: maskedContactLabel({
        phone: order.contactPhone,
        email: order.contactEmail,
      }),
      reason: args.reason,
      createdAt: now,
    });

    return { changed: true };
  },
});

/**
 * Clears an active fake-order flag (a mis-flag). The row is deactivated, never
 * deleted, so the flag stays queryable and the abuse metric stops counting it.
 *
 * `{ changed: false }` when the order has no flag row or its flag is already
 * inactive: a no-op success with no audit row. The `byOrderId` read makes a
 * concurrent double-unflag serialize — the loser retries, re-reads `active:
 * false`, and returns the no-op branch.
 */
export const unflagOrder = mutation({
  args: {
    businessId: v.id('businesses'),
    orderId: v.id('orders'),
  },
  handler: async (ctx, args) => {
    const { user } = await requireBusinessOwnerUser(ctx, args.businessId);

    const order = await ctx.db.get('orders', args.orderId);
    if (order === null || order.businessId !== args.businessId) {
      throw orderNotFoundError();
    }

    const existing = await ctx.db
      .query('orderFlags')
      .withIndex('byOrderId', (q) => q.eq('orderId', args.orderId))
      .first();

    if (existing === null || !existing.active) {
      return { changed: false };
    }

    await ctx.db.patch(existing._id, { active: false });

    await ctx.db.insert('auditLogs', {
      actorUserId: user._id,
      action: 'order.unflag',
      targetType: 'order',
      targetId: String(args.orderId),
      targetName: maskedContactLabel({
        phone: order.contactPhone,
        email: order.contactEmail,
      }),
      createdAt: Date.now(),
    });

    return { changed: true };
  },
});
