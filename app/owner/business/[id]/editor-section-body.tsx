'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { EditorHistory } from './editor-history';
import { getPhotoSlotLabels } from './editor-photo-slots';
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
import { EditorSectionView } from './section-editors';
import type { CategoryOption } from './section-card';

const STUB_NOTE_CLASS =
  'bg-muted text-muted-foreground rounded-control border border-border p-4 text-sm';

/**
 * Photos & Media panel (prototype L406-411). Uploads are a later slice (B7), so
 * the v1 panel renders the prototype's structure — upload zone, ordered grid,
 * note — without file controls.
 */
function PhotosPanel({ section, photoCount }: { section: EditorSection; photoCount: number }) {
  return (
    <Card className="rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-lg">{section.label}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="border-border text-card-muted rounded-card border-2 border-dashed p-6 text-center text-sm">
          Drag photos here — photo uploads arrive in a later slice
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-3">
          {getPhotoSlotLabels(photoCount).map((label, index) => (
            <div
              key={index}
              className="bg-muted border-border text-muted-foreground flex aspect-square items-center justify-center rounded-control border text-xs font-semibold"
            >
              {label}
            </div>
          ))}
        </div>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            title="Photo uploads arrive in a later slice"
          >
            Add photo
          </Button>
        </div>
        <p className="text-card-muted text-xs">
          Photos are content — adding or reordering an approved listing&apos;s photos goes live
          immediately.
        </p>
      </CardContent>
    </Card>
  );
}

const ANALYTICS_STATS = ['Profile views', 'Contact clicks', 'Orders / bookings'] as const;

/**
 * Analytics panel (prototype L440-447): the v1 stub note plus the stat grid.
 * The counts are not sourced yet (SPEC §13), so the values render as
 * placeholders rather than fabricated numbers.
 */
function AnalyticsPanel({ section }: { section: EditorSection }) {
  return (
    <Card className="rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-lg">{section.label}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className={STUB_NOTE_CLASS}>
          v1 stub — counts read from existing tables. No revenue card.
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-3">
          {ANALYTICS_STATS.map((stat) => (
            <div
              key={stat}
              className="bg-muted border-border rounded-control border p-4 text-center"
            >
              <b className="text-foreground block text-2xl font-semibold">—</b>
              <span className="text-muted-foreground text-xs font-semibold">{stat}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Settings panel (prototype L455-457): stub note only. */
function SettingsPanel({ section }: { section: EditorSection }) {
  return (
    <Card className="rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-lg">{section.label}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className={STUB_NOTE_CLASS}>v1 stub — placeholder. Nothing to configure here yet.</p>
      </CardContent>
    </Card>
  );
}

/**
 * Renders the active section of the owner editor: the Change History trail, the
 * Photos & Media / Analytics / Settings panels, or the editable section view
 * with the prototype's "Reset Section" tool in its panel head (L375-378).
 * Extracted from `EditorShell` so the shell's render branching stays within the
 * repo's ESLint complexity guardrail.
 */
export function EditorSectionBody({
  activeId,
  activeSection,
  form,
  onChange,
  readOnly,
  categories,
  historyEntries,
  photoCount,
  showResetSection,
  canResetSection,
  onResetSection,
}: {
  activeId: EditorSectionId;
  activeSection: EditorSection;
  form: EditorFormState;
  onChange: <K extends keyof EditorFormState>(field: K, value: EditorFormState[K]) => void;
  readOnly: boolean;
  categories: CategoryOption[];
  historyEntries: HistoryEntry[];
  photoCount: number;
  /** True when the active section has reset fields. */
  showResetSection: boolean;
  canResetSection: boolean;
  onResetSection: () => void;
}) {
  const resetTool = showResetSection ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onResetSection}
      disabled={!canResetSection}
    >
      Reset Section
    </Button>
  ) : null;

  if (activeId === HISTORY_SECTION.id) {
    return <EditorHistory entries={historyEntries} />;
  }

  if (activeId === PHOTOS_SECTION.id) {
    return <PhotosPanel section={activeSection} photoCount={photoCount} />;
  }

  if (activeId === ANALYTICS_SECTION.id) {
    return <AnalyticsPanel section={activeSection} />;
  }

  if (activeId === SETTINGS_SECTION.id) {
    return <SettingsPanel section={activeSection} />;
  }

  return (
    <EditorSectionView
      sectionId={activeId}
      section={activeSection}
      form={form}
      onChange={onChange}
      readOnly={readOnly}
      categories={categories}
      tool={resetTool}
    />
  );
}
