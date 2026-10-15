import type { ReactNode } from 'react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import type { EditorFormState } from './editor-form';
import type { EditorSection } from './editor-types';

/** Minimal category option the editor needs for its Select and preview. */
export interface CategoryOption {
  _id: string;
  name: string;
}

/**
 * Props every section editor receives. `onChange` is field-scoped so each
 * section updates exactly the part of form state it owns. `tool` is the panel
 * head's right-aligned tool (the prototype's "Reset Section", L375-378).
 */
export interface SectionEditorProps {
  section: EditorSection;
  form: EditorFormState;
  onChange: <K extends keyof EditorFormState>(field: K, value: EditorFormState[K]) => void;
  readOnly: boolean;
  categories: CategoryOption[];
  tool?: ReactNode;
}

/**
 * Panel shell for a form section (prototype `.editor-panel` head, L375-378):
 * title, description, optional right-aligned tool, and the field content.
 */
export function SectionCard({
  section,
  tool,
  children,
}: {
  section: EditorSection;
  tool?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-lg">{section.label}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
        {tool === undefined ? null : <CardAction>{tool}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
