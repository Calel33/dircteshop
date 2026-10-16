import Link from 'next/link';

import { CategoryIcon } from './category-icon';

// Approved category pill strip for the landing (Variant B `vB-pills`).
// Each pill links to its category results page; the approved count comes from
// `categories.listWithCounts` and never leaks non-approved rows.

export type CategoryPillData = {
  _id: string;
  name: string;
  slug: string;
  icon?: string;
  approvedCount: number;
};

export function CategoryPills({ categories }: { categories: readonly CategoryPillData[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {categories.map((category) => (
        <li key={category._id}>
          <Link
            href={`/categories/${category.slug}`}
            data-testid={`category-pill-${category.slug}`}
            className="bg-card text-card-foreground border-border rounded-pill hover:border-primary/60 focus-visible:ring-ring/50 inline-flex min-h-8 items-center gap-1.5 border px-3 py-1 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <CategoryIcon name={category.icon} className="text-primary size-3.5" />
            {category.name}
            <span className="text-card-muted font-medium">{category.approvedCount}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
