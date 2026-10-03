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
 * Saved/status trail (issue #12 todo #10). It has no form fields, so it is a
 * navigation section rather than an entry in `SECTION_EDITORS`.
 */
export const HISTORY_SECTION = {
  id: 'change-history',
  label: 'Change History',
  description: 'Saved and status trail',
} as const satisfies EditorSection;

export type EditorSectionId = EditorFormSectionId | typeof HISTORY_SECTION.id;

/** Every section shown in the nav, in order. */
export const EDITOR_NAV_SECTIONS = [
  ...EDITOR_SECTIONS,
  HISTORY_SECTION,
] as const satisfies readonly EditorSection[];

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
      <ul className="flex flex-col gap-1" role="list">
        {EDITOR_NAV_SECTIONS.map((section) => {
          const isActive = section.id === activeId;

          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => onSelect(section.id)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'w-full rounded-control px-3 py-2 text-left text-sm transition-colors',
                  isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                )}
              >
                {section.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
