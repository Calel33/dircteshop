import { CalendarCheck, Globe, MapPin, MessageSquare, Phone, ShoppingBag } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { isSafeExternalUrl } from '@/lib/utils';
import type { ProfileAction } from '@/lib/verticals';

import type { BusinessAddress, PublicBusiness } from './profile-types';

type LinkAction = Extract<ProfileAction, { kind: 'call' | 'directions' | 'website' }>;
type WorkflowAction = Extract<ProfileAction, { kind: 'book' | 'quote' }>;
type OrderAction = Extract<ProfileAction, { kind: 'order' }>;

export type ActionsBarProps = {
  actions: readonly ProfileAction[];
  business: PublicBusiness;
};

function isWorkflowAction(action: ProfileAction): action is WorkflowAction {
  return action.kind === 'book' || action.kind === 'quote';
}

function isOrderAction(action: ProfileAction): action is OrderAction {
  return action.kind === 'order';
}

/** Google Maps search URL built from the business address. */
function buildDirectionsHref(address: BusinessAddress): string {
  const query = [
    address.addressLine1,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function resolveLinkAction(
  action: LinkAction,
  business: PublicBusiness,
): { label: string; icon: ReactNode; href?: string } {
  switch (action.kind) {
    case 'call':
      return {
        label: 'Call',
        icon: <Phone aria-hidden />,
        href: business.phone === undefined ? undefined : `tel:${business.phone}`,
      };
    case 'directions':
      return {
        label: 'Get Directions',
        icon: <MapPin aria-hidden />,
        href: buildDirectionsHref(business.address),
      };
    case 'website':
      return {
        label: 'Visit Website',
        icon: <Globe aria-hidden />,
        // Scheme-guarded: owner-supplied values like `javascript:...` fail the
        // check and the action degrades to a disabled button, never a live
        // unsafe href.
        href: isSafeExternalUrl(business.website) ? business.website : undefined,
      };
  }
}

function resolveWorkflowAction(action: WorkflowAction): { label: string; icon: ReactNode } {
  if (action.kind === 'book') {
    return { label: action.label ?? 'Book Appointment', icon: <CalendarCheck aria-hidden /> };
  }

  return { label: action.label ?? 'Get a Quote', icon: <MessageSquare aria-hidden /> };
}

/**
 * Renders the vertical config's `ProfileAction[]`. Link actions resolve their
 * href from the business document; book/quote render as disabled labeled stubs
 * until the B8/B9 workflows ship; the order action anchors to the in-page
 * `#order` module.
 */
export function ActionsBar({ actions, business }: ActionsBarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action, index) => {
        const key = `${action.kind}-${index}`;

        if (isOrderAction(action)) {
          return (
            <Button key={key} variant="outline" asChild>
              <a href="#order">
                <ShoppingBag aria-hidden />
                {action.label ?? 'Order Online'}
              </a>
            </Button>
          );
        }

        if (isWorkflowAction(action)) {
          const { label, icon } = resolveWorkflowAction(action);

          return (
            <Button
              key={key}
              variant="outline"
              disabled
              title="Available in a future release"
              className="disabled:opacity-100 border-muted-foreground/40 text-muted-foreground"
            >
              {icon}
              {label}
            </Button>
          );
        }

        const { label, icon, href } = resolveLinkAction(action, business);

        return href === undefined ? (
          <Button
            key={key}
            variant="outline"
            disabled
            title="Not provided by this business"
            className="disabled:opacity-100 border-muted-foreground/40 text-muted-foreground"
          >
            {icon}
            {label}
          </Button>
        ) : (
          <Button key={key} variant="outline" asChild>
            <a href={href}>
              {icon}
              {label}
            </a>
          </Button>
        );
      })}
    </div>
  );
}
