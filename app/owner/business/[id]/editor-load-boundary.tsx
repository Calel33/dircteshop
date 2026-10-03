'use client';

import { Component, type ReactNode } from 'react';

import { EditorNotFound } from './editor-states';

interface EditorLoadBoundaryProps {
  children: ReactNode;
}

interface EditorLoadBoundaryState {
  hasError: boolean;
}

/**
 * Catches a `getMine` argument-validation failure and renders the same
 * not-found state as a missing or foreign-owned listing. `useQuery` throws
 * during render when a Convex function returns an error, so a React error
 * boundary is the mechanism for catching it.
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

  render() {
    if (this.state.hasError) {
      return <EditorNotFound />;
    }

    return this.props.children;
  }
}
