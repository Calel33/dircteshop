'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { canConfirmDelete, getConsequenceCopy } from './directory-actions-policy';
import { DirectoryAction } from './directory-actions-policy';

export function DirectoryInlineConfirm({
  action,
  targetName,
  onConfirm,
  onCancel,
  isPending,
  error,
}: {
  action: string;
  targetName: string;
  onConfirm: (input: { reason?: string; confirmName?: string }) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');

  const isDelete = action === 'delete';
  const isModeration = ['requestChanges', 'reject', 'suspend'].includes(action);

  const canConfirm =
    (!isModeration || reason.trim() !== '') &&
    (!isDelete || canConfirmDelete(targetName, confirmName));

  return (
    <div className="space-y-4 p-4 border rounded-card bg-card">
      <div className="space-y-1">
        <p className="text-sm font-medium">Consequence</p>
        <p className="text-sm text-muted-foreground">{getConsequenceCopy(action as DirectoryAction)}</p>
      </div>

      {isModeration && (
        <div className="space-y-1">
          <Label className="text-xs font-semibold">Moderation Reason</Label>
          <Textarea
            placeholder="Enter reason..."
            value={reason}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
          />
        </div>
      )}

      {isDelete && (
        <div className="space-y-1">
          <Label className="text-xs font-semibold">Confirm Deletion</Label>
          <Input
            placeholder={`Type "${targetName}" to confirm`}
            value={confirmName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmName(e.target.value)}
          />
        </div>
      )}

      {error && (
        <div role="alert" className="text-destructive text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <Button 
          variant={isDelete ? "destructive" : "default"}
          onClick={() => onConfirm({ 
            reason: isModeration ? reason : undefined, 
            confirmName: isDelete ? confirmName : undefined 
          })} 
          disabled={!canConfirm || isPending}
        >
          {isPending ? 'Processing...' : isDelete ? 'Delete Business' : 'Confirm'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
