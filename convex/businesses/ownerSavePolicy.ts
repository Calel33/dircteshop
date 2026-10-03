import type { CoreIdentityField, EditableBusinessField } from '../businessTypes';
import type { ListingStatus } from './helpers';

// B3a (issue #12, todo #5) owner save/submit decision logic. Pure functions with
// type-only imports, so every decision is unit-testable in isolation — the same
// pattern as `ownerProjections.ts`. The frozen field classification is injected
// (`EDITABLE_FIELD_CLASS`) so this module never needs a runtime import of a
// Convex module and stays resolvable under both `node --test` and Convex.

export type FieldClass = 'core' | 'content';

/** The frozen editable classification (`convex/businessTypes.ts`), injected. */
export type FieldClassMap = Readonly<Record<EditableBusinessField, FieldClass>>;

/**
 * How `saveDraft` treats the current listing status (contract §4.2/§5):
 * - `persistAll`: editable non-approved states (draft/changesRequested).
 * - `persistContent`: approved — content persists, core identity is staged
 *   client-side until `saveAndResubmit`.
 * - `reject`: read-only states (pendingReview/suspended) and rejected (the owner
 *   must revise to draft first).
 */
export type OwnerSaveMode = 'persistAll' | 'persistContent' | 'reject';

export function ownerSaveMode(status: ListingStatus): OwnerSaveMode {
  if (status === 'approved') {
    return 'persistContent';
  }
  if (status === 'draft' || status === 'changesRequested') {
    return 'persistAll';
  }
  return 'reject';
}

export function isEditableBusinessField(
  fieldClass: FieldClassMap,
  field: string
): field is EditableBusinessField {
  return Object.prototype.hasOwnProperty.call(fieldClass, field);
}

/**
 * Unknown-key policy (contract §4.2): anything absent from the allowlist is
 * never patchable, so unknown keys are rejected. Convex object validation already
 * throws on undeclared keys at the API boundary; this is the handler-level
 * defense-in-depth check (same posture as `searchPublic`'s post-filter).
 */
export function findUnknownPatchFields(fieldClass: FieldClassMap, patch: object): string[] {
  return Object.keys(patch).filter((key) => !isEditableBusinessField(fieldClass, key));
}

/** Editable keys the client actually supplied (`undefined` counts as omitted). */
export function providedEditableFields(
  fieldClass: FieldClassMap,
  patch: object
): EditableBusinessField[] {
  const record = patch as Record<string, unknown>;
  return Object.keys(record).filter(
    (key): key is EditableBusinessField =>
      isEditableBusinessField(fieldClass, key) && record[key] !== undefined
  );
}

/**
 * The trimmed value of a supplied `name`, or `undefined` when the patch omitted
 * it (T4). The client `validateForm` is bypassable by calling the mutation
 * directly and `v.string()` accepts whitespace-only values, so the server trims
 * and persists this value rather than `patch.name` verbatim.
 */
export function normalizePatchName(patch: object): string | undefined {
  const name = (patch as Record<string, unknown>).name;
  return typeof name === 'string' ? name.trim() : undefined;
}

/** Whether a patch supplied a name that is blank after trimming (T4). */
export function isBlankPatchName(patch: object): boolean {
  const name = normalizePatchName(patch);
  return name !== undefined && name.length === 0;
}

/** The subset of `fields` the server persists under the given save mode. */
export function persistableSaveFields(
  mode: OwnerSaveMode,
  fieldClass: FieldClassMap,
  fields: readonly EditableBusinessField[]
): EditableBusinessField[] {
  if (mode === 'reject') {
    return [];
  }
  if (mode === 'persistAll') {
    return [...fields];
  }
  return fields.filter((field) => fieldClass[field] === 'content');
}

export function hasCoreIdentityField(
  fieldClass: FieldClassMap,
  fields: readonly EditableBusinessField[]
): boolean {
  return fields.some((field) => fieldClass[field] === 'core');
}

/**
 * The persisted core identity values `saveAndResubmit` compares a patch against.
 * Typed structurally (not `Doc<'businesses'>`) so this module keeps no
 * Convex-generated runtime imports — the editor client imports it directly.
 */
export interface PersistedCoreIdentity {
  readonly name: string;
  readonly categoryId: string;
  readonly description: string;
  readonly address: AddressValue;
}

/** The `addressValidator` shape (`convex/businessTypes.ts`). */
export interface AddressValue {
  readonly addressLine1: string;
  readonly addressLine2?: string;
  readonly city: string;
  readonly state: string;
  readonly country: string;
  readonly postalCode?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

/**
 * Core identity fields a patch supplies whose value differs from the persisted
 * document (T5). Presence alone (`hasCoreIdentityField`) is not enough: without
 * this check an approved listing can be pulled back into review by re-sending an
 * unchanged value. Name and required address parts compare trimmed; optional
 * address parts treat `undefined` and `''` as equal; coordinates compare
 * strictly when present. Content fields and unknown keys are ignored.
 */
export function changedCoreIdentityFields(
  fieldClass: FieldClassMap,
  patch: object,
  business: PersistedCoreIdentity
): CoreIdentityField[] {
  const suppliedCore = providedEditableFields(fieldClass, patch).filter(
    (field): field is CoreIdentityField => fieldClass[field] === 'core'
  );

  return suppliedCore.filter((field) => coreIdentityFieldDiffers(field, patch, business));
}

function coreIdentityFieldDiffers(
  field: CoreIdentityField,
  patch: object,
  business: PersistedCoreIdentity
): boolean {
  const record = patch as Record<string, unknown>;
  switch (field) {
    case 'name':
      return normalizedString(record.name) !== normalizedString(business.name);
    case 'categoryId':
      return record.categoryId !== business.categoryId;
    case 'description':
      return record.description !== business.description;
    case 'address':
      return !addressesEqual(record.address, business.address);
  }
}

function addressesEqual(supplied: unknown, persisted: AddressValue): boolean {
  if (!isAddressValue(supplied)) {
    return false;
  }

  return (
    supplied.addressLine1.trim() === persisted.addressLine1.trim() &&
    normalizedString(supplied.addressLine2) === normalizedString(persisted.addressLine2) &&
    supplied.city.trim() === persisted.city.trim() &&
    supplied.state.trim() === persisted.state.trim() &&
    supplied.country.trim() === persisted.country.trim() &&
    normalizedString(supplied.postalCode) === normalizedString(persisted.postalCode) &&
    supplied.latitude === persisted.latitude &&
    supplied.longitude === persisted.longitude
  );
}

function isAddressValue(value: unknown): value is AddressValue {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const address = value as Record<string, unknown>;
  return (
    typeof address.addressLine1 === 'string' &&
    typeof address.city === 'string' &&
    typeof address.state === 'string' &&
    typeof address.country === 'string'
  );
}

/** Trimmed string, or `''` for a missing value, so `undefined` and `''` compare equal. */
function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export type ModerationReasonPolicy = 'retain' | 'clear';

export type OwnerModerationReasonPolicy = Readonly<
  Record<'onOwnerSubmit' | 'onOwnerRevise', ModerationReasonPolicy>
>;

/**
 * §9.1/§9.2 decision (contract §9): conservative retention. An owner submit or
 * revise never clears `moderationReason`/`moderatedAt`, matching the existing
 * `transition` behavior and keeping the change surface minimal. Owner banners
 * must key off `status` and read the reason only for `changesRequested`/`rejected`.
 */
export const OWNER_MODERATION_REASON_POLICY: OwnerModerationReasonPolicy = {
  onOwnerSubmit: 'retain',
  onOwnerRevise: 'retain',
};

/**
 * Whether `saveAndResubmit` should clear moderation metadata. Driven by the
 * §9.1 policy above; the owner `transition` submit path already retains it.
 */
export function ownerSubmitClearsModeration(): boolean {
  return OWNER_MODERATION_REASON_POLICY.onOwnerSubmit === 'clear';
}
