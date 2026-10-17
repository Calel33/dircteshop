import { DirectoryListingStatus } from './directory-types';

export type DirectoryAction = 
  | 'approve' 
  | 'requestChanges' 
  | 'reject' 
  | 'suspend' 
  | 'restore' 
  | 'feature' 
  | 'delete';

export function actionsForStatus(status: DirectoryListingStatus): DirectoryAction[] {
  const actions: DirectoryAction[] = ['feature', 'delete'];
  
  switch (status) {
    case 'pendingReview':
      return ['approve', 'requestChanges', 'reject', ...actions];
    case 'approved':
      return ['suspend', ...actions];
    case 'suspended':
      return ['restore', ...actions];
    default:
      return actions;
  }
}

export function actionRequiresReason(action: DirectoryAction): boolean {
  return ['requestChanges', 'reject', 'suspend'].includes(action);
}

export function canConfirmDelete(currentName: string, typedName: string): boolean {
  return currentName === typedName;
}

export const ACTION_LABELS: Record<DirectoryAction, string> = {
  approve: 'Approve',
  requestChanges: 'Request changes',
  reject: 'Reject',
  suspend: 'Suspend',
  restore: 'Restore',
  feature: 'Feature pin',
  delete: 'Hard delete',
};

export function getConsequenceCopy(action: DirectoryAction): string {
  switch (action) {
    case 'requestChanges':
    case 'reject':
    case 'suspend':
      return `This action sends your reason to the listing owner.`;
    case 'delete':
      return `This will permanently delete the business, its menu, services, stylists, orders, bookings, quotes, and media files. An audit entry will be kept.`;
    default:
      return `Confirm action: ${ACTION_LABELS[action]}`;
  }
}

export function normalizeReason(reason: string): string {
  return reason.trim();
}
