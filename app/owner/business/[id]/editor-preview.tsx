'use client';

import type { RefObject } from 'react';

import { BusinessProfile } from '@/components/profile/BusinessProfile';
import type { BusinessProfileData } from '@/components/profile/profile-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The preview has three distinct states: the categories needed to resolve the
 * vertical config are still loading; the selected category cannot be resolved
 * (renamed, re-pointed, or filtered out), which needs an actionable hint rather
 * than a forever-loading message; or the profile data is ready (PR #46 M4).
 */
export type PreviewState =
  | { status: 'loading' }
  | { status: 'unresolved' }
  | { status: 'ready'; data: BusinessProfileData };

interface EditorPreviewProps {
  state: PreviewState;
  isDirty: boolean;
}

const UNRESOLVED_MESSAGE = 'Choose a category in Basic Info to preview.';

/** Renders the preview body for whichever state it is in. */
function PreviewContent({ state, className }: { state: PreviewState; className?: string }) {
  if (state.status === 'ready') {
    return <BusinessProfile data={state.data} />;
  }

  return (
    <p className={className ?? 'text-muted-foreground text-sm'}>
      {state.status === 'loading' ? 'Loading preview…' : UNRESOLVED_MESSAGE}
    </p>
  );
}

/**
 * WYSIWYS Live Preview (prototype `.preview-panel`, owner-workspace.html
 * L461-468): the sticky third workspace column, rendering the shared profile
 * foundation from UNSAVED form state through the preview adapter, with the
 * amber "unsaved edits" note while the form is dirty.
 */
export function EditorPreview({ state, isDirty }: EditorPreviewProps) {
  return (
    <aside
      aria-label="Live Preview"
      className="bg-card text-card-foreground border-border rounded-card flex flex-col overflow-hidden border lg:sticky lg:top-4"
    >
      <div className="border-border bg-muted/40 border-b px-4 py-3">
        <h2 className="text-foreground font-label text-xs tracking-wide uppercase">
          Live Preview
        </h2>
        <p className="text-foreground mt-1 text-xs">
          Rendered from <strong className="text-foreground">unsaved</strong> form state — what you
          type is what you&apos;d see.
        </p>
      </div>
      <div className="p-4">
        <div className="border-border bg-background overflow-hidden rounded-card border">
          <PreviewContent state={state} className="text-muted-foreground p-card text-sm" />
        </div>
      </div>
      {isDirty ? (
        <p className="bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200 mx-4 mb-4 rounded-control px-3 py-2 text-center text-xs font-bold">
          Previewing unsaved edits — not saved or submitted
        </p>
      ) : null}
    </aside>
  );
}

/**
 * Full preview overlay (issue #14 / B3c Task 8; prototype L476-481): the same
 * shared `BusinessProfile` rendered from the current UNSAVED form data, in a
 * full-width scrollable modal. Reuses the single profile renderer (no second
 * renderer, no drift) and states that the preview is unsaved. `triggerRef`
 * points at the button that opens the overlay; because there is no Radix trigger
 * under this root, the overlay restores focus there itself on every close path.
 */
export function EditorPreviewOverlay({
  state,
  isDirty,
  onClose,
  triggerRef,
}: {
  state: PreviewState;
  isDirty: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
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
      <DialogContent
        className="flex max-h-[90vh] w-full flex-col gap-gap overflow-y-auto sm:max-w-4xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Preview Live — public profile</DialogTitle>
          <DialogDescription>
            {isDirty
              ? 'Previewing unsaved edits — nothing is saved or submitted.'
              : 'Showing the saved profile.'}
          </DialogDescription>
        </DialogHeader>
        <div className="bg-background rounded-card">
          <PreviewContent state={state} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
