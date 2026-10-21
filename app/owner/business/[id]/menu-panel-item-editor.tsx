'use client';

import { useAuth } from '@clerk/nextjs';
import { useId, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Id } from '@/convex/_generated/dataModel';
import { PHOTO_LIMITS, invalidReasonForFile } from '@/convex/businesses/photoPolicy';

import {
  addCustomizationGroup,
  addCustomizationOption,
  removeCustomizationGroup,
  removeCustomizationOption,
  updateCustomizationGroup,
  updateCustomizationOption,
  uploadErrorMessage,
} from './menu-panel-helpers';
import type { CustomizationGroupDraft, ItemDraft } from './menu-panel-helpers';
import { messageForError, readStorageId } from './photos-panel-helpers';

// The inline item editor for the owner Menu panel: core fields, availability,
// image upload via the B7 endpoint, optional nutrition, and the nested
// customization-group editor. Shared form primitives are exported here for the
// sibling group components; the save/mutation wiring stays in `menu-panel.tsx`.

const ACCEPTED_IMAGE_TYPES = PHOTO_LIMITS.types.join(',');
const MAX_IMAGE_MB = PHOTO_LIMITS.maxBytes / (1024 * 1024);
const ERROR_CLASS = 'border-danger-border bg-danger-soft text-danger-strong rounded-control border p-3 text-sm';
const HELP_CLASS = 'text-card-muted text-xs';

/** Labelled text input shared by every field in the menu editor. */
export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  placeholder,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  placeholder?: string;
  inputMode?: 'decimal';
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className={HELP_CLASS}>
          {hint}
        </p>
      )}
    </div>
  );
}

async function uploadItemImage(
  businessId: Id<'businesses'>,
  file: File,
  token: string,
): Promise<Id<'_storage'>> {
  const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (siteUrl === undefined || siteUrl.length === 0) {
    throw new Error('Image uploads are not configured for this environment.');
  }
  const response = await fetch(`${siteUrl}/photos/upload?businessId=${businessId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type },
    body: file,
  });
  if (!response.ok) throw new Error(await uploadErrorMessage(response));
  const storageId = readStorageId(await response.json());
  if (storageId === null) throw new Error('The upload did not return an image id. Try again.');
  return storageId;
}

function NutritionFields({
  baseId,
  nutrition,
  onChange,
}: {
  baseId: string;
  nutrition: ItemDraft['nutrition'];
  onChange: (nutrition: ItemDraft['nutrition']) => void;
}) {
  const field = (suffix: string, label: string, key: keyof ItemDraft['nutrition']) => (
    <TextField
      id={`${baseId}-${suffix}`}
      label={label}
      inputMode="decimal"
      value={nutrition[key]}
      onChange={(value) => onChange({ ...nutrition, [key]: value })}
    />
  );

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Nutrition (optional)</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field('calories', 'Calories', 'calories')}
        {field('protein', 'Protein (g)', 'proteinGrams')}
        {field('carbs', 'Carbs (g)', 'carbohydrateGrams')}
        {field('fat', 'Fat (g)', 'fatGrams')}
      </div>
    </fieldset>
  );
}

function ItemImageField({
  baseId,
  draft,
  uploading,
  error,
  notice,
  onFile,
  onChange,
}: {
  baseId: string;
  draft: ItemDraft;
  uploading: boolean;
  error: string | null;
  notice: string;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onChange: (patch: Partial<ItemDraft>) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Item image</legend>
      {draft.imageStorageId === null ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-muted border-border size-16 shrink-0 overflow-hidden rounded-control border">
            {draft.imageUrl === null ? (
              <span className="text-card-muted flex size-full items-center justify-center text-micro">New</span>
            ) : (
              <img src={draft.imageUrl} alt="" className="size-full object-cover" />
            )}
          </div>
          <p className={HELP_CLASS}>
            {draft.imageName === null
              ? 'Saved image.'
              : `${draft.imageName} uploaded — save the item to attach it.`}
          </p>
          <Button type="button" variant="outline" size="sm"
            onClick={() => onChange({ imageStorageId: null, imageUrl: null, imageName: null })}>
            Remove image
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${baseId}-image`}>
          {draft.imageStorageId === null ? 'Upload image' : 'Replace image'}
        </Label>
        <Input id={`${baseId}-image`} type="file" accept={ACCEPTED_IMAGE_TYPES} onChange={onFile} />
        <p className={HELP_CLASS}>
          JPEG, PNG or WebP · up to {MAX_IMAGE_MB} MB. The image is attached when you save the item.
        </p>
      </div>
      {uploading ? <p role="status" className="text-card-muted text-sm">Uploading image…</p> : null}
      {notice.length === 0 ? null : (
        <p role="status" className="text-card-muted text-sm">{notice}</p>
      )}
      {error === null ? null : <p role="alert" className={ERROR_CLASS}>{error}</p>}
    </fieldset>
  );
}

function CustomizationEditor({
  groups,
  onChange,
  disabled,
}: {
  groups: CustomizationGroupDraft[];
  onChange: (groups: CustomizationGroupDraft[]) => void;
  disabled: boolean;
}) {
  const ids = useId();
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3">
      <legend className="text-sm font-medium">Customization groups</legend>
      <p className={HELP_CLASS}>
        Required groups render as a single-choice selector (pick exactly one). Optional groups render
        as checkboxes (pick any number).
      </p>
      {groups.length === 0 ? (
        <p className="text-card-muted text-sm">No customization options. Add a group to let customers choose.</p>
      ) : null}
      {groups.map((group, groupIndex) => {
        const groupId = `${ids}-group-${groupIndex}`;
        return (
          <fieldset key={groupId} className="border-border rounded-control flex flex-col gap-2 border p-3">
            <legend className="px-1 text-sm font-medium">Group {groupIndex + 1}</legend>
            <TextField id={`${groupId}-name`} label="Group name" value={group.name}
              onChange={(name) => onChange(updateCustomizationGroup(groups, groupIndex, { name }))} />
            <div className="flex items-center gap-2">
              <Checkbox id={`${groupId}-required`} checked={group.required}
                onCheckedChange={(checked) =>
                  onChange(updateCustomizationGroup(groups, groupIndex, { required: checked === true }))} />
              <Label htmlFor={`${groupId}-required`}>Required</Label>
            </div>
            <p className={HELP_CLASS}>
              {group.required ? 'Customers pick exactly one option.' : 'Customers can pick any number of options.'}
            </p>
            <p className="text-sm font-medium">Options</p>
            <ul role="list" className="flex flex-col gap-2">
              {group.options.map((option, optionIndex) => {
                const optionId = `${groupId}-option-${optionIndex}`;
                return (
                  <li key={optionId} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <TextField id={`${optionId}-name`} label="Option name" value={option.name}
                        onChange={(name) => onChange(updateCustomizationOption(groups, groupIndex, optionIndex, { name }))} />
                    </div>
                    <div className="flex w-full flex-col gap-1 sm:w-40">
                      <TextField id={`${optionId}-adjustment`} label="Price adjustment" placeholder="0.00"
                        inputMode="decimal" value={option.priceAdjustment}
                        onChange={(priceAdjustment) => onChange(updateCustomizationOption(groups, groupIndex, optionIndex, { priceAdjustment }))} />
                    </div>
                    <Button type="button" variant="outline" size="icon" className="text-destructive"
                      aria-label={`Remove option ${optionIndex + 1} from group ${groupIndex + 1}`}
                      onClick={() => onChange(removeCustomizationOption(groups, groupIndex, optionIndex))}>
                      <span aria-hidden="true">✕</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Add option to customization group ${groupIndex + 1}`}
                onClick={() => onChange(addCustomizationOption(groups, groupIndex))}
              >
                Add option
              </Button>
              <Button type="button" variant="outline" size="sm" className="text-destructive"
                aria-label={`Remove customization group ${groupIndex + 1}`}
                onClick={() => onChange(removeCustomizationGroup(groups, groupIndex))}>
                Remove group
              </Button>
            </div>
          </fieldset>
        );
      })}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(addCustomizationGroup(groups))}>
          Add customization group
        </Button>
      </div>
    </fieldset>
  );
}

/** Inline create/edit form for a menu item. Rendered inside its group card. */
export function ItemEditor({
  businessId,
  mode,
  draft,
  busy,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  businessId: Id<'businesses'>;
  mode: 'create' | 'edit';
  draft: ItemDraft;
  busy: boolean;
  saving: boolean;
  error: string | null;
  onChange: (patch: Partial<ItemDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { getToken } = useAuth();
  const ids = useId();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState('');

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined || uploading) return;

    const reason = invalidReasonForFile({ name: file.name, size: file.size, type: file.type });
    if (reason !== null) {
      setUploadError(reason);
      setUploadNotice('');
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadNotice('');
    try {
      const token = await getToken({ template: 'convex' });
      if (token === null) throw new Error('Your session expired. Reload the page and try again.');
      const storageId = await uploadItemImage(businessId, file, token);
      onChange({ imageStorageId: storageId, imageUrl: null, imageName: file.name });
      setUploadNotice('Image uploaded. Save the item to attach it.');
    } catch (uploadFailure) {
      setUploadError(messageForError(uploadFailure, 'The image upload failed. Try again.'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      className="border-border bg-muted/30 rounded-control flex flex-col gap-3 border p-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSave();
      }}
    >
      <p className="text-sm font-semibold">{mode === 'create' ? 'New item' : `Edit ${draft.name}`}</p>
      <fieldset disabled={busy || uploading} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField id={`${ids}-name`} label="Name" value={draft.name}
            onChange={(name) => onChange({ name })} />
          <TextField id={`${ids}-price`} label="Price" value={draft.price} inputMode="decimal"
            placeholder="12.50" hint="Leave blank for no price. Numbers only."
            onChange={(price) => onChange({ price })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-description`}>Description</Label>
          <Textarea id={`${ids}-description`} value={draft.description} rows={2}
            onChange={(event) => onChange({ description: event.target.value })} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id={`${ids}-available`} checked={draft.isAvailable}
            onCheckedChange={(checked) => onChange({ isAvailable: checked })} />
          <Label htmlFor={`${ids}-available`}>Available to order</Label>
        </div>

        <ItemImageField
          baseId={ids}
          draft={draft}
          uploading={uploading}
          error={uploadError}
          notice={uploadNotice}
          onFile={handleFile}
          onChange={onChange}
        />
        <NutritionFields
          baseId={ids}
          nutrition={draft.nutrition}
          onChange={(nutrition) => onChange({ nutrition })}
        />

        <CustomizationEditor groups={draft.customizationOptions}
          onChange={(customizationOptions) => onChange({ customizationOptions })} disabled={busy} />

        {error === null ? null : <p role="alert" className={ERROR_CLASS}>{error}</p>}
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Cancel item edit"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || uploading}>
          {saving ? 'Saving…' : mode === 'create' ? 'Add item' : 'Save item'}
        </Button>
      </div>
    </form>
  );
}
