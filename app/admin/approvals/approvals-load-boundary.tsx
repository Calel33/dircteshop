'use client';

import { Component, Fragment, type ReactNode } from 'react';

import { ApprovalQueue } from './approval-queue';

interface ApprovalsLoadBoundaryProps {
  /** Reference clock forwarded to the error state's queue shell. */
  now: number;
  children: ReactNode;
}

interface ApprovalsLoadBoundaryState {
  hasError: boolean;
  /** Bumping this remounts the subtree so a retry re-runs the query. */
  resetKey: number;
}

/**
 * Catches render-time failures in the connected approvals queue
 * (issue #13 / B3b todo #5): `useQuery` throws during render when the
 * `listPendingApprovals` function returns an error (e.g. a revoked Super Admin).
 * Rendering the error state through {@link ApprovalQueue} keeps the page heading
 * and the actionable `onRetry` affordance. Mirrors the owner editor's
 * `EditorLoadBoundary` pattern; the retry remounts the subtree so the live query
 * is re-subscribed instead of replaying the cached error.
 */
export class ApprovalsLoadBoundary extends Component<
  ApprovalsLoadBoundaryProps,
  ApprovalsLoadBoundaryState
> {
  state: ApprovalsLoadBoundaryState = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<ApprovalsLoadBoundaryState> {
    return { hasError: true };
  }

  reset = () => {
    this.setState((previous) => ({ hasError: false, resetKey: previous.resetKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return <ApprovalQueue state="error" cards={[]} now={this.props.now} onRetry={this.reset} />;
    }

    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}
