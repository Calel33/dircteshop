import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

import type { ProfileBreadcrumbItem } from './profile-types';

export type ProfileBreadcrumbProps = {
  items: readonly ProfileBreadcrumbItem[];
};

/**
 * Home → category → business trail shared by every public profile.
 * The final item is the current page; earlier items link when an href exists.
 */
export function ProfileBreadcrumb({ items }: ProfileBreadcrumbProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;

          return (
            <BreadcrumbItem key={`${item.label}-${index}`}>
              {isCurrent ? (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              ) : item.href === undefined ? (
                <span className="text-foreground">{item.label}</span>
              ) : (
                <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
              )}
              {isCurrent ? null : <BreadcrumbSeparator />}
            </BreadcrumbItem>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
