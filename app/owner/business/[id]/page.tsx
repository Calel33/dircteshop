import type { Metadata } from 'next';

import { OwnerEditor } from './owner-editor';

export const metadata: Metadata = {
  title: 'Business editor',
  description: 'Edit and manage one of your business listings.',
};

/**
 * Owner editor route (SPEC §9, `/owner/business/[id]`). Next.js 16: a dynamic
 * route's `params` is a Promise and must be awaited. Ownership authorization is
 * enforced server-side by `businesses.getMine`; this page only forwards the id.
 */
export default async function OwnerBusinessEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <OwnerEditor businessId={id} />;
}
