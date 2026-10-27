import { ConvexError, v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireBusinessOwnerUser } from './authz';
import {
  contactChannelHashesFromInput,
  maskContact,
  ORDER_ERRORS,
  parseContact,
} from './orderCommitPolicy';
import { contactThrottleKeys } from './orderThrottle';

// Owner abuse controls (issue #81, T9 / protocol §7.2 S4 L1625–1637).
//
// Two owner-managed controls live here:
//   1. the per-business block list — Q7 L1892: per business, never global; one
//      row per domain-separated channel hash (§6.2.2 L1009, `schema.ts:324`),
//      so blocking a dual-channel contact blocks both phone and email
//      (S4 L1633 "block blocks both phone and email hashes");
//   2. the audited per-business contact-throttle clear — Q8 L1893.
//
// Every export is owner-scoped through `requireBusinessOwnerUser`, which fails
// before any read. Everything that guard does not throw is a `ConvexError`
// built from `ORDER_ERRORS`, so the owner panel reads the same `{ code,
// message }` envelope as the rest of the order surface.
//
// Privacy: a raw phone/email is never stored, keyed, audited, or returned. The
// block rows hold `contactChannelHashes` digests (name-excluded — the customer
// name is free text the abuser controls); throttle keys come from
// `contactThrottleKeys`; audit `targetName` and the `listBlocked` payload carry
// the masked display form or nothing at all.
//
// `./orders` is deliberately not imported: it imports `./orderThrottle`, so a
// back edge would make a cycle. The error envelope is built inline instead.

/**
 * The audit `targetName` for an owner contact action: the masked display form
 * (`***-0100` / `a***@example.com`), one part per supplied channel. Never the
 * raw contact and never a hash.
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
function ownerActionError(
  code: 'CONTACT_INVALID' | 'ORDER_NOT_FOUND' | 'INTERNAL'
): ConvexError<Record<string, string>> {
  return new ConvexError({ code, message: ORDER_ERRORS[code].message });
}

/**
 * Blocks a contact for one business (Q7 L1892; S4 L1633).
 *
 * The owner form submits a raw phone and/or email, so normalization and the
 * per-channel domain separation happen in `contactChannelHashesFromInput` — the
 * module that owns the hash shape — and never here. A supplied-but-invalid
 * channel, or no channel at all, is `CONTACT_INVALID` so the form can show the
 * real validation error rather than a generic refusal.
 *
 * Idempotent: a `(businessId, contactHash)` pair that is already blocked is
 * skipped, so a repeated submit creates no duplicate row. The exact-range
 * `first()` read joins the read set, so a concurrent insert of the same pair
 * conflicts and the loser retries and skips (same OCC argument as
 * `orderThrottle.ts` L177–185). The audit row is written only when at least one
 * row was created; `targetName` is the masked contact, never the raw value or
 * the hash.
 */
export const blockContact = mutation({
  args: {
    businessId: v.id('businesses'),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireBusinessOwnerUser(ctx, args.businessId);

    const hashes = await contactChannelHashesFromInput({
      phone: args.phone,
      email: args.email,
    });
    if (hashes === null) {
      throw ownerActionError('CONTACT_INVALID');
    }

    const now = Date.now();
    const trimmedReason = args.reason?.trim();
    let created = 0;

    for (const contactHash of hashes) {
      const existing = await ctx.db
        .query('orderBlocks')
        .withIndex('byBusinessIdContactHash', (q) =>
          q.eq('businessId', args.businessId).eq('contactHash', contactHash)
        )
        .first();
      if (existing !== null) {
        continue;
      }

      await ctx.db.insert('orderBlocks', {
        businessId: args.businessId,
        contactHash,
        reason: trimmedReason || undefined,
        createdByUserId: user._id,
        createdAt: now,
      });
      created += 1;
    }

    if (created > 0) {
      await ctx.db.insert('auditLogs', {
        actorUserId: user._id,
        action: 'order.block_contact',
        targetType: 'order_contact',
        targetId: String(args.businessId),
        targetName: maskedContactLabel({ phone: args.phone, email: args.email }),
        reason: trimmedReason || undefined,
        createdAt: now,
      });
    }

    return { created };
  },
});

/**
 * Removes the block rows for the supplied channels (Q7 L1892 — per business).
 *
 * Hashes resolve exactly as `blockContact` resolves them, so unblocking is the
 * inverse of blocking for either or both channels. Every matching row is
 * deleted; a repeat call removes nothing and therefore writes no audit row.
 * `targetName` stays the masked display form.
 */
export const unblockContact = mutation({
  args: {
    businessId: v.id('businesses'),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireBusinessOwnerUser(ctx, args.businessId);

    const hashes = await contactChannelHashesFromInput({
      phone: args.phone,
      email: args.email,
    });
    if (hashes === null) {
      throw ownerActionError('CONTACT_INVALID');
    }

    const now = Date.now();
    let removed = 0;

    for (const contactHash of hashes) {
      // Exact `(businessId, contactHash)` range, so this reads the rows for one
      // key (normally 0 or 1) and never scans the table.
      const rows = await ctx.db
        .query('orderBlocks')
        .withIndex('byBusinessIdContactHash', (q) =>
          q.eq('businessId', args.businessId).eq('contactHash', contactHash)
        )
        .collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
        removed += 1;
      }
    }

    if (removed > 0) {
      await ctx.db.insert('auditLogs', {
        actorUserId: user._id,
        action: 'order.unblock_contact',
        targetType: 'order_contact',
        targetId: String(args.businessId),
        targetName: maskedContactLabel({ phone: args.phone, email: args.email }),
        createdAt: now,
      });
    }

    return { removed };
  },
});

/**
 * Clears both contact throttle windows for the order's contact (Q8 L1893:
 * per business and audited).
 *
 * The owner acts on an order from their board, so the name-excluded identity
 * hash is recomputed from that order's own stored contact
 * (`customerName` / `contactPhone` / `contactEmail`) — the throttle key excludes
 * the name by design (plan T1; research Q3). The order is re-read here and must
 * belong to `businessId`; an unknown or foreign order answers
 * `ORDER_NOT_FOUND` verbatim, so the caller cannot learn that another business
 * owns it.
 *
 * Only `orderThrottle` rows are deleted — never `orderBlocks` (protocol L1631:
 * cleanup is throttle-only; a block persists until the owner unblocks it).
 * `INTERNAL` covers a stored contact that no longer re-parses: the commit path
 * rejects such a contact, so this is a corrupt-row case, not user input.
 */
export const clearContactThrottle = mutation({
  args: {
    businessId: v.id('businesses'),
    orderId: v.id('orders'),
  },
  handler: async (ctx, args) => {
    const { user } = await requireBusinessOwnerUser(ctx, args.businessId);

    const order = await ctx.db.get('orders', args.orderId);
    if (order === null || order.businessId !== args.businessId) {
      // Deliberately identical for "missing" and "another business's order":
      // a cross-business id must not disclose that the order exists.
      throw ownerActionError('ORDER_NOT_FOUND');
    }

    const parsed = await parseContact({
      customerName: order.customerName,
      phone: order.contactPhone,
      email: order.contactEmail,
    });
    if (!parsed.ok) {
      // Stored contact should always re-parse: the commit path validated it
      // before insert. Reaching here means the row is corrupt, so the owner gets
      // the generic internal copy rather than a contact-validation hint.
      throw ownerActionError('INTERNAL');
    }

    const keys = contactThrottleKeys(args.businessId, parsed.contactHash);
    const now = Date.now();
    let cleared = 0;

    for (const key of [keys.tenMinutes, keys.day]) {
      const row = await ctx.db
        .query('orderThrottle')
        .withIndex('byKey', (q) => q.eq('key', key))
        .first();
      if (row !== null) {
        await ctx.db.delete(row._id);
        cleared += 1;
      }
    }

    if (cleared > 0) {
      await ctx.db.insert('auditLogs', {
        actorUserId: user._id,
        action: 'order.clear_throttle',
        targetType: 'order',
        targetId: String(args.orderId),
        targetName: maskedContactLabel({
          phone: order.contactPhone,
          email: order.contactEmail,
        }),
        createdAt: now,
      });
    }

    return { cleared };
  },
});

/**
 * The owner's block list for one business, newest first, at most 200 rows.
 *
 * `contactHash` is projected out on purpose: there is no raw contact to render,
 * and the digest is a stable identifier for a customer's phone/email — it must
 * not leave the server. The list is therefore informational (reason and time);
 * unblocking happens from the contact shown on an order row, which supplies the
 * raw phone/email `unblockContact` needs.
 *
 * The page is bounded because the block list is owner-managed and unbounded in
 * principle; the `byBusinessIdCreatedAt` index orders by `createdAt`
 * descending, so `take(200)` returns the newest page directly.
 */
export const listBlocked = query({
  args: { businessId: v.id('businesses') },
  handler: async (ctx, args) => {
    await requireBusinessOwnerUser(ctx, args.businessId);

    const rows = await ctx.db
      .query('orderBlocks')
      // Newest 200 for this one business: the `byBusinessIdCreatedAt` index
      // orders by recency, so `take(200)` after `order('desc')` keeps exactly
      // the newest page — never an arbitrary hash-ordered subset.
      .withIndex('byBusinessIdCreatedAt', (q) => q.eq('businessId', args.businessId))
      .order('desc')
      .take(200);

    // Index order is already newest first; the projection only drops
    // `contactHash` (no digest may leave the server) and `createdByUserId`.
    return rows.map((row) => ({
      _id: row._id,
      reason: row.reason,
      createdAt: row.createdAt,
    }));
  },
});
