'use client';

import { useId } from 'react';

import { Button } from '@/components/ui/button';
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

import {
  WEEKDAY_LABELS,
  WEEKDAYS,
  type OpeningPeriodForm,
  type Weekday,
} from './editor-form';
import { applyHoursPreset, HOURS_PRESET_OPTIONS, type HoursPresetId } from './editor-hours-presets';
import { FieldClassTag } from './field-controls';
import { SectionCard, type SectionEditorProps } from './section-card';

const DEFAULT_PERIOD: OpeningPeriodForm = { opensAt: '09:00', closesAt: '17:00' };

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
          <span className="text-card-muted font-mono text-xs">
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
                className="w-auto text-card-foreground [color-scheme:dark]"
              />
              <span className="text-card-muted text-xs">to</span>
              <Input
                type="time"
                aria-label={`${label} closes at`}
                value={period.closesAt}
                onChange={(event) => updatePeriod(index, { closesAt: event.target.value })}
                className="w-auto text-card-foreground [color-scheme:dark]"
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
        <span className="text-card-muted text-xs">Quick fill</span>
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
          <SelectTrigger id={templateId} className="w-48 text-card-foreground data-[placeholder]:text-card-muted!" size="sm">
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
      <p className="text-card-muted text-xs">
        Presets are quick-fills only — they stamp ordinary editable values into the form; nothing is
        stored as a template. Edit any value afterwards.
      </p>
    </div>
  );
}

/** Operating Hours section: weekly rows plus the quick-fill presets. */
export function HoursSection({ section, form, onChange, readOnly, tool }: SectionEditorProps) {
  function applyPreset(preset: HoursPresetId) {
    onChange('hours', applyHoursPreset(preset));
  }

  return (
    <SectionCard section={section} tool={tool}>
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
