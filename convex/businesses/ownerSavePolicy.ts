import type { EditableBusinessField } from '../businessTypes';
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
