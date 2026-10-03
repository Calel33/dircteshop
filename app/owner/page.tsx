import type { Metadata } from 'next';

import { OwnerHome } from './owner-home';

export const metadata: Metadata = {
  title: 'Owner workspace',
  description: 'Create and manage your business listings.',
};

export default function OwnerPage() {
  return <OwnerHome />;
}
