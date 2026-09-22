import { BadgeCheck, Clock, Star } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

import type { BusinessHours, PublicBusiness } from './profile-types';

const DAY_KEYS: readonly (keyof BusinessHours)[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

type OpenStatus = {
  isOpen: boolean;
  closesAt?: string;
};

function toMinutes(value: string): number | null {
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

/**
 * Compare the current time against today's opening periods.
 *
 * TODO(#2): `now` is the server clock (UTC on Vercel) while `hours` are
 * business-local wall-clock times, so this status is wrong for any business
 * outside the server's timezone. A correct fix needs a `timezone` field on
 * `businesses` (SPEC §7) and zone-aware evaluation; that field arrives in a
 * follow-up to #2, so the limitation is recorded here per AGENTS.md §10.
 */
function getOpenStatus(hours: BusinessHours, now: Date): OpenStatus {
  const periods = hours[DAY_KEYS[now.getDay()]] ?? [];
  const current = now.getHours() * 60 + now.getMinutes();

  for (const period of periods) {
    const opensAt = toMinutes(period.opensAt);
    const closesAt = toMinutes(period.closesAt);

    if (opensAt === null || closesAt === null) {
      continue;
    }

    // A period whose close is not after its open wraps past midnight (e.g.
    // 22:00-02:00): open from `opensAt` through the end of the day, or before
    // `closesAt` in the early morning.
    const wrapsMidnight = closesAt <= opensAt;
    const isOpen = wrapsMidnight
      ? current >= opensAt || current < closesAt
      : current >= opensAt && current < closesAt;

    if (isOpen) {
      return { isOpen: true, closesAt: period.closesAt };
    }
  }

  return { isOpen: false };
}

export type IdentityBarProps = {
  business: PublicBusiness;
  categoryName: string;
  now?: Date;
};

/** Name, category, verified badge, rating, and open-until status. */
export function IdentityBar({ business, categoryName, now = new Date() }: IdentityBarProps) {
  const status = getOpenStatus(business.hours, now);
  const hasRating = business.ratingCount > 0;
  const reviewLabel = business.ratingCount === 1 ? 'review' : 'reviews';

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{categoryName}</Badge>
        {business.verification.isVerified ? (
          <Badge>
            <BadgeCheck aria-hidden />
            Verified
          </Badge>
        ) : null}
        {status.isOpen ? (
          <Badge variant="outline">
            <Clock aria-hidden />
            {status.closesAt === undefined ? 'Open now' : `Open until ${status.closesAt}`}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Closed
          </Badge>
        )}
      </div>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{business.name}</h1>
      {hasRating ? (
        <p className="text-muted-foreground flex items-center gap-1 text-sm">
          <Star aria-hidden className="size-3.5 fill-current" />
          <span className="text-foreground font-medium">{business.rating.toFixed(1)}</span>
          <span>
            ({business.ratingCount} {reviewLabel})
          </span>
        </p>
      ) : (
        <p className="text-muted-foreground text-sm">No reviews yet</p>
      )}
    </header>
  );
}
