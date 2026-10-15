'use client';

import type { RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { formatTimestamp } from './editor-datetime';
import { getPrimaryActionLabel, type EditorActionKind } from './editor-status';

interface EditorSaveBarProps {
  /** True when the listing status is read-only (pending/suspended/rejected). */
  readOnly: boolean;
  isDirty: boolean;
  canSave: boolean;
  /** Status-dependent save button copy ("Save Draft" / "Save changes"). */
  saveLabel: string;
  isSaving: boolean;
  error: string | null;
  /** True when approved core identity edits are staged for a future resubmit. */
  coreStaged: boolean;
  /** Last persisted save timestamp; rendered as "· Last saved {date}". */
  lastSavedAt?: number;
  /** Client-only session tools (Task 7): undo/redo. */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Opens the Preview Live overlay (prototype `#btn-preview`). */
  onOpenPreview: () => void;
  /** Ref to the Preview Live button, so the overlay can restore focus on close. */
  previewTriggerRef: RefObject<HTMLButtonElement | null>;
  /** Submit / resubmit / revise, or `null` when the status offers none. */
  primaryAction: EditorActionKind | null;
  canRunPrimary: boolean;
  isSubmitting: boolean;
  onPrimary: () => void;
  onSave: () => void;
}

function saveStateLabel(readOnly: boolean, isDirty: boolean): string {
  if (readOnly) {
    return 'This listing is read-only.';
  }
  return isDirty ? 'Unsaved changes' : 'All changes saved';
}

/** Coloured save-state dot (prototype `.save-dot`: green / amber / muted). */
function saveDotClass(readOnly: boolean, isDirty: boolean): string {
  if (readOnly) {
    return 'bg-muted-foreground';
  }
  return isDirty ? 'bg-amber-500 dark:bg-amber-400' : 'bg-green-600 dark:bg-green-500';
}

/**
 * Explicit-save toolbar (prototype `.savebar`, owner-workspace.html L120-125 /
 * L326-339): save-state dot + label + last-saved timestamp, and Undo / Redo /
 * Preview Live / Save Draft / Submit for Approval. There is no autosave — edits
 * live in client state until a save or primary action.
 */
export function EditorSaveBar({
  readOnly,
  isDirty,
  canSave,
  saveLabel,
  isSaving,
  error,
  coreStaged,
  lastSavedAt,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenPreview,
  previewTriggerRef,
  primaryAction,
  canRunPrimary,
  isSubmitting,
  onPrimary,
  onSave,
}: EditorSaveBarProps) {
  return (
    <div className="border-border bg-card text-card-foreground rounded-card flex flex-wrap items-center justify-between gap-3 border px-card py-3">
      <div className="flex flex-col gap-1">
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={cn('size-2 shrink-0 rounded-pill', saveDotClass(readOnly, isDirty))}
          />
          {saveStateLabel(readOnly, isDirty)}
          {lastSavedAt === undefined ? null : (
            <span className="text-card-muted text-xs">
              · Last saved {formatTimestamp(lastSavedAt)}
            </span>
          )}
        </p>
        {coreStaged ? (
          <p className="text-card-foreground/80 text-xs">
            Core identity changes apply when this listing is resubmitted for review.
          </p>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onUndo} disabled={!canUndo}>
          Undo
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onRedo} disabled={!canRedo}>
          Redo
        </Button>
        <Button
          ref={previewTriggerRef}
          type="button"
          variant="outline"
          onClick={onOpenPreview}
        >
          Preview Live
        </Button>
        {readOnly ? null : (
          <Button type="button" variant="outline" onClick={onSave} disabled={!canSave}>
            {isSaving ? 'Saving…' : saveLabel}
          </Button>
        )}
        {primaryAction === null ? null : (
          <Button type="button" onClick={onPrimary} disabled={!canRunPrimary}>
            {isSubmitting ? 'Working…' : getPrimaryActionLabel(primaryAction)}
          </Button>
        )}
      </div>
    </div>
  );
}
