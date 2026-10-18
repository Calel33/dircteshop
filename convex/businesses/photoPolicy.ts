import type { Doc } from '../_generated/dataModel';

// B7 (issue #7) photo upload policy. Pure functions with type-only imports, so
// the limits, rejection messages and normalization are unit-testable without a
// Convex runtime (same pattern as `ownerSavePolicy.ts`). These limits are the
// ones recorded on issue #7; server-side attach-time enforcement imports them
// from here so there is a single source of truth.

/** The stored photo shape (`businesses.photos[]`, aliased as `BusinessPhoto`). */
type BusinessPhoto = Doc<'businesses'>['photos'][number];

/** A browser `File` (or storage metadata) reduced to what the limits need. */
type PhotoFile = {
  name: string;
  size: number;
  type?: string | null;
};

type PhotoLimits = {
  readonly maxBytes: number;
  readonly types: readonly string[];
  readonly maxPhotos: number;
  readonly maxAltLength: number;
};

/** Limits recorded on issue #7: 5 MiB, JPEG/PNG/WebP, 12 photos, 200-char alt. */
export const PHOTO_LIMITS: PhotoLimits = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  types: Object.freeze(['image/jpeg', 'image/png', 'image/webp']),
  maxPhotos: 12,
  maxAltLength: 200,
});

/**
 * Returns a user-facing reason the file cannot be uploaded, or `null` when it
 * passes every limit. The MIME type is checked first: a missing or empty `type`
 * (a POST without a `Content-Type` header stores no `contentType`) is a
 * rejection, never a soft pass.
 */
export function invalidReasonForFile(
  file: PhotoFile,
  limits: PhotoLimits = PHOTO_LIMITS
): string | null {
  const type = (file.type ?? '').trim().toLowerCase();
  if (type.length === 0) {
    return "This file's type could not be read. Choose a JPEG, PNG or WebP image.";
  }
  if (!limits.types.includes(type)) {
    return 'Photos must be a JPEG, PNG or WebP image.';
  }
  if (file.size <= 0) {
    return 'This file is empty. Choose a different photo.';
  }
  if (file.size > limits.maxBytes) {
    return `Photos must be ${limits.maxBytes / (1024 * 1024)} MB or smaller.`;
  }
  return null;
}

/**
 * Normalizes photos before they are stored: re-stamps `ordering` to the array
 * index, trims alt text and caps it at `maxAltLength`, and drops duplicate
 * storage ids (keeping the first). Returns a fresh array; the input is never
 * mutated.
 */
export function normalizePhotos(input: readonly BusinessPhoto[] | undefined): BusinessPhoto[] {
  const normalized: BusinessPhoto[] = [];
  const seen = new Set<string>();

  for (const photo of input ?? []) {
    if (seen.has(photo.storageId)) {
      continue;
    }
    seen.add(photo.storageId);

    const altText = normalizeAltText(photo.altText);
    normalized.push({
      storageId: photo.storageId,
      ...(altText === undefined ? {} : { altText }),
      ordering: normalized.length,
    });
  }

  return normalized;
}

/**
 * Returns a user-facing reason when `photos` exceeds `maxPhotos`, or `null` when
 * the count is allowed. A pure predicate (it never throws) so callers can show
 * the message client-side or throw it server-side.
 */
export function assertPhotosCount(photos: readonly BusinessPhoto[]): string | null {
  if (photos.length <= PHOTO_LIMITS.maxPhotos) {
    return null;
  }
  return `Listings can have up to ${PHOTO_LIMITS.maxPhotos} photos. Remove one before adding another.`;
}

function normalizeAltText(altText: string | undefined): string | undefined {
  if (altText === undefined) {
    return undefined;
  }
  // Blank collapses to absent (never `''`): an empty alt renders an informative
  // gallery photo as decorative (`<img alt="">`, WCAG SC 1.1.1).
  const trimmed = altText.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.slice(0, PHOTO_LIMITS.maxAltLength);
}
