'use client';

import { createElement, type ComponentType } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { EditorFormSectionId } from './editor-sections';
import { Field, FieldClassTag, StringListEditor } from './field-controls';
import { HoursSection } from './hours-section';
import { SectionCard, type SectionEditorProps } from './section-card';

const STUB_NOTE_CLASS =
  'bg-muted text-muted-foreground rounded-control border border-border p-4 text-sm';

const DESCRIPTION_CLASS =
  'border-input text-card-foreground dark:bg-input/30 placeholder:text-card-muted focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-2 md:text-sm';

function BasicInfoSection({
  section,
  form,
  onChange,
  readOnly,
  categories,
  tool,
}: SectionEditorProps) {
  const categoryName = categories.find((category) => category._id === form.categoryId)?.name ?? '';

  return (
    <SectionCard section={section} tool={tool}>
      <Field
        id="editor-name"
        label="Business name"
        fieldClass="core"
        readOnly={readOnly}
        displayValue={form.name}
      >
        <Input
          id="editor-name"
          value={form.name}
          onChange={(event) => onChange('name', event.target.value)}
          autoComplete="organization"
          className="text-card-foreground"
        />
      </Field>

      <Field
        id="editor-category"
        label="Category"
        fieldClass="core"
        readOnly={readOnly}
        displayValue={categoryName}
      >
        <Select
          value={form.categoryId}
          onValueChange={(value) => onChange('categoryId', value)}
          disabled={categories.length === 0}
        >
          <SelectTrigger id="editor-category" className="w-full text-card-foreground data-[placeholder]:text-card-muted!">
            <SelectValue placeholder={categories.length === 0 ? 'Loading categories…' : 'Choose a category'} />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItem key={category._id} value={category._id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        id="editor-description"
        label="Description"
        fieldClass="core"
        readOnly={readOnly}
        displayValue={form.description}
      >
        <textarea
          id="editor-description"
          value={form.description}
          onChange={(event) => onChange('description', event.target.value)}
          className={DESCRIPTION_CLASS}
        />
      </Field>

      <Field
        id="editor-keywords"
        label="Keywords (searchable)"
        fieldClass="content"
        readOnly={readOnly}
        displayValue={form.keywords}
        hint="Content field — for an approved listing these go live immediately, no re-review."
      >
        <Input
          id="editor-keywords"
          value={form.keywords}
          onChange={(event) => onChange('keywords', event.target.value)}
          placeholder="coffee, pastries, breakfast"
          className="text-card-foreground placeholder:text-card-muted!"
        />
      </Field>
    </SectionCard>
  );
}

function ContactSection({ section, form, onChange, readOnly, tool }: SectionEditorProps) {
  return (
    <SectionCard section={section} tool={tool}>
      <Field id="editor-phone" label="Phone" fieldClass="content" readOnly={readOnly} displayValue={form.phone}>
        <Input
          id="editor-phone"
          type="tel"
          value={form.phone}
          onChange={(event) => onChange('phone', event.target.value)}
          autoComplete="tel"
          className="text-card-foreground"
        />
      </Field>
      <Field id="editor-email" label="Email" fieldClass="content" readOnly={readOnly} displayValue={form.email}>
        <Input
          id="editor-email"
          type="email"
          value={form.email}
          onChange={(event) => onChange('email', event.target.value)}
          autoComplete="email"
          className="text-card-foreground"
        />
      </Field>
      <Field id="editor-website" label="Website" fieldClass="content" readOnly={readOnly} displayValue={form.website}>
        <Input
          id="editor-website"
          type="url"
          value={form.website}
          onChange={(event) => onChange('website', event.target.value)}
          autoComplete="url"
          placeholder="https://"
          className="text-card-foreground placeholder:text-card-muted!"
        />
      </Field>
    </SectionCard>
  );
}

function LocationSection({ section, form, onChange, readOnly, tool }: SectionEditorProps) {
  const streetValue = [form.address.addressLine1, form.address.addressLine2]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(', ');
  const cityStateValue = [
    form.address.city,
    form.address.state,
    form.address.postalCode,
    form.address.country,
  ]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(', ');

  function updateAddress(patch: Partial<typeof form.address>) {
    onChange('address', { ...form.address, ...patch });
  }

  return (
    <SectionCard section={section} tool={tool}>
      <Field
        id="editor-address-line1"
        label="Street Address"
        fieldClass="core"
        readOnly={readOnly}
        displayValue={streetValue}
      >
        <Input
          id="editor-address-line1"
          value={form.address.addressLine1}
          onChange={(event) => updateAddress({ addressLine1: event.target.value })}
          placeholder="123 Main St"
          autoComplete="address-line1"
          className="text-card-foreground placeholder:text-card-muted!"
        />
        <Input
          aria-label="Address line 2 (optional)"
          value={form.address.addressLine2}
          onChange={(event) => updateAddress({ addressLine2: event.target.value })}
          placeholder="Suite, unit (optional)"
          autoComplete="address-line2"
          className="text-card-foreground placeholder:text-card-muted!"
        />
      </Field>

      <Field
        id="editor-address-city"
        label="City / State"
        fieldClass="core"
        readOnly={readOnly}
        displayValue={cityStateValue}
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            aria-label="City"
            value={form.address.city}
            onChange={(event) => updateAddress({ city: event.target.value })}
            placeholder="City"
            autoComplete="address-level2"
            className="text-card-foreground placeholder:text-card-muted!"
          />
          <Input
            aria-label="State / region"
            value={form.address.state}
            onChange={(event) => updateAddress({ state: event.target.value })}
            placeholder="State / region"
            autoComplete="address-level1"
            className="text-card-foreground placeholder:text-card-muted!"
          />
          <Input
            aria-label="Postal code (optional)"
            value={form.address.postalCode}
            onChange={(event) => updateAddress({ postalCode: event.target.value })}
            placeholder="Postal code (optional)"
            autoComplete="postal-code"
            className="text-card-foreground placeholder:text-card-muted!"
          />
          <Input
            aria-label="Country"
            value={form.address.country}
            onChange={(event) => updateAddress({ country: event.target.value })}
            placeholder="Country"
            autoComplete="country"
            className="text-card-foreground placeholder:text-card-muted!"
          />
        </div>
      </Field>

      <p className={STUB_NOTE_CLASS}>
        Simplified in v1: address fields only, lat/lng stored. No map embed — geolocation is out of
        scope.
      </p>
    </SectionCard>
  );
}

function ListField({
  id,
  label,
  values,
  onChange,
  readOnly,
  placeholder,
  itemNoun,
  hint,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  readOnly: boolean;
  placeholder: string;
  itemNoun: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        <FieldClassTag fieldClass="content" />
      </div>
      <StringListEditor
        id={id}
        values={values}
        onChange={onChange}
        readOnly={readOnly}
        placeholder={placeholder}
        itemNoun={itemNoun}
      />
      {hint === undefined ? null : <p className="text-card-muted text-xs">{hint}</p>}
    </div>
  );
}

function TagsSection({ section, form, onChange, readOnly, categories, tool }: SectionEditorProps) {
  const categoryName = categories.find((category) => category._id === form.categoryId)?.name ?? '—';

  return (
    <SectionCard section={section} tool={tool}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label>Primary Category</Label>
          <FieldClassTag fieldClass="core" />
        </div>
        <p className="text-card-muted text-sm">
          Set in Basic Information:{' '}
          <strong className="text-foreground">{categoryName}</strong>
        </p>
      </div>

      <ListField
        id="editor-tags"
        label="Additional Tags"
        values={form.tags}
        onChange={(values) => onChange('tags', values)}
        readOnly={readOnly}
        placeholder="Add a tag and press Enter"
        itemNoun="tag"
        hint="Tags are content — safe to change on an approved listing."
      />
    </SectionCard>
  );
}

function AmenitiesSection({ section, form, onChange, readOnly, tool }: SectionEditorProps) {
  return (
    <SectionCard section={section} tool={tool}>
      <ListField
        id="editor-amenities"
        label="Services & Amenities"
        values={form.amenities}
        onChange={(values) => onChange('amenities', values)}
        readOnly={readOnly}
        placeholder="Add a service or amenity and press Enter"
        itemNoun="amenity"
        hint="Content field — goes live immediately on an approved listing."
      />
    </SectionCard>
  );
}

// Hyphenated section ids require computed keys (eslint naming-convention).
const SECTION_EDITORS: Record<EditorFormSectionId, ComponentType<SectionEditorProps>> = {
  ['basic-info']: BasicInfoSection,
  hours: HoursSection,
  contact: ContactSection,
  location: LocationSection,
  ['categories-tags']: TagsSection,
  ['features-amenities']: AmenitiesSection,
};

/** Renders the active editor section from form state. */
export function EditorSectionView({
  sectionId,
  ...props
}: SectionEditorProps & { sectionId: EditorFormSectionId }) {
  return createElement(SECTION_EDITORS[sectionId], props);
}
