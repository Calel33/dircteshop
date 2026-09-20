import type { Doc } from '@/convex/_generated/dataModel';
import type { VerticalConfig } from '@/lib/verticals';

/** A stored business photo (Convex file storage; uploads ship with B7). */
export type BusinessPhoto = Doc<'businesses'>['photos'][number];

/** Per-day opening periods keyed `monday`..`sunday`; an absent day is closed. */
export type BusinessHours = Doc<'businesses'>['hours'];

/** A single step in the public profile breadcrumb trail. */
export type ProfileBreadcrumbItem = {
  label: string;
  href?: string;
};

/**
 * Everything the public profile foundation renders (SPEC §6): the business
 * document, its resolved category, and the category's vertical config.
 */
export type BusinessProfileData = {
  business: Doc<'businesses'>;
  category: Doc<'categories'>;
  vertical: VerticalConfig;
};
