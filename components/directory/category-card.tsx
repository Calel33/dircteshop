import Link from 'next/link';

import { CategoryIcon } from './category-icon';

// Compact category card (Variant B `vB-mini`): icon, name, approved count,
// linking to the category results page. Server-compatible; the category index
// page feeds it from `categories.listWithCounts`.

export type CategoryCardData = {
  _id: string;
  name: string;
  slug: string;
  icon?: string;
  approvedCount: number;
};

export function CategoryCard({ category }: { category: CategoryCardData }) {
  return (
    <Link
      href={`/categories/${category.slug}`}
      data-testid={`category-card-${category.slug}`}
      className="bg-card text-card-foreground border-border rounded-card hover:border-primary/60 focus-visible:ring-ring/50 flex h-full flex-col gap-2 border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span
        aria-hidden
        className="bg-primary/10 text-primary rounded-control flex size-10 items-center justify-center"
      >
        <CategoryIcon name={category.icon} className="size-5" />
      </span>
      <span className="leading-tight font-semibold">{category.name}</span>
      <span className="text-card-muted text-xs">
        {category.approvedCount} {category.approvedCount === 1 ? 'business' : 'businesses'}
      </span>
    </Link>
  );
}
