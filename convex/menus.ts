import { ConvexError, v } from 'convex/values';
import type { Infer } from 'convex/values';

import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireBusinessOwner, requireBusinessOwnerUser } from './authz';
import { ownerSaveMode } from './businesses/ownerSavePolicy';
import {
  deleteStorageFileQuietly,
  isUploadOwnedBy,
  resolveStorageUrls,
} from './businesses/photoStorage';
import { buildSupplyAuditLog } from './supplyAudit';

// B8 (issue #8) restaurant menu CRUD for `menuGroups` + `menuItems`.
//
// Menus are listing CONTENT, not identity: writes go live immediately for an
// approved listing and never enter the listing state machine (SPEC §5; plan §3
// "Live menu edits"). There is no `saveDraft` equivalent and no re-review.
//
// The guard still consults `ownerSaveMode` so menus are read-only exactly while
// the owner editor is read-only (pendingReview / suspended / rejected), instead
// of inventing a second status policy.
//
// Every read is bounded (`.take`), images are reused from B7 (`storageUploads`
// ownership, never another tenant's file), and ordering is the persisted
// `byBusinessIdOrdering` key.
// Docs: https://docs.convex.dev/database/mutations · https://docs.convex.dev/database/reading-data

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_GROUPS = 50;
const MAX_ITEMS = 200;

const nutritionValidator = v.object({
  calories: v.optional(v.number()),
  proteinGrams: v.optional(v.number()),
  carbohydrateGrams: v.optional(v.number()),
  fatGrams: v.optional(v.number()),
});

const customizationGroupValidator = v.object({
  name: v.string(),
  required: v.boolean(),
  options: v.array(
    v.object({
      name: v.string(),
      priceAdjustment: v.optional(v.number()),
    })
  ),
});

const customizationOptionsValidator = v.array(customizationGroupValidator);

const directionValidator = v.union(v.literal('up'), v.literal('down'));

const updateItemPatchValidator = v.object({
  name: v.optional(v.string()),
  description: v.optional(v.string()),
  price: v.optional(v.number()),
  isAvailable: v.optional(v.boolean()),
  ordering: v.optional(v.number()),
  customizationOptions: v.optional(customizationOptionsValidator),
  nutrition: v.optional(nutritionValidator),
  imageStorageId: v.optional(v.union(v.id('_storage'), v.null())),
});

type Nutrition = Infer<typeof nutritionValidator>;
type CustomizationOptions = Infer<typeof customizationOptionsValidator>;
type UpdateItemPatch = Infer<typeof updateItemPatchValidator>;
type MenuGroup = Doc<'menuGroups'>;
type MenuItem = Doc<'menuItems'>;
type Direction = 'up' | 'down';

/**
 * Read-only statuses mirror `ownerSaveMode(...) === 'reject'`
 * (pendingReview / suspended / rejected), i.e. the same statuses the owner
 * editor renders read-only. Draft, changesRequested, and approved are writable.
 */
function assertMenuWritable(business: Doc<'businesses'>): void {
  if (ownerSaveMode(business.status) === 'reject') {
    throw new ConvexError(`Menus are read-only while the listing is "${business.status}".`);
  }
}

function validatedName(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ConvexError(`${label} is required`);
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new ConvexError(`${label} must be ${MAX_NAME_LENGTH} characters or fewer`);
  }
  return trimmed;
}

/** Trims; a blank description collapses to `undefined` so the field is absent. */
function validatedDescription(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new ConvexError(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`);
  }
  return trimmed;
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ConvexError(`${label} must be a non-negative number`);
  }
}

function validatedNutrition(nutrition: Nutrition): Nutrition {
  const result: Nutrition = {};
  if (nutrition.calories !== undefined) {
    assertNonNegative(nutrition.calories, 'Calories');
    result.calories = nutrition.calories;
  }
  if (nutrition.proteinGrams !== undefined) {
    assertNonNegative(nutrition.proteinGrams, 'Protein');
    result.proteinGrams = nutrition.proteinGrams;
  }
  if (nutrition.carbohydrateGrams !== undefined) {
    assertNonNegative(nutrition.carbohydrateGrams, 'Carbohydrates');
    result.carbohydrateGrams = nutrition.carbohydrateGrams;
  }
  if (nutrition.fatGrams !== undefined) {
    assertNonNegative(nutrition.fatGrams, 'Fat');
    result.fatGrams = nutrition.fatGrams;
  }
  return result;
}

function validatedGroupOptions(group: CustomizationOptions[number]) {
  if (group.options.length === 0) {
    throw new ConvexError(`Customization group "${group.name}" needs at least one option`);
  }
  return group.options.map((option) => {
    const name = validatedName(option.name, 'Option name');
    if (option.priceAdjustment === undefined) {
      return { name };
    }
    // v1 deliberately rejects negative adjustments (a discount) so the
    // customizer total can never go below the item price. Revisit with the
    // pricing ticket if discounts are wanted.
    assertNonNegative(option.priceAdjustment, 'Price adjustment');
    return { name, priceAdjustment: option.priceAdjustment };
  });
}

function validatedCustomizationOptions(
  groups: CustomizationOptions
): CustomizationOptions {
  return groups.map((group) => ({
    name: validatedName(group.name, 'Customization group name'),
    required: group.required,
    options: validatedGroupOptions(group),
  }));
}

function nextOrdering(rows: readonly { ordering: number }[]): number {
  let max = -1;
  for (const row of rows) {
    if (row.ordering > max) {
      max = row.ordering;
    }
  }
  return max + 1;
}

/** The row to swap with, or `null` at either end (move is a no-op there). */
function adjacentRow<T extends { ordering: number }>(
  rows: readonly T[],
  index: number,
  direction: Direction
): { current: T; neighbor: T } | null {
  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= rows.length) {
    return null;
  }
  return { current: rows[index], neighbor: rows[neighborIndex] };
}

async function readGroups(
  ctx: QueryCtx | MutationCtx,
  businessId: Id<'businesses'>
): Promise<MenuGroup[]> {
  return await ctx.db
    .query('menuGroups')
    .withIndex('byBusinessIdOrdering', (q) => q.eq('businessId', businessId))
    .take(MAX_GROUPS);
}

async function readItems(
  ctx: QueryCtx | MutationCtx,
  businessId: Id<'businesses'>
): Promise<MenuItem[]> {
  return await ctx.db
    .query('menuItems')
    .withIndex('byBusinessIdOrdering', (q) => q.eq('businessId', businessId))
    .take(MAX_ITEMS);
}

async function menuForBusiness(ctx: QueryCtx, businessId: Id<'businesses'>) {
  const [groups, items] = await Promise.all([
    readGroups(ctx, businessId),
    readItems(ctx, businessId),
  ]);

  const storageIds = [
    ...new Set(
      items.flatMap((item) =>
        item.imageStorageId === undefined ? [] : [item.imageStorageId]
      )
    ),
  ];
  const imageUrls = await resolveStorageUrls(ctx, storageIds);

  return {
    groups,
    items: items.map((item) => ({
      ...item,
      imageUrl:
        item.imageStorageId === undefined ? null : imageUrls[item.imageStorageId] ?? null,
    })),
  };
}

async function groupInBusiness(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  groupId: Id<'menuGroups'>
): Promise<MenuGroup> {
  const group = await ctx.db.get(groupId);
  if (group === null || group.businessId !== businessId) {
    throw new ConvexError('Menu group not found');
  }
  return group;
}

async function itemInBusiness(
  ctx: MutationCtx,
  businessId: Id<'businesses'>,
  itemId: Id<'menuItems'>
): Promise<MenuItem> {
  const item = await ctx.db.get(itemId);
  if (item === null || item.businessId !== businessId) {
    throw new ConvexError('Menu item not found');
  }
  return item;
}

/**
 * Validates the non-image half of an `updateItem` patch. Only supplied keys are
 * returned, so omitted fields keep their persisted value.
 */
function validatedItemFields(patch: UpdateItemPatch): Partial<MenuItem> {
  const result: Partial<MenuItem> = {};
  if (patch.name !== undefined) {
    result.name = validatedName(patch.name, 'Item name');
  }
  if (patch.description !== undefined) {
    result.description = validatedDescription(patch.description);
  }
  if (patch.price !== undefined) {
    assertNonNegative(patch.price, 'Price');
    result.price = patch.price;
  }
  if (patch.isAvailable !== undefined) {
    result.isAvailable = patch.isAvailable;
  }
  if (patch.ordering !== undefined) {
    assertNonNegative(patch.ordering, 'Ordering');
    result.ordering = patch.ordering;
  }
  if (patch.customizationOptions !== undefined) {
    result.customizationOptions = validatedCustomizationOptions(
      patch.customizationOptions
    );
  }
  if (patch.nutrition !== undefined) {
    result.nutrition = validatedNutrition(patch.nutrition);
  }
  return result;
}

/**
 * Validates the optional `createItem` fields and returns only the keys the
 * caller supplied, so omitted fields stay absent from the inserted document.
 */
function optionalItemFields(args: {
  description?: string;
  price?: number;
  imageStorageId?: Id<'_storage'>;
  nutrition?: Nutrition;
}): Partial<MenuItem> {
  const fields: Partial<MenuItem> = {};
  if (args.description !== undefined) {
    const description = validatedDescription(args.description);
    if (description !== undefined) {
      fields.description = description;
    }
  }
  if (args.price !== undefined) {
    fields.price = args.price;
  }
  if (args.imageStorageId !== undefined) {
    fields.imageStorageId = args.imageStorageId;
  }
  if (args.nutrition !== undefined) {
    fields.nutrition = validatedNutrition(args.nutrition);
  }
  return fields;
}

/**
 * Resolves an explicit image change (id = attach, `null` = clear) and returns
 * the patch plus any owned file to delete AFTER the database write. The
 * ownership check is shared with B7: an id uploaded for another listing is
 * never attachable and never deletable from here.
 */
async function applyImageChange(
  ctx: MutationCtx,
  business: Doc<'businesses'>,
  item: MenuItem,
  imageStorageId: Id<'_storage'> | null
): Promise<{ patch: Partial<MenuItem>; deleteAfter: Id<'_storage'> | null }> {
  if (imageStorageId === null) {
    const deleteAfter =
      item.imageStorageId !== undefined &&
      (await isUploadOwnedBy(ctx, item.imageStorageId, business))
        ? item.imageStorageId
        : null;
    // `undefined` removes the optional field; it is never stored as a value.
    return { patch: { imageStorageId: undefined }, deleteAfter };
  }

  if (!(await isUploadOwnedBy(ctx, imageStorageId, business))) {
    throw new ConvexError('Image not uploaded for this business');
  }
  return { patch: { imageStorageId }, deleteAfter: null };
}

/**
 * Explicit public projection: only what `menu-tabs` and the ordering panel
 * render — no `businessId`, `imageStorageId`, or `ordering`. `groupId` is
 * kept: `menu-tabs.tsx` buckets items by it to pair with groups.
 * `isAvailable` is the §6.2.2 group switch the basket panel renders as
 * "This section is unavailable right now." (absent = available).
 */
function publicGroup(group: MenuGroup) {
  return {
    _id: group._id,
    name: group.name,
    description: group.description,
    isAvailable: group.isAvailable ?? true,
  };
}

function publicItem(item: MenuItem & { imageUrl: string | null }) {
  return {
    _id: item._id,
    groupId: item.groupId,
    name: item.name,
    description: item.description,
    price: item.price,
    nutrition: item.nutrition,
    customizationOptions: item.customizationOptions,
    isAvailable: item.isAvailable,
    imageUrl: item.imageUrl,
  };
}

/** Public menu for an approved listing, else `null`. Mirrors `getPublic`. */
export const listForBusiness = query({
  args: { businessId: v.id('businesses') },
  handler: async (ctx, { businessId }) => {
    const business = await ctx.db.get(businessId);
    if (business === null || business.status !== 'approved') {
      return null;
    }
    const menu = await menuForBusiness(ctx, businessId);
    return {
      groups: menu.groups.map(publicGroup),
      items: menu.items.map(publicItem),
    };
  },
});

/** Owner view of the full owner shape (editor fields included), every status. */
export const listMine = query({
  args: { businessId: v.id('businesses') },
  handler: async (ctx, { businessId }) => {
    await requireBusinessOwner(ctx, businessId);
    return await menuForBusiness(ctx, businessId);
  },
});

export const createGroup = mutation({
  args: {
    businessId: v.id('businesses'),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const business = await requireBusinessOwner(ctx, args.businessId);
    assertMenuWritable(business);

    const description =
      args.description === undefined ? undefined : validatedDescription(args.description);

    return await ctx.db.insert('menuGroups', {
      businessId: args.businessId,
      name: validatedName(args.name, 'Menu group name'),
      ...(description === undefined ? {} : { description }),
      ordering: nextOrdering(await readGroups(ctx, args.businessId)),
    });
  },
});

export const updateGroup = mutation({
  args: {
    businessId: v.id('businesses'),
    groupId: v.id('menuGroups'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const business = await requireBusinessOwner(ctx, args.businessId);
    assertMenuWritable(business);
    const group = await groupInBusiness(ctx, args.businessId, args.groupId);

    const patch: Partial<MenuGroup> = {};
    if (args.name !== undefined) {
      patch.name = validatedName(args.name, 'Menu group name');
    }
    if (args.description !== undefined) {
      // An empty supplied description clears the optional field: patch with
      // `undefined` removes it (never stored as a value).
      const description = validatedDescription(args.description);
      patch.description = description;
    }

    await ctx.db.patch(group._id, patch);
  },
});

export const deleteGroup = mutation({
  args: {
    businessId: v.id('businesses'),
    groupId: v.id('menuGroups'),
  },
  handler: async (ctx, args) => {
    const business = await requireBusinessOwner(ctx, args.businessId);
    assertMenuWritable(business);
    const group = await groupInBusiness(ctx, args.businessId, args.groupId);

    // No FK enforcement in Convex; block the delete while any item still
    // references the group (the same reassign-first rule admin categories use).
    const referencingItem = await ctx.db
      .query('menuItems')
      .withIndex('byGroupId', (q) => q.eq('groupId', group._id))
      .take(1);
    if (referencingItem.length > 0) {
      throw new ConvexError(
        'This menu group still has items. Move or delete them before deleting the group.'
      );
    }

    await ctx.db.delete(group._id);
  },
});

export const moveGroup = mutation({
  args: {
    businessId: v.id('businesses'),
    groupId: v.id('menuGroups'),
    direction: directionValidator,
  },
  handler: async (ctx, args) => {
    const business = await requireBusinessOwner(ctx, args.businessId);
    assertMenuWritable(business);

    // One bounded read of the ordered list; at most two patches below.
    const groups = await readGroups(ctx, args.businessId);
    const index = groups.findIndex((group) => group._id === args.groupId);
    if (index < 0) {
      throw new ConvexError('Menu group not found');
    }

    const step = adjacentRow(groups, index, args.direction);
    if (step === null) {
      return;
    }
    await ctx.db.patch(step.current._id, { ordering: step.neighbor.ordering });
    await ctx.db.patch(step.neighbor._id, { ordering: step.current.ordering });
  },
});

/**
 * Order-commitment protocol T6 (issue #77): the owner's menu-section supply
 * switch (§6.2.8, §6.5 group matrix). Hiding a group makes `placeOrder` reject
 * any basket that selected one of its items with `GROUP_UNAVAILABLE`; the group
 * stays visible to customers as "Currently unavailable".
 *
 * `assertMenuWritable` applies exactly as it does to every other menu mutation:
 * a group is listing content, read-only while the listing is pendingReview /
 * suspended / rejected. The patch and its single `auditLogs` row commit in one
 * transaction (INV-22). An identical value — compared against the normalized
 * `isAvailable ?? true`, since absent means available (§6.2.2) — is a no-op and
 * writes no row, mirroring `setFeatured`.
 */
export const setGroupAvailability = mutation({
  args: {
    businessId: v.id('businesses'),
    groupId: v.id('menuGroups'),
    isAvailable: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { business, user } = await requireBusinessOwnerUser(ctx, args.businessId);
    assertMenuWritable(business);
    const group = await groupInBusiness(ctx, args.businessId, args.groupId);

    const current = group.isAvailable ?? true;
    if (current === args.isAvailable) {
      return;
    }

    const now = Date.now();

    await ctx.db.patch(group._id, { isAvailable: args.isAvailable });

    // The name snapshot comes from the doc the guards already loaded (Q7): a
    // menu target has no read-side name fallback once the cascade deletes it.
    await ctx.db.insert(
      'auditLogs',
      buildSupplyAuditLog({
        actorUserId: user._id,
        action: 'orders.groupAvailability.toggled',
        targetType: 'menuGroup',
        targetId: group._id,
        targetName: group.name,
        createdAt: now,
      })
    );
  },
});

export const createItem = mutation({
  args: {
    businessId: v.id('businesses'),
    groupId: v.id('menuGroups'),
    name: v.string(),
    description: v.optional(v.string()),
    price: v.optional(v.number()),
    imageStorageId: v.optional(v.id('_storage')),
    customizationOptions: v.optional(customizationOptionsValidator),
    isAvailable: v.optional(v.boolean()),
    nutrition: v.optional(nutritionValidator),
  },
  handler: async (ctx, args) => {
    const business = await requireBusinessOwner(ctx, args.businessId);
    assertMenuWritable(business);
    const group = await groupInBusiness(ctx, args.businessId, args.groupId);

    if (args.price !== undefined) {
      assertNonNegative(args.price, 'Price');
    }
    if (
      args.imageStorageId !== undefined &&
      !(await isUploadOwnedBy(ctx, args.imageStorageId, business))
    ) {
      throw new ConvexError('Image not uploaded for this business');
    }

    const item: Omit<Doc<'menuItems'>, '_id' | '_creationTime'> = {
      businessId: args.businessId,
      groupId: group._id,
      name: validatedName(args.name, 'Item name'),
      customizationOptions:
        args.customizationOptions === undefined
          ? []
          : validatedCustomizationOptions(args.customizationOptions),
      ordering: nextOrdering(await readItems(ctx, args.businessId)),
      // §6.2.8 (issue #77): creation sets initial state, not a toggle, so it
      // writes no audit row; only a real availability change does (updateItem).
      isAvailable: args.isAvailable ?? true,
    };
    Object.assign(item, optionalItemFields(args));

    return await ctx.db.insert('menuItems', item);
  },
});

export const updateItem = mutation({
  args: {
    businessId: v.id('businesses'),
    itemId: v.id('menuItems'),
    patch: updateItemPatchValidator,
  },
  handler: async (ctx, args) => {
    const { business, user } = await requireBusinessOwnerUser(ctx, args.businessId);
    assertMenuWritable(business);
    const item = await itemInBusiness(ctx, args.businessId, args.itemId);

    // §6.2.8 (issue #77): the existing item availability mutation audits a real
    // toggle. Comparing against the persisted value is mandatory, not
    // defensive: the owner editor's `buildItemPatch` sends `isAvailable` on
    // EVERY save, so without it every name/price edit would manufacture a
    // spurious `orders.itemAvailability.toggled` row.
    const availabilityChanged =
      args.patch.isAvailable !== undefined && args.patch.isAvailable !== item.isAvailable;

    const patch = validatedItemFields(args.patch);
    let deleteAfter: Id<'_storage'> | null = null;
    if (args.patch.imageStorageId !== undefined) {
      const imageChange = await applyImageChange(
        ctx,
        business,
        item,
        args.patch.imageStorageId
      );
      Object.assign(patch, imageChange.patch);
      deleteAfter = imageChange.deleteAfter;
    }

    const now = Date.now();
    await ctx.db.patch(item._id, patch);

    if (availabilityChanged) {
      await ctx.db.insert(
        'auditLogs',
        buildSupplyAuditLog({
          actorUserId: user._id,
          action: 'orders.itemAvailability.toggled',
          targetType: 'menuItem',
          targetId: item._id,
          targetName: item.name,
          createdAt: now,
        })
      );
    }

    // Runs after the write: `ctx.storage.delete` is not transactional, so a
    // rolled-back save must never leave a dangling image reference.
    if (deleteAfter !== null) {
      await deleteStorageFileQuietly(ctx, deleteAfter);
    }
  },
});

export const moveItem = mutation({
  args: {
    businessId: v.id('businesses'),
    itemId: v.id('menuItems'),
    direction: directionValidator,
  },
  handler: async (ctx, args) => {
    const business = await requireBusinessOwner(ctx, args.businessId);
    assertMenuWritable(business);

    const items = await readItems(ctx, args.businessId);
    const index = items.findIndex((item) => item._id === args.itemId);
    if (index < 0) {
      throw new ConvexError('Menu item not found');
    }

    const step = adjacentRow(items, index, args.direction);
    if (step === null) {
      return;
    }
    await ctx.db.patch(step.current._id, { ordering: step.neighbor.ordering });
    await ctx.db.patch(step.neighbor._id, { ordering: step.current.ordering });
  },
});

export const deleteItem = mutation({
  args: {
    businessId: v.id('businesses'),
    itemId: v.id('menuItems'),
  },
  handler: async (ctx, args) => {
    const business = await requireBusinessOwner(ctx, args.businessId);
    assertMenuWritable(business);
    const item = await itemInBusiness(ctx, args.businessId, args.itemId);

    const imageStorageId = item.imageStorageId;
    const ownedImage =
      imageStorageId !== undefined &&
      (await isUploadOwnedBy(ctx, imageStorageId, business))
        ? imageStorageId
        : null;

    await ctx.db.delete(item._id);
    if (ownedImage !== null) {
      await deleteStorageFileQuietly(ctx, ownedImage);
    }
  },
});
