'use client';

import { useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { EditorFieldClass } from './editor-form';

const FIELD_CLASS_META: Record<EditorFieldClass, { label: string; title: string }> = {
  core: {
    label: 'Core',
    title:
      'Core identity. On an approved listing these changes apply when the listing is resubmitted for review.',
  },
  content: {
    label: 'Live',
    title: 'Content. On an approved listing these changes publish immediately.',
  },
};

/** Small core/live tag that makes the server's save-mode split visible in the UI. */
export function FieldClassTag({ fieldClass }: { fieldClass: EditorFieldClass }) {
  const meta = FIELD_CLASS_META[fieldClass];

  return (
    <Badge variant="outline" title={meta.title} className="font-label text-xs tracking-wide uppercase">
      {meta.label}
    </Badge>
  );
}

interface FieldProps {
  id: string;
  label: string;
  fieldClass: EditorFieldClass;
  readOnly: boolean;
  /** Text shown instead of the control when the listing is read-only. */
  displayValue: string;
  children: ReactNode;
}

/**
 * Labelled editor field. Renders the control while editing and a plain value
 * when read-only, so a locked listing never exposes an editable control.
 */
export function Field({ id, label, fieldClass, readOnly, displayValue, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        <FieldClassTag fieldClass={fieldClass} />
      </div>
      {readOnly ? (
        <p className="text-muted-foreground text-sm break-words">
          {displayValue.length > 0 ? displayValue : '—'}
        </p>
      ) : (
        children
      )}
    </div>
  );
}

interface StringListEditorProps {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  readOnly: boolean;
  placeholder: string;
  /** Accessible label for the remove buttons; e.g. "tag". */
  itemNoun: string;
}

/** Free-form string list editor (tags / amenities): add, de-dupe, and remove. */
export function StringListEditor({
  id,
  values,
  onChange,
  readOnly,
  placeholder,
  itemNoun,
}: StringListEditorProps) {
  const [draft, setDraft] = useState('');

  function addValue() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      return;
    }
    if (!values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setDraft('');
  }

  if (readOnly) {
    return (
      <p className="text-muted-foreground text-sm break-words">
        {values.length > 0 ? values.join(', ') : '—'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addValue();
            }
          }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" onClick={addValue} disabled={draft.trim().length === 0}>
          Add
        </Button>
      </div>
      {values.length > 0 ? (
        <ul role="list" className="flex flex-wrap gap-2">
          {values.map((value) => (
            <li key={value}>
              <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-pill px-2 py-1 text-xs">
                {value}
                <button
                  type="button"
                  onClick={() => onChange(values.filter((candidate) => candidate !== value))}
                  aria-label={`Remove ${itemNoun} ${value}`}
                  className="hover:text-foreground"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
