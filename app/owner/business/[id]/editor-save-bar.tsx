'use client';

import { Button } from '@/components/ui/button';

import { getPrimaryActionLabel, type EditorActionKind } from './editor-status';

interface EditorSaveBarProps {
  /** True when the listing status is read-only (pending/suspended/rejected). */
  readOnly: boolean;
  isDirty: boolean;
  canSave: boolean;
  /** Status-dependent save button copy ("Save draft" / "Save changes"). */
  saveLabel: string;
  isSaving: boolean;
  error: string | null;
  /** True when approved core identity edits are staged for a future resubmit. */
  coreStaged: boolean;
  isPreviewOpen: boolean;
  /** Client-only session tools (Task 7): undo/redo and per-section reset. */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canResetSection: boolean;
  /** Label of the active section, used in the Reset Section button. */
  resetSectionLabel: string;
  onResetSection: () => void;
  onSave: () => void;
  onTogglePreview: () => void;
  /** Opens the full-screen preview overlay (Task 8). */
  onOpenFullPreview: () => void;
  /** Submit / resubmit / revise, or `null` when the status offers none. */
  primaryAction: EditorActionKind | null;
  canRunPrimary: boolean;
  isSubmitting: boolean;
  onPrimary: () => void;
}

function saveStateLabel(readOnly: boolean, isDirty: boolean): string {
  if (readOnly) {
    return 'This listing is read-only.';
  }
  return isDirty ? 'Unsaved changes' : 'All changes saved';
}

/**
 * Explicit-save toolbar: dirty indicator, Save Draft, the status primary action
 * (submit / resubmit / revise), and the Preview Live toggle. There is no
 * autosave — edits live in client state until a save or primary action.
 */
export function EditorSaveBar({
  readOnly,
  isDirty,
  canSave,
  saveLabel,
  isSaving,
  error,
  coreStaged,
  isPreviewOpen,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canResetSection,
  resetSectionLabel,
  onResetSection,
  onSave,
  onTogglePreview,
  onOpenFullPreview,
  primaryAction,
  canRunPrimary,
  isSubmitting,
  onPrimary,
}: EditorSaveBarProps) {
  return (
    <div className="border-border bg-card text-card-foreground flex flex-wrap items-center justify-between gap-3 rounded-card border px-card py-3">
      <div className="flex flex-col gap-1">
        <p role="status" className="text-sm">
          {saveStateLabel(readOnly, isDirty)}
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
          type="button"
          variant="ghost"
          size="sm"
          onClick={onResetSection}
          disabled={!canResetSection}
        >
          {`Reset ${resetSectionLabel}`}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onOpenFullPreview}>
          Full preview
        </Button>
        <Button type="button" variant="outline" onClick={onTogglePreview}>
          {isPreviewOpen ? 'Hide preview' : 'Preview live'}
        </Button>
        {readOnly ? null : (
          <Button type="button" onClick={onSave} disabled={!canSave}>
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
