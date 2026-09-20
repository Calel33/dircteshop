import { Globe, Mail, MapPin, Phone } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Doc } from '@/convex/_generated/dataModel';
import { isSafeExternalUrl } from '@/lib/utils';

export type InfoCardProps = {
  business: Doc<'businesses'>;
};

function InfoRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-card-foreground/80">{icon}</span>
      <div className="min-w-0 text-sm break-words">{children}</div>
    </div>
  );
}

/** Address and contact channels for the profile sidebar. */
export function InfoCard({ business }: InfoCardProps) {
  const { address } = business;
  const cityLine = [address.city, address.state, address.postalCode].filter(Boolean).join(' ');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business Information</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <InfoRow icon={<MapPin aria-hidden className="size-4" />}>
          <p>{address.addressLine1}</p>
          {address.addressLine2 === undefined ? null : <p>{address.addressLine2}</p>}
          <p>{cityLine}</p>
          <p>{address.country}</p>
        </InfoRow>
        {business.phone === undefined ? null : (
          <InfoRow icon={<Phone aria-hidden className="size-4" />}>
            <a className="hover:text-foreground transition-colors" href={`tel:${business.phone}`}>
              {business.phone}
            </a>
          </InfoRow>
        )}
        {business.email === undefined ? null : (
          <InfoRow icon={<Mail aria-hidden className="size-4" />}>
            <a className="hover:text-foreground transition-colors" href={`mailto:${business.email}`}>
              {business.email}
            </a>
          </InfoRow>
        )}
        {isSafeExternalUrl(business.website) ? (
          <InfoRow icon={<Globe aria-hidden className="size-4" />}>
            <a
              className="hover:text-foreground transition-colors"
              href={business.website}
              target="_blank"
              rel="noreferrer"
            >
              {business.website}
            </a>
          </InfoRow>
        ) : business.website === undefined ? null : (
          <InfoRow icon={<Globe aria-hidden className="size-4" />}>
            {/* Scheme-guard value: rendered as inert text, never an href. */}
            <span>{business.website}</span>
          </InfoRow>
        )}
      </CardContent>
    </Card>
  );
}
