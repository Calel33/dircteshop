'use client';

import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Inline confirmation body: a bordered consequence note, optional fields, and
 * the Cancel / confirm action row. Extracted from the admin directory confirm
 * so owner surfaces can use the same pattern without importing across app
 * segments.
 */
export function InlineConfirm({
  message,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  isPending = false,
  destructive = false,
  neutral = false,
  confirmDisabled = false,
}: {
  message: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
  /** Confirm button uses the destructive variant. */
  destructive?: boolean;
  /** Render the note on the neutral panel surface instead of the danger surface. */
  neutral?: boolean;
  confirmDisabled?: boolean;
}) {
  return (
    <>
      <div
        className={
          neutral
            ? 'border-border bg-panel text-muted-foreground rounded-menu border p-3 text-tiny'
            : 'border-danger-border bg-danger-soft text-danger-strong rounded-menu border p-3 text-tiny'
        }
      >
        {message}
      </div>

      {children}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-input"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant={destructive ? 'destructive' : 'default'}
          className="rounded-input"
          onClick={onConfirm}
          disabled={confirmDisabled || isPending}
        >
          {isPending ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </>
  );
}
