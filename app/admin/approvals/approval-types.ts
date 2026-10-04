import type { Doc } from '@/convex/_generated/dataModel';

import type { ApprovalAction } from './approval-actions-policy';

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
   * Reference clock for age and priority. Supplied by the caller so the server
   * render and the client render derive the same values.
   */
  now: number;
}
