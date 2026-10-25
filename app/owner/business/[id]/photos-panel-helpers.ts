import { ConvexError } from 'convex/values';

import type { Id } from '@/convex/_generated/dataModel';

import { PHOTO_LIMITS, invalidReasonForFile } from '../../../../convex/businesses/photoPolicy.ts';
import type { EditorFormState } from './editor-form';

// Pure helpers for the owner Photos & Media panel. This module is deliberately
// free of `'use client'` and React imports so `node --test` can load it
// directly (same pattern as `convex/businesses/photoPolicy.ts`).

export type FormPhoto = EditorFormState['photos'][number];

/** Re-stamps `ordering` to the array index; the save path does the same server-side. */
export function stampOrdering(photos: readonly FormPhoto[]): FormPhoto[] {
  return photos.map((photo, index) => ({ ...photo, ordering: index }));
}

/**
 * Replaces a photo's alt text, dropping the previous key so clearing the field
 * really clears it. Blank stays `''` in form state while typing; the save path
 * collapses it to absent via `normalizePhotos`.
 */
export function withAltText(photo: FormPhoto, altText: string): FormPhoto {
  const { altText: _previousAltText, ...rest } = photo;
  void _previousAltText; // Omitted from `rest`; the next value is `altText`.
  return { ...rest, altText };
}

/** Reads `{ storageId }` from an upload response; `null` when the body is unusable. */
export function readStorageId(payload: unknown): Id<'_storage'> | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const storageId = (payload as { storageId?: unknown }).storageId;
  return typeof storageId === 'string' && storageId.length > 0
    ? (storageId as Id<'_storage'>)
    : null;
}

export function messageForError(error: unknown, fallback: string): string {
  // The backend sends owner-facing text as the ConvexError payload; the wrapper
  // the client rebuilds carries the internal function path in `.message`
  // (https://docs.convex.dev/functions/error-handling/application-errors).
  // Protocol paths send an object envelope `{ code, message }`; prefer its
  // `message` so the panel never shows the wrapper text (plan D11).
  if (error instanceof ConvexError) {
    const data = error.data;
    if (typeof data === 'string') {
      if (data.trim().length > 0) {
        return data;
      }
    } else if (typeof data === 'object' && data !== null) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message;
      }
    }
  }
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

/** Validates a picked batch before any byte leaves the browser. */
export function validateSelection(
  files: readonly File[],
  remaining: number
): { accepted: File[]; errors: string[] } {
  const accepted: File[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const reason = invalidReasonForFile({ name: file.name, size: file.size, type: file.type });
    if (reason !== null) {
      errors.push(`${file.name}: ${reason}`);
    } else if (accepted.length >= remaining) {
      errors.push(
        `${file.name}: listings can have up to ${PHOTO_LIMITS.maxPhotos} photos. Remove one before adding another.`
      );
    } else {
      accepted.push(file);
    }
  }

  return { accepted, errors };
}
