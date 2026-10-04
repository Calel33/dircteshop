'use client';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { ApprovalActionDialog } from './approval-action-dialog';
import { normalizeReason, type ApprovalAction } from './approval-actions-policy';
import { ApprovalQueue } from './approval-queue';
import { ApprovalsLoadBoundary } from './approvals-load-boundary';
import type { ApprovalCard, ApprovalQueueState } from './approval-types';

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
 * Route shell for `/admin/approvals` (issue #13 / B3b todo #4 + #5). It owns the
 * presentational queue state, the live Convex queue/mutation wiring, and the
 * per-card confirmation/reason modal. The clock is captured once per mount so
 * age and priority stay stable across renders and match on server and client.
 *
 * `listPendingApprovals` is the frozen Super Admin projection (todo #2);
 * `moderateListing` is the atomic decision + audit mutation (todo #3). Success
 * closes the modal and relies on the reactive query to remove the card, so a
 * decision is never reflected as success before the server commits.
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
  const cards = useQuery(api.businesses.queries.listPendingApprovals);
  const moderateListing = useMutation(api.businesses.mutations.moderateListing);

  const [decision, setDecision] = useState<{ card: ApprovalCard; action: ApprovalAction } | null>(
    null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  return (
    <>
      <ApprovalQueue
        state={queueStateFor(cards)}
        cards={cards ?? []}
        now={now}
        onAction={openDecision}
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
    </>
  );
}
