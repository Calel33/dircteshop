import { Badge } from '@/components/ui/badge';

import { cn } from '@/lib/utils';

import type { EditorSection } from './editor-types';

/** The B3a core editor sections, in the order they appear in the shell. */
export const EDITOR_SECTIONS = [
  { id: 'basic-info', label: 'Basic Info', description: 'Name, category, and description' },
  { id: 'hours', label: 'Hours', description: 'Weekly opening hours' },
  { id: 'contact', label: 'Contact', description: 'Phone, email, and website' },
  { id: 'location', label: 'Location', description: 'Street address' },
  {
    id: 'categories-tags',
    label: 'Categories & Tags',
    description: 'Free-form tags for discovery',
  },
  {
    id: 'features-amenities',
    label: 'Features & Amenities',
    description: 'Free-form amenities',
  },
] as const satisfies readonly EditorSection[];

export type EditorFormSectionId = (typeof EDITOR_SECTIONS)[number]['id'];

/**
 * Nav-only Photos & Media placeholder (issue #14 / B3c Task 8; SPEC §9). Photo
 * upload/storage lands in a later slice (B7), so this is a navigation entry with
 * no upload controls and no form fields.
 */
export const PHOTOS_SECTION = {
  id: 'photos-media',
  label: 'Photos & Media',
  description: 'v1 placeholder — photo uploads arrive in a later slice. No upload controls yet.',
  stub: true,
} as const satisfies EditorSection;

/**
 * Nav-only Analytics placeholder (issue #12 / prototype L369). v1 reads counts
 * from existing tables — no revenue card, no data fetch wired here yet.
 */
export const ANALYTICS_SECTION = {
  id: 'analytics',
  label: 'Analytics',
  description: 'v1 stub — counts read from existing tables. No revenue card.',
  stub: true,
} as const satisfies EditorSection;

/**
 * Saved/status trail (issue #12 todo #10). It has no form fields, so it is a
 * navigation section rather than an entry in `SECTION_EDITORS`.
 */
export const HISTORY_SECTION = {
  id: 'change-history',
  label: 'Change History',
  description: 'Saved and status trail',
} as const satisfies EditorSection;

/** Nav-only Settings placeholder (issue #12 / prototype L371). */
export const SETTINGS_SECTION = {
  id: 'settings',
  label: 'Settings',
  description: 'v1 stub — placeholder. Nothing to configure here yet.',
  stub: true,
} as const satisfies EditorSection;

export type EditorSectionId =
  | EditorFormSectionId
  | typeof PHOTOS_SECTION.id
  | typeof ANALYTICS_SECTION.id
  | typeof HISTORY_SECTION.id
  | typeof SETTINGS_SECTION.id;

/**
 * Every section shown in the nav, in prototype order (owner-workspace.html
 * L358-372): Listing Details (Basic Info, Hours, Photos & Media, Contact),
 * Advanced (Location, Categories & Tags, Features & Amenities), Management
 * (Analytics, Change History, Settings).
 */
export const EDITOR_NAV_SECTIONS: readonly (EditorSection & { id: EditorSectionId })[] = [
  ...EDITOR_SECTIONS.slice(0, 2),
  PHOTOS_SECTION,
  ...EDITOR_SECTIONS.slice(2),
  ANALYTICS_SECTION,
  HISTORY_SECTION,
  SETTINGS_SECTION,
];

interface EditorSectionNavProps {
  activeId: EditorSectionId;
  onSelect: (id: EditorSectionId) => void;
}

/**
 * Section navigation for the editor shell. Always usable — a read-only listing
 * still needs to be reviewed section by section; the editors themselves render
 * plain values instead of controls.
 */
export function EditorSectionNav({ activeId, onSelect }: EditorSectionNavProps) {
  return (
    <nav aria-label="Editor sections" className="flex flex-col gap-2">
      <p className="text-muted-foreground px-2 font-label text-xs tracking-wide uppercase">
        Sections
      </p>
      {/*
        Compact (mobile) collapses the vertical sidebar into a horizontal,
        non-wrapping scroll strip; at `lg` it returns to the desktop column.
      */}
      <ul
        className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
        role="list"
      >
        {EDITOR_NAV_SECTIONS.map((section) => {
          const isActive = section.id === activeId;

          return (
            <li key={section.id} className="shrink-0 lg:shrink">
              <button
                type="button"
                onClick={() => onSelect(section.id)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-control px-3 py-2 text-left text-sm whitespace-nowrap transition-colors',
                  isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                )}
              >
                <span>{section.label}</span>
                {'stub' in section ? (
                  <Badge variant="outline" className="font-label text-xs">
                    stub
                  </Badge>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
