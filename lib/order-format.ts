// Money formatting for the basket and receipt surfaces. Menu prices are stored
// as integer cents (MONEY = 'integer-cents'); this module is the single
// display boundary and divides by 100. Pure module — no React, no Convex
// imports — so it is unit-testable with `node --test`.

const PRICE_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

/** Integer cents → `$24.50`. Prices are stored as integer cents (see
 *  `convex/orderCommitPolicy.ts` MONEY = 'integer-cents' and §6.2.4); the
 *  display layer divides by 100. */
export function formatPrice(price: number): string {
  return PRICE_FORMATTER.format(price / 100);
}

/**
 * The one label a customer sees when the total is not knowable: a basket with
 * any unpriced line yields a null subtotal, and a partial total is worse than
 * none (§6.7 "Total at pickup").
 */
export const TOTAL_AT_PICKUP = 'Total at pickup';

/** Formats a subtotal, or the pickup-total label when it is null/absent. */
export function formatSubtotal(subtotal: number | null | undefined): string {
  return subtotal === null || subtotal === undefined ? TOTAL_AT_PICKUP : formatPrice(subtotal);
}
