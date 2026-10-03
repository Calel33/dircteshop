import { Badge } from '@/components/ui/badge';
import type { ListingStatus } from '@/convex/businesses/helpers';

import { getStatusChip } from './listing-status';

/** Owner-facing listing status badge. Colour supports the label, never replaces it. */
export function StatusChip({ status }: { status: ListingStatus }) {
  const chip = getStatusChip(status);

  return (
    <Badge variant={chip.variant} title={chip.description}>
      {chip.label}
    </Badge>
  );
}
