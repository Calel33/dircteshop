import type { Metadata } from 'next';

import { BusinessResults } from '@/components/directory/business-results';

export const metadata: Metadata = {
  title: 'Search — LocalConnect',
  description: 'Search approved local businesses by name, service, or keyword.',
};

/**
 * Normalizes a repeated search param (`/search?q=a&q=b` → `['a','b']`) to the
 * first value; the raw URL is untrusted network input. Docs:
 * https://nextjs.org/docs/app/api-reference/file-conventions/page
 */
function toSingleParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

/**
 * `/search?q=` (SPEC §8). Next.js 16 removed synchronous request APIs, so
 * `searchParams` is a Promise and must be awaited. `q` is read here — not via
 * `useSearchParams` — and passed down as a prop: that keeps the results
 * component free of the Suspense boundary requirement, and direct navigation
 * or reload of the URL always reproduces the same results.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const q = toSingleParam(params.q);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Search results</h1>
      </header>
      <BusinessResults q={q} resetPath="/search" />
    </div>
  );
}
