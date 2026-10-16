import { fetchQuery } from 'convex/nextjs';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { BusinessResults } from '@/components/directory/business-results';
import { api } from '@/convex/_generated/api';

/** Memoized per request so `generateMetadata` and the page share one fetch. */
const getCategory = cache((slug: string) =>
  fetchQuery(api.categories.bySlug, { slug })
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);

  if (category === null) {
    return { title: 'Category not found — LocalConnect' };
  }

  return {
    title: `${category.name} — LocalConnect`,
    description: `Approved ${category.name} businesses on LocalConnect.`,
  };
}

/**
 * `/categories/[slug]` (SPEC §8): category-scoped results through the shared
 * `BusinessResults` flow. The slug resolves server-side against Convex; an
 * unknown slug renders Next.js not-found. The category **id** — not the slug —
 * is the server-validated query scope. Next.js 16: `params` is a Promise and
 * must be awaited. Docs:
 * https://nextjs.org/docs/app/api-reference/file-conventions/page
 */
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = await getCategory(slug);

  if (category === null) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-card-muted mb-2 flex items-center gap-2 text-xs">
          <Link href="/" className="hover:text-primary font-semibold">
            Home
          </Link>
          <span aria-hidden>/</span>
          <Link href="/categories" className="hover:text-primary font-semibold">
            Categories
          </Link>
          <span aria-hidden>/</span>
          <span className="text-card-foreground font-semibold">{category.name}</span>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">{category.name}</h1>
      </header>
      <BusinessResults
        q=""
        category={{ _id: category._id, name: category.name, slug: category.slug }}
        resetPath={`/categories/${category.slug}`}
      />
    </div>
  );
}
