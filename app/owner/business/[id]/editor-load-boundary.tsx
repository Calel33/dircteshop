'use client';

import { Component, type ReactNode } from 'react';

import { EditorErrorState } from './editor-states';

interface EditorLoadBoundaryProps {
  children: ReactNode;
}

interface EditorLoadBoundaryState {
  hasError: boolean;
}

/**
 * Catches render-time failures in the editor subtree — most notably a `getMine`
 * argument-validation failure, since `useQuery` throws during render when a
 * Convex function returns an error. Renders `EditorErrorState`, which is
 * distinct from the not-found/no-access copy and lets the user retry, so a bug
 * is not misreported as a missing or foreign-owned listing.
 *
 * The client id guard (`looksLikeConvexId`) rejects most malformed params
 * before the query runs; this boundary covers the residual case of a
 * structurally plausible but non-canonical id.
 */
export class EditorLoadBoundary extends Component<EditorLoadBoundaryProps, EditorLoadBoundaryState> {
  state: EditorLoadBoundaryState = { hasError: false };

  static getDerivedStateFromError(): EditorLoadBoundaryState {
    return { hasError: true };
  }

  reset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return <EditorErrorState onRetry={this.reset} />;
    }

    return this.props.children;
  }
}
