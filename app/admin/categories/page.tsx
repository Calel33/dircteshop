'use client';

import { Component, Fragment, useState, type ReactNode } from 'react';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { CategoriesRoute, type CategoryActionResult } from './categories-route';
import { Button } from '@/components/ui/button';

/** Normalises a thrown mutation error into a user-facing message. */
function messageFromError(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data;
    if (typeof data === 'string') {
      return data;
    }
    if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') {
      return data.message;
    }
  }
  return error instanceof Error ? error.message : fallback;
}

interface CategoriesLoadBoundaryProps {
  children: ReactNode;
}

interface CategoriesLoadBoundaryState {
  hasError: boolean;
  /** Bumping this remounts the subtree so a retry re-runs the query. */
  resetKey: number;
}

/**
 * Catches render-time failures in the connected category manager (same
 * minimal class pattern as `DirectoryLoadBoundary`): `useQuery` throws during
 * render when a guarded Convex function returns an error (e.g. a revoked
 * Super Admin), and the retry remounts the subtree so the live query is
 * re-subscribed instead of replaying the cached error.
 */
class CategoriesLoadBoundary extends Component<CategoriesLoadBoundaryProps, CategoriesLoadBoundaryState> {
  state: CategoriesLoadBoundaryState = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<CategoriesLoadBoundaryState> {
    return { hasError: true };
  }

  reset = () => {
    this.setState((previous) => ({ hasError: false, resetKey: previous.resetKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 space-y-3">
          <div role="alert" className="text-destructive">
            Could not load the category manager. An admin session may be required.
          </div>
          <Button variant="outline" onClick={this.reset}>
            Retry
          </Button>
        </div>
      );
    }

    return <Fragment key={this.state.resetKey}>{this.props.children}</Fragment>;
  }
}

/**
 * Connected `/admin/categories` route (issue #16, Task 5). Owns the live
 * Convex wiring: the guarded `listAdminCategories` read (display order plus
 * each category's referencing-business count), and every write routed to its
 * guarded mutation. Each handler resolves to a result object so the
 * presentation can keep its inline panel open with the server's message on a
 * rejection. The delete guard itself is server-side — this page only presents
 * the count; a blocked delete is enforced by `deleteCategory`.
 */
export default function CategoriesPage() {
  return (
    <CategoriesLoadBoundary>
      <CategoriesPageContent />
    </CategoriesLoadBoundary>
  );
}

function CategoriesPageContent() {
  const { isAuthenticated } = useConvexAuth();
  const result = useQuery(api.categories.listAdminCategories, isAuthenticated ? {} : 'skip');

  const createCategory = useMutation(api.categories.createCategory);
  const updateCategory = useMutation(api.categories.updateCategory);
  const deleteCategory = useMutation(api.categories.deleteCategory);
  const reorderCategories = useMutation(api.categories.reorderCategories);

  const [isPending, setIsPending] = useState(false);

  /** Runs one guarded mutation behind the shared pending flag. */
  async function run(action: () => Promise<unknown>): Promise<CategoryActionResult> {
    setIsPending(true);
    try {
      await action();
    } catch (e) {
      setIsPending(false);
      return { ok: false, error: messageFromError(e, 'Category action failed') };
    }
    setIsPending(false);
    return { ok: true };
  }

  return (
    <CategoriesRoute
      categories={result ?? []}
      loading={result === undefined}
      isPending={isPending}
      onAdd={(name) => run(() => createCategory({ name }))}
      onUpdate={(categoryId, values) => run(() => updateCategory({ categoryId, ...values }))}
      onDelete={(categoryId) => run(() => deleteCategory({ categoryId }))}
      onReorder={(orderedIds: Id<'categories'>[]) => run(() => reorderCategories({ orderedIds }))}
    />
  );
}
