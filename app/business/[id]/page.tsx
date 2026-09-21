import { fetchQuery } from 'convex/nextjs';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { BusinessProfile } from '@/components/profile/BusinessProfile';
import type { BusinessProfileData } from '@/components/profile/profile-types';
import { api } from '@/convex/_generated/api';
import { getVerticalConfig } from '@/lib/verticals';

/** Memoized per request so `generateMetadata` and the page share one fetch. */
const getPublicBusiness = cache((id: string) =>
  fetchQuery(api.businesses.queries.getPublic, { id }).catch(() => null)
);

/**
 * Public page metadata (SEO): reuses the `getPublic` fetch and falls back to a
 * plain title when the listing is absent (the page 404s in that case).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getPublicBusiness(id);

  if (result === null) {
    return { title: 'Business not found' };
  }

  const { business } = result;

  return {
    title: business.name,
    description: business.description,
    openGraph: {
      title: business.name,
      description: business.description,
      type: 'website',
    },
  };
}

/**
 * Public business profile (SPEC §2, `/business/[id]`).
 *
 * Public visibility is enforced server-side in Convex: `businesses.getPublic`
 * returns `null` unless the listing is `approved` (and for malformed ids), so a
 * non-approved or unknown business renders as a 404 rather than disclosing its
 * existence. The fetch fails closed to the same 404.
 *
 * Next.js 16: a dynamic route's `params` is a Promise and must be awaited.
 * Docs: https://nextjs.org/docs/app/api-reference/file-conventions/page
 */
export default async function BusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const result = await getPublicBusiness(id);

  if (result === null) {
    notFound();
  }

  const data: BusinessProfileData = {
    business: result.business,
    category: result.category,
    vertical: getVerticalConfig(result.category.slug),
  };

  return <BusinessProfile data={data} />;
}
