'use client';

import { useRef, useState } from 'react';
import { ConvexError } from 'convex/values';
import { useMutation, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import type { EditableBusinessField } from '@/convex/businessTypes';
import { ownerSaveMode, persistableSaveFields } from '@/convex/businesses/ownerSavePolicy';
import { getVerticalConfig } from '@/lib/verticals';

import { EditorHeader } from './editor-header';
import { EditorPreview, EditorPreviewOverlay, type PreviewState } from './editor-preview';
import { EditorSaveBar } from './editor-save-bar';
import { EditorStatusBanner } from './editor-banner';
import { EditorSectionBody } from './editor-section-body';
import {
  deriveNavCompletion,
  EDITOR_NAV_SECTIONS,
  EDITOR_SECTIONS,
  EditorSectionNav,
  type EditorSectionId,
} from './editor-sections';
import type { CategoryOption } from './section-card';
import type { OwnerEditorDocument } from './editor-types';
import {
  deriveHistoryEntries,
  getPrimaryAction,
  getSaveActionLabel,
  getSaveAvailability,
  getStatusBanner,
  isEditableStatus,
  type EditorActionKind,
} from './editor-status';
import {
  buildEditablePatch,
  canonicalizeForm,
  coreIdentityFields,
  createEditorForm,
  dirtyFields,
  EDITOR_FIELD_CLASS,
  FIELD_SIGNATURES,
  mergeSavedFields,
  reconcileSavedFields,
  validateForm,
  type EditorFormState,
} from './editor-form';
import { toPreviewBusiness } from './preview-adapter';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  restoreFieldsFromBaseline,
  sectionResetFields,
  undoHistory,
  type HistoryState,
} from './editor-session-history';

type CategoryDoc = Doc<'categories'>;

function toCategoryOptions(categories: readonly CategoryDoc[] | undefined): CategoryOption[] {
  return (categories ?? []).map((category) => ({ _id: category._id, name: category.name }));
}

function findSelectedCategory(
  categories: readonly CategoryDoc[] | undefined,
  categoryId: string
): CategoryDoc | undefined {
  return (categories ?? []).find((category) => category._id === categoryId);
}

function buildPreviewState(
  business: OwnerEditorDocument,
  form: EditorFormState,
  categories: readonly CategoryDoc[] | undefined
): PreviewState {
  if (categories === undefined) {
    return { status: 'loading' };
  }

  const category = findSelectedCategory(categories, form.categoryId);
  if (category === undefined) {
    return { status: 'unresolved' };
  }

  return {
    status: 'ready',
    data: {
      business: toPreviewBusiness(business, form),
      category,
      vertical: getVerticalConfig(category.slug),
      // Saved photos already have URLs; the preview resolves only the unsaved
      // uploads missing from this map.
      photoUrls: business.photoUrls,
    },
  };
}

/** Normalises a thrown mutation error into a user-facing message. */
function messageFromError(error: unknown, fallback: string): string {
  // The backend sends owner-facing text as the ConvexError payload; the wrapper
  // the client rebuilds carries the internal function path in `.message`
  // (https://docs.convex.dev/functions/error-handling/application-errors).
  if (error instanceof ConvexError && typeof error.data === 'string' && error.data.trim().length > 0) {
    return error.data;
  }
  return error instanceof Error ? error.message : fallback;
}

/** The editable fields each primary action persists. Submit and Publish save the
 * savable content fields; Resubmit saves every dirty field including staged
 * identity. */
function fieldsForPrimaryAction(
  action: EditorActionKind | null,
  dirty: readonly EditableBusinessField[],
  savable: readonly EditableBusinessField[]
): readonly EditableBusinessField[] {
  if (action === 'resubmit') {
    return dirty;
  }
  if (action === 'submit' || action === 'publish') {
    return savable;
  }
  return [];
}

/** Pre-save/pre-action validation: only a non-empty name is enforced today. */
function nameErrorForFields(
  fields: readonly EditableBusinessField[],
  form: EditorFormState
): string | null {
  return fields.includes('name') ? validateForm(form) : null;
}

/**
 * Editor shell for one owned listing (issue #12 / B3a todo #9 + #10): header,
 * status banner, explicit save bar with the status primary action, section
 * navigation, the active section editor (or Change History), and the WYSIWYS
 * preview. Form state is client-owned and only written through Save Draft,
 * Submit, Resubmit, or Revise.
 *
 * Save-mode behavior mirrors the server's `ownerSavePolicy`: drafts and
 * changes-requested listings persist every editable field; an approved listing
 * persists content only and stages core identity edits client-side until
 * `saveAndResubmit`; read-only statuses render values but no controls.
 */
export function EditorShell({ business }: { business: OwnerEditorDocument }) {
  const categories = useQuery(api.categories.listOrdered);
  const saveDraft = useMutation(api.businesses.mutations.saveDraft);
  const transition = useMutation(api.businesses.mutations.transition);
  const saveAndResubmit = useMutation(api.businesses.mutations.saveAndResubmit);

  // Client-only session history (Task 7): `present` is the live form state and
  // `past`/`future` back Undo/Redo. Nothing here is persisted.
  const [history, setHistory] = useState<HistoryState>(() =>
    createHistory(createEditorForm(business))
  );
  const [baseline, setBaseline] = useState<EditorFormState>(() => createEditorForm(business));
  const form = history.present;
  const [activeId, setActiveId] = useState<EditorSectionId>(EDITOR_SECTIONS[0].id);
  const [isPreviewOverlayOpen, setIsPreviewOverlayOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref to the "Preview Live" button: the overlay has no Radix trigger under its
  // root, so it restores focus here on close (see EditorPreviewOverlay).
  const previewTriggerRef = useRef<HTMLButtonElement>(null);

  const readOnly = !isEditableStatus(business.status);
  const mode = ownerSaveMode(business.status);
  const dirty = dirtyFields(form, baseline);
  const savable = persistableSaveFields(mode, EDITOR_FIELD_CLASS, dirty);
  const coreStaged = mode === 'persistContent' && coreIdentityFields(dirty).length > 0;
  const contentDirty = mode === 'persistContent' && savable.length > 0;
  const primaryAction = getPrimaryAction({
    status: business.status,
    coreStaged,
    contentDirty,
  });
  const saveLabel = getSaveActionLabel(business.status);
  const banner = getStatusBanner({
    status: business.status,
    moderationReason: business.moderationReason,
    submittedAt: business.submittedAt,
    coreStaged,
  });
  const historyEntries = deriveHistoryEntries(business);
  const navCompletion = deriveNavCompletion(form);

  const isBusy = isSaving || isSubmitting;
  // Validate only what will be persisted. Approved core identity (e.g. a staged
  // name) is not part of a content-only save, so it must not block that save;
  // Submit persists `savable` and Resubmit persists every dirty field.
  const { canSave, canRunPrimary } = getSaveAvailability({
    readOnly,
    busy: isBusy,
    savableCount: savable.length,
    saveNameError: nameErrorForFields(savable, form),
    primaryAction,
    primaryNameError: nameErrorForFields(
      fieldsForPrimaryAction(primaryAction, dirty, savable),
      form
    ),
  });

  const activeSection =
    EDITOR_NAV_SECTIONS.find((section) => section.id === activeId) ?? EDITOR_NAV_SECTIONS[0];
  const previewState = buildPreviewState(business, form, categories);

  function handleFieldChange<K extends keyof EditorFormState>(
    field: K,
    value: EditorFormState[K]
  ) {
    setHistory((state) => pushHistory(state, { ...state.present, [field]: value }));
    setError(null);
  }

  /**
   * Persists the savable content fields and reconciles local state. Shared by
   * Save Draft, Submit, and the approved-listing "Publish changes" primary — all
   * use the `saveDraft` mutation with no status change. Saved fields stop being
   * dirty; approved core identity edits were ignored by the server and stay
   * staged for `saveAndResubmit`. Reconcile against the latest form so edits
   * typed while the mutation was in flight are kept.
   */
  async function persistSavable() {
    const patch = buildEditablePatch(form, savable);
    await saveDraft({ businessId: business._id, patch });

    const canonical = canonicalizeForm(form, savable);
    // Success advances the saved baseline (which alone stops saved fields
    // reading as dirty) while keeping the undo/redo frames, so an edit typed
    // during the in-flight save stays undoable and undo can step back past the
    // save point.
    setHistory((state) => ({
      ...state,
      present: reconcileSavedFields(state.present, form, canonical, savable),
    }));
    setBaseline((previous) => mergeSavedFields(previous, canonical, savable));
  }

  async function handleSave() {
    if (!canSave) {
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      await persistSavable();
    } catch (saveError) {
      setError(messageFromError(saveError, 'Could not save the listing.'));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);

    try {
      // The transition mutation does not carry editable fields, so persist dirty
      // edits first — otherwise submitting a draft would silently drop them.
      if (savable.length > 0) {
        await persistSavable();
      }
      await transition({ businessId: business._id, action: 'submitForReview' });
    } catch (submitError) {
      setError(messageFromError(submitError, 'Could not submit the listing.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResubmit() {
    setError(null);
    setIsSubmitting(true);

    try {
      // Atomic: the staged core identity fields and any content dirt are written
      // together with `approved -> pendingReview`. On success the persisted fields
      // are reconciled so they stop reading as dirty.
      await saveAndResubmit({ businessId: business._id, patch: buildEditablePatch(form, dirty) });

      const canonical = canonicalizeForm(form, dirty);
      setHistory((state) => ({
        ...state,
        present: reconcileSavedFields(state.present, form, canonical, dirty),
      }));
      setBaseline((previous) => mergeSavedFields(previous, canonical, dirty));
    } catch (resubmitError) {
      setError(messageFromError(resubmitError, 'Could not resubmit the listing.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevise() {
    setError(null);
    setIsSubmitting(true);

    try {
      await transition({ businessId: business._id, action: 'reopenAsDraft' });
    } catch (reviseError) {
      setError(messageFromError(reviseError, 'Could not revise the listing.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePrimary() {
    if (!canRunPrimary) {
      return;
    }

    if (primaryAction === 'submit') {
      await handleSubmit();
    } else if (primaryAction === 'resubmit') {
      await handleResubmit();
    } else if (primaryAction === 'revise') {
      await handleRevise();
    } else if (primaryAction === 'publish') {
      setError(null);
      setIsSubmitting(true);

      try {
        await persistSavable();
      } catch (publishError) {
        setError(messageFromError(publishError, 'Could not publish the changes.'));
      } finally {
        setIsSubmitting(false);
      }
    }
  }

  function handleUndo() {
    setHistory((state) => undoHistory(state));
    setError(null);
  }

  function handleRedo() {
    setHistory((state) => redoHistory(state));
    setError(null);
  }

  /** Restores the active section's fields from the last-saved Convex baseline. */
  function handleResetSection() {
    const fields = sectionResetFields(activeId);
    if (fields.length === 0) {
      return;
    }
    setHistory((state) => {
      const restored = restoreFieldsFromBaseline(state.present, baseline, fields);
      const changed = fields.some(
        (field) => FIELD_SIGNATURES[field](restored) !== FIELD_SIGNATURES[field](state.present)
      );
      // A section with no differences from the baseline has nothing to reset;
      // pushing would only burn a no-op undo frame.
      return changed ? pushHistory(state, restored) : state;
    });
    setError(null);
  }

  const sectionFields = sectionResetFields(activeId);
  const showResetSection = sectionFields.length > 0;
  const canResetSection =
    !readOnly && !isBusy && sectionFields.some((field) => dirty.includes(field));

  return (
    <div className="flex flex-col gap-gap">
      <EditorHeader business={business} />
      {banner === null ? null : (
        <EditorStatusBanner banner={banner} onRevise={handleRevise} canRevise={canRunPrimary} />
      )}
      <EditorSaveBar
        readOnly={readOnly}
        isDirty={dirty.length > 0}
        canSave={canSave}
        saveLabel={saveLabel}
        isSaving={isSaving}
        error={error}
        coreStaged={coreStaged}
        lastSavedAt={business.lastSavedAt}
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSave={handleSave}
        onOpenPreview={() => setIsPreviewOverlayOpen(true)}
        previewTriggerRef={previewTriggerRef}
        primaryAction={primaryAction}
        canRunPrimary={canRunPrimary}
        isSubmitting={isSubmitting}
        onPrimary={handlePrimary}
      />
      <div className="grid grid-cols-1 items-start gap-gap lg:grid-cols-[15rem_minmax(0,1fr)_22rem]">
        <EditorSectionNav activeId={activeId} onSelect={setActiveId} completion={navCompletion} />
        <EditorSectionBody
          activeId={activeId}
          activeSection={activeSection}
          form={form}
          onChange={handleFieldChange}
          readOnly={readOnly}
          categories={toCategoryOptions(categories)}
          historyEntries={historyEntries}
          businessId={business._id}
          photos={form.photos}
          savedPhotos={baseline.photos}
          onPhotosChange={(photos) => handleFieldChange('photos', photos)}
          showResetSection={showResetSection}
          canResetSection={canResetSection}
          onResetSection={handleResetSection}
        />
        <EditorPreview state={previewState} isDirty={dirty.length > 0} />
      </div>
      {isPreviewOverlayOpen ? (
        <EditorPreviewOverlay
          state={previewState}
          isDirty={dirty.length > 0}
          onClose={() => setIsPreviewOverlayOpen(false)}
          triggerRef={previewTriggerRef}
        />
      ) : null}
    </div>
  );
}
