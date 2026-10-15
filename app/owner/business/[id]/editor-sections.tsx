import { Fragment } from 'react';

import { Badge } from '@/components/ui/badge';

import { cn } from '@/lib/utils';

import type { EditorFormState } from './editor-form';
import type { EditorSection } from './editor-types';

/** The B3a core editor sections, in the order they appear in the shell. */
export const EDITOR_SECTIONS = [
  {
    id: 'basic-info',
    label: 'Basic Information',
    description: 'Essential details about your business',
  },
  { id: 'hours', label: 'Operating Hours', description: 'Quick-fill presets, then edit freely' },
  { id: 'contact', label: 'Contact Details', description: 'How customers reach you' },
  {
    id: 'location',
    label: 'Location & Map',
    description: 'Address fields only — no map embed in v1',
  },
  {
    id: 'categories-tags',
    label: 'Categories & Tags',
    description: 'Primary category is core; tags are content',
  },
  {
    id: 'features-amenities',
    label: 'Features & Amenities',
    description: 'Services customers can expect',
  },
] as const satisfies readonly EditorSection[];

export type EditorFormSectionId = (typeof EDITOR_SECTIONS)[number]['id'];

/**
 * Photos & Media section (issue #14 / B3c Task 8; SPEC §9). Photo upload and
 * storage land in a later slice (B7): the v1 panel renders the prototype's
 * structure (upload zone, photo grid, note) without file controls.
 */
export const PHOTOS_SECTION = {
  id: 'photos-media',
  label: 'Photos & Media',
  description: 'Ordered gallery — the first photo is the cover',
} as const satisfies EditorSection;

/**
 * Nav-only Analytics placeholder (issue #12 / prototype L369). v1 reads counts
 * from existing tables — no revenue card, no data fetch wired here yet.
 */
export const ANALYTICS_SECTION = {
  id: 'analytics',
  label: 'Analytics',
  description: 'v1 stub — counts from existing tables',
  stub: true,
} as const satisfies EditorSection;

/**
 * Saved/status trail (issue #12 todo #10). It has no form fields, so it is a
 * navigation section rather than an entry in `SECTION_EDITORS`.
 */
export const HISTORY_SECTION = {
  id: 'change-history',
  label: 'Change History',
  description: 'Saved + status trail, no field diffs',
} as const satisfies EditorSection;

/** Nav-only Settings placeholder (issue #12 / prototype L371). */
export const SETTINGS_SECTION = {
  id: 'settings',
  label: 'Settings',
  description: 'v1 stub — placeholder',
  stub: true,
} as const satisfies EditorSection;

export type EditorSectionId =
  | EditorFormSectionId
  | typeof PHOTOS_SECTION.id
  | typeof ANALYTICS_SECTION.id
  | typeof HISTORY_SECTION.id
  | typeof SETTINGS_SECTION.id;

/** A labelled group of nav sections (prototype `.nav-group`, L359-371). */
export interface EditorNavGroup {
  label: string;
  sections: readonly (EditorSection & { id: EditorSectionId })[];
}

/**
 * The section nav groups, mirroring the prototype's nav (owner-workspace.html
 * L358-372): Listing Details, Advanced, Management.
 */
export const EDITOR_NAV_GROUPS: readonly EditorNavGroup[] = [
  {
    label: 'Listing Details',
    sections: [
      EDITOR_SECTIONS[0],
      EDITOR_SECTIONS[1],
      PHOTOS_SECTION,
      EDITOR_SECTIONS[2],
    ],
  },
  {
    label: 'Advanced',
    sections: [EDITOR_SECTIONS[3], EDITOR_SECTIONS[4], EDITOR_SECTIONS[5]],
  },
  { label: 'Management', sections: [ANALYTICS_SECTION, HISTORY_SECTION, SETTINGS_SECTION] },
];

/** Every section shown in the nav, in prototype order (flattened for lookups). */
export const EDITOR_NAV_SECTIONS: readonly (EditorSection & { id: EditorSectionId })[] =
  EDITOR_NAV_GROUPS.flatMap((group) => group.sections);

/** Per-section completion dot: filled ("ok"), partial, or the default grey. */
export type NavDotState = 'ok' | 'partial' | 'none';
export type NavCompletion = Partial<Record<EditorSectionId, NavDotState>>;

/**
 * Derives the nav completion dots from the unsaved form state, using the same
 * rules as the prototype's `DOTS()` (owner-workspace.html L781-792): basic needs
 * name + description, contact needs a phone for full and email/website for
 * partial, and the well-known singletons fill their own section.
 */
export function deriveNavCompletion(form: EditorFormState, photoCount: number): NavCompletion {
  return {
    'basic-info': basicDot(form),
    hours: filledDot(Object.values(form.hours).some((periods) => periods.length > 0)),
    'photos-media': filledDot(photoCount > 0),
    contact: contactDot(form),
    location: textDot(form.address.addressLine1),
    'categories-tags': textDot(form.categoryId),
    'features-amenities': filledDot(form.amenities.length > 0),
  };
}

function filledDot(filled: boolean): NavDotState {
  return filled ? 'ok' : 'none';
}

function textDot(value: string): NavDotState {
  return value.trim().length > 0 ? 'ok' : 'none';
}

function basicDot(form: EditorFormState): NavDotState {
  const hasName = form.name.trim().length > 0;
  const hasDescription = form.description.trim().length > 0;

  if (hasName && hasDescription) {
    return 'ok';
  }
  return hasName || hasDescription ? 'partial' : 'none';
}

function contactDot(form: EditorFormState): NavDotState {
  if (form.phone.trim().length > 0) {
    return 'ok';
  }
  return form.email.trim().length > 0 || form.website.trim().length > 0 ? 'partial' : 'none';
}

interface EditorSectionNavProps {
  activeId: EditorSectionId;
  onSelect: (id: EditorSectionId) => void;
  completion: NavCompletion;
}

/**
 * Section navigation for the editor shell, grouped and dotted like the
 * prototype. Always usable — a read-only listing still needs to be reviewed
 * section by section; the editors themselves render plain values instead of
 * controls. Compact (below `lg`) collapses to a horizontal strip with the group
 * labels and dots hidden.
 */
export function EditorSectionNav({ activeId, onSelect, completion }: EditorSectionNavProps) {
  return (
    <nav
      aria-label="Editor sections"
      className="bg-card text-card-foreground border-border rounded-card border p-3 lg:sticky lg:top-4"
    >
      <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-2 lg:overflow-visible lg:pb-0">
        {EDITOR_NAV_GROUPS.map((group) => (
          <Fragment key={group.label}>
            <p className="text-card-muted hidden px-2 font-label text-xs font-semibold tracking-wide uppercase lg:block">
              {group.label}
            </p>
            <ul role="list" className="flex shrink-0 gap-1 lg:flex-col lg:gap-1">
              {group.sections.map((section) => {
                const isActive = section.id === activeId;
                const dot = completion[section.id];

                return (
                  <li key={section.id} className="shrink-0 lg:shrink">
                    <button
                      type="button"
                      onClick={() => onSelect(section.id)}
                      aria-current={isActive ? 'true' : undefined}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm whitespace-nowrap transition-colors',
                        isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                      )}
                    >
                      <span>{section.label}</span>
                      {'stub' in section ? (
                        <Badge variant="outline" className="font-label text-xs">
                          stub
                        </Badge>
                      ) : null}
                      {dot === undefined ? null : (
                        <span
                          aria-hidden="true"
                          className={cn(
                            'ml-auto hidden size-2 shrink-0 rounded-pill lg:inline-block',
                            dot === 'ok'
                              ? 'bg-green-600'
                              : dot === 'partial'
                                ? 'bg-amber-500'
                                : 'bg-border'
                          )}
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Fragment>
        ))}
      </div>
    </nav>
  );
}
