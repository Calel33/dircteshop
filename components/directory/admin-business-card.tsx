'use client';

import { cn } from '@/lib/utils';
import {
  FeaturedChip,
  StarRating,
  StatusChip,
  VerificationChip,
} from '@/app/admin/status-chip';
import { AdminDirectoryRow } from '@/app/admin/directory/directory-types';

/** Prototype `submittedAge`: a compact "2d ago" / "6h ago" stamp. */
function shortAge(submittedAt: number | null): string {
  if (submittedAt === null) {
    return '—';
  }

  const hours = Math.floor(Math.max(0, Date.now() - submittedAt) / 3_600_000);
  if (hours < 1) {
    return 'just now';
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * One directory card, matching the prototype's `cardB` exactly: a bold name
 * row with an optional Featured chip and the status chip, one
 * `category · location · owner` sub-line, then a verification / rating / age
 * row. Selecting a card opens the inspector; the active card keeps the
 * prototype's `.card.active` treatment (brand border plus a hairline brand
 * ring), not a generic offset ring.
 */
export function AdminBusinessCard({
  row,
  onSelect,
  selected,
}: {
  row: AdminDirectoryRow;
  onSelect: () => void;
  selected?: boolean;
}) {
  const location = [row.address.city, row.address.state].filter(Boolean).join(', ');

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected === true}
      className={cn(
        'bg-card border-border rounded-shell shadow-sm grid w-full gap-2 border p-4 text-left transition-colors',
        'hover:border-border-strong focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        selected === true && 'border-primary ring-primary shadow-md ring-1'
      )}
    >
      <span className="flex flex-wrap items-center gap-2">
        <b className="text-sm font-semibold">{row.name}</b>
        {row.isFeatured ? <FeaturedChip /> : null}
        <span className="flex-1" />
        <StatusChip status={row.status} />
      </span>

      <span className="text-muted-foreground text-xs">
        {[row.categoryName ?? 'Uncategorized', location, row.ownerName ?? 'Unknown owner']
          .filter((part) => part.length > 0)
          .join(' · ')}
      </span>

      <span className="flex flex-wrap items-center gap-2">
        <VerificationChip verified={row.isVerified} />
        <span className="flex-1" />
        <StarRating rating={row.rating} />
        <span className="text-muted-foreground text-xs">{shortAge(row.submittedAt)}</span>
      </span>
    </button>
  );
}
