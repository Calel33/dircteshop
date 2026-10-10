'use client';

import { createElement, useId, type ComponentType, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { EditorSection } from './editor-types';
import type { EditorFormSectionId } from './editor-sections';
import {
  WEEKDAY_LABELS,
  WEEKDAYS,
  type EditorFormState,
  type OpeningPeriodForm,
  type Weekday,
} from './editor-form';
import { applyHoursPreset, HOURS_PRESET_OPTIONS, type HoursPresetId } from './editor-hours-presets';
import { Field, FieldClassTag, StringListEditor } from './field-controls';

const DEFAULT_PERIOD: OpeningPeriodForm = { opensAt: '09:00', closesAt: '17:00' };

/** Minimal category option the editor needs for its Select and preview. */
export interface CategoryOption {
  _id: string;
  name: string;
}

/**
 * Props every section editor receives. `onChange` is field-scoped so each
 * section updates exactly the part of form state it owns.
 */
export interface SectionEditorProps {
  section: EditorSection;
  form: EditorFormState;
  onChange: <K extends keyof EditorFormState>(field: K, value: EditorFormState[K]) => void;
  readOnly: boolean;
  categories: CategoryOption[];
}

function SectionCard({ section, children }: { section: EditorSection; children: ReactNode }) {
  return (
    <Card className="rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-lg">{section.label}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

const DESCRIPTION_CLASS =
  'border-input dark:bg-input/30 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-2 md:text-sm';

function BasicInfoSection({ section, form, onChange, readOnly, categories }: SectionEditorProps) {
  const categoryName = categories.find((category) => category._id === form.categoryId)?.name ?? '';

  return (
    <SectionCard section={section}>
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
          <SelectTrigger id="editor-category" className="w-full">
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
    </SectionCard>
  );
}

function ContactSection({ section, form, onChange, readOnly }: SectionEditorProps) {
  return (
    <SectionCard section={section}>
      <Field id="editor-phone" label="Phone" fieldClass="content" readOnly={readOnly} displayValue={form.phone}>
        <Input
          id="editor-phone"
          type="tel"
          value={form.phone}
          onChange={(event) => onChange('phone', event.target.value)}
          autoComplete="tel"
        />
      </Field>
      <Field id="editor-email" label="Email" fieldClass="content" readOnly={readOnly} displayValue={form.email}>
        <Input
          id="editor-email"
          type="email"
          value={form.email}
          onChange={(event) => onChange('email', event.target.value)}
          autoComplete="email"
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
        />
      </Field>
    </SectionCard>
  );
}

const ADDRESS_FIELDS = [
  { key: 'addressLine1', label: 'Address line 1', autoComplete: 'address-line1' },
  { key: 'addressLine2', label: 'Address line 2 (optional)', autoComplete: 'address-line2' },
  { key: 'city', label: 'City', autoComplete: 'address-level2' },
  { key: 'state', label: 'State / region', autoComplete: 'address-level1' },
  { key: 'postalCode', label: 'Postal code (optional)', autoComplete: 'postal-code' },
  { key: 'country', label: 'Country', autoComplete: 'country' },
] as const;

function LocationSection({ section, form, onChange, readOnly }: SectionEditorProps) {
  return (
    <SectionCard section={section}>
      {ADDRESS_FIELDS.map(({ key, label, autoComplete }) => (
        <Field
          key={key}
          id={`editor-address-${key}`}
          label={label}
          fieldClass="core"
          readOnly={readOnly}
          displayValue={form.address[key]}
        >
          <Input
            id={`editor-address-${key}`}
            value={form.address[key]}
            onChange={(event) =>
              onChange('address', { ...form.address, [key]: event.target.value })
            }
            autoComplete={autoComplete}
          />
        </Field>
      ))}
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
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  readOnly: boolean;
  placeholder: string;
  itemNoun: string;
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
    </div>
  );
}

function TagsSection({ section, form, onChange, readOnly }: SectionEditorProps) {
  return (
    <SectionCard section={section}>
      <ListField
        id="editor-tags"
        label="Tags"
        values={form.tags}
        onChange={(values) => onChange('tags', values)}
        readOnly={readOnly}
        placeholder="Add a tag and press Enter"
        itemNoun="tag"
      />
    </SectionCard>
  );
}

function AmenitiesSection({ section, form, onChange, readOnly }: SectionEditorProps) {
  return (
    <SectionCard section={section}>
      <ListField
        id="editor-amenities"
        label="Amenities"
        values={form.amenities}
        onChange={(values) => onChange('amenities', values)}
        readOnly={readOnly}
        placeholder="Add an amenity and press Enter"
        itemNoun="amenity"
      />
    </SectionCard>
  );
}

function formatPeriods(periods: readonly OpeningPeriodForm[]): string {
  return periods.map((period) => `${period.opensAt} – ${period.closesAt}`).join(', ');
}

function DayHoursRow({
  day,
  periods,
  readOnly,
  onChange,
}: {
  day: Weekday;
  periods: OpeningPeriodForm[];
  readOnly: boolean;
  onChange: (periods: OpeningPeriodForm[]) => void;
}) {
  const label = WEEKDAY_LABELS[day];
  const isOpen = periods.length > 0;

  function updatePeriod(index: number, patch: Partial<OpeningPeriodForm>) {
    onChange(periods.map((period, position) => (position === index ? { ...period, ...patch } : period)));
  }

  return (
    <div className="border-border flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {readOnly ? (
          <span className="text-muted-foreground font-mono text-xs">
            {isOpen ? formatPeriods(periods) : 'Closed'}
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`editor-hours-${day}`}
              checked={isOpen}
              onCheckedChange={(checked) => onChange(checked === true ? [DEFAULT_PERIOD] : [])}
            />
            <Label htmlFor={`editor-hours-${day}`} className="text-xs">
              Open
            </Label>
          </div>
        )}
      </div>

      {!readOnly && isOpen
        ? periods.map((period, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Input
                type="time"
                aria-label={`${label} opens at`}
                value={period.opensAt}
                onChange={(event) => updatePeriod(index, { opensAt: event.target.value })}
                className="w-auto"
              />
              <span className="text-muted-foreground text-xs">to</span>
              <Input
                type="time"
                aria-label={`${label} closes at`}
                value={period.closesAt}
                onChange={(event) => updatePeriod(index, { closesAt: event.target.value })}
                className="w-auto"
              />
              {periods.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(periods.filter((_, position) => position !== index))}
                  aria-label={`Remove ${label} period ${index + 1}`}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ))
        : null}

      {!readOnly && isOpen ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => onChange([...periods, DEFAULT_PERIOD])}
        >
          Add period
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Hours quick-fill controls (issue #14 / Task 6): preset buttons plus a
 * "Copy from template" selector. Both stamp ordinary editable values through the
 * normal hours change handler — nothing is persisted and there is no template
 * CRUD. Hidden entirely on a read-only listing.
 */
function HoursPresetControls({ onApply }: { onApply: (preset: HoursPresetId) => void }) {
  const templateId = useId();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">Quick fill</span>
        {HOURS_PRESET_OPTIONS.map((preset) => (
          <Button
            key={preset.id}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onApply(preset.id)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={templateId} className="text-xs">
          Copy from template
        </Label>
        <Select value="" onValueChange={(value) => onApply(value as HoursPresetId)}>
          <SelectTrigger id={templateId} className="w-48" size="sm">
            <SelectValue placeholder="Choose a template" />
          </SelectTrigger>
          <SelectContent>
            {HOURS_PRESET_OPTIONS.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-muted-foreground text-xs">
        Presets are quick-fills only — they stamp ordinary editable values into the form; nothing is
        stored as a template. Edit any value afterwards.
      </p>
    </div>
  );
}

function HoursSection({ section, form, onChange, readOnly }: SectionEditorProps) {
  function applyPreset(preset: HoursPresetId) {
    onChange('hours', applyHoursPreset(preset));
  }

  return (
    <SectionCard section={section}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Weekly hours</span>
        <FieldClassTag fieldClass="content" />
      </div>
      {readOnly ? null : <HoursPresetControls onApply={applyPreset} />}
      <div className="flex flex-col gap-4">
        {WEEKDAYS.map((day) => (
          <DayHoursRow
            key={day}
            day={day}
            periods={form.hours[day]}
            readOnly={readOnly}
            onChange={(periods) => onChange('hours', { ...form.hours, [day]: periods })}
          />
        ))}
      </div>
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
