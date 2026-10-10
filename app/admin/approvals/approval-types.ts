import type { ReactNode } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import type { ApprovalAction } from './approval-actions-policy';
import type { SelectionState } from './approval-selection';

/**
 * Frozen queue-card projection for `/admin/approvals` (issue #13 / B3b todo #4).
 *
 * This is the typed boundary between the presentational queue and the backend
 * queue query. It mirrors the narrow projection the Convex query returns:
 * business identity, category/owner display labels, submission age, the image
 * storage id (data only), and the public contact/address fields. It deliberately
 * carries no auth identifiers, moderation internals, or raw owner/business docs.
 *
 * The `address` shape is taken from the schema so it cannot drift from Convex.
 */
export interface ApprovalCard {
  _id: string;
  name: string;
  categoryName: string | null;
  ownerLabel: string | null;
  submittedAt: number | undefined;
  imageStorageId: string | null;
  address: Doc<'businesses'>['address'];
  phone?: string;
  email?: string;
}

/** The four presentational queue states the route shell can be in. */
export type ApprovalQueueState = 'loading' | 'empty' | 'error' | 'ready';

/** The confirmed cursor page size (mirrors the server's `QUEUE_PAGE_SIZE`). */
export const APPROVAL_PAGE_SIZE = 25;

/** Priority filter options; `all` disables the 48h band filter (SPEC §10). */
export const APPROVAL_PRIORITY_FILTERS = ['all', 'high', 'normal'] as const;
export type ApprovalPriorityFilter = (typeof APPROVAL_PRIORITY_FILTERS)[number];

/** Time bucket options; `all` is unbounded (requester clarification 2026-10-10). */
export const APPROVAL_TIME_FILTERS = ['all', '24h', '7d', '30d'] as const;
export type ApprovalTimeFilter = (typeof APPROVAL_TIME_FILTERS)[number];

/** The route-owned filter selection. `categoryId` undefined means all categories. */
export interface ApprovalFilters {
  categoryId: string | undefined;
  priority: ApprovalPriorityFilter;
  time: ApprovalTimeFilter;
}

export const DEFAULT_APPROVAL_FILTERS: ApprovalFilters = {
  categoryId: undefined,
  priority: 'all',
  time: 'all',
};

/**
 * The guarded full-details projection returned by
 * `getPendingApprovalDetails` (Task 1). Mirrors `toPendingApprovalDetails`: the
 * owner-submitted profile, the owner label and the submission summary, with no
 * auth ids, storage refs, or moderation internals. Hand-written to match the
 * server projection (the pinning test lives server-side).
 */
export interface PendingApprovalDetails {
  _id: string;
  status: Doc<'businesses'>['status'];
  name: string;
  categoryName: string | null;
  description: string;
  address: Doc<'businesses'>['address'];
  phone?: string;
  email?: string;
  website?: string;
  hours: Doc<'businesses'>['hours'];
  tags: string[];
  amenities: string[];
  services: string[];
  credentials: string[];
  keywords: string[];
  photos: { altText?: string; ordering: number }[];
  photoCount: number;
  ownerLabel: string | null;
  submittedAt?: number;
  lastSavedAt?: number;
  lastUpdatedAt: number;
}

/** A category option for the filter control. */
export interface ApprovalCategoryOption {
  _id: string;
  name: string;
}

/** Filter controls for the queue: category, priority and submission time. */
export interface ApprovalQueueFilterProps {
  filters: ApprovalFilters;
  categories: readonly ApprovalCategoryOption[];
  /** Any change resets cursor history and clears the current-page selection. */
  onChange: (next: ApprovalFilters) => void;
}

/** Page-scoped selection wiring for the queue. */
export interface ApprovalQueueSelectionProps {
  selectedIds: ReadonlySet<string>;
  state: SelectionState;
  onToggleAll: (checked: boolean) => void;
  onToggleOne: (id: string, checked: boolean) => void;
}

/** Cursor navigation wiring for the queue. */
export interface ApprovalQueuePaginationProps {
  hasPrevious: boolean;
  hasNext: boolean;
  pageStatus?: 'SplitRecommended' | 'SplitRequired' | null;
  onPrevious: () => void;
  onNext: () => void;
}

/** Props for the presentational {@link ApprovalQueue}. */
export interface ApprovalQueueProps {
  state: ApprovalQueueState;
  cards: readonly ApprovalCard[];
  /** Actionable message shown in the `error` state. */
  errorMessage?: string;
  /** Retry handler shown in the `error` state. */
  onRetry?: () => void;
  /**
   * Opens the confirmation/reason modal for one card decision (todo #5). The
   * queue stays presentational; the route owns the modal and the mutation.
   */
  onAction?: (card: ApprovalCard, action: ApprovalAction) => void;
  /**
   * Opens the full-details side panel for one card (Task 4). Presentational
   * trigger only; the route owns the panel state.
   */
  onViewDetails?: (card: ApprovalCard) => void;
  /** Category/priority/time filter controls (Task 3). */
  filters: ApprovalFilters;
  categories: readonly ApprovalCategoryOption[];
  onFiltersChange: (next: ApprovalFilters) => void;
  /** Current-page selection (Task 3). */
  selection: ApprovalQueueSelectionProps;
  /**
   * Bulk-approve bar (Task 5), mounted by the route between the select-all row
   * and the list so it only appears while items are selected.
   */
  bulkActions?: ReactNode;
  /** Cursor navigation (Task 3). */
  pagination: ApprovalQueuePaginationProps;
  /**
   * Reference clock for age and priority. Supplied by the caller so the server
   * render and the client render derive the same values.
   */
  now: number;
}
