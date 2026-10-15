import { Badge } from '@/components/ui/badge';
import type { ListingStatus } from '@/convex/businesses/helpers';
import { cn } from '@/lib/utils';

import { getStatusChip } from './listing-status';

/** Owner-facing listing status badge. Colour supports the label, never replaces it. */
export function StatusChip({ status }: { status: ListingStatus }) {
  const chip = getStatusChip(status);

  return (
    <Badge variant="outline" className={cn('border-transparent', chip.className)} title={chip.description}>
      {chip.label}
    </Badge>
  );
}
