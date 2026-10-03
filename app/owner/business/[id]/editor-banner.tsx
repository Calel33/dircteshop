'use client';

import { cn } from '@/lib/utils';

import { formatTimestamp } from './editor-datetime';
import type { BannerTone, StatusBanner } from './editor-status';

const TONE_CLASSES: Record<BannerTone, string> = {
  info: 'border-border bg-muted text-foreground',
  warning: 'border-secondary/40 bg-secondary/10 text-foreground',
  danger: 'border-destructive/40 bg-destructive/10 text-foreground',
  brand: 'border-primary/40 bg-primary/10 text-foreground',
};

/**
 * Status banner for the owner editor (issue #12 / B3a todo #10). Colour supports
 * the copy but is never the only signal — the title and message carry the meaning.
 */
export function EditorStatusBanner({ banner }: { banner: StatusBanner }) {
  return (
    <div
      role={banner.tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex flex-col gap-1 rounded-card border px-card py-3',
        TONE_CLASSES[banner.tone]
      )}
    >
      <p className="text-sm font-medium">{banner.title}</p>
      <p className="text-muted-foreground text-sm">{banner.message}</p>
      {banner.submittedAt === undefined ? null : (
        <p className="text-muted-foreground font-label text-xs">
          Submitted {formatTimestamp(banner.submittedAt)}
        </p>
      )}
    </div>
  );
}
