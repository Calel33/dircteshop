import type { Metadata } from 'next';

import { LandingDiscovery } from '@/components/directory/landing-sections';

export const metadata: Metadata = {
  title: 'LocalConnect — Discover local businesses',
  description:
    'Explore approved local businesses by category, trending listings, newest arrivals, and recently verified spots.',
};

/**
 * `/` — the LocalConnect discovery landing (SPEC §8). Replaces the starter
 * marketing composition; the persistent search header comes from the
 * `(landing)` route-group layout. The starter sections' component files are
 * intentionally left in place (removing template components is out of B4
 * scope), but this route no longer renders them.
 */
export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <LandingDiscovery />
    </div>
  );
}
