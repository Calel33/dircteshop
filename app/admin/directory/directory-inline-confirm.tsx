'use client';

import { useState } from 'react';
import { InlineConfirm } from '@/components/ui/inline-confirm';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  actionRequiresReason,
  canConfirmDelete,
  type DirectoryAction,
} from './directory-actions-policy';

/** The status each moderation action moves a listing to (prototype `ACTIONS.to`). */
const TARGET_STATUS: Partial<Record<DirectoryAction, string>> = {
  approve: 'approved',
  requestChanges: 'changesRequested',
  reject: 'rejected',
  suspend: 'suspended',
  restore: 'approved',
};

const LABEL: Record<DirectoryAction, string> = {
  approve: 'Approve',
  requestChanges: 'Request changes',
  reject: 'Reject',
  suspend: 'Suspend',
  restore: 'Restore',
  feature: 'Feature pin',
  delete: 'Hard delete',
};

/** `.consequence`: what the confirm will do, and the audit row it writes. */
function Consequence({
  targetName,
  targetStatus,
  isDelete,
}: {
  targetName: string;
  targetStatus: string | undefined;
  isDelete: boolean;
}) {
  if (isDelete) {
    return (
      <>
        This permanently deletes <b>{targetName}</b> and every child record (photos, hours,
        notifications, reviews). It cannot be undone. An{' '}
        <code className="font-mono">auditLogs</code> row is written first.
      </>
    );
  }

  return (
    <>
      <b>{targetName}</b>{' '}
      {targetStatus === undefined ? (
        <>
          will have its featured pin toggled.
        </>
      ) : (
        <>
          will move to <code className="font-mono">{targetStatus}</code>.
        </>
      )}{' '}
      An <code className="font-mono">auditLogs</code> row records who, what, and when.
    </>
  );
}

/** Required reason field for request-changes, reject and suspend. */
function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const blank = value.length > 0 && value.trim().length === 0;

  return (
    <div className="grid gap-1">
      <label htmlFor="moderation-reason" className="text-muted-foreground text-xs font-semibold">
        Reason (required — becomes <code className="font-mono">moderationReason</code> and notifies the
        owner)
      </label>
      <Textarea
        id="moderation-reason"
        className="rounded-input bg-card min-h-14 text-tiny"
        placeholder="Explain what must change"
        value={value}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
        required
        aria-invalid={blank}
      />
      {blank ? (
        <span className="text-danger text-xs" role="alert">
          Reason is required.
        </span>
      ) : null}
    </div>
  );
}

/**
 * The prototype's `confirmForm`, rendered inside the inspector's `.insp-step`.
 * It is the confirmation BODY only — the caller supplies the bordered step and
 * its title. Delete requires typing the exact business name and states the
 * irreversible child-record warning; request-changes, reject and suspend
 * require a reason before the confirm button enables.
 */
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

  const typedAction = action as DirectoryAction;
  const isDelete = action === 'delete';
  const requiresReason = actionRequiresReason(typedAction);
  const isDestructive = isDelete || typedAction === 'reject' || typedAction === 'suspend';
  const reasonMissing = requiresReason && reason.trim() === '';
  const nameMismatch = isDelete && !canConfirmDelete(targetName, confirmName);

  return (
    <InlineConfirm
      message={
        <Consequence
          targetName={targetName}
          targetStatus={TARGET_STATUS[typedAction]}
          isDelete={isDelete}
        />
      }
      neutral={!isDestructive}
      destructive={isDestructive}
      confirmLabel={isDelete ? `Delete ${targetName}` : LABEL[typedAction]}
      onConfirm={() =>
        onConfirm({
          reason: requiresReason ? reason : undefined,
          confirmName: isDelete ? confirmName : undefined,
        })
      }
      onCancel={onCancel}
      isPending={isPending}
      confirmDisabled={reasonMissing || nameMismatch}
    >
      {isDelete ? (
        <div className="grid gap-1">
          <label htmlFor="confirm-name" className="text-muted-foreground text-xs font-semibold">
            Type <b>{targetName}</b> to confirm
          </label>
          <Input
            id="confirm-name"
            className="rounded-input bg-card h-8 text-tiny"
            placeholder={targetName}
            value={confirmName}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setConfirmName(event.target.value)}
            disabled={isPending}
          />
        </div>
      ) : null}

      {requiresReason ? <ReasonField value={reason} onChange={setReason} /> : null}

      {error === null ? null : (
        <div role="alert" className="text-danger text-xs">
          {error}
        </div>
      )}
    </InlineConfirm>
  );
}
