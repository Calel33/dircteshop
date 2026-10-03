import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

import { BusinessSwitcher } from './business-switcher';
import type { OwnerEditorDocument } from './editor-types';
import { StatusChip } from '../../status-chip';

/** Editor header: back link, business name, status chip, switcher, and account menu. */
export function EditorHeader({ business }: { business: OwnerEditorDocument }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-gap">
      <div className="flex flex-col gap-2">
        <Link
          href="/owner"
          className="text-muted-foreground font-label text-xs hover:text-foreground"
        >
          ← Your businesses
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold">{business.name}</h1>
          <StatusChip status={business.status} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <BusinessSwitcher currentId={business._id} />
        <UserButton />
      </div>
    </header>
  );
}
