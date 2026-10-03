'use client';

import { Authenticated, AuthLoading, Unauthenticated, useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

import { looksLikeConvexId } from './convex-id';
import { EditorLoadBoundary } from './editor-load-boundary';
import { EditorShell } from './editor-shell';
import { EditorLoading, EditorNotFound, EditorSignedOutCard } from './editor-states';

/**
 * `/owner/business/[id]` route shell. `/owner` is not middleware-protected, so
 * signed-out visitors get the hub's inline Clerk sign-in pattern rather than a
 * redirect. Ownership itself is enforced server-side by `businesses.getMine`.
 */
export function OwnerEditor({ businessId }: { businessId: string }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-gap px-4 py-8 sm:px-6 lg:px-8">
      <AuthLoading>
        <EditorLoading />
      </AuthLoading>
      <Unauthenticated>
        <EditorSignedOutCard />
      </Unauthenticated>
      <Authenticated>
        <EditorLoadBoundary key={businessId}>
          <OwnedBusinessEditor businessId={businessId} />
        </EditorLoadBoundary>
      </Authenticated>
    </main>
  );
}

/**
 * Loads the owned editor document. The id is only passed to Convex when it has
 * the shape of a document id, so a malformed URL segment renders the not-found
 * state instead of throwing an argument-validation error. `null` — anonymous,
 * missing, or foreign-owned — renders the same not-found state.
 */
function OwnedBusinessEditor({ businessId }: { businessId: string }) {
  const validId = looksLikeConvexId(businessId);
  const business = useQuery(
    api.businesses.queries.getMine,
    validId ? { businessId: businessId as Id<'businesses'> } : 'skip'
  );

  if (!validId || business === null) {
    return <EditorNotFound />;
  }

  if (business === undefined) {
    return <EditorLoading />;
  }

  return <EditorShell business={business} />;
}
