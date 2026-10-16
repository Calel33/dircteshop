import {
  Briefcase,
  Car,
  Coffee,
  HeartPulse,
  Scale,
  ShoppingBag,
  Sparkles,
  Store,
  Utensils,
} from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

// Category icons are stored on `categories.icon` as lucide names by the
// category seed (convex/categories.ts). Unknown names (for example a category
// created before its icon ships) fall back to a generic storefront so the
// surface still renders.
const CATEGORY_ICONS = {
  utensils: Utensils,
  car: Car,
  'heart-pulse': HeartPulse,
  scale: Scale,
  sparkles: Sparkles,
  coffee: Coffee,
  'shopping-bag': ShoppingBag,
  briefcase: Briefcase,
} as const;

type CategoryIconProps = {
  name?: string;
  className?: string;
} & Omit<ComponentProps<'svg'>, 'name'>;

/** Renders the category's lucide icon by seeded name, with a safe fallback. */
export function CategoryIcon({ name, className, ...props }: CategoryIconProps) {
  const Icon =
    name !== undefined && name in CATEGORY_ICONS
      ? CATEGORY_ICONS[name as keyof typeof CATEGORY_ICONS]
      : Store;

  return <Icon aria-hidden className={cn('size-4', className)} {...props} />;
}
