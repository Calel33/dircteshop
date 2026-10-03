import type { PublicBusiness } from '@/components/profile/profile-types';
import type { Id } from '@/convex/_generated/dataModel';

import { normalizeAddress, normalizeHours, type EditorFormState } from './editor-form.ts';

// New, minimal adapter (issue #12 / B3a todo #9): maps the owner editor's
// UNSAVED form state onto the public `PublicBusiness` shape so WYSIWYS preview
// can reuse the shared `components/profile/BusinessProfile` renderer without
// forking or modifying it. Only fields the editor owns come from `form`; the
// rest (photos, rating, verification, …) are carried from the owned document.
//
// Type-only imports + a single pure runtime import keep this module usable by
// both the client bundle and `node --test` (preview-adapter.test.ts).

/** The owned-document fields preview carries through unchanged. */
export interface PreviewSource {
  _id: Id<'businesses'>;
  photos: PublicBusiness['photos'];
  verification: { isVerified: boolean };
  rating: number;
  ratingCount: number;
  services: string[];
  credentials: string[];
  lastUpdatedAt: number;
}

function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Builds the public profile projection from unsaved form state. `source` is the
 * `getMine` editor document (structurally satisfies `PreviewSource`); `form` is
 * the current client state.
 */
export function toPreviewBusiness(source: PreviewSource, form: EditorFormState): PublicBusiness {
  return {
    _id: source._id,
    name: form.name,
    description: form.description,
    address: normalizeAddress(form.address),
    phone: emptyToUndefined(form.phone),
    email: emptyToUndefined(form.email),
    website: emptyToUndefined(form.website),
    photos: source.photos,
    hours: normalizeHours(form.hours),
    verification: source.verification,
    rating: source.rating,
    ratingCount: source.ratingCount,
    services: source.services,
    credentials: source.credentials,
    lastUpdatedAt: source.lastUpdatedAt,
  };
}
