'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface BusinessSwitcherProps {
  currentId: Id<'businesses'>;
}

/**
 * "My Businesses" switcher in the editor header. The list comes from the
 * owner-scoped `listMine`, so navigation is only ever offered among listings
 * the signed-in account owns.
 */
export function BusinessSwitcher({ currentId }: BusinessSwitcherProps) {
  const router = useRouter();
  const businesses = useQuery(api.businesses.queries.listMine);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          My Businesses
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>My Businesses</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {businesses === undefined ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : businesses.length === 0 ? (
          <DropdownMenuItem disabled>No businesses yet</DropdownMenuItem>
        ) : (
          businesses.map((business) => {
            const isCurrent = business._id === currentId;

            return (
              <DropdownMenuItem
                key={business._id}
                disabled={isCurrent}
                onSelect={() => {
                  if (!isCurrent) {
                    router.push(`/owner/business/${business._id}`);
                  }
                }}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate">{business.name}</span>
                {isCurrent ? (
                  <span className="text-muted-foreground text-xs">Current</span>
                ) : null}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
