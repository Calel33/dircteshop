import type { FunctionReturnType } from 'convex/server';

import { api } from '@/convex/_generated/api';

/** The owned editor document returned by `businesses.queries.getMine`. */
export type OwnerEditorDocument = NonNullable<
  FunctionReturnType<typeof api.businesses.queries.getMine>
>;

/** A section of the owner editor, before its form content lands in todo #9. */
export interface EditorSection {
  id: string;
  label: string;
  description: string;
}
