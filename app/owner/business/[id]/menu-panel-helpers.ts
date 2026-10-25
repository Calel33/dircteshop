import type { Doc, Id } from '@/convex/_generated/dataModel';

// Pure helpers for the owner Menu panel (T7). No React and no `'use client'`, so
// the parsing/validation rules can be exercised by `node --test` without a
// browser. The stored shapes come from `convex/menus.ts`; the server re-validates
// every field, so these helpers exist to fail fast with inline, field-level copy.

export type MenuGroup = Doc<'menuGroups'>;
export type MenuItem = Doc<'menuItems'> & { imageUrl: string | null };
export type Nutrition = NonNullable<Doc<'menuItems'>['nutrition']>;
export type CustomizationOptions = Doc<'menuItems'>['customizationOptions'];
export type CustomizationGroup = CustomizationOptions[number];

export type NutritionDraft = {
  calories: string;
  proteinGrams: string;
  carbohydrateGrams: string;
  fatGrams: string;
};

export type OptionDraft = {
  name: string;
  priceAdjustment: string;
};

export type CustomizationGroupDraft = {
  name: string;
  required: boolean;
  options: OptionDraft[];
};

/** The item editor's local state shape; persisted only on Save. */
export type ItemDraft = {
  name: string;
  description: string;
  price: string;
  isAvailable: boolean;
  imageStorageId: Id<'_storage'> | null;
  imageUrl: string | null;
  imageName: string | null;
  nutrition: NutritionDraft;
  customizationOptions: CustomizationGroupDraft[];
};

/** The `createItem` argument fields, minus `businessId` / `groupId`. */
export type NewItemFields = {
  name: string;
  description?: string;
  price?: number;
  imageStorageId?: Id<'_storage'>;
  customizationOptions: CustomizationOptions;
  isAvailable: boolean;
  nutrition?: Nutrition;
};

/** The `updateItem` patch fields. */
export type ItemPatch = {
  name: string;
  description: string;
  price?: number;
  isAvailable: boolean;
  customizationOptions: CustomizationOptions;
  nutrition: Nutrition;
  imageStorageId?: Id<'_storage'> | null;
};

export type MoveDirection = 'up' | 'down';

/** The item editor's target: a new item in a group, or an existing item. */
export type ItemEditorState =
  | { mode: 'create'; groupId: Id<'menuGroups'>; draft: ItemDraft }
  | { mode: 'edit'; item: MenuItem; draft: ItemDraft };

export type PendingSave =
  | { mode: 'create'; groupId: Id<'menuGroups'>; fields: NewItemFields }
  | { mode: 'edit'; itemId: Id<'menuItems'>; patch: ItemPatch };

export function editorGroupId(editor: ItemEditorState): Id<'menuGroups'> {
  return editor.mode === 'create' ? editor.groupId : editor.item.groupId;
}

export function buildSave(editor: ItemEditorState): { save: PendingSave | null; errors: string[] } {
  if (editor.mode === 'create') {
    const built = buildNewItem(editor.draft);
    return {
      save:
        built.value === null
          ? null
          : { mode: 'create', groupId: editor.groupId, fields: built.value },
      errors: built.errors,
    };
  }

  const built = buildItemPatch(editor.draft, editor.item);
  return {
    save:
      built.value === null ? null : { mode: 'edit', itemId: editor.item._id, patch: built.value },
    errors: built.errors,
  };
}

/** Reads the server's `{ error }` body; falls back to the HTTP status. */
export async function uploadErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    // Fall through to the status-based message.
  }
  return `The image upload failed (HTTP ${response.status}). Try again.`;
}

export type BuildResult<T> = {
  value: T | null;
  errors: string[];
};

type NumberParse =
  | { ok: true; value: number | undefined }
  | { ok: false; error: string };

// Non-negative decimals only. The server rejects negative prices and price
// adjustments, and `Number()` would otherwise accept `0x10`, `1e3` and `Infinity`.
const DECIMAL_PATTERN = /^(?:\d+\.?\d*|\.\d+)$/;

/** Prices are stored as integer cents; display divides by 100. */
export function formatPrice(price: number | undefined): string {
  return price === undefined ? 'No price' : `$${(price / 100).toFixed(2)}`;
}

/** Blank means "not supplied"; anything else must be a non-negative decimal. */
export function parseOptionalNumber(raw: string, label: string): NumberParse {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: undefined };
  }
  if (!DECIMAL_PATTERN.test(trimmed)) {
    return { ok: false, error: `${label} must be a non-negative number.` };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${label} must be a non-negative number.` };
  }
  return { ok: true, value };
}

export function nutritionDraftFrom(nutrition: Nutrition | undefined): NutritionDraft {
  return {
    calories: nutrition?.calories === undefined ? '' : String(nutrition.calories),
    proteinGrams:
      nutrition?.proteinGrams === undefined ? '' : String(nutrition.proteinGrams),
    carbohydrateGrams:
      nutrition?.carbohydrateGrams === undefined ? '' : String(nutrition.carbohydrateGrams),
    fatGrams: nutrition?.fatGrams === undefined ? '' : String(nutrition.fatGrams),
  };
}

/** Builds the stored nutrition object; blank fields are omitted, not zeroed. */
export function nutritionFromDraft(draft: NutritionDraft): {
  nutrition: Nutrition;
  errors: string[];
} {
  const errors: string[] = [];
  const nutrition: Nutrition = {};

  function assign(key: keyof Nutrition, raw: string, label: string) {
    const parsed = parseOptionalNumber(raw, label);
    if (!parsed.ok) {
      errors.push(parsed.error);
      return;
    }
    if (parsed.value !== undefined) {
      nutrition[key] = parsed.value;
    }
  }

  assign('calories', draft.calories, 'Calories');
  assign('proteinGrams', draft.proteinGrams, 'Protein');
  assign('carbohydrateGrams', draft.carbohydrateGrams, 'Carbohydrates');
  assign('fatGrams', draft.fatGrams, 'Fat');

  return { nutrition, errors };
}

export function hasNutrition(nutrition: Nutrition): boolean {
  return Object.keys(nutrition).length > 0;
}

export function emptyOption(): OptionDraft {
  return { name: '', priceAdjustment: '' };
}

export function emptyCustomizationGroup(): CustomizationGroupDraft {
  return { name: '', required: false, options: [emptyOption()] };
}

export function customizationDraftFrom(
  groups: readonly CustomizationGroup[],
): CustomizationGroupDraft[] {
  return groups.map((group) => ({
    name: group.name,
    required: group.required,
    options: group.options.map((option) => ({
      name: option.name,
      priceAdjustment:
        option.priceAdjustment === undefined ? '' : String(option.priceAdjustment / 100),
    })),
  }));
}

/**
 * Draft -> stored shape. Every group the owner added is validated rather than
 * silently dropped, so an empty click does not vanish on save.
 */
export function customizationFromDraft(groups: readonly CustomizationGroupDraft[]): {
  options: CustomizationOptions;
  errors: string[];
} {
  const errors: string[] = [];
  const options: CustomizationOptions = [];

  groups.forEach((group, groupIndex) => {
    const label = `Customization group ${groupIndex + 1}`;
    const name = group.name.trim();
    if (name.length === 0) {
      errors.push(`${label} needs a name.`);
    }
    if (group.options.length === 0) {
      errors.push(`${label} needs at least one option.`);
    }

    const groupOptions: CustomizationOptions[number]['options'] = [];
    group.options.forEach((option, optionIndex) => {
      const optionName = option.name.trim();
      const optionLabel = `${label}, option ${optionIndex + 1}`;
      if (optionName.length === 0) {
        errors.push(`${optionLabel} needs a name.`);
      }
      const parsed = parseOptionalNumber(option.priceAdjustment, `${optionLabel} price adjustment`);
      if (!parsed.ok) {
        errors.push(parsed.error);
        return;
      }
      if (optionName.length === 0) {
        return;
      }
      groupOptions.push(
        parsed.value === undefined
          ? { name: optionName }
          : { name: optionName, priceAdjustment: Math.round(parsed.value * 100) },
      );
    });

    if (name.length > 0 && groupOptions.length > 0) {
      options.push({ name, required: group.required, options: groupOptions });
    }
  });

  return { options, errors };
}

export function addCustomizationGroup(
  groups: readonly CustomizationGroupDraft[],
): CustomizationGroupDraft[] {
  return [...groups, emptyCustomizationGroup()];
}

export function removeCustomizationGroup(
  groups: readonly CustomizationGroupDraft[],
  index: number,
): CustomizationGroupDraft[] {
  return groups.filter((_, position) => position !== index);
}

export function updateCustomizationGroup(
  groups: readonly CustomizationGroupDraft[],
  index: number,
  patch: Partial<CustomizationGroupDraft>,
): CustomizationGroupDraft[] {
  return groups.map((group, position) =>
    position === index ? { ...group, ...patch, options: patch.options ?? group.options } : group,
  );
}

export function addCustomizationOption(
  groups: readonly CustomizationGroupDraft[],
  groupIndex: number,
): CustomizationGroupDraft[] {
  return groups.map((group, position) =>
    position === groupIndex ? { ...group, options: [...group.options, emptyOption()] } : group,
  );
}

export function removeCustomizationOption(
  groups: readonly CustomizationGroupDraft[],
  groupIndex: number,
  optionIndex: number,
): CustomizationGroupDraft[] {
  return groups.map((group, position) =>
    position === groupIndex
      ? {
          ...group,
          options: group.options.filter((_, optionPosition) => optionPosition !== optionIndex),
        }
      : group,
  );
}

export function updateCustomizationOption(
  groups: readonly CustomizationGroupDraft[],
  groupIndex: number,
  optionIndex: number,
  patch: Partial<OptionDraft>,
): CustomizationGroupDraft[] {
  return groups.map((group, position) =>
    position === groupIndex
      ? {
          ...group,
          options: group.options.map((option, optionPosition) =>
            optionPosition === optionIndex ? { ...option, ...patch } : option,
          ),
        }
      : group,
  );
}

export function emptyItemDraft(): ItemDraft {
  return {
    name: '',
    description: '',
    price: '',
    isAvailable: true,
    imageStorageId: null,
    imageUrl: null,
    imageName: null,
    nutrition: nutritionDraftFrom(undefined),
    customizationOptions: [],
  };
}

export function itemDraftFrom(item: MenuItem): ItemDraft {
  return {
    name: item.name,
    description: item.description ?? '',
    price: item.price === undefined ? '' : String(item.price / 100),
    isAvailable: item.isAvailable,
    imageStorageId: item.imageStorageId ?? null,
    imageUrl: item.imageUrl,
    imageName: null,
    nutrition: nutritionDraftFrom(item.nutrition),
    customizationOptions: customizationDraftFrom(item.customizationOptions),
  };
}

/** Validates a create draft and returns the `createItem` fields. */
export function buildNewItem(draft: ItemDraft): BuildResult<NewItemFields> {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (name.length === 0) {
    errors.push('Item name is required.');
  }

  const price = parseOptionalNumber(draft.price, 'Price');
  if (!price.ok) {
    errors.push(price.error);
  }

  const nutrition = nutritionFromDraft(draft.nutrition);
  errors.push(...nutrition.errors);

  const customization = customizationFromDraft(draft.customizationOptions);
  errors.push(...customization.errors);

  if (errors.length > 0) {
    return { value: null, errors };
  }

  const value: NewItemFields = {
    name,
    customizationOptions: customization.options,
    isAvailable: draft.isAvailable,
  };
  const description = draft.description.trim();
  if (description.length > 0) {
    value.description = description;
  }
  if (price.ok && price.value !== undefined) {
    value.price = Math.round(price.value * 100);
  }
  if (draft.imageStorageId !== null) {
    value.imageStorageId = draft.imageStorageId;
  }
  if (hasNutrition(nutrition.nutrition)) {
    value.nutrition = nutrition.nutrition;
  }

  return { value, errors };
}

/**
 * Validates an edit draft and returns the `updateItem` patch. Omitted keys keep
 * their stored value; `imageStorageId: null` is an explicit clear.
 *
 * The shipped `updateItem` validator cannot express "remove the price" (an
 * omitted price means unchanged, and `null` is not accepted), so clearing a
 * price on an existing item is rejected inline instead of silently doing
 * nothing. Creating an item without a price remains supported.
 */
export function buildItemPatch(draft: ItemDraft, item: MenuItem): BuildResult<ItemPatch> {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (name.length === 0) {
    errors.push('Item name is required.');
  }

  const price = parseOptionalNumber(draft.price, 'Price');
  if (!price.ok) {
    errors.push(price.error);
  } else if (price.value === undefined && item.price !== undefined) {
    errors.push("This item already has a price. Clearing a price isn't supported yet — enter a number.");
  }

  const nutrition = nutritionFromDraft(draft.nutrition);
  errors.push(...nutrition.errors);

  const customization = customizationFromDraft(draft.customizationOptions);
  errors.push(...customization.errors);

  if (errors.length > 0) {
    return { value: null, errors };
  }

  const value: ItemPatch = {
    name,
    description: draft.description.trim(),
    isAvailable: draft.isAvailable,
    customizationOptions: customization.options,
    nutrition: nutrition.nutrition,
  };
  if (price.ok && price.value !== undefined) {
    value.price = Math.round(price.value * 100);
  }
  const savedImageId = item.imageStorageId ?? null;
  if (draft.imageStorageId !== savedImageId) {
    value.imageStorageId = draft.imageStorageId;
  }

  return { value, errors };
}

/** Items arrive in global `ordering`; grouping keeps that order inside a group. */
export function groupItemsByGroup(
  items: readonly MenuItem[],
): Map<Id<'menuGroups'>, MenuItem[]> {
  const grouped = new Map<Id<'menuGroups'>, MenuItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.groupId);
    if (existing === undefined) {
      grouped.set(item.groupId, [item]);
    } else {
      existing.push(item);
    }
  }
  return grouped;
}
