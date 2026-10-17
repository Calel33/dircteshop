'use client';

import { Button } from '@/components/ui/button';

export function DirectoryBulkConfirm({ 
  count, 
  onConfirm, 
  onCancel,
  isPending,
  error
}: { 
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
}) {
  return (
    <div className="p-4 border rounded-lg bg-card space-y-4 mb-4" role="alert">
      <div className="space-y-1">
        <p className="text-sm font-medium">Bulk Approval</p>
        <p className="text-sm text-muted-foreground">Are you sure you want to approve {count} listings? This action is irreversible.</p>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={onConfirm} disabled={isPending}>Confirm Approval</Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={isPending}>Cancel</Button>
      </div>
    </div>
  );
}
