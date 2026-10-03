'use client';

import { SignInButton, SignUpButton } from '@clerk/nextjs';
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { OwnerBusinesses } from './owner-businesses';

/**
 * `/owner` hub shell. `/owner` is not middleware-protected, so the signed-out
 * branch renders the existing Clerk sign-in flow inline (the same modal pattern
 * as the landing header) instead of redirecting.
 */
export function OwnerHome() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-gap px-4 py-8 sm:px-6 lg:px-8">
      <AuthLoading>
        <OwnerHomeSkeleton />
      </AuthLoading>
      <Unauthenticated>
        <SignedOutCard />
      </Unauthenticated>
      <Authenticated>
        <OwnerBusinesses />
      </Authenticated>
    </main>
  );
}

function SignedOutCard() {
  return (
    <Card className="mx-auto mt-section w-full max-w-md rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-xl">Owner workspace</CardTitle>
        <CardDescription>Sign in to create and manage your business listings.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        <SignInButton mode="modal">
          <Button className="w-full sm:w-auto">Sign in</Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button variant="outline" className="w-full sm:w-auto">
            Create an account
          </Button>
        </SignUpButton>
      </CardContent>
    </Card>
  );
}

function OwnerHomeSkeleton() {
  return (
    <div className="flex flex-col gap-gap" aria-busy="true" aria-label="Loading the owner workspace">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-gap sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-card" />
        ))}
      </div>
    </div>
  );
}
