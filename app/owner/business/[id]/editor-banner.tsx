'use client';

import { Button } from '@/components/ui/button';
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
 * Status banner for the owner editor (issue #12 / B3a todo #10; prototype L341-355).
 * Colour supports the copy but is never the only signal — the title and message
 * carry the meaning. The rejected banner carries an inline "Revise listing"
 * action, exactly like the prototype.
 */
export function EditorStatusBanner({
  banner,
  onRevise,
  canRevise = true,
}: {
  banner: StatusBanner;
  onRevise?: () => void;
  canRevise?: boolean;
}) {
  const showRevise = banner.action === 'revise' && onRevise !== undefined;

  return (
    <div
      role={banner.tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'rounded-card flex flex-wrap items-start gap-gap border px-card py-3',
        TONE_CLASSES[banner.tone]
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-medium">{banner.title}</p>
        <p className="text-muted-foreground text-sm">{banner.message}</p>
        {banner.submittedAt === undefined ? null : (
          <p className="text-muted-foreground font-label text-xs">
            Submitted {formatTimestamp(banner.submittedAt)}
          </p>
        )}
      </div>
      {showRevise ? (
        <Button type="button" variant="outline" size="sm" onClick={onRevise} disabled={!canRevise}>
          Revise listing
        </Button>
      ) : null}
    </div>
  );
}
