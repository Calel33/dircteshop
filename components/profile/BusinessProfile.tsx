import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProfileAction } from '@/lib/verticals';

import { ActionsBar } from './ActionsBar';
import { HoursCard } from './HoursCard';
import { IdentityBar } from './IdentityBar';
import { InfoCard } from './InfoCard';
import { LastUpdatedFooter } from './LastUpdatedFooter';
import { ProfileBreadcrumb } from './ProfileBreadcrumb';
import { ProfileHero } from './ProfileHero';
import type { BusinessProfileData } from './profile-types';

export type BusinessProfileProps = {
  data: BusinessProfileData;
  /** Overrides `data.vertical.defaultActions` when provided. */
  actions?: readonly ProfileAction[];
  /** Vertical modules for the main column (B8-B10). Defaults to an About card. */
  mainContent?: ReactNode;
  /** Extra modules appended to the sidebar after the info and hours cards. */
  sidebar?: ReactNode;
};

function AboutCard({ description }: { description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>About</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-card-foreground/80 text-sm leading-relaxed">{description}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Public business-profile foundation (SPEC §6). Renders the shared slots —
 * breadcrumb, hero, identity bar, actions, then a two-column main + sidebar
 * layout that collapses to one column below the `lg` breakpoint.
 */
export function BusinessProfile({ data, actions, mainContent, sidebar }: BusinessProfileProps) {
  const { business, category, vertical } = data;

  return (
    <article className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <ProfileBreadcrumb
        items={[
          { label: 'Home', href: '/' },
          { label: 'Categories', href: '/categories' },
          { label: category.name, href: `/categories/${category.slug}` },
          { label: business.name },
        ]}
      />
      {/* TODO(#2): pass `photoUrls` once B7 (uploads) resolves storage URLs;
          the gallery renders placeholders until then. */}
      <ProfileHero businessName={business.name} photos={business.photos} />
      <IdentityBar business={business} categoryName={category.name} />
      <ActionsBar actions={actions ?? vertical.defaultActions} business={business} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          {mainContent ?? <AboutCard description={business.description} />}
        </div>
        <aside className="flex flex-col gap-6">
          <InfoCard business={business} />
          <HoursCard hours={business.hours} />
          {sidebar}
        </aside>
      </div>
      <LastUpdatedFooter lastUpdatedAt={business.lastUpdatedAt} />
    </article>
  );
}
