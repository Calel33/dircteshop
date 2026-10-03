'use client';

import { useState } from 'react';
import { UserButton } from '@clerk/nextjs';
import { useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { BusinessCard } from './business-card';
import { CreateBusinessForm } from './create-business-form';

/**
 * Signed-in owner hub: every owned listing as a card with its status chip,
 * an "Add Your Business" entry, and an empty state. Reads are owner-scoped in
 * Convex (`listMine`) — the client never filters by owner.
 */
export function OwnerBusinesses() {
  const businesses = useQuery(api.businesses.queries.listMine);
  const categories = useQuery(api.categories.listOrdered);
  const [isCreating, setIsCreating] = useState(false);

  const categoryNames = new Map(
    (categories ?? []).map((category) => [category._id, category.name])
  );

  return (
    <div className="flex flex-col gap-gap">
      <header className="flex flex-wrap items-center justify-between gap-gap">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold">Your businesses</h1>
          <p className="text-muted-foreground text-sm">
            Manage your listings and track their review status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setIsCreating(true)} disabled={isCreating}>
            Add Your Business
          </Button>
          <UserButton />
        </div>
      </header>

      {isCreating ? <CreateBusinessForm onCancel={() => setIsCreating(false)} /> : null}

      {businesses === undefined ? (
        <BusinessGridSkeleton />
      ) : businesses.length === 0 ? (
        isCreating ? null : <EmptyState onAdd={() => setIsCreating(true)} />
      ) : (
        <ul className="grid grid-cols-1 gap-gap sm:grid-cols-2 lg:grid-cols-3">
          {businesses.map((business) => (
            <li key={business._id}>
              <BusinessCard
                business={business}
                categoryName={categoryNames.get(business.categoryId)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <Card className="rounded-card py-card text-center">
      <CardHeader>
        <CardTitle className="font-display text-lg">No businesses yet</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <p className="text-muted-foreground max-w-prose text-sm">
          Add your first listing to get started. You can fill in the details in the editor.
        </p>
        <Button onClick={onAdd}>Add Your Business</Button>
      </CardContent>
    </Card>
  );
}

function BusinessGridSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-gap sm:grid-cols-2 lg:grid-cols-3"
      aria-busy="true"
      aria-label="Loading your businesses"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-32 rounded-card" />
      ))}
    </div>
  );
}
