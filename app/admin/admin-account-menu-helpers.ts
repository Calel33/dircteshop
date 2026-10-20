/**
 * Pure identity derivation for the admin account menu (PR #69 / T5).
 *
 * Kept free of Clerk and React so `node --test` can pin the fallback order;
 * the component passes Clerk's `user` here, which satisfies this structural
 * shape. The terminal labels are the menu's own (`'Super Admin'`, `'Signed in'`,
 * `'A'`) and are deliberately different from `convex/userName.ts`'s stored-user
 * policy (`'Unknown user'`) — see `scripts/user-name.test.ts` for that chain.
 */
export type AccountUser =
  | {
      fullName?: string | null;
      username?: string | null;
      primaryEmailAddress?: { emailAddress: string } | null;
    }
  | null
  | undefined;

export function initials(name: string | null | undefined): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : '';
  const value = last ? `${first.charAt(0)}${last.charAt(0)}` : first.slice(0, 2);
  return value.toUpperCase() || 'A';
}

export function accountName(user: AccountUser): string {
  return user?.fullName ?? user?.username ?? 'Super Admin';
}

export function accountEmail(user: AccountUser): string {
  return user?.primaryEmailAddress?.emailAddress ?? 'Signed in';
}

export function accountInitials(user: AccountUser): string {
  return initials(user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress);
}
