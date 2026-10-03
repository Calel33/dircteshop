'use client';

import { SignInButton, SignUpButton } from '@clerk/nextjs';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Route loading state while Convex resolves identity and the owned document. */
export function EditorLoading() {
  return (
    <div className="flex flex-col gap-gap" aria-busy="true" aria-label="Loading the editor">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-gap lg:grid-cols-[1fr_3fr]">
        <Skeleton className="h-64 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    </div>
  );
}

/**
 * Signed-out branch for `/owner/business/[id]`. `/owner` is not
 * middleware-protected, so the hub's inline Clerk sign-in pattern is reused
 * here instead of redirecting.
 */
export function EditorSignedOutCard() {
  return (
    <Card className="mx-auto mt-section w-full max-w-md rounded-card py-card">
      <CardHeader>
        <CardTitle className="font-display text-xl">Business editor</CardTitle>
        <CardDescription>Sign in to edit and manage your business listings.</CardDescription>
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

/**
 * One not-found shape for malformed, missing, and foreign-owned ids. The copy
 * deliberately does not say whether the id exists, so opening another owner's
 * listing leaks nothing.
 */
export function EditorNotFound() {
  return (
    <Card className="mx-auto mt-section w-full max-w-md rounded-card py-card text-center">
      <CardHeader>
        <CardTitle className="font-display text-xl">Listing not available</CardTitle>
        <CardDescription>
          This listing could not be opened. It may not exist, or your account may not own it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href="/owner">Back to your businesses</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
