import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EMPTY_BASKET,
  MAX_BASKET_LINES,
  MAX_BASKET_UNITS,
  MAX_LINE_QUANTITY,
  basketReducer,
  basketStorageKey,
  basketSubtotal,
  basketTotalUnits,
  clearStoredBasket,
  loadBasket,
  parseStoredBasket,
  saveBasket,
  type BasketLine,
  type BasketState,
  type BasketStorage,
} from './basket.ts';

function line(overrides: Partial<BasketLine> = {}): BasketLine {
  return {
    id: 'line-1',
    menuItemId: 'item-1',
    name: 'Bowl',
    unitTotal: 1200,
    quantity: 1,
    selections: [],
    ...overrides,
  };
}

function state(lines: BasketLine[]): BasketState {
  return { ...EMPTY_BASKET, lines };
}

function fakeStorage(): { storage: BasketStorage; raw: () => string | null; keys: string[] } {
  let value: string | null = null;
  const keys: string[] = [];
  return {
    storage: {
      getItem: (key) => {
        keys.push(key);
        return value;
      },
      setItem: (key, next) => {
        keys.push(key);
        value = next;
      },
      removeItem: (key) => {
        keys.push(key);
        value = null;
      },
    },
    raw: () => value,
    keys,
  };
}

test('add clamps a line quantity to 1..20', () => {
  const low = basketReducer(EMPTY_BASKET, {
    type: 'add',
    line: line({ id: 'a', quantity: 0 }),
  });
  const high = basketReducer(EMPTY_BASKET, {
    type: 'add',
    line: line({ id: 'b', quantity: 21 }),
  });

  assert.equal(low.lines[0]?.quantity, 1);
  assert.equal(high.lines[0]?.quantity, MAX_LINE_QUANTITY);
});

test('add stops at the 20-line cap', () => {
  const full = state(
    Array.from({ length: MAX_BASKET_LINES }, (_, index) => line({ id: `line-${index}` }))
  );
  const next = basketReducer(full, { type: 'add', line: line({ id: 'overflow' }) });

  assert.equal(next, full);
  assert.equal(next.lines.length, MAX_BASKET_LINES);
});

test('add clamps a line to the remaining 100-unit budget', () => {
  const nearFull = state([
    line({ id: 'a', quantity: 20 }),
    line({ id: 'b', quantity: 20 }),
    line({ id: 'c', quantity: 20 }),
    line({ id: 'd', quantity: 20 }),
    line({ id: 'e', quantity: 10 }),
  ]);
  const next = basketReducer(nearFull, { type: 'add', line: line({ id: 'f', quantity: 20 }) });

  assert.equal(next.lines.at(-1)?.quantity, 10);
  assert.equal(basketTotalUnits(next.lines), MAX_BASKET_UNITS);

  const rejected = basketReducer(next, { type: 'add', line: line({ id: 'g', quantity: 1 }) });
  assert.equal(rejected, next);
});

test('setQuantity clamps to the line cap and the total-unit cap', () => {
  const current = state([line({ id: 'a', quantity: 2 }), line({ id: 'b', quantity: 90 })]);
  // 90 units used by b, so a may grow to 10 only.
  const capped = basketReducer(current, { type: 'setQuantity', lineId: 'a', quantity: 20 });
  assert.equal(capped.lines[0]?.quantity, 10);

  const lowered = basketReducer(capped, { type: 'setQuantity', lineId: 'a', quantity: 0 });
  assert.equal(lowered.lines[0]?.quantity, 1);
});

test('setQuantity ignores an unknown line', () => {
  const current = state([line({ id: 'a' })]);
  assert.equal(
    basketReducer(current, { type: 'setQuantity', lineId: 'missing', quantity: 3 }),
    current
  );
});

test('remove drops the line and its unavailable marker', () => {
  const current = basketReducer(
    state([line({ id: 'a' }), line({ id: 'b' })]),
    { type: 'markUnavailable', lineIds: ['a'] }
  );
  const next = basketReducer(current, { type: 'remove', lineId: 'a' });

  assert.deepEqual(next.lines, [line({ id: 'b' })]);
  assert.deepEqual(next.unavailableLineIds, []);
});

test('markUnavailable keeps the rest of the basket and only known lines', () => {
  const current = state([line({ id: 'a' }), line({ id: 'b' })]);
  const next = basketReducer(current, { type: 'markUnavailable', lineIds: ['b', 'ghost'] });

  assert.equal(next.lines.length, 2);
  assert.deepEqual(next.unavailableLineIds, ['b']);
});

test('subtotal multiplies each line and is null when any line is unpriced', () => {
  assert.equal(
    basketSubtotal([line({ unitTotal: 1200, quantity: 2 }), line({ unitTotal: 350, quantity: 3 })]),
    3450
  );
  assert.equal(basketSubtotal([line({ unitTotal: 1200 }), line({ unitTotal: undefined })]), null);
});

test('hydrate marks a restored basket and re-applies the caps', () => {
  const restored = basketReducer(EMPTY_BASKET, {
    type: 'hydrate',
    lines: [line({ id: 'a', quantity: 0 }), line({ id: 'b', quantity: 21 })],
  });

  assert.equal(restored.restored, true);
  assert.deepEqual(
    restored.lines.map((entry) => entry.quantity),
    [1, 20]
  );

  const dismissed = basketReducer(restored, { type: 'dismissRestored' });
  assert.equal(dismissed.restored, false);
});

test('clear resets lines, markers, and the restored note', () => {
  const current = basketReducer(
    basketReducer(EMPTY_BASKET, { type: 'hydrate', lines: [line()] }),
    { type: 'markUnavailable', lineIds: ['line-1'] }
  );
  assert.deepEqual(basketReducer(current, { type: 'clear' }), EMPTY_BASKET);
});

test('basketStorageKey is versioned and business-scoped', () => {
  assert.equal(basketStorageKey('abc123'), 'lc:basket:abc123:v1');
});

test('basket storage round-trips lines and the idempotency key', () => {
  const { storage, raw, keys } = fakeStorage();
  const lines = [line({ id: 'a', quantity: 2 }), line({ id: 'b', unitTotal: undefined })];

  saveBasket(storage, 'biz', lines, 'key-1');

  assert.equal(keys[0], 'lc:basket:biz:v1');
  const loaded = loadBasket(storage, 'biz');
  assert.deepEqual(loaded?.lines[0], lines[0]);
  assert.equal(loaded?.lines[1]?.id, 'b');
  assert.equal(loaded?.lines[1]?.unitTotal, undefined);
  assert.equal(loaded?.submitKey, 'key-1');
  assert.ok(raw()?.includes('"v":1'));

  clearStoredBasket(storage, 'biz');
  assert.equal(loadBasket(storage, 'biz'), null);
});

test('the persisted payload carries no contact data', () => {
  const { storage, raw } = fakeStorage();
  saveBasket(storage, 'biz', [line()], 'key-1');

  const payload = JSON.parse(raw() ?? '{}') as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ['lines', 'submitKey', 'v']);

  const persistedLine = (payload.lines as Record<string, unknown>[])[0];
  assert.deepEqual(Object.keys(persistedLine).sort(), [
    'id',
    'menuItemId',
    'name',
    'quantity',
    'selections',
    'unitTotal',
  ]);
});

test('a mismatched storage version is discarded', () => {
  const raw = JSON.stringify({ v: 2, lines: [], submitKey: 'key' });
  assert.equal(parseStoredBasket(raw), null);
});

test('malformed storage payloads are discarded, not repaired', () => {
  assert.equal(parseStoredBasket(null), null);
  assert.equal(parseStoredBasket('not json'), null);
  assert.equal(parseStoredBasket(JSON.stringify({ v: 1, lines: 'nope' })), null);
  assert.equal(parseStoredBasket(JSON.stringify({ v: 1, lines: [], submitKey: 'k' })), null);
  assert.equal(
    parseStoredBasket(
      JSON.stringify({ v: 1, lines: [{ id: 'a', menuItemId: 'm', name: 'n', quantity: 21 }] })
    ),
    null
  );
});

test('a valid payload drops invalid lines but keeps the rest', () => {
  const raw = JSON.stringify({
    v: 1,
    submitKey: 'key-1',
    lines: [
      { id: 'a', menuItemId: 'm', name: 'Good', quantity: 1, selections: [] },
      { id: 'b', menuItemId: 'm', name: 'Bad', quantity: 0, selections: [] },
    ],
  });

  const parsed = parseStoredBasket(raw);
  assert.deepEqual(
    parsed?.lines.map((entry) => entry.id),
    ['a']
  );
});

test('missing storage means an empty basket, and saving is a no-op', () => {
  assert.equal(loadBasket(null, 'biz'), null);
  saveBasket(null, 'biz', [line()], 'key');
  clearStoredBasket(null, 'biz');
});
