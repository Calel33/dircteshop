'use client';

import { useState } from 'react';
import { UserButton } from '@clerk/nextjs';
import { useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { BusinessCard } from './business-card';
import { CreateBusinessForm } from './create-business-form';

/** Owner listing grid: auto-fill tracks from the prototype's `.biz-grid`. */
export const OWNER_CARD_GRID = 'grid gap-gap grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]';

/**
 * Signed-in owner hub, mirroring the prototype (owner-workspace.html L289-307):
 * branded app header, "My Businesses" heading with the explanatory paragraph,
 * the listing grid, and a dashed empty state. Reads are owner-scoped in Convex
 * (`listMine`) — the client never filters by owner.
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
      <header className="bg-card text-card-foreground border-border flex flex-wrap items-center gap-gap rounded-card border px-card py-3">
        <p className="font-display flex items-center gap-2 text-base font-extrabold">
          <span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-control text-xs font-bold">
            L
          </span>
          Local<span className="font-normal">Hub</span>
        </p>
        <nav aria-label="Owner workspace" className="flex gap-gap">
          <span
            aria-current="page"
            className="border-primary border-b-2 pb-1 text-sm font-semibold whitespace-nowrap"
          >
            My Businesses
          </span>
        </nav>
        <div className="ml-auto flex items-center gap-gap">
          <Button onClick={() => setIsCreating(true)} disabled={isCreating}>
            Add Your Business
          </Button>
          <UserButton />
        </div>
      </header>

      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">My Businesses</h1>
        <p className="text-muted-foreground max-w-prose text-sm">
          Any signed-in user can create a listing — owner access is derived from the listing, not
          granted by an admin. A listing becomes public only after approval.
        </p>
      </div>

      {isCreating ? <CreateBusinessForm onCancel={() => setIsCreating(false)} /> : null}

      {businesses === undefined ? (
        <BusinessGridSkeleton />
      ) : businesses.length === 0 ? (
        isCreating ? null : <EmptyState onAdd={() => setIsCreating(true)} />
      ) : (
        <ul className={OWNER_CARD_GRID}>
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
    <div className="rounded-card border-border border border-dashed px-4 py-8 text-center">
      <h3 className="font-display text-base font-bold">No businesses yet</h3>
      <p className="text-muted-foreground mx-auto mt-2 mb-4 max-w-md text-sm">
        Start with a draft. Nothing is visible to the public until an admin approves it.
      </p>
      <Button onClick={onAdd}>Add Your Business</Button>
    </div>
  );
}

function BusinessGridSkeleton() {
  return (
    <div className={OWNER_CARD_GRID} aria-busy="true" aria-label="Loading your businesses">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-32 rounded-card" />
      ))}
    </div>
  );
}
