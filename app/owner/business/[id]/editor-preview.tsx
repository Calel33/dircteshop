'use client';

import { BusinessProfile } from '@/components/profile/BusinessProfile';
import type { BusinessProfileData } from '@/components/profile/profile-types';

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
