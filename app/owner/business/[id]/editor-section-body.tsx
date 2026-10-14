'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { EditorHistory } from './editor-history';
import {
  ANALYTICS_SECTION,
  HISTORY_SECTION,
  PHOTOS_SECTION,
  SETTINGS_SECTION,
  type EditorSectionId,
} from './editor-sections';
import type { EditorSection } from './editor-types';
import type { EditorFormState } from './editor-form';
import type { HistoryEntry } from './editor-status';
import { EditorSectionView, type CategoryOption } from './section-editors';

/**
 * Renders the active section of the owner editor: the Change History trail, a
 * stub card for the nav-only sections (Photos & Media, Analytics, Settings), or
 * the editable section view. Extracted from `EditorShell` so the shell's render
 * branching stays within the repo's ESLint complexity guardrail.
 */
export function EditorSectionBody({
  activeId,
  activeSection,
  form,
  onChange,
  readOnly,
  categories,
  historyEntries,
}: {
  activeId: EditorSectionId;
  activeSection: EditorSection;
  form: EditorFormState;
  onChange: <K extends keyof EditorFormState>(field: K, value: EditorFormState[K]) => void;
  readOnly: boolean;
  categories: CategoryOption[];
  historyEntries: HistoryEntry[];
}) {
  if (activeId === HISTORY_SECTION.id) {
    return <EditorHistory entries={historyEntries} />;
  }

  if (
    activeId === PHOTOS_SECTION.id ||
    activeId === ANALYTICS_SECTION.id ||
    activeId === SETTINGS_SECTION.id
  ) {
    return (
      <Card className="rounded-card py-card">
        <CardHeader>
          <CardTitle className="font-display text-lg">{activeSection.label}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{activeSection.description}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <EditorSectionView
      sectionId={activeId}
      section={activeSection}
      form={form}
      onChange={onChange}
      readOnly={readOnly}
      categories={categories}
    />
  );
}
