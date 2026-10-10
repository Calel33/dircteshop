'use client';

import { BusinessProfile } from '@/components/profile/BusinessProfile';
import type { BusinessProfileData } from '@/components/profile/profile-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface EditorPreviewProps {
  data: BusinessProfileData | null;
  isDirty: boolean;
}

/**
 * WYSIWYS Preview Live: renders the shared profile foundation from UNSAVED form
 * state through the preview adapter. `data` is `null` until the category needed
 * to resolve the vertical config has loaded.
 */
export function EditorPreview({ data, isDirty }: EditorPreviewProps) {
  return (
    <section aria-label="Preview live" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Preview live</h2>
        <span className="text-muted-foreground font-label text-xs">
          {isDirty ? 'Previewing unsaved changes' : 'Showing saved state'}
        </span>
      </div>
      <div className="border-border overflow-hidden rounded-card border">
        {data === null ? (
          <p className="text-muted-foreground p-card text-sm">Loading preview…</p>
        ) : (
          <BusinessProfile data={data} />
        )}
      </div>
    </section>
  );
}

/**
 * Full preview overlay (issue #14 / B3c Task 8): the same shared `BusinessProfile`
 * rendered from the current UNSAVED form data, in a full-width scrollable modal.
 * Reuses the single profile renderer (no second renderer, no drift) and states
 * that the preview is unsaved.
 */
export function EditorPreviewOverlay({
  data,
  isDirty,
  onClose,
}: {
  data: BusinessProfileData | null;
  isDirty: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-full flex-col gap-gap overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Full preview</DialogTitle>
          <DialogDescription>
            {isDirty
              ? 'Previewing unsaved edits — nothing is saved or submitted.'
              : 'Showing the saved profile.'}
          </DialogDescription>
        </DialogHeader>
        {data === null ? (
          <p className="text-muted-foreground text-sm">Loading preview…</p>
        ) : (
          <BusinessProfile data={data} />
        )}
      </DialogContent>
    </Dialog>
  );
}
