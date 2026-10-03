import type { FunctionReturnType } from 'convex/server';

import { api } from '@/convex/_generated/api';

/** The owned editor document returned by `businesses.queries.getMine`. */
export type OwnerEditorDocument = NonNullable<
  FunctionReturnType<typeof api.businesses.queries.getMine>
>;

/** A section of the owner editor, paired with its form content. */
export interface EditorSection {
  id: string;
  label: string;
  description: string;
  /** Nav-only placeholder section with no editor wired yet. */
  stub?: true;
}
