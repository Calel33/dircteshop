import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TOTAL_AT_PICKUP, formatPrice, formatSubtotal } from './order-format.ts';

test('formats integer cents as USD', () => {
  assert.equal(formatPrice(0), '$0.00');
  assert.equal(formatPrice(2450), '$24.50');
  assert.equal(formatPrice(100000), '$1,000.00');
});

test('a null subtotal is the pickup-total label, never a partial sum', () => {
  assert.equal(formatSubtotal(null), TOTAL_AT_PICKUP);
  assert.equal(formatSubtotal(undefined), TOTAL_AT_PICKUP);
  assert.equal(formatSubtotal(2450), '$24.50');
});
