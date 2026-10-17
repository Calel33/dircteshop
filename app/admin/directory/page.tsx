'use client';

import { Component, Fragment, useEffect, useState, type ReactNode } from 'react';
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { DirectoryRoute } from '@/app/admin/directory/directory-route';
import { type DirectoryFilters } from '@/app/admin/directory/directory-types';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';

/** Normalises a thrown mutation/action error into a user-facing message. */
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

interface DirectoryLoadBoundaryProps {
  children: ReactNode;
}

interface DirectoryLoadBoundaryState {
  hasError: boolean;
  /** Bumping this remounts the subtree so a retry re-runs the query. */
  resetKey: number;
}

/**
 * Catches render-time failures in the connected directory (same minimal class
 * pattern as `ApprovalsLoadBoundary`): `useQuery` throws during render when a
 * guarded Convex function returns an error (e.g. a revoked Super Admin), and
 * the retry remounts the subtree so the live query is re-subscribed instead
 * of replaying the cached error.
 */
class DirectoryLoadBoundary extends Component<DirectoryLoadBoundaryProps, DirectoryLoadBoundaryState> {
  state: DirectoryLoadBoundaryState = { hasError: false, resetKey: 0 };

  static getDerivedStateFromError(): Partial<DirectoryLoadBoundaryState> {
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
            Could not load the directory. An admin session may be required.
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
 * Connected `/admin/directory` route (issue #15, Tasks 12-13). Owns the live
 * Convex wiring: the guarded `listAdminDirectory` cursor query (25 rows per
 * page, manual cursor stack because the server rejects `numItems > 25`), the
 * category options, the debounced search input, and every directory action
 * routed to its real mutation/action (`moderateListing`, `setFeatured`,
 * `hardDeleteBusiness`, `approveSelected`, `createDraftForOwner`).
 */
export default function DirectoryPage() {
  return (
    <DirectoryLoadBoundary>
      <DirectoryPageContent />
    </DirectoryLoadBoundary>
  );
}

function DirectoryPageContent() {
  const { isAuthenticated } = useConvexAuth();
  const [filters, setFilters] = useState<DirectoryFilters>({});
  const [searchInput, setSearchInput] = useState('');
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1];
  const isMobile = useIsMobile();

  const categories = useQuery(api.categories.listOrdered) ?? [];
  const result = useQuery(
    api.businesses.queries.listAdminDirectory,
    isAuthenticated
      ? {
          paginationOpts: { numItems: 25, cursor },
          categoryId: filters.categoryId as Id<'categories'> | undefined,
          status: filters.status,
          isVerified: filters.isVerified,
          isFeatured: filters.featuredOnly === true ? true : undefined,
          search: filters.search,
        }
      : 'skip'
  );

  const moderate = useMutation(api.businesses.mutations.moderateListing);
  const setFeatured = useMutation(api.businesses.adminMutations.setFeatured);
  const hardDelete = useMutation(api.businesses.adminMutations.hardDeleteBusiness);
  const approveSelected = useMutation(api.businesses.mutations.approveSelected);
  const createDraft = useAction(api.businesses.adminOwnerActions.createDraftForOwner);

  const [actionState, setActionState] = useState<{ isPending: boolean; error: string | null }>({
    isPending: false,
    error: null,
  });
  const [bulkState, setBulkState] = useState<{ isPending: boolean; error: string | null }>({
    isPending: false,
    error: null,
  });
  const [addState, setAddState] = useState<{ isPending: boolean; error: string | null }>({
    isPending: false,
    error: null,
  });

  // The input stays responsive (`searchInput`) while the query argument
  // follows 300ms after the last keystroke; applying a new term starts a fresh
  // traversal. Cleanup cancels the pending timer on unmount/next keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      const nextSearch = searchInput.trim() === '' ? undefined : searchInput;
      if (nextSearch !== filters.search) {
        setFilters((current) => ({ ...current, search: nextSearch }));
        setCursorStack([null]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, filters.search]);

  function handleFiltersChange(next: DirectoryFilters) {
    // The search text is debounced separately; only real filter changes apply
    // immediately and restart the cursor traversal.
    const nextSearch = next.search ?? '';
    if (nextSearch !== searchInput) {
      setSearchInput(nextSearch);
    }

    const changed =
      filters.categoryId !== next.categoryId ||
      filters.status !== next.status ||
      filters.isVerified !== next.isVerified ||
      filters.featuredOnly !== next.featuredOnly;
    if (!changed) {
      return;
    }

    setFilters((current) => ({
      ...current,
      categoryId: next.categoryId,
      status: next.status,
      isVerified: next.isVerified,
      featuredOnly: next.featuredOnly,
    }));
    setCursorStack([null]);
  }

  /**
   * Routes one inspector action to its real server function. Rejections
   * propagate so the awaiting inspector keeps the inline confirm open; the
   * message is surfaced through `actionState.error`.
   */
  async function handleAction(
    businessId: string,
    action: string,
    options?: { reason?: string; confirmName?: string }
  ) {
    setActionState({ isPending: true, error: null });
    try {
      switch (action) {
        case 'approve':
        case 'requestChanges':
        case 'reject':
        case 'suspend':
        case 'restore':
          await moderate({
            businessId: businessId as Id<'businesses'>,
            action,
            reason: options?.reason,
          });
          break;
        case 'feature': {
          const target = (result?.page ?? []).find((r) => r._id === businessId);
          await setFeatured({
            businessId: businessId as Id<'businesses'>,
            isFeatured: !(target?.isFeatured ?? false),
          });
          break;
        }
        case 'delete':
          await hardDelete({
            businessId: businessId as Id<'businesses'>,
            confirmName: options?.confirmName ?? '',
          });
          break;
        default:
          throw new Error('Unknown action: ' + action);
      }
    } catch (e) {
      setActionState({ isPending: false, error: messageFromError(e, 'Action failed') });
      throw e;
    }
    setActionState({ isPending: false, error: null });
  }

  async function handleBulkApprove(ids: string[]) {
    setBulkState({ isPending: true, error: null });
    try {
      await approveSelected({ businessIds: ids as Id<'businesses'>[] });
    } catch (e) {
      // All-or-nothing: the error surfaces via bulkState; selection is only
      // cleared by the rows-identity reset after a committed refresh.
      setBulkState({ isPending: false, error: messageFromError(e, 'Bulk approve failed') });
      return;
    }
    setBulkState({ isPending: false, error: null });
  }

  async function handleAdd(d: { name: string; categoryId: string; ownerEmail: string }) {
    setAddState({ isPending: true, error: null });
    try {
      await createDraft({ ...d, categoryId: d.categoryId as Id<'categories'> });
    } catch (e) {
      setAddState({ isPending: false, error: messageFromError(e, 'Create draft failed') });
      throw e;
    }
    setAddState({ isPending: false, error: null });
  }

  const splitNotice =
    result?.pageStatus === 'SplitRequired' || result?.pageStatus === 'SplitRecommended'
      ? 'The server split this page; continue with Next to see the remaining rows.'
      : null;

  return (
    <DirectoryRoute
      rows={result?.page ?? []}
      loading={result === undefined}
      error={null}
      filters={{ ...filters, search: searchInput }}
      onFiltersChange={handleFiltersChange}
      categories={categories.map((category) => ({ _id: category._id, name: category.name }))}
      canGoNext={result?.isDone === false}
      canGoPrevious={cursorStack.length > 1}
      onNext={() => {
        const page = result;
        if (page && !page.isDone) {
          setCursorStack([...cursorStack, page.continueCursor]);
        }
      }}
      onPrevious={() => {
        if (cursorStack.length > 1) {
          setCursorStack(cursorStack.slice(0, -1));
        }
      }}
      eligibleCount={result?.page.filter((r) => r.status === 'pendingReview').length ?? 0}
      onApproveSelected={handleBulkApprove}
      onSubmitAdd={handleAdd}
      addState={addState}
      actionState={actionState}
      bulkState={bulkState}
      onAction={handleAction}
      isMobile={isMobile}
      splitNotice={splitNotice}
    />
  );
}
