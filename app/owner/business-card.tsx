import Link from 'next/link';
import type { FunctionReturnType } from 'convex/server';

import { api } from '@/convex/_generated/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { StatusChip } from './status-chip';

/** One owned-listing summary as returned by `businesses.queries.listMine`. */
type OwnerListing = FunctionReturnType<typeof api.businesses.queries.listMine>[number];

const updatedAtFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

interface BusinessCardProps {
  business: OwnerListing;
  categoryName?: string;
}

/**
 * Presentational card for one owned listing. Links to the editor route
 * (`/owner/business/[id]`), which this PR ships.
 */
export function BusinessCard({ business, categoryName }: BusinessCardProps) {
  const updatedAt = business.lastSavedAt ?? business.lastUpdatedAt;

  return (
    <Link
      href={`/owner/business/${business._id}`}
      className="block h-full rounded-card focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Card className="h-full gap-gap rounded-card py-card transition-colors hover:border-primary/60">
        <CardHeader>
          <CardTitle className="text-base font-semibold">{business.name}</CardTitle>
          {categoryName ? <p className="text-muted-foreground text-sm">{categoryName}</p> : null}
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <StatusChip status={business.status} />
          <span className="text-muted-foreground font-label text-xs">
            Updated {updatedAtFormatter.format(updatedAt)}
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}
