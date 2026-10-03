'use client';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';
import type { EditableBusinessField } from '@/convex/businessTypes';
import { ownerSaveMode, persistableSaveFields } from '@/convex/businesses/ownerSavePolicy';
import { getVerticalConfig } from '@/lib/verticals';
import type { BusinessProfileData } from '@/components/profile/profile-types';

import { EditorHeader } from './editor-header';
import { EditorPreview } from './editor-preview';
import { EditorSaveBar } from './editor-save-bar';
import { EditorStatusBanner } from './editor-banner';
import { EditorHistory } from './editor-history';
import {
  EDITOR_NAV_SECTIONS,
  EDITOR_SECTIONS,
  HISTORY_SECTION,
  EditorSectionNav,
  type EditorSectionId,
} from './editor-sections';
import { EditorSectionView, type CategoryOption } from './section-editors';
import type { OwnerEditorDocument } from './editor-types';
import {
  deriveHistoryEntries,
  getPrimaryAction,
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
  mergeSavedFields,
  validateForm,
  type EditorFormState,
} from './editor-form';
import { toPreviewBusiness } from './preview-adapter';

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

function buildPreviewData(
  business: OwnerEditorDocument,
  form: EditorFormState,
  category: CategoryDoc | undefined
): BusinessProfileData | null {
  if (category === undefined) {
    return null;
  }

  return {
    business: toPreviewBusiness(business, form),
    category,
    vertical: getVerticalConfig(category.slug),
  };
}

/** Normalises a thrown mutation error into a user-facing message. */
function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** The editable fields each primary action persists. Submit saves the draft's
 * dirty fields; Resubmit saves every dirty field including staged identity. */
function fieldsForPrimaryAction(
  action: EditorActionKind | null,
  dirty: readonly EditableBusinessField[],
  savable: readonly EditableBusinessField[]
): readonly EditableBusinessField[] {
  if (action === 'resubmit') {
    return dirty;
  }
  if (action === 'submit') {
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

  const [form, setForm] = useState<EditorFormState>(() => createEditorForm(business));
  const [baseline, setBaseline] = useState<EditorFormState>(() => createEditorForm(business));
  const [activeId, setActiveId] = useState<EditorSectionId>(EDITOR_SECTIONS[0].id);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readOnly = !isEditableStatus(business.status);
  const mode = ownerSaveMode(business.status);
  const dirty = dirtyFields(form, baseline);
  const savable = persistableSaveFields(mode, EDITOR_FIELD_CLASS, dirty);
  const coreStaged = mode === 'persistContent' && coreIdentityFields(dirty).length > 0;
  const primaryAction = getPrimaryAction({ status: business.status, coreStaged });
  const banner = getStatusBanner({
    status: business.status,
    moderationReason: business.moderationReason,
    submittedAt: business.submittedAt,
    coreStaged,
  });
  const history = deriveHistoryEntries(business);

  const isBusy = isSaving || isSubmitting;
  // Validate only what will be persisted. Approved core identity (e.g. a staged
  // name) is not part of a content-only save, so it must not block that save;
  // Submit persists the dirty fields and Resubmit persists every dirty field.
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
  const previewData = buildPreviewData(
    business,
    form,
    findSelectedCategory(categories, form.categoryId)
  );

  function handleFieldChange<K extends keyof EditorFormState>(
    field: K,
    value: EditorFormState[K]
  ) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setError(null);
  }

  async function handleSave() {
    if (!canSave) {
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      const patch = buildEditablePatch(form, savable);
      await saveDraft({ businessId: business._id, patch });

      // Saved fields stop being dirty; approved core identity edits were ignored
      // by the server and stay staged for `saveAndResubmit`.
      const canonical = canonicalizeForm(form, savable);
      setForm(canonical);
      setBaseline((previous) => mergeSavedFields(previous, canonical, savable));
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
        await saveDraft({ businessId: business._id, patch: buildEditablePatch(form, savable) });
        const canonical = canonicalizeForm(form, savable);
        setForm(canonical);
        setBaseline((previous) => mergeSavedFields(previous, canonical, savable));
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
      // together with `approved -> pendingReview`.
      await saveAndResubmit({ businessId: business._id, patch: buildEditablePatch(form, dirty) });
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
    }
  }

  return (
    <div className="flex flex-col gap-gap">
      <EditorHeader business={business} />
      {banner === null ? null : <EditorStatusBanner banner={banner} />}
      <EditorSaveBar
        readOnly={readOnly}
        isDirty={dirty.length > 0}
        canSave={canSave}
        isSaving={isSaving}
        error={error}
        coreStaged={coreStaged}
        isPreviewOpen={isPreviewOpen}
        onSave={handleSave}
        onTogglePreview={() => setIsPreviewOpen((open) => !open)}
        primaryAction={primaryAction}
        canRunPrimary={canRunPrimary}
        isSubmitting={isSubmitting}
        onPrimary={handlePrimary}
      />
      <div className="grid grid-cols-1 gap-gap lg:grid-cols-[1fr_3fr]">
        <EditorSectionNav activeId={activeId} onSelect={setActiveId} />
        {activeId === HISTORY_SECTION.id ? (
          <EditorHistory entries={history} />
        ) : (
          <EditorSectionView
            sectionId={activeId}
            section={activeSection}
            form={form}
            onChange={handleFieldChange}
            readOnly={readOnly}
            categories={toCategoryOptions(categories)}
          />
        )}
      </div>
      {isPreviewOpen ? <EditorPreview data={previewData} isDirty={dirty.length > 0} /> : null}
    </div>
  );
}
