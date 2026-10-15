import type { Doc } from '../_generated/dataModel';

// Zone-aware "Open Now" evaluation for the B4 directory (SPEC §8, todo task 4).
//
// Hours are business-local wall-clock strings; the database has no timezone
// equality index, so Open Now is computed per business against one stable
// `now` instant passed as a query argument (convex-backend issue 505: every filter
// dependency is an explicit argument so a long-lived cursor is never
// invalidated by a moving clock).
//
// The local weekday/minutes come from `Intl.DateTimeFormat` with the business
// IANA zone — never `Date#getHours()`, which is server-UTC on Vercel (the bug
// recorded in components/profile/IdentityBar.tsx). The Convex V8 isolate
// bundles ICU, and the browser does the same, so this module stays pure and
// usable from both.
//
// Pure functions + types only (no Convex runtime imports), so the behavior is
// pinned by `scripts/public-hours.test.ts`.

export type BusinessHours = Doc<'businesses'>['hours'];

/** Business-local wall clock: weekday index (0 = Sunday) and minutes since local midnight. */
export type BusinessClock = {
  weekday: number;
  minutes: number;
};

export type OpenStatus = {
  isOpen: boolean;
  closesAt?: string;
};

/** Index-aligned with `Intl.DateTimeFormat` `weekday: 'short'` output in `en-US`. */
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const DAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const satisfies readonly (keyof BusinessHours)[];

/**
 * One formatter per timezone for the whole query execution: `Intl.DateTimeFormat`
 * construction is comparatively expensive, so the evaluator reuses instances
 * (https://v8.dev/blog/intl) instead of building one per business.
 */
export function createBusinessFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Business-local weekday and minutes for `now`, read from an ICU formatter. */
export function businessClock(formatter: Intl.DateTimeFormat, now: number): BusinessClock {
  const parts = formatter.formatToParts(new Date(now));
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;

  const weekdayIndex = SHORT_WEEKDAYS.indexOf((weekday ?? '') as (typeof SHORT_WEEKDAYS)[number]);
  if (weekdayIndex === -1 || hour === undefined || minute === undefined) {
    throw new Error(`Could not read local time parts from formatter (weekday=${weekday})`);
  }

  return { weekday: weekdayIndex, minutes: Number(hour) * 60 + Number(minute) };
}

/** Parses an `HH:MM` wall-clock string to minutes since midnight; `null` when malformed. */
export function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (match === null) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function periodStatus(
  period: { opensAt: string; closesAt: string },
  clock: BusinessClock
): OpenStatus | null {
  const opensAt = toMinutes(period.opensAt);
  const closesAt = toMinutes(period.closesAt);

  if (opensAt === null || closesAt === null) {
    return null;
  }

  // A period whose close is not after its open wraps past midnight (e.g.
  // 22:00-02:00): open from `opensAt` through the end of the day, or before
  // `closesAt` in the early morning (carry-over handled by the caller).
  const wrapsMidnight = closesAt <= opensAt;
  const isOpen = wrapsMidnight
    ? clock.minutes >= opensAt
    : clock.minutes >= opensAt && clock.minutes < closesAt;

  return isOpen ? { isOpen: true, closesAt: period.closesAt } : { isOpen: false };
}

/**
 * Open status for a business-local wall clock. Checks today's periods first,
 * then yesterday's wrapping periods (an overnight 22:00-02:00 window is still
 * open at 01:00 the next day). A day with no periods is closed.
 */
export function openStatusAt(hours: BusinessHours, clock: BusinessClock): OpenStatus {
  for (const period of hours[DAY_KEYS[clock.weekday]] ?? []) {
    const status = periodStatus(period, clock);
    if (status?.isOpen) {
      return status;
    }
  }

  return overnightCarryOver(hours, clock);
}

/** Yesterday's wrapping period is still open when the local clock is before its close. */
function overnightCarryOver(hours: BusinessHours, clock: BusinessClock): OpenStatus {
  const previousDayKey = DAY_KEYS[(clock.weekday + 6) % 7];
  for (const period of hours[previousDayKey] ?? []) {
    const opensAt = toMinutes(period.opensAt);
    const closesAt = toMinutes(period.closesAt);

    // Only a wrapping period can still be open; a same-day window ended yesterday.
    if (opensAt === null || closesAt === null || closesAt > opensAt) {
      continue;
    }

    if (clock.minutes < closesAt) {
      return { isOpen: true, closesAt: period.closesAt };
    }
  }

  return { isOpen: false };
}

/**
 * Per-query-execution evaluator: memoizes one `Intl.DateTimeFormat` per
 * business timezone for the stable `now`, and is the single Open Now
 * implementation behind both the paginated list refill filter and the exact
 * count, so list and total cannot disagree.
 */
export function createOpenNowEvaluator(now: number): {
  status: (hours: BusinessHours, timeZone: string) => OpenStatus;
  isOpen: (hours: BusinessHours, timeZone: string) => boolean;
} {
  const formatters = new Map<string, Intl.DateTimeFormat>();

  const clockFor = (timeZone: string): BusinessClock => {
    let formatter = formatters.get(timeZone);
    if (formatter === undefined) {
      formatter = createBusinessFormatter(timeZone);
      formatters.set(timeZone, formatter);
    }
    return businessClock(formatter, now);
  };

  return {
    status: (hours, timeZone) => openStatusAt(hours, clockFor(timeZone)),
    isOpen: (hours, timeZone) => openStatusAt(hours, clockFor(timeZone)).isOpen,
  };
}
