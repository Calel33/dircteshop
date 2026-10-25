'use client';

import { useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { TriangleAlert } from 'lucide-react';
import { Component, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

/**
 * Public restaurant menu (T4). Reads the approved-only `menus.listForBusiness`
 * query and renders one tab per non-empty menu group, with its items below.
 * Presentation only: the active tab is local UI state; no callbacks are lifted.
 */

type MenuData = NonNullable<FunctionReturnType<typeof api.menus.listForBusiness>>;
type MenuGroup = MenuData['groups'][number];
type MenuItem = MenuData['items'][number];

type VisibleGroup = {
  group: MenuGroup;
  items: MenuItem[];
};

const PRICE_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatPrice(price: number): string {
  return PRICE_FORMATTER.format(price);
}

/** Compact nutrition line; absent fields are omitted and empty objects hide. */
function nutritionLabel(nutrition: MenuItem['nutrition']): string | null {
  if (nutrition === undefined) {
    return null;
  }

  const parts: string[] = [];

  if (nutrition.calories !== undefined) {
    parts.push(`${nutrition.calories} cal`);
  }
  if (nutrition.proteinGrams !== undefined) {
    parts.push(`${nutrition.proteinGrams}g protein`);
  }
  if (nutrition.carbohydrateGrams !== undefined) {
    parts.push(`${nutrition.carbohydrateGrams}g carbs`);
  }
  if (nutrition.fatGrams !== undefined) {
    parts.push(`${nutrition.fatGrams}g fat`);
  }

  return parts.length === 0 ? null : parts.join(' · ');
}

/** Menu groups in server `ordering` order, with empty groups removed. */
function groupsWithItems(data: MenuData): VisibleGroup[] {
  const itemsByGroup = new Map<string, MenuItem[]>();

  for (const item of data.items) {
    const bucket = itemsByGroup.get(item.groupId);

    if (bucket === undefined) {
      itemsByGroup.set(item.groupId, [item]);
    } else {
      bucket.push(item);
    }
  }

  return data.groups
    .map((group) => ({ group, items: itemsByGroup.get(group._id) ?? [] }))
    .filter((entry) => entry.items.length > 0);
}

function ItemOrderEntry({
  item,
  price,
  orderProtocol = 'legacy',
}: {
  item: MenuItem;
  price: string | null;
  orderProtocol?: 'legacy' | 'basket';
}) {
  if (!item.isAvailable) {
    return (
      <span className="bg-neutral-chip text-neutral-chip-foreground rounded-pill px-2 py-0.5 font-mono text-micro tracking-label uppercase">
        Unavailable
      </span>
    );
  }

  // On basket businesses the basket panel owns add-to-basket; the legacy
  // `#order-<id>` hash link is dead, so hide it.
  if (orderProtocol === 'basket') {
    return null;
  }

  return (
    <Button asChild size="sm">
      <a href={`#order-${item._id}`}>{price === null ? 'Order' : `Order ${price}`}</a>
    </Button>
  );
}

function MenuItemCard({ item, orderProtocol = 'legacy' }: { item: MenuItem; orderProtocol?: 'legacy' | 'basket' }) {
  const price = item.price === undefined ? null : formatPrice(item.price);
  const nutrition = nutritionLabel(item.nutrition);

  return (
    <li
      className={`border-border bg-card flex flex-col gap-2 rounded-card border p-card @max-[44rem]:p-gap ${
        item.isAvailable ? '' : 'opacity-60'
      }`}
    >
      {item.imageUrl === null || item.imageUrl.length === 0 ? null : (
        <div className="bg-muted border-border h-28 w-full overflow-hidden rounded-control border @max-[44rem]:h-24">
          {/* Raw <img> is deliberate (mirrors B7 `ProfileHero.tsx`): Convex
              storage URLs are bearer URLs and `next/image` optimization would
              require remotePatterns allowlisting that revocation cannot scope. */}
          <img
            src={item.imageUrl}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        </div>
      )}
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-body leading-tight font-semibold">{item.name}</h3>
        {price === null ? null : (
          <span className="shrink-0 font-mono text-tiny font-semibold">{price}</span>
        )}
      </div>
      {item.description === undefined || item.description.length === 0 ? null : (
        <p className="text-tiny text-card-muted">{item.description}</p>
      )}
      {nutrition === null ? null : (
        <p className="text-micro text-card-muted font-mono">{nutrition}</p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <ItemOrderEntry item={item} price={price} orderProtocol={orderProtocol} />
      </div>
    </li>
  );
}

function MenuTabsSkeleton() {
  return (
    <Card
      className="@container overflow-hidden"
      role="status"
      aria-busy="true"
      aria-label="Loading menu"
    >
      <CardHeader>
        <Skeleton className="h-5 w-24" />
      </CardHeader>
      <div className="flex flex-col gap-gap px-card">
        <div className="flex gap-2 overflow-x-auto">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-20 shrink-0 rounded-control" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-gap @max-[60rem]:grid-cols-1">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="border-border bg-card flex flex-col gap-2 rounded-card border p-card"
            >
              <Skeleton className="h-28 w-full rounded-control" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function MenuTabsError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card role="alert" className="items-center gap-gap border-dashed px-card py-card text-center">
      <TriangleAlert aria-hidden className="text-card-muted size-10 stroke-[1.5]" />
      <div className="flex flex-col gap-1">
        <p className="text-body font-semibold">Menu unavailable</p>
        <p className="text-tiny text-card-muted">
          Something went wrong while loading the menu. Nothing was changed — try again.
        </p>
      </div>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </Card>
  );
}

class MenuTabsErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <MenuTabsError onRetry={this.props.onRetry} />;
    }

    return this.props.children;
  }
}

function MenuTabsQuery({
  businessId,
  orderProtocol = 'legacy',
}: {
  businessId: Id<'businesses'>;
  orderProtocol?: 'legacy' | 'basket';
}) {
  const data = useQuery(api.menus.listForBusiness, { businessId });
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  if (data === undefined) {
    return <MenuTabsSkeleton />;
  }

  if (data === null) {
    return null;
  }

  const groups = groupsWithItems(data);
  const fallbackGroup = groups[0];

  if (fallbackGroup === undefined) {
    return null;
  }

  const activeGroup = groups.find((entry) => entry.group._id === selectedGroupId) ?? fallbackGroup;

  return (
    <Card className="@container overflow-hidden">
      <CardHeader>
        <h2 className="leading-none font-semibold">Menu</h2>
      </CardHeader>
      <Tabs value={activeGroup.group._id} onValueChange={setSelectedGroupId} className="gap-0">
        <div className="px-card">
          <TabsList
            aria-label="Menu sections"
            className="bg-muted flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-control p-1"
          >
            {groups.map(({ group }) => (
              <TabsTrigger
                key={group._id}
                value={group._id}
                className="text-tiny h-auto flex-none rounded-control px-3 py-2 whitespace-nowrap data-[state=active]:bg-card dark:data-[state=active]:bg-input/30 data-[state=active]:text-foreground data-[state=active]:shadow-sm @max-[44rem]:px-2"
              >
                {group.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {groups.map(({ group, items }) => (
          <TabsContent key={group._id} value={group._id} className="px-card pt-card">
            <ul role="list" className="grid grid-cols-2 gap-gap @max-[60rem]:grid-cols-1">
              {items.map((item) => (
                <MenuItemCard key={item._id} item={item} orderProtocol={orderProtocol} />
              ))}
            </ul>
          </TabsContent>
        ))}
      </Tabs>
    </Card>
  );
}

/**
 * Frozen contract: `{ businessId }` only. The retry key remounts the subtree so
 * a failed query re-subscribes (Convex `useQuery` throws during render); the
 * error boundary is local presentation, not a data-flow contract.
 */
export function MenuTabs({
  businessId,
  orderProtocol = 'legacy',
}: {
  businessId: Id<'businesses'>;
  orderProtocol?: 'legacy' | 'basket';
}) {
  const [retryKey, setRetryKey] = useState(0);

  return (
    <MenuTabsErrorBoundary key={retryKey} onRetry={() => setRetryKey((current) => current + 1)}>
      <MenuTabsQuery businessId={businessId} orderProtocol={orderProtocol} />
    </MenuTabsErrorBoundary>
  );
}
