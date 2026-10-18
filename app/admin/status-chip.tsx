import { cn } from '@/lib/utils';
import { DIRECTORY_STATUS_LABELS, type DirectoryListingStatus } from './directory/directory-types';

/**
 * The prototype's `.chip` vocabulary (`admin-workspace.html`, Variant B).
 * One pill shape, one tone per role; every tone pairs a soft fill with its
 * hairline border and a dark text role, so status is never conveyed by colour
 * alone. Tones come from the `--brand-*` / `--success-*` / `--warning-*` /
 * `--danger-*` / `--info-*` triples added to `globals.css`.
 */
const CHIP_CLASS =
  'inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-xs font-semibold whitespace-nowrap';

const STATUS_TONE: Record<DirectoryListingStatus, string> = {
  draft: 'bg-neutral-chip text-neutral-chip-foreground border-border-strong',
  pendingReview: 'bg-warning-soft text-warning-strong border-warning-border',
  approved: 'bg-success-soft text-success-strong border-success-border',
  changesRequested: 'bg-info-soft text-info-strong border-info-border',
  rejected: 'bg-danger-soft text-danger-strong border-danger-border',
  suspended: 'bg-neutral-chip text-neutral-chip-foreground border-border-strong',
};

/** Listing status chip (prototype `.chip` + `STATUS[status].chip`). */
export function StatusChip({
  status,
  className,
}: {
  status: DirectoryListingStatus;
  className?: string;
}) {
  return (
    <span className={cn(CHIP_CLASS, STATUS_TONE[status], className)}>
      {DIRECTORY_STATUS_LABELS[status]}
    </span>
  );
}

/** Verified / unverified chip (prototype `vtag`). */
export function VerificationChip({ verified }: { verified: boolean }) {
  return (
    <span
      className={cn(
        CHIP_CLASS,
        verified
          ? 'bg-success-soft text-success-strong border-success-border'
          : 'bg-neutral-chip text-neutral-chip-foreground border-border-strong'
      )}
    >
      {verified ? 'Verified' : 'Unverified'}
    </span>
  );
}

/** Featured pin chip (prototype `.chip.blue`). */
export function FeaturedChip() {
  return (
    <span className={cn(CHIP_CLASS, 'bg-brand-soft text-brand-strong border-brand-border')}>
      Featured
    </span>
  );
}

/**
 * Prototype `stars`: the amber star plus one decimal, or a muted dash when the
 * listing has no rating yet. The visible glyph is decorative; the accessible
 * name carries the value.
 */
export function StarRating({ rating }: { rating: number }) {
  if (!rating) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <span aria-label={`${rating.toFixed(1)} out of 5`} className="text-tiny tabular-nums">
      <span aria-hidden="true" className="text-star">
        ★
      </span>{' '}
      {rating.toFixed(1)}
    </span>
  );
}
