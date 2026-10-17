import type { Id } from '@/convex/_generated/dataModel';
import { DirectoryListingStatus } from '../directory/directory-types';

export type AuditLogRow = {
  _id: Id<'auditLogs'>;
  at: number;
  action: string;
  actorName: string | null;
  targetType: string;
  targetId: string;
  targetName: string | null;
  fromStatus: DirectoryListingStatus | null;
  toStatus: DirectoryListingStatus | null;
  reason: string | null;
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  approve: 'Approve',
  requestChanges: 'Request changes',
  reject: 'Reject',
  suspend: 'Suspend',
  restore: 'Restore',
  feature: 'Feature pin',
  delete: 'Hard delete',
  createDraft: 'Create draft',
};
