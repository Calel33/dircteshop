export const MARK_ALL_READ_MAX_BATCHES = 50;

export function markAllReadBatchLimitExceeded(
  hasMoreUnread: boolean,
  completedBatches: number
): boolean {
  return hasMoreUnread && completedBatches >= MARK_ALL_READ_MAX_BATCHES;
}
