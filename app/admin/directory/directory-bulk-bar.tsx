'use client';

import { Button } from '@/components/ui/button';

export function DirectoryBulkBar({ 
  selectedCount,
  eligibleCount,
  onRequestConfirm,
  isPending,
}: { 
  selectedCount: number;
  eligibleCount: number;
  onRequestConfirm: () => void;
  isPending: boolean;
}) {
  return (
      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg mb-4 border border-border">
        <div className="space-y-0.5">
          <p className="font-semibold text-sm">Bulk Approve</p>
          <p className="text-sm text-muted-foreground">{selectedCount} of {eligibleCount} pending listings selected</p>
        </div>
        <Button 
          size="sm"
          onClick={onRequestConfirm} 
          disabled={selectedCount === 0 || isPending}
        >
          Approve Selected
        </Button>
      </div>
  );
}
