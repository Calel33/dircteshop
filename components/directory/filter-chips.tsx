'use client';

import { Clock, Info, Star, X } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { DirectoryFilterState } from '@/convex/businesses/directoryQuery';
import { cn } from '@/lib/utils';

// SPEC §8 chips: Open Now and Highly Rated are real filters; Trending,
// Special Offers, and Nearby render disabled with an explanatory tooltip.
//
// Accessibility note: the disabled chips use `aria-disabled` instead of the
// native `disabled` attribute. A natively disabled control receives no pointer
// or focus events (MDN), so a Radix TooltipTrigger around it could only ever
// open on hover — never on keyboard focus. `aria-disabled` keeps the chip
// focusable and the tooltip fires on both; activation is genuinely blocked by
// the guarded no-op handlers, since `aria-disabled` alone does not prevent it.

type FilterChipsProps = {
  filters: DirectoryFilterState;
  onChange: (filters: DirectoryFilterState) => void;
};

const DISABLED_CHIPS = [
  {
    key: 'trending',
    label: 'Trending',
    tooltip: 'Trending is admin-curated (isFeatured), not a visitor filter in v1.',
  },
  {
    key: 'offers',
    label: 'Special Offers',
    tooltip: 'No offers field exists in v1 — deferred with the offers decision.',
  },
  {
    key: 'nearby',
    label: 'Nearby',
    tooltip: 'Location services are deferred in v1 (no geolocation).',
  },
] as const;

const CHIP_BASE =
  'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

export function FilterChips({ filters, onChange }: FilterChipsProps) {
  const activeCount = (filters.openNow ? 1 : 0) + (filters.highlyRated ? 1 : 0);

  return (
    <div
      role="group"
      aria-label="Filters"
      className="flex flex-wrap items-center gap-2 max-lg:flex-nowrap max-lg:overflow-x-auto max-lg:pb-1"
    >
      <button
        type="button"
        aria-pressed={filters.openNow}
        data-testid="chip-open-now"
        onClick={() => onChange({ ...filters, openNow: !filters.openNow })}
        className={cn(
          CHIP_BASE,
          filters.openNow
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card text-card-foreground hover:border-primary/60'
        )}
      >
        <Clock aria-hidden className="size-3.5" />
        Open Now
      </button>

      <button
        type="button"
        aria-pressed={filters.highlyRated}
        data-testid="chip-highly-rated"
        onClick={() => onChange({ ...filters, highlyRated: !filters.highlyRated })}
        className={cn(
          CHIP_BASE,
          filters.highlyRated
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card text-card-foreground hover:border-primary/60'
        )}
      >
        <Star aria-hidden className="size-3.5" />
        Highly Rated
      </button>

      {DISABLED_CHIPS.map((chip) => (
        <Tooltip key={chip.key}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-disabled="true"
              data-testid={`chip-${chip.key}`}
              onClick={(event) => event.preventDefault()}
              className={cn(CHIP_BASE, 'border-border bg-muted/60 text-card-muted cursor-not-allowed')}
            >
              <Info aria-hidden className="size-3.5" />
              {chip.label}
            </button>
          </TooltipTrigger>
          <TooltipContent>{chip.tooltip}</TooltipContent>
        </Tooltip>
      ))}

      {activeCount > 0 ? (
        <button
          type="button"
          data-testid="chip-clear-filters"
          onClick={() => onChange({ openNow: false, highlyRated: false })}
          className={cn(CHIP_BASE, 'border-transparent bg-transparent text-primary hover:bg-muted')}
        >
          <X aria-hidden className="size-3.5" />
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
