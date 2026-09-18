import { auth } from '@clerk/nextjs/server';
import { fetchQuery } from 'convex/nextjs';
import { notFound } from 'next/navigation';
import { api } from '@/convex/_generated/api';

/**
 * Cosmetic 404 gate. Authorization is enforced server-side in Convex
 * (`requireSuperAdmin`); this layout only minimizes disclosure for the UI.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { getToken } = await auth();

  // Prefer the `convex` JWT template; fall back to the default session token,
  // which Convex also accepts when the Clerk integration sets aud=convex.
  const token =
    (await getToken({ template: 'convex' }).catch(() => null)) ?? (await getToken());

  if (!token) {
    notFound();
  }

  const isSuperAdmin = await fetchQuery(api.users.isSuperAdmin, {}, { token }).catch(
    () => false,
  );

  if (!isSuperAdmin) {
    notFound();
  }

  return <>{children}</>;
}
