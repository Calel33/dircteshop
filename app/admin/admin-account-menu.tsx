'use client';

import { useState } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import { Loader2, LogOut } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { accountEmail, accountInitials, accountName } from './admin-account-menu-helpers';

function AccountIdentity({ name, email }: { name: string; email: string }) {
  return (
    <DropdownMenuLabel className="font-normal">
      <span className="block truncate text-sm font-medium">{name}</span>
      <span className="text-muted-foreground block truncate text-xs">{email}</span>
    </DropdownMenuLabel>
  );
}

function SignOutLabel({ isSigningOut }: { isSigningOut: boolean }) {
  return (
    <>
      {isSigningOut ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <LogOut className="size-4" aria-hidden="true" />
      )}
      {/* Mounted before the text changes, so the pending state is announced even
          though the disabled menu item may no longer hold focus. */}
      <span aria-live="polite">{isSigningOut ? 'Signing out…' : 'Sign out'}</span>
    </>
  );
}

/**
 * Account menu for the admin command bar. Sign-out is a Clerk client action:
 * it ends the session, which makes `useAuth` report signed-out and lets
 * `ConvexProviderWithClerk` stop sending the Convex token. The existing
 * middleware and `requireSuperAdmin` guards remain the authorization boundary.
 */
export function AdminAccountMenu() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    setError(null);

    try {
      await signOut({ redirectUrl: '/' });
    } catch {
      setError('Could not sign out. Try again.');
      setIsSigningOut(false);
    }
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setError(null);
      }}
    >
      <div className="flex items-center">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="bg-brand-soft text-brand-strong border-brand-border grid size-8 cursor-pointer place-items-center rounded-full border text-xs font-bold outline-none transition-colors hover:border-brand-strong focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            {accountInitials(user)}
          </button>
        </DropdownMenuTrigger>

        {/* Outside DropdownMenuContent: Radix renders that content as role="menu",
            which only accepts menu items, groups, and separators. Fixed so the
            portalled menu cannot cover the alert while it stays open. */}
        {error ? (
          <p
            role="alert"
            className="bg-card border-border text-destructive fixed right-4 bottom-4 z-50 w-64 rounded-menu border px-3 py-2 text-xs shadow-md"
          >
            {error}
          </p>
        ) : null}
      </div>

      <DropdownMenuContent align="end" className="w-56">
        <AccountIdentity name={accountName(user)} email={accountEmail(user)} />

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={isSigningOut}
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
        >
          <SignOutLabel isSigningOut={isSigningOut} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
