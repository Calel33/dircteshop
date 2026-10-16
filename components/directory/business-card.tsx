import { BadgeCheck, Star } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { OpenStatus } from '@/convex/businesses/publicHours';
import type { PublicDirectoryResult } from '@/convex/businesses/publicProjections';
import { cn } from '@/lib/utils';

import { resolveDirectoryCardActions, type DirectoryCardAction } from './card-actions';
import { CategoryIcon } from './category-icon';

// The one shared directory card (SPEC §8). Density variants:
// - `row`  dense result/landing row (Variant B `vB-row`)
// - `mini` compact landing card (Variant B `vB-mini`)
// Both render the same `PublicDirectoryResult` projection, styles come from
// shared tokens only, and actions are capped at two working destinations.

export type BusinessCardCategory = {
  name: string;
  icon?: string;
};

type BusinessCardProps = {
  business: PublicDirectoryResult;
  category?: BusinessCardCategory;
  density: 'row' | 'mini';
};

/** Human label for the server-computed open status. */
export function openStatusLabel(status: OpenStatus): string {
  if (!status.isOpen) {
    return 'Closed';
  }

  return status.closesAt === undefined ? 'Open now' : `Open until ${status.closesAt}`;
}

function PhotoTile({
  category,
  className,
}: {
  category?: BusinessCardCategory;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'bg-primary/10 text-primary flex items-center justify-center rounded-control',
        className
      )}
    >
      <CategoryIcon name={category?.icon} className="size-6" />
    </div>
  );
}

function RatingLine({ business }: Pick<BusinessCardProps, 'business'>) {
  if (business.ratingCount === 0) {
    return <span className="text-card-muted text-xs">No reviews yet</span>;
  }

  return (
    <span className="flex items-center gap-1 text-xs font-semibold">
      <Star aria-hidden className="fill-accent text-accent size-3.5" />
      {business.rating.toFixed(1)}
      <span className="text-card-muted font-normal">({business.ratingCount})</span>
    </span>
  );
}

function OpenLine({ status }: { status: OpenStatus }) {
  return (
    <span className="text-card-muted flex items-center gap-1.5 text-xs">
      <span
        aria-hidden
        className={cn(
          'rounded-pill size-2',
          status.isOpen ? 'bg-primary' : 'bg-muted-foreground/50'
        )}
      />
      {openStatusLabel(status)}
    </span>
  );
}

function VerifiedBadge() {
  return (
    <Badge>
      <BadgeCheck aria-hidden />
      Verified
    </Badge>
  );
}

const ACTION_LABELS: Record<DirectoryCardAction['kind'], string> = {
  profile: 'View',
  call: 'Call',
  website: 'Website',
};

function CardAction({ action }: { action: DirectoryCardAction }) {
  if (action.kind === 'profile') {
    return (
      <Button variant="default" size="sm" asChild>
        <Link href={action.href}>{ACTION_LABELS.profile}</Link>
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" asChild>
      {action.kind === 'website' ? (
        <a href={action.href} target="_blank" rel="noreferrer">
          {ACTION_LABELS.website}
        </a>
      ) : (
        <a href={action.href}>{ACTION_LABELS.call}</a>
      )}
    </Button>
  );
}

/**
 * Renders no more than the two working actions resolved from the projection
 * (`resolveDirectoryCardActions`), never a placeholder workflow button.
 */
function BusinessCardActions({ business }: Pick<BusinessCardProps, 'business'>) {
  return resolveDirectoryCardActions(business).map((action) => (
    <CardAction key={action.kind} action={action} />
  ));
}

/** Dense row: photo tile, identity, rating/open line, description, address, ≤2 actions. */
function BusinessRowCard({ business, category }: BusinessCardProps) {
  return (
    <article className="bg-card text-card-foreground border-border rounded-card flex flex-col gap-3 border p-3 sm:flex-row sm:gap-gap">
      <PhotoTile category={category} className="size-20 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {category ? (
            <span className="text-primary flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
              <CategoryIcon name={category.icon} className="size-3.5" />
              {category.name}
            </span>
          ) : null}
          {business.verification.isVerified ? <VerifiedBadge /> : null}
        </div>
        <h3 className="text-base leading-tight font-semibold">
          <Link
            href={`/business/${business._id}`}
            className="hover:text-primary focus-visible:ring-ring/50 rounded-control focus-visible:ring-2 focus-visible:outline-none"
          >
            {business.name}
          </Link>
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <RatingLine business={business} />
          <OpenLine status={business.openStatus} />
        </div>
        <p className="text-card-muted line-clamp-1 text-sm">{business.description}</p>
        <p className="text-card-muted text-xs">
          {business.address.addressLine1} · {business.address.city}, {business.address.state}
        </p>
      </div>
      <div className="flex shrink-0 flex-row gap-2 sm:flex-col sm:justify-center">
        <BusinessCardActions business={business} />
      </div>
    </article>
  );
}

/** Compact card: photo banner, name, rating, category · open line. */
function BusinessMiniCard({ business, category }: BusinessCardProps) {
  return (
    <article className="bg-card text-card-foreground border-border rounded-card flex flex-col gap-2 border p-3">
      <PhotoTile category={category} className="aspect-[4/3] w-full" />
      <h3 className="text-sm leading-tight font-semibold">
        <Link
          href={`/business/${business._id}`}
          className="hover:text-primary focus-visible:ring-ring/50 rounded-control focus-visible:ring-2 focus-visible:outline-none"
        >
          {business.name}
        </Link>
      </h3>
      <RatingLine business={business} />
      <span className="text-card-muted text-xs">
        {category ? `${category.name} · ` : ''}
        {openStatusLabel(business.openStatus)}
      </span>
    </article>
  );
}

export function BusinessCard({ business, category, density }: BusinessCardProps) {
  return density === 'mini' ? (
    <BusinessMiniCard business={business} category={category} density={density} />
  ) : (
    <BusinessRowCard business={business} category={category} density={density} />
  );
}
