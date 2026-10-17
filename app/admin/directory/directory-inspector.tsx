'use client';

import { useEffect, useState } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { AdminDirectoryRow } from './directory-types';
import { actionsForStatus, ACTION_LABELS } from './directory-actions-policy';
import { DirectoryInlineConfirm } from './directory-inline-confirm';

export function DirectoryInspector({
  row,
  onClose,
  onAction,
  isPending,
  error,
  isMobile,
}: {
  row: AdminDirectoryRow | null;
  onClose: () => void;
  onAction: (action: string, options?: { reason?: string, confirmName?: string }) => Promise<void>;
  isPending: boolean;
  error: string | null;
  isMobile?: boolean;
}) {
  const [activeAction, setActiveAction] = useState<string | null>(null);

  useEffect(() => {
    setActiveAction(null);
  }, [row?._id]);

  const handleAction = async (action: string, options?: { reason?: string, confirmName?: string }) => {
    try {
      await onAction(action, options);
      setActiveAction(null);
    } catch {
      // Error is handled via props
    }
  };

  if (!row) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-card-muted">
        Select a listing to inspect. Actions and their confirmations happen here, in place.
      </div>
    );
  }

  const actions = actionsForStatus(row.status);

  const content = (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h2 className="text-xl font-bold">{row.name}</h2>
          <span className="px-2 py-1 bg-muted rounded-full text-xs font-medium">{row.status}</span>
        </div>
        {isMobile && <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>}
      </div>


      <div className="text-sm space-y-1">
        <p><strong>Category:</strong> {row.categoryName ?? 'Uncategorized'}</p>
        <p><strong>Owner:</strong> {row.ownerName ?? 'Unknown'}</p>
        {row.email && <p><strong>Email:</strong> {row.email}</p>}
        <p><strong>Location:</strong> {row.address.city}, {row.address.state}</p>
        <p><strong>Description:</strong> {row.description}</p>
        {row.phone && <p><strong>Phone:</strong> {row.phone}</p>}
        {row.website && <p><strong>Website:</strong> {row.website}</p>}
        <p><strong>Verified:</strong> {row.isVerified ? 'Yes' : 'No'}</p>
        <p><strong>Featured:</strong> {row.isFeatured ? 'Yes' : 'No'}</p>
        <p><strong>Rating:</strong> {row.rating} ({row.ratingCount} reviews)</p>
        <p><strong>Submitted:</strong> {row.submittedAt ? new Date(row.submittedAt).toLocaleDateString() : 'N/A'}</p>
        <p><strong>Created:</strong> {new Date(row.createdAt).toLocaleDateString()}</p>
      </div>

      {activeAction ? (
        <DirectoryInlineConfirm
          action={activeAction}
          targetName={row.name}
          onConfirm={(input) => handleAction(activeAction, input)}
          onCancel={() => setActiveAction(null)}
          isPending={isPending}
          error={error}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => (
            <Button key={action} variant="outline" onClick={() => setActiveAction(action)}>
              {ACTION_LABELS[action]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={!!row} onOpenChange={() => onClose()}>
        <SheetContent side="bottom" className="h-[80vh] p-0">
          <div className="overflow-y-auto h-full">
            {content}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside className="fixed bottom-0 left-0 w-full md:relative md:w-80 md:h-full md:border-l bg-card overflow-y-auto z-50 md:z-auto">
      {content}
    </aside>
  );
}
