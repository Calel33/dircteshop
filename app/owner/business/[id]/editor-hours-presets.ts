import { WEEKDAYS, type HoursForm, type OpeningPeriodForm, type Weekday } from './editor-form.ts';

/**
 * Pure hours quick-fill presets (issue #14 / B3c Task 6). Presets are UI-only:
 * they stamp ordinary editable weekly values into the form and are never
 * persisted, and there is no preset CRUD. The exact time values match the
 * throwaway prototype's `applyPreset` (owner-workspace.html L695-705); the
 * prototype's CSS is NOT ported. Framework-free so it can be pinned with
 * `node --test`.
 *
 * `Clear` is the owner-confirmed replacement for SPEC §9's older `Custom`
 * preset label; manual editing remains "Custom" conceptually.
 */

export const HOURS_PRESETS = ['standard', 'coffee-shop', 'weekend-only', 'clear'] as const;
export type HoursPresetId = (typeof HOURS_PRESETS)[number];

/** UI metadata for the preset buttons and the "Copy from template" control. */
export const HOURS_PRESET_OPTIONS: readonly { id: HoursPresetId; label: string }[] = [
  { id: 'standard', label: 'Standard 9–5' },
  { id: 'coffee-shop', label: 'Coffee shop 7–6' },
  { id: 'weekend-only', label: 'Weekend only' },
  { id: 'clear', label: 'Clear' },
];

const OPEN_9_TO_5: OpeningPeriodForm = { opensAt: '09:00', closesAt: '17:00' };

/** A fresh, closed form: all seven weekdays present with no periods. */
export function emptyHoursForm(): HoursForm {
  const result = {} as HoursForm;
  for (const day of WEEKDAYS) {
    result[day] = [];
  }
  return result;
}

/**
 * The preset's open days. A new object is returned on every call, so the
 * shared constant is never mutated and the caller can own the result.
 */
function presetDayPeriods(preset: HoursPresetId): Partial<Record<Weekday, OpeningPeriodForm[]>> {
  switch (preset) {
    case 'standard':
      return {
        monday: [{ ...OPEN_9_TO_5 }],
        tuesday: [{ ...OPEN_9_TO_5 }],
        wednesday: [{ ...OPEN_9_TO_5 }],
        thursday: [{ ...OPEN_9_TO_5 }],
        friday: [{ ...OPEN_9_TO_5 }],
      };
    case 'coffee-shop':
      return {
        monday: [{ opensAt: '07:00', closesAt: '18:00' }],
        tuesday: [{ opensAt: '07:00', closesAt: '18:00' }],
        wednesday: [{ opensAt: '07:00', closesAt: '18:00' }],
        thursday: [{ opensAt: '07:00', closesAt: '18:00' }],
        friday: [{ opensAt: '07:00', closesAt: '18:00' }],
        saturday: [{ opensAt: '08:00', closesAt: '16:00' }],
      };
    case 'weekend-only':
      return {
        saturday: [{ ...OPEN_9_TO_5 }],
        sunday: [{ ...OPEN_9_TO_5 }],
      };
    case 'clear':
      return {};
  }
}

/**
 * Builds a fresh `HoursForm` for a preset. Every day is present (closed days as
 * `[]`), each period is cloned, and the result stays ordinary editable form
 * state — applying a preset is exactly a form change with nothing persisted.
 */
export function applyHoursPreset(preset: HoursPresetId): HoursForm {
  const result = emptyHoursForm();
  const openDays = presetDayPeriods(preset);

  for (const day of WEEKDAYS) {
    const periods = openDays[day];
    if (periods !== undefined) {
      result[day] = periods.map((period) => ({ ...period }));
    }
  }

  return result;
}
