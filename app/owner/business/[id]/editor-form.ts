import type { EditableBusinessField } from '@/convex/businessTypes';
import type { Id } from '@/convex/_generated/dataModel';

// Pure owner-editor form state for issue #12 / B3a (todo #9).
//
// Everything here is framework-free and has only type-only imports, so the
// dirty/patch/time-normalisation derivations can be exercised under
// `node --test` (editor-form.test.ts) without a Convex runtime or a DOM. The
// React shell (editor-shell.tsx) and section components own only rendering and
// the mutation call.

/** UI-facing mirror of the frozen server classification (`EDITABLE_FIELD_CLASS`). */
export type EditorFieldClass = 'core' | 'content';

/**
 * Core-vs-content classification used for field tagging and for deciding which
 * edits stay client-staged on an approved listing. Pinned to the frozen server
 * map by `editor-form.test.ts` so the UI can never drift from the mutation's
 * allowlist.
 */
export const EDITOR_FIELD_CLASS = {
  name: 'core',
  categoryId: 'core',
  description: 'core',
  address: 'core',
  hours: 'content',
  phone: 'content',
  email: 'content',
  website: 'content',
  tags: 'content',
  amenities: 'content',
} as const satisfies Record<EditableBusinessField, EditorFieldClass>;

/** Every editable field, in section order, derived from the classification map. */
export const EDITOR_FIELDS = Object.keys(EDITOR_FIELD_CLASS) as EditableBusinessField[];

/** Weekly hours days, matching `hoursValidator` in convex/businessTypes.ts. */
export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

export interface OpeningPeriodForm {
  opensAt: string;
  closesAt: string;
}

export interface AddressForm {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
}

export type HoursForm = Record<Weekday, OpeningPeriodForm[]>;

/** Client form state for one owned listing — only the B3a editable surface. */
export interface EditorFormState {
  name: string;
  categoryId: string;
  description: string;
  address: AddressForm;
  hours: HoursForm;
  phone: string;
  email: string;
  website: string;
  tags: string[];
  amenities: string[];
}

/**
 * Structural view of the fields `createEditorForm` reads. `getMine`'s editor
 * document satisfies it; tests can pass a plain object.
 */
export interface EditorSourceDocument {
  name: string;
  categoryId: string;
  description: string;
  address: {
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode?: string;
    country: string;
    latitude?: number;
    longitude?: number;
  };
  hours: Partial<Record<Weekday, readonly OpeningPeriodForm[]>>;
  phone?: string;
  email?: string;
  website?: string;
  tags?: string[];
  amenities?: string[];
}

/** Address value as the server stores it (optional parts omitted when empty). */
export interface AddressPatch {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode?: string;
  country: string;
  latitude?: number;
  longitude?: number;
}

export type HoursPatch = Partial<Record<Weekday, OpeningPeriodForm[]>>;

/** A partial editable patch; only keys present are sent to `saveDraft`. */
export interface EditorPatch {
  name?: string;
  categoryId?: Id<'categories'>;
  description?: string;
  address?: AddressPatch;
  hours?: HoursPatch;
  phone?: string;
  email?: string;
  website?: string;
  tags?: string[];
  amenities?: string[];
}

function toHoursForm(hours: EditorSourceDocument['hours']): HoursForm {
  const result = {} as HoursForm;

  for (const day of WEEKDAYS) {
    result[day] = (hours[day] ?? []).map((period) => ({
      opensAt: period.opensAt,
      closesAt: period.closesAt,
    }));
  }

  return result;
}

/** Initialises client form state from an owned editor document. */
export function createEditorForm(document: EditorSourceDocument): EditorFormState {
  return {
    name: document.name,
    categoryId: document.categoryId,
    description: document.description,
    address: {
      addressLine1: document.address.addressLine1,
      addressLine2: document.address.addressLine2 ?? '',
      city: document.address.city,
      state: document.address.state,
      postalCode: document.address.postalCode ?? '',
      country: document.address.country,
      ...(document.address.latitude === undefined ? {} : { latitude: document.address.latitude }),
      ...(document.address.longitude === undefined
        ? {}
        : { longitude: document.address.longitude }),
    },
    hours: toHoursForm(document.hours),
    phone: document.phone ?? '',
    email: document.email ?? '',
    website: document.website ?? '',
    tags: [...(document.tags ?? [])],
    amenities: [...(document.amenities ?? [])],
  };
}

/** Drops empty days and clones periods so the value matches `hoursValidator`. */
export function normalizeHours(hours: HoursForm): HoursPatch {
  const result: HoursPatch = {};

  for (const day of WEEKDAYS) {
    const periods = hours[day].map((period) => ({
      opensAt: period.opensAt,
      closesAt: period.closesAt,
    }));

    if (periods.length > 0) {
      result[day] = periods;
    }
  }

  return result;
}

/** Omits empty optional address parts; preserves latitude/longitude when set. */
export function normalizeAddress(address: AddressForm): AddressPatch {
  const addressLine2 = address.addressLine2.trim();
  const postalCode = address.postalCode.trim();

  return {
    addressLine1: address.addressLine1.trim(),
    ...(addressLine2.length === 0 ? {} : { addressLine2 }),
    city: address.city.trim(),
    state: address.state.trim(),
    ...(postalCode.length === 0 ? {} : { postalCode }),
    country: address.country.trim(),
    ...(address.latitude === undefined ? {} : { latitude: address.latitude }),
    ...(address.longitude === undefined ? {} : { longitude: address.longitude }),
  };
}

/** Trims, drops blanks, and de-dupes a free-form string list, preserving order. */
export function normalizeStringList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}

/**
 * Form-shaped canonical address: keeps all six string keys (empty optional parts
 * become `''`) and preserves latitude/longitude when set. Distinct from
 * `normalizeAddress`, which produces the server patch shape (optional parts
 * omitted) and must stay that way.
 */
function canonicalAddress(address: AddressForm): AddressForm {
  return {
    addressLine1: address.addressLine1.trim(),
    addressLine2: address.addressLine2.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    postalCode: address.postalCode.trim(),
    country: address.country.trim(),
    ...(address.latitude === undefined ? {} : { latitude: address.latitude }),
    ...(address.longitude === undefined ? {} : { longitude: address.longitude }),
  };
}

/** Form-shaped canonical hours: all seven weekdays present, closed days as `[]`. */
function canonicalHours(hours: HoursForm): HoursForm {
  return toHoursForm(hours);
}

/** Canonical server value for one editable field, used by patch and canonicalise. */
const FIELD_PATCH_VALUES = {
  name: (form: EditorFormState) => form.name.trim(),
  categoryId: (form: EditorFormState) => form.categoryId,
  description: (form: EditorFormState) => form.description,
  address: (form: EditorFormState) => normalizeAddress(form.address),
  hours: (form: EditorFormState) => normalizeHours(form.hours),
  phone: (form: EditorFormState) => form.phone.trim(),
  email: (form: EditorFormState) => form.email.trim(),
  website: (form: EditorFormState) => form.website.trim(),
  tags: (form: EditorFormState) => normalizeStringList(form.tags),
  amenities: (form: EditorFormState) => normalizeStringList(form.amenities),
} satisfies Record<EditableBusinessField, (form: EditorFormState) => unknown>;

/** Stable per-field signature for change detection (trimmed/structural). */
const FIELD_SIGNATURES = {
  name: (form: EditorFormState) => form.name.trim(),
  categoryId: (form: EditorFormState) => form.categoryId,
  description: (form: EditorFormState) => form.description,
  address: (form: EditorFormState) => JSON.stringify(normalizeAddress(form.address)),
  hours: (form: EditorFormState) => JSON.stringify(normalizeHours(form.hours)),
  phone: (form: EditorFormState) => form.phone.trim(),
  email: (form: EditorFormState) => form.email.trim(),
  website: (form: EditorFormState) => form.website.trim(),
  tags: (form: EditorFormState) => JSON.stringify(normalizeStringList(form.tags)),
  amenities: (form: EditorFormState) => JSON.stringify(normalizeStringList(form.amenities)),
} satisfies Record<EditableBusinessField, (form: EditorFormState) => string>;

/**
 * Form-shaped canonical value per field, used by `canonicalizeForm`. Unlike
 * `FIELD_PATCH_VALUES` (server patch shape), the address keeps all six string
 * keys and hours keeps all seven weekdays, so the result is a genuine
 * `EditorFormState` and the next `dirtyFields` render cannot throw.
 */
const CANONICAL_FIELD_VALUES = {
  name: (form: EditorFormState) => form.name.trim(),
  categoryId: (form: EditorFormState) => form.categoryId,
  description: (form: EditorFormState) => form.description,
  address: (form: EditorFormState) => canonicalAddress(form.address),
  hours: (form: EditorFormState) => canonicalHours(form.hours),
  phone: (form: EditorFormState) => form.phone.trim(),
  email: (form: EditorFormState) => form.email.trim(),
  website: (form: EditorFormState) => form.website.trim(),
  tags: (form: EditorFormState) => normalizeStringList(form.tags),
  amenities: (form: EditorFormState) => normalizeStringList(form.amenities),
} satisfies Record<EditableBusinessField, (form: EditorFormState) => unknown>;

/** Editable fields whose current value differs from the saved baseline. */
export function dirtyFields(
  form: EditorFormState,
  baseline: EditorFormState
): EditableBusinessField[] {
  return EDITOR_FIELDS.filter(
    (field) => FIELD_SIGNATURES[field](form) !== FIELD_SIGNATURES[field](baseline)
  );
}

/** The subset of `fields` classified as core identity. */
export function coreIdentityFields(
  fields: readonly EditableBusinessField[]
): EditableBusinessField[] {
  return fields.filter((field) => EDITOR_FIELD_CLASS[field] === 'core');
}

/**
 * Builds a partial patch containing only `fields`, each normalised to its server
 * shape. The result is structurally assignable to `saveDraft`'s `patch` argument.
 */
export function buildEditablePatch(
  form: EditorFormState,
  fields: readonly EditableBusinessField[]
): EditorPatch {
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    result[field] = FIELD_PATCH_VALUES[field](form);
  }

  return result as EditorPatch;
}

/**
 * Returns a copy of `form` with `fields` replaced by their canonical values.
 * Called after a successful save so the saved fields stop reading as dirty while
 * approved core identity edits (ignored by the server) stay staged. The result is
 * a genuine `EditorFormState`: address keeps all six string keys and hours keeps
 * all seven weekdays, so the shell's next `dirtyFields` render cannot throw.
 */
export function canonicalizeForm(
  form: EditorFormState,
  fields: readonly EditableBusinessField[]
): EditorFormState {
  const next: EditorFormState = { ...form };
  const draft: Record<EditableBusinessField, unknown> = next;

  for (const field of fields) {
    draft[field] = CANONICAL_FIELD_VALUES[field](form);
  }

  return next;
}

/**
 * Merges the canonical values of `fields` into a saved baseline, leaving every
 * other field (e.g. approved core identity staged client-side) untouched.
 */
export function mergeSavedFields(
  baseline: EditorFormState,
  canonical: EditorFormState,
  fields: readonly EditableBusinessField[]
): EditorFormState {
  const next: Record<string, unknown> = { ...baseline };

  for (const field of fields) {
    next[field] = canonical[field];
  }

  return next as unknown as EditorFormState;
}

/**
 * Reconciles form state after a save resolves. The mutation was sent from a
 * pre-await `snapshot`, but the section inputs stay editable while it is in
 * flight: when `current` has a newer value for a saved field (its signature
 * differs from `snapshot`), keep the user's edit; otherwise take the canonical
 * value so the field stops reading as dirty. Fields outside `fields` are left
 * exactly as the user left them.
 */
export function reconcileSavedFields(
  current: EditorFormState,
  snapshot: EditorFormState,
  canonical: EditorFormState,
  fields: readonly EditableBusinessField[]
): EditorFormState {
  const next: EditorFormState = { ...current };
  const draft: Record<EditableBusinessField, unknown> = next;

  for (const field of fields) {
    if (FIELD_SIGNATURES[field](current) !== FIELD_SIGNATURES[field](snapshot)) {
      continue;
    }
    draft[field] = canonical[field];
  }

  return next;
}

/** Minimal pre-save validation: a listing must keep a non-empty name. */
export function validateForm(form: EditorFormState): string | null {
  if (form.name.trim().length === 0) {
    return 'Business name is required.';
  }

  return null;
}
