import Link from 'next/link';
import type { FunctionReturnType } from 'convex/server';

import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { getStatusChip } from './listing-status';
import { StatusChip } from './status-chip';

/** One owned-listing summary as returned by `businesses.queries.listMine`. */
type OwnerListing = FunctionReturnType<typeof api.businesses.queries.listMine>[number];

const updatedAtFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

interface BusinessCardProps {
  business: OwnerListing;
  categoryName?: string;
}

/**
 * Presentational card for one owned listing (prototype `.biz-card`,
 * owner-workspace.html L108-114/L825-838): thumbnail initial, name + status
 * chip, a "category · Updated {date}" meta line, and a status-dependent action
 * that opens the editor route (`/owner/business/[id]`).
 */
export function BusinessCard({ business, categoryName }: BusinessCardProps) {
  const updatedAt = business.lastSavedAt ?? business.lastUpdatedAt;
  const chip = getStatusChip(business.status);

  return (
    <Card className="rounded-card gap-gap p-gap flex-row items-start">
      <div
        aria-hidden="true"
        className="bg-primary/15 text-foreground flex size-14 shrink-0 items-center justify-center rounded-control text-lg font-extrabold"
      >
        {(business.name || '?').charAt(0).toUpperCase()}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-base font-semibold">{business.name || 'Untitled listing'}</h3>
          <StatusChip status={business.status} />
        </div>
        <p className="text-card-muted text-xs">
          {categoryName ?? '—'} · Updated {updatedAtFormatter.format(updatedAt)}
        </p>
        <div className="mt-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/owner/business/${business._id}`}>{chip.actionLabel}</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
