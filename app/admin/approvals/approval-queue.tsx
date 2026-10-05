'use client';

import { ApprovalQueueCard } from './approval-card';
import { ApprovalQueueEmpty, ApprovalQueueError, ApprovalQueueLoading } from './approval-states';
import type { ApprovalQueueProps } from './approval-types';

/**
 * Presentational `/admin/approvals` queue (issue #13 / B3b todo #4 + #5). Every
 * state is driven by props; the route shell supplies the live Convex queue. Card
 * decisions are surfaced through `onAction`, which the route handles with the
 * confirmation/reason modal. Includes a visible page heading so the route has a
 * single accessible document outline.
 */
export function ApprovalQueue({
  state,
  cards,
  errorMessage,
  onRetry,
  onAction,
  now,
}: ApprovalQueueProps) {
  return (
    <section aria-labelledby="approvals-heading" className="flex flex-col gap-gap">
      <header className="flex flex-col gap-1">
        <h1 id="approvals-heading" className="font-display text-2xl font-semibold">
          Pending approvals
        </h1>
        <p className="text-muted-foreground text-sm">
          Review each submitted business. Approve to publish it, or request changes with a reason.
        </p>
      </header>
      {state === 'loading' ? (
        <ApprovalQueueLoading />
      ) : state === 'error' ? (
        <ApprovalQueueError message={errorMessage} onRetry={onRetry} />
      ) : state === 'ready' && cards.length > 0 ? (
        <ul className="grid grid-cols-1 gap-gap lg:grid-cols-2">
          {cards.map((card) => (
            <li key={card._id}>
              <ApprovalQueueCard card={card} now={now} onAction={onAction} />
            </li>
          ))}
        </ul>
      ) : (
        <ApprovalQueueEmpty />
      )}
    </section>
  );
}
