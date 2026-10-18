'use client';

import { useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { ConvexError } from 'convex/values';
import { useMutation, useQuery } from 'convex/react';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { PHOTO_LIMITS, invalidReasonForFile } from '@/convex/businesses/photoPolicy';
import { cn } from '@/lib/utils';

import type { EditorFormState } from './editor-form';
import type { EditorSection } from './editor-types';

// B7 (issue #7): the real Photos & Media panel. Uploads follow the documented
// Convex flow — the owner-gated `generateUploadUrl` mutation, a browser POST of
// the bytes, then the returned storage id appended to `form.photos`. Photos are
// content fields, so the existing save machinery persists them and the server
// re-stamps `ordering` to the array index. Reordering uses buttons (WCAG 2.2
// SC 2.5.7) rather than drag, with live-region announcements and retained focus.

type FormPhoto = EditorFormState['photos'][number];
type MoveDirection = 'up' | 'down';

const MAX_PHOTOS = PHOTO_LIMITS.maxPhotos;
const MAX_MEGABYTES = PHOTO_LIMITS.maxBytes / (1024 * 1024);
const ACCEPTED_TYPES = PHOTO_LIMITS.types.join(',');

/** Re-stamps `ordering` to the array index; the save path does the same server-side. */
function stampOrdering(photos: readonly FormPhoto[]): FormPhoto[] {
  return photos.map((photo, index) => ({ ...photo, ordering: index }));
}

/** Reads `{ storageId }` from an upload response; `null` when the body is unusable. */
function readStorageId(payload: unknown): Id<'_storage'> | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const storageId = (payload as { storageId?: unknown }).storageId;
  return typeof storageId === 'string' && storageId.length > 0
    ? (storageId as Id<'_storage'>)
    : null;
}

function messageForError(error: unknown, fallback: string): string {
  // The backend sends owner-facing text as the ConvexError payload; the wrapper
  // the client rebuilds carries the internal function path in `.message`
  // (https://docs.convex.dev/functions/error-handling/application-errors).
  if (error instanceof ConvexError && typeof error.data === 'string' && error.data.trim().length > 0) {
    return error.data;
  }
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

/** Validates a picked batch before any byte leaves the browser. */
function validateSelection(
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
        `${file.name}: listings can have up to ${MAX_PHOTOS} photos. Remove one before adding another.`
      );
    } else {
      accepted.push(file);
    }
  }

  return { accepted, errors };
}

function PhotoThumbnail({
  altText,
  position,
  url,
}: {
  altText?: string;
  position: number;
  url: string | null;
}) {
  return (
    <div className="bg-muted border-border aspect-square w-full shrink-0 overflow-hidden rounded-control border sm:w-24">
      {url === null ? (
        <span className="text-card-muted flex size-full items-center justify-center text-xs">
          Photo {position}
        </span>
      ) : (
        <img src={url} alt={altText ?? ''} className="size-full object-cover" />
      )}
    </div>
  );
}

/** Read-only statuses cannot edit photos, so they get the plain gallery. */
function ReadOnlyGallery({
  photos,
  photoUrls,
}: {
  photos: readonly FormPhoto[];
  photoUrls: Readonly<Record<string, string | null>> | undefined;
}) {
  if (photos.length === 0) {
    return <p className="text-card-muted text-sm">No photos yet.</p>;
  }

  return (
    <ul role="list" className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
      {photos.map((photo, index) => (
        <li key={photo.storageId} className="flex flex-col gap-1">
          <PhotoThumbnail
            altText={photo.altText}
            position={index + 1}
            url={photoUrls?.[photo.storageId] ?? null}
          />
          {photo.altText ? <p className="text-card-muted text-xs">{photo.altText}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function PhotosPanel({
  businessId,
  section,
  photos,
  savedPhotos,
  onPhotosChange,
  readOnly,
  tool,
}: {
  businessId: Id<'businesses'>;
  section: EditorSection;
  photos: FormPhoto[];
  savedPhotos: readonly FormPhoto[];
  onPhotosChange: (photos: FormPhoto[]) => void;
  readOnly: boolean;
  tool: ReactNode;
}) {
  const generateUploadUrl = useMutation(api.businesses.photoUploads.generateUploadUrl);
  // Owner-gated resolution for both saved photos and unsaved uploads.
  const photoUrls = useQuery(api.businesses.photoStorage.photoUrls, {
    businessId,
    storageIds: photos.map((photo) => photo.storageId),
  });

  const fileInputId = useId();
  const helpId = useId();
  const errorId = useId();
  const [errors, setErrors] = useState<string[]>([]);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const moveButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const isBusy = uploadingName !== null;
  const atCapacity = photos.length >= MAX_PHOTOS;
  const savedStorageIds = new Set(savedPhotos.map((photo) => photo.storageId));

  async function uploadPhoto(file: File): Promise<Id<'_storage'>> {
    const uploadUrl = await generateUploadUrl({ businessId });
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });

    if (!response.ok) {
      throw new Error(`the upload failed (HTTP ${response.status}). Try again.`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('the upload returned an unreadable response. Try again.');
    }

    const storageId = readStorageId(payload);
    if (storageId === null) {
      throw new Error('the upload did not return a photo id. Try again.');
    }
    return storageId;
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (files.length === 0 || isBusy) {
      return;
    }

    const remaining = Math.max(MAX_PHOTOS - photos.length, 0);
    const selection = validateSelection(files, remaining);
    const nextErrors = [...selection.errors];
    setErrors(nextErrors);
    setAnnouncement('');

    if (selection.accepted.length === 0) {
      return;
    }

    const next = [...photos];
    let added = 0;

    for (const file of selection.accepted) {
      setUploadingName(file.name);
      try {
        const storageId = await uploadPhoto(file);
        // Blank alt text stays absent so the public gallery falls back to the
        // business name; storing `''` would render an informative photo as
        // decorative `<img alt="">` (WCAG SC 1.1.1).
        next.push({ storageId, ordering: next.length });
        onPhotosChange(stampOrdering(next));
        added += 1;
      } catch (uploadError) {
        nextErrors.push(
          `${file.name}: ${messageForError(uploadError, 'the upload failed. Try again.')}`
        );
        setErrors([...nextErrors]);
      }
    }

    setUploadingName(null);
    if (added > 0) {
      setAnnouncement(added === 1 ? 'Photo added.' : `${added} photos added.`);
    }
  }

  function updateAltText(storageId: Id<'_storage'>, altText: string) {
    onPhotosChange(
      photos.map((photo) => {
        if (photo.storageId !== storageId) {
          return photo;
        }
        // Collapse blank to absent (never `''`), but keep the raw string while
        // typing so spaces survive a controlled input; the save path trims and
        // caps server-side via `normalizePhotos`.
        return { ...photo, ...(altText.trim().length === 0 ? {} : { altText }) };
      })
    );
  }

  function registerMoveButton(storageId: Id<'_storage'>, direction: MoveDirection) {
    const key = `${storageId}:${direction}`;
    return (element: HTMLButtonElement | null) => {
      if (element === null) {
        moveButtonRefs.current.delete(key);
      } else {
        moveButtonRefs.current.set(key, element);
      }
    };
  }

  function focusMoveButton(storageId: Id<'_storage'>, direction: MoveDirection) {
    requestAnimationFrame(() => {
      moveButtonRefs.current.get(`${storageId}:${direction}`)?.focus();
    });
  }

  function movePhoto(index: number, direction: MoveDirection) {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= photos.length) {
      return;
    }

    const next = [...photos];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onPhotosChange(stampOrdering(next));
    setAnnouncement(`Moved to position ${target + 1} of ${photos.length}.`);

    // Keep focus on the pressed control; at an end the opposite direction stays enabled.
    const focusDirection =
      target === 0 ? 'down' : target === photos.length - 1 ? 'up' : direction;
    focusMoveButton(moved.storageId, focusDirection);
  }

  function removePhoto(index: number) {
    const photo = photos[index];
    if (savedStorageIds.has(photo.storageId)) {
      const confirmed = window.confirm(
        'Remove this photo? It will be deleted from storage when you save.'
      );
      if (!confirmed) {
        return;
      }
    }

    onPhotosChange(stampOrdering(photos.filter((_, position) => position !== index)));
    setAnnouncement(
      savedStorageIds.has(photo.storageId)
        ? 'Photo removed. Save to delete it from storage.'
        : 'Photo removed.'
    );
  }

  return (
    <Card className="rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-lg">{section.label}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
        <CardAction>{tool}</CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {readOnly ? (
          <ReadOnlyGallery photos={photos} photoUrls={photoUrls} />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <div className="relative inline-flex w-fit rounded-md focus-within:ring-2 focus-within:ring-ring/50">
                <label
                  htmlFor={fileInputId}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'cursor-pointer',
                    atCapacity || isBusy ? 'pointer-events-none opacity-50' : null
                  )}
                >
                  Add photos
                </label>
                <input
                  id={fileInputId}
                  type="file"
                  accept={ACCEPTED_TYPES}
                  multiple
                  disabled={atCapacity || isBusy}
                  aria-invalid={errors.length > 0 ? true : undefined}
                  aria-describedby={`${helpId}${errors.length > 0 ? ` ${errorId}` : ''}`}
                  onChange={handleFiles}
                  className="absolute size-px opacity-0"
                />
              </div>
              <p id={helpId} className="text-card-muted text-sm">
                JPEG, PNG or WebP · up to {MAX_MEGABYTES} MB each · {photos.length} of {MAX_PHOTOS}{' '}
                photos.
              </p>
              {uploadingName === null ? null : (
                <p role="status" className="text-card-muted text-sm">
                  Uploading {uploadingName}…
                </p>
              )}
              {errors.length === 0 ? null : (
                <div
                  id={errorId}
                  role="alert"
                  className="border-destructive/40 bg-destructive/5 text-destructive rounded-control border p-3 text-sm"
                >
                  <ul role="list" className="flex flex-col gap-1">
                    {errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {photos.length === 0 ? (
              <p className="border-border text-card-muted rounded-card border-2 border-dashed p-6 text-center text-sm">
                No photos yet. Add up to {MAX_PHOTOS} images — the first one is the cover.
              </p>
            ) : (
              <ul role="list" className="flex flex-col gap-3">
                {photos.map((photo, index) => {
                  const position = index + 1;
                  const altInputId = `${fileInputId}-alt-${photo.storageId}`;
                  const altHintId = `${altInputId}-hint`;

                  return (
                    <li
                      key={photo.storageId}
                      className="border-border rounded-control flex flex-col gap-3 border p-3 sm:flex-row sm:items-start"
                    >
                      <PhotoThumbnail
                        altText={photo.altText}
                        position={position}
                        url={photoUrls?.[photo.storageId] ?? null}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-card-muted font-label text-xs font-semibold tracking-wide uppercase">
                            Photo {position}
                            {index === 0 ? ' · cover' : ''}
                          </p>
                          <div className="flex items-center gap-1">
                            <Button
                              ref={registerMoveButton(photo.storageId, 'up')}
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label={`Move photo ${position} up`}
                              disabled={isBusy || index === 0}
                              onClick={() => movePhoto(index, 'up')}
                            >
                              <span aria-hidden="true">↑</span>
                            </Button>
                            <Button
                              ref={registerMoveButton(photo.storageId, 'down')}
                              type="button"
                              variant="outline"
                              size="icon"
                              aria-label={`Move photo ${position} down`}
                              disabled={isBusy || index === photos.length - 1}
                              onClick={() => movePhoto(index, 'down')}
                            >
                              <span aria-hidden="true">↓</span>
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="text-destructive"
                              aria-label={`Remove photo ${position}`}
                              disabled={isBusy}
                              onClick={() => removePhoto(index)}
                            >
                              <span aria-hidden="true">✕</span>
                            </Button>
                          </div>
                        </div>
                        <Label htmlFor={altInputId}>Alt text</Label>
                        <Input
                          id={altInputId}
                          value={photo.altText ?? ''}
                          maxLength={PHOTO_LIMITS.maxAltLength}
                          disabled={isBusy}
                          aria-describedby={altHintId}
                          onChange={(event) => updateAltText(photo.storageId, event.target.value)}
                          placeholder="Describe the photo for screen readers"
                          className="text-card-foreground placeholder:text-card-muted!"
                        />
                        <p id={altHintId} className="text-card-muted text-xs">
                          Describe what the photo shows. Screen readers read this text; avoid file
                          names.
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        <p className="text-card-muted text-xs">
          Photos are content — adding or reordering an approved listing&apos;s photos goes live
          immediately.
        </p>

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </CardContent>
    </Card>
  );
}
