import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConvexError } from 'convex/values';

import { ORDER_ERROR_CODES } from '../convex/orderCommitPolicy.ts';
import {
  NETWORK_ERROR,
  ORDER_ERROR_COPY,
  isOrderErrorCode,
  resolveOrderError,
} from './order-errors.ts';

test('every §6.5 code has customer copy and a recovery action', () => {
  for (const code of ORDER_ERROR_CODES) {
    const entry = ORDER_ERROR_COPY[code];
    assert.ok(entry, `missing map entry for ${code}`);
    assert.ok(entry.copy.length > 0, `empty copy for ${code}`);
    assert.ok(entry.recoveryAction.length > 0, `empty recovery for ${code}`);
    assert.notEqual(entry.recovery, undefined);
    assert.equal(isOrderErrorCode(code), true);
  }
});

test('reads the object envelope and its total', () => {
  const error = new ConvexError({
    code: 'PRICE_CHANGED',
    message: 'Prices changed while you were ordering.',
    actualSubtotal: 2450,
  });

  const resolved = resolveOrderError(error);
  assert.equal(resolved.code, 'PRICE_CHANGED');
  assert.equal(resolved.copy, ORDER_ERROR_COPY.PRICE_CHANGED.copy);
  assert.equal(resolved.recovery, 'reconfirm');
  assert.equal(resolved.actualSubtotal, 2450);
});

test('carries the rejected line index for supply errors', () => {
  const resolved = resolveOrderError(
    new ConvexError({ code: 'ITEM_UNAVAILABLE', lineIndex: 2 })
  );

  assert.equal(resolved.code, 'ITEM_UNAVAILABLE');
  assert.equal(resolved.lineIndex, 2);
  assert.equal(resolved.recovery, 'refresh-menu');
});

test('substitutes the phone and the retry minutes', () => {
  const closed = resolveOrderError(new ConvexError({ code: 'ORDERING_CLOSED' }), {
    phone: '+1 555 0100',
  });
  assert.ok(closed.copy.includes('+1 555 0100'));

  const throttled = resolveOrderError(
    new ConvexError({ code: 'TOO_MANY_REQUESTS', retryAfterMs: 120_000 })
  );
  assert.ok(throttled.copy.includes('2 minutes'));
});

test('never renders raw Convex or framework text', () => {
  const internal = resolveOrderError(
    new ConvexError({ code: 'INTERNAL', message: 'stack: /convex/_generated/server.js' })
  );
  assert.equal(internal.copy, ORDER_ERROR_COPY.INTERNAL.copy);
  assert.ok(!internal.copy.includes('stack'));

  const legacyString = resolveOrderError(new ConvexError('This item is not available for ordering.'));
  assert.equal(legacyString.code, 'INTERNAL');
  assert.equal(legacyString.copy, ORDER_ERROR_COPY.INTERNAL.copy);

  const unknown = resolveOrderError(new ConvexError({ code: 'SOMETHING_NEW' }));
  assert.equal(unknown.code, 'INTERNAL');

  const thrown = new Error('boom at line 42 of orders.ts');
  assert.equal(thrown.message.length > 0, true);
  const network = resolveOrderError(thrown);
  assert.equal(network.code, 'NETWORK');
  assert.equal(network.copy, NETWORK_ERROR.copy);
  assert.ok(!network.copy.includes('boom'));
});
