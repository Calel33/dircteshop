import { fetchQuery } from 'convex/nextjs';
import type { Metadata } from 'next';

import { CategoryCard } from '@/components/directory/category-card';
import { api } from '@/convex/_generated/api';

export const metadata: Metadata = {
  title: 'Browse categories — LocalConnect',
  description: 'Every approved local business, grouped by category.',
};

/**
 * `/categories` (SPEC §8): the ordered category index with approved counts,
 * rendered server-side from `categories.listWithCounts` — the same query the
 * results sidebar uses, so counts never disagree between surfaces.
 */
export default async function CategoriesPage() {
  const result = await fetchQuery(api.categories.listWithCounts);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Browse Categories</h1>
        <p className="text-card-muted mt-1 text-sm">
          Every approved business, grouped by category.
        </p>
      </header>
      {result.categories.length === 0 ? (
        <p role="status" className="text-card-muted text-sm">
          Categories are being set up. Check back soon.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {result.categories.map((category) => (
            <li key={category._id}>
              <CategoryCard category={category} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
