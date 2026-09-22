import type { Doc } from '@/convex/_generated/dataModel';
import type { VerticalConfig } from '@/lib/verticals';

/** A stored business photo (Convex file storage; uploads ship with B7). */
export type BusinessPhoto = Doc<'businesses'>['photos'][number];

/** Per-day opening periods keyed `monday`..`sunday`; an absent day is closed. */
export type BusinessHours = Doc<'businesses'>['hours'];

/** Postal address as stored on a business document. */
export type BusinessAddress = Doc<'businesses'>['address'];

/**
 * Public projection of a business, matching `businesses.getPublic`. Excludes
 * owner, moderation, and search-maintenance internals (`ownerId`,
 * `verification.verifiedBy`, `moderationReason`, `moderatedAt`, `searchText`,
 * `keywords`, …) so the public RSC payload cannot leak them.
 */
export type PublicBusiness = {
  _id: Doc<'businesses'>['_id'];
  name: string;
  description: string;
  address: BusinessAddress;
  phone?: string;
  email?: string;
  website?: string;
  photos: BusinessPhoto[];
  hours: BusinessHours;
  verification: { isVerified: boolean };
  rating: number;
  ratingCount: number;
  services: string[];
  credentials: string[];
  lastUpdatedAt: number;
};

/** A single step in the public profile breadcrumb trail. */
export type ProfileBreadcrumbItem = {
  label: string;
  href?: string;
};

/**
 * Everything the public profile foundation renders (SPEC §6): the public
 * business projection, its resolved category, and the category's vertical
 * config.
 */
export type BusinessProfileData = {
  business: PublicBusiness;
  category: Doc<'categories'>;
  vertical: VerticalConfig;
};
