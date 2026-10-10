'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { ApprovalActionDialog } from './approval-action-dialog';
import { ApprovalBulkBar, ApprovalBulkDialog } from './approval-bulk-dialog';
import { ApprovalDetailsPanel } from './approval-details-panel';
import { normalizeReason, type ApprovalAction } from './approval-actions-policy';
import { FIRST_QUEUE_PAGE, planQueuePage, type QueuePageRef } from './approval-pagination';
import { ApprovalQueue } from './approval-queue';
import {
  selectedIdsOnPage,
  selectionState,
  toggleAllSelected,
  toggleSelected,
} from './approval-selection';
import { ApprovalsLoadBoundary } from './approvals-load-boundary';
import {
  APPROVAL_PAGE_SIZE,
  DEFAULT_APPROVAL_FILTERS,
  type ApprovalCard,
  type ApprovalFilters,
  type ApprovalQueueState,
} from './approval-types';

/** Normalises a thrown mutation error into a user-facing message. */
function messageFromError(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data;
    if (typeof data === 'string') {
      return data;
    }
    if (typeof data === 'object' && data !== null && 'message' in data) {
      const message = data.message;
      if (typeof message === 'string') {
        return message;
      }
    }
  }

  return error instanceof Error ? error.message : fallback;
}

/** Maps the Convex query result to the queue's presentational state. */
function queueStateFor(cards: readonly ApprovalCard[] | undefined): ApprovalQueueState {
  if (cards === undefined) {
    return 'loading';
  }
  return cards.length === 0 ? 'empty' : 'ready';
}

/**
 * Route shell for `/admin/approvals` (issue #13 / B3b todo #4 + #5, extended by
 * B3c / #14 Tasks 3–5). It owns the presentational queue state, the live Convex
 * queue/mutation wiring, the per-card confirmation/reason modal, the
 * category/priority/time filters, the cursor page stack and the page-scoped
 * selection. The clock is captured once per mount so age, priority and the
 * filter cutoff stay stable across renders and match on server and client —
 * keeping the paginated query's cursor valid.
 *
 * `listPendingApprovals` is the guarded cursor query (Task 1);
 * `moderateListing` is the atomic single decision + audit mutation (B3b).
 * Success closes the modal and relies on the reactive query to remove the card,
 * so a decision is never reflected as success before the server commits.
 */
export function ApprovalsRoute() {
  const [now] = useState(() => Date.now());

  return (
    <ApprovalsLoadBoundary now={now}>
      <ConnectedApprovalQueue now={now} />
    </ApprovalsLoadBoundary>
  );
}

function ConnectedApprovalQueue({ now }: { now: number }) {
  const [filters, setFilters] = useState<ApprovalFilters>(DEFAULT_APPROVAL_FILTERS);
  const [pageRef, setPageRef] = useState<QueuePageRef>(FIRST_QUEUE_PAGE);
  const [cursorStack, setCursorStack] = useState<QueuePageRef[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set<string>());

  const categories = useQuery(api.categories.listOrdered);
  const result = useQuery(api.businesses.queries.listPendingApprovals, {
    paginationOpts: {
      numItems: APPROVAL_PAGE_SIZE,
      cursor: pageRef.cursor,
      endCursor: pageRef.endCursor,
    },
    categoryId: filters.categoryId as Id<'categories'> | undefined,
    priority: filters.priority,
    time: filters.time,
    now,
  });
  const moderateListing = useMutation(api.businesses.mutations.moderateListing);
  const approveSelected = useMutation(api.businesses.mutations.approveSelected);

  const [detailsTarget, setDetailsTarget] = useState<ApprovalCard | null>(null);
  const details = useQuery(
    api.businesses.queries.getPendingApprovalDetails,
    detailsTarget === null ? 'skip' : { businessId: detailsTarget._id as Id<'businesses'> }
  );

  const [decision, setDecision] = useState<{ card: ApprovalCard; action: ApprovalAction } | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const cards = result?.page ?? [];
  const pageIds = cards.map((card) => card._id);
  const state = selectionState(selectedIds, pageIds);
  const selectedOnPageCount = selectedIdsOnPage(selectedIds, pageIds).length;
  const categoryOptions = (categories ?? []).map((category) => ({
    _id: category._id,
    name: category.name,
  }));

  // Cursor-page plan. For a SplitRequired page the result may be incomplete, so
  // the visible range is re-scoped to its first half (bounded by `splitCursor`)
  // and Next is withheld until the page is complete — see approval-pagination.ts.
  const plan = planQueuePage(pageRef, result);

  useEffect(() => {
    if (plan.current === pageRef) {
      return;
    }
    // A split re-scope changes the page content, so drop the page-scoped selection.
    setPageRef(plan.current);
    setSelectedIds(new Set());
  }, [plan, pageRef]);

  function changeFilters(next: ApprovalFilters) {
    setFilters(next);
    setPageRef(FIRST_QUEUE_PAGE);
    setCursorStack([]);
    setSelectedIds(new Set());
  }

  function goNext() {
    if (plan.next === null) {
      return;
    }
    setCursorStack((stack) => [...stack, pageRef]);
    setPageRef(plan.next);
    setSelectedIds(new Set());
  }

  function goPrevious() {
    if (cursorStack.length === 0) {
      return;
    }
    const previous = cursorStack[cursorStack.length - 1];
    setCursorStack(cursorStack.slice(0, -1));
    setPageRef(previous);
    setSelectedIds(new Set());
  }

  function openDecision(card: ApprovalCard, action: ApprovalAction) {
    setActionError(null);
    setDecision({ card, action });
  }

  function closeDecision() {
    if (isSubmitting) {
      return;
    }
    setDecision(null);
    setActionError(null);
  }

  async function confirmDecision(reason: string) {
    if (decision === null || isSubmitting) {
      return;
    }

    const { card, action } = decision;
    const trimmedReason = normalizeReason(action, reason);
    setActionError(null);
    setIsSubmitting(true);

    try {
      await moderateListing({
        businessId: card._id as Id<'businesses'>,
        action,
        ...(trimmedReason === undefined ? {} : { reason: trimmedReason }),
      });
      // Success: the reactive query removes the card; close the modal.
      setDecision(null);
    } catch (submitError) {
      setActionError(
        messageFromError(submitError, 'Could not update the listing. Please try again.')
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function openBulk() {
    if (selectedOnPageCount === 0) {
      return;
    }
    setBulkError(null);
    setIsBulkOpen(true);
  }

  function closeBulk() {
    if (isBulkSubmitting) {
      return;
    }
    setIsBulkOpen(false);
    setBulkError(null);
  }

  async function confirmBulkApprove() {
    if (isBulkSubmitting) {
      return;
    }

    const ids = selectedIdsOnPage(selectedIds, pageIds);
    if (ids.length === 0) {
      setIsBulkOpen(false);
      return;
    }

    setBulkError(null);
    setIsBulkSubmitting(true);

    try {
      await approveSelected({ businessIds: ids as Id<'businesses'>[] });
      // Success: the reactive query removes the rows; clear selection after commit.
      setIsBulkOpen(false);
      setSelectedIds(new Set());
    } catch (submitError) {
      // All-or-nothing: preserve the selection so the admin can refresh and retry.
      setBulkError(
        messageFromError(
          submitError,
          'Could not approve the selected listings. Refresh the queue and try again.'
        )
      );
    } finally {
      setIsBulkSubmitting(false);
    }
  }

  return (
    <>
      <ApprovalQueue
        state={queueStateFor(result === undefined ? undefined : result.page)}
        cards={cards}
        now={now}
        onAction={openDecision}
        onViewDetails={setDetailsTarget}
        filters={filters}
        categories={categoryOptions}
        onFiltersChange={changeFilters}
        selection={{
          selectedIds,
          state,
          onToggleAll: (checked) =>
            setSelectedIds((current) => toggleAllSelected(current, pageIds, checked)),
          onToggleOne: (id, checked) =>
            setSelectedIds((current) => toggleSelected(current, id, checked)),
        }}
        bulkActions={
          selectedOnPageCount > 0 ? (
            <ApprovalBulkBar
              count={selectedOnPageCount}
              disabled={isBulkSubmitting}
              onApprove={openBulk}
            />
          ) : null
        }
        pagination={{
          hasPrevious: cursorStack.length > 0,
          hasNext: plan.next !== null,
          pageStatus: result?.pageStatus ?? null,
          onPrevious: goPrevious,
          onNext: goNext,
        }}
      />
      {decision === null ? null : (
        <ApprovalActionDialog
          key={`${decision.card._id}:${decision.action}`}
          card={decision.card}
          action={decision.action}
          isSubmitting={isSubmitting}
          error={actionError}
          onCancel={closeDecision}
          onConfirm={confirmDecision}
        />
      )}
      <ApprovalDetailsPanel
        target={detailsTarget}
        details={details}
        onClose={() => setDetailsTarget(null)}
      />
      <ApprovalBulkDialog
        open={isBulkOpen && selectedOnPageCount > 0}
        count={selectedOnPageCount}
        isSubmitting={isBulkSubmitting}
        error={bulkError}
        onCancel={closeBulk}
        onConfirm={confirmBulkApprove}
      />
    </>
  );
}
