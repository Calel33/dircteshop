#!/usr/bin/env node
/**
 * Pins the B4 zone-aware Open Now contract (issue #4, todo task 4).
 *
 * Open Now must be evaluated in the BUSINESS's IANA timezone against one
 * stable instant — never the browser or server clock (`Date#getHours` is
 * server-UTC on Vercel; the existing IdentityBar TODO records that bug). The
 * cases below cover same-day windows, multiple periods, closed days, overnight
 * carry-over, malformed times, timezone differences, and a DST transition.
 *
 * Run: node --test scripts/public-hours.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  businessClock,
  createBusinessFormatter,
  createOpenNowEvaluator,
  openStatusAt,
  type BusinessClock,
  type BusinessHours,
} from '../convex/businesses/publicHours.ts';

function at(weekday: number, minutes: number): BusinessClock {
  return { weekday, minutes };
}

test('openStatusAt reports open within a same-day period and closed outside it', () => {
  const hours: BusinessHours = { monday: [{ opensAt: '09:00', closesAt: '17:00' }] };

  assert.deepStrictEqual(openStatusAt(hours, at(1, 12 * 60)), { isOpen: true, closesAt: '17:00' });
  assert.deepStrictEqual(openStatusAt(hours, at(1, 8 * 60 + 59)), { isOpen: false });
  assert.deepStrictEqual(openStatusAt(hours, at(1, 17 * 60)), { isOpen: false });
});

test('openStatusAt is closed on a day without periods and does not leak other days', () => {
  const hours: BusinessHours = { friday: [{ opensAt: '09:00', closesAt: '17:00' }] };

  // Saturday 08:00-16:00 is absent: closed all day.
  assert.deepStrictEqual(openStatusAt(hours, at(6, 12 * 60)), { isOpen: false });
  // Saturday morning must not inherit Friday's non-wrapping period.
  assert.deepStrictEqual(openStatusAt(hours, at(6, 8 * 60)), { isOpen: false });
});

test('openStatusAt handles multiple periods with a midday gap', () => {
  const hours: BusinessHours = {
    wednesday: [
      { opensAt: '09:00', closesAt: '12:00' },
      { opensAt: '13:00', closesAt: '17:00' },
    ],
  };

  assert.deepStrictEqual(openStatusAt(hours, at(3, 10 * 60)), { isOpen: true, closesAt: '12:00' });
  assert.deepStrictEqual(openStatusAt(hours, at(3, 12 * 60 + 30)), { isOpen: false });
  assert.deepStrictEqual(openStatusAt(hours, at(3, 14 * 60)), { isOpen: true, closesAt: '17:00' });
});

test('openStatusAt handles an overnight period on its opening day', () => {
  const hours: BusinessHours = { friday: [{ opensAt: '22:00', closesAt: '02:00' }] };

  assert.deepStrictEqual(openStatusAt(hours, at(5, 21 * 60)), { isOpen: false });
  assert.deepStrictEqual(openStatusAt(hours, at(5, 23 * 60)), { isOpen: true, closesAt: '02:00' });
});

test('openStatusAt carries an overnight period into the next morning', () => {
  const hours: BusinessHours = { friday: [{ opensAt: '22:00', closesAt: '02:00' }] };

  assert.deepStrictEqual(openStatusAt(hours, at(6, 1 * 60)), { isOpen: true, closesAt: '02:00' });
  assert.deepStrictEqual(openStatusAt(hours, at(6, 2 * 60 + 30)), { isOpen: false });
});

test('openStatusAt ignores malformed period times', () => {
  const hours: BusinessHours = { monday: [{ opensAt: '9am', closesAt: '17:00' }] };

  assert.deepStrictEqual(openStatusAt(hours, at(1, 12 * 60)), { isOpen: false });
});

test('businessClock resolves the business-local weekday and minutes', () => {
  // 2026-01-15T06:30Z is Thursday; New York is 01:30 EST, Los Angeles 22:30 PST (Wednesday).
  const instant = Date.UTC(2026, 0, 15, 6, 30);

  assert.deepStrictEqual(businessClock(createBusinessFormatter('America/New_York'), instant), {
    weekday: 4,
    minutes: 90,
  });
  assert.deepStrictEqual(businessClock(createBusinessFormatter('America/Los_Angeles'), instant), {
    weekday: 3,
    minutes: 22 * 60 + 30,
  });
});

test('businessClock tracks a DST transition', () => {
  // US Eastern springs forward 2026-03-08 02:00 EST -> 03:00 EDT.
  const before = Date.UTC(2026, 2, 8, 6, 30); // 01:30 EST
  const after = Date.UTC(2026, 2, 8, 7, 30); // 03:30 EDT

  const formatter = createBusinessFormatter('America/New_York');
  assert.deepStrictEqual(businessClock(formatter, before), { weekday: 0, minutes: 90 });
  assert.deepStrictEqual(businessClock(formatter, after), { weekday: 0, minutes: 210 });
});

test('createOpenNowEvaluator resolves each business timezone independently', () => {
  // Monday 2026-01-12T12:00Z: London local noon (open), New York 07:00 (closed).
  const evaluator = createOpenNowEvaluator(Date.UTC(2026, 0, 12, 12, 0));
  const hours: BusinessHours = { monday: [{ opensAt: '09:00', closesAt: '17:00' }] };

  assert.equal(evaluator.isOpen(hours, 'Europe/London'), true);
  assert.equal(evaluator.isOpen(hours, 'America/New_York'), false);
});

test('createOpenNowEvaluator reports a closed business with no hours', () => {
  const evaluator = createOpenNowEvaluator(Date.UTC(2026, 0, 12, 12, 0));

  assert.deepStrictEqual(evaluator.status({}, 'America/Chicago'), { isOpen: false });
});
