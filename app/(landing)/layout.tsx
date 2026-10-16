import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/directory/site-header';

// Public discovery route group (SPEC §2/§8): `/`, `/search`, and `/categories`
// share the persistent search header. `/dashboard`, `/owner`, and `/admin`
// live outside this group and keep their own shells.

export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
    </div>
  );
}
