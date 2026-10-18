'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { NotificationMenu } from '@/components/notifications/notification-menu';
import { cn } from '@/lib/utils';
import { exportBusinessesCsv } from '@/app/admin/export-actions';

/** The prototype's five command-deck tabs, in order. */
const TABS = [
  { label: 'Overview', href: '/admin' },
  { label: 'Directory', href: '/admin/directory' },
  { label: 'Owners', href: '/admin/owners' },
  { label: 'Audit', href: '/admin/audit' },
  { label: 'Categories', href: '/admin/categories' },
] as const;

/**
 * Routes that exist but have no prototype surface. Variant A renders these as
 * muted `.side-stub` lines rather than tabs, so the deck keeps exactly five
 * tabs while every route stays reachable.
 */
const STUBS = [
  { label: 'Approvals', href: '/admin/approvals' },
  { label: 'Flagged Content', href: '/admin/flagged' },
  { label: 'Analytics', href: '/admin/analytics' },
  { label: 'Settings', href: '/admin/settings' },
] as const;

/**
 * The prototype's `.cmdbar` (Variant B): brand block, five tabs, a spacer, the
 * audited CSV export, and the admin avatar. The header is chrome only — it
 * reads the pathname and calls the existing export Server Action; no page
 * state crosses into it.
 */
export function AdminCommandBar() {
  const pathname = usePathname();
  const [exportState, setExportState] = useState<{
    isPending: boolean;
    error: string | null;
    status: string | null;
  }>({ isPending: false, error: null, status: null });

  // The Server Action returns the serialized CSV (it cannot set
  // Content-Disposition), so the download is triggered here with a Blob and an
  // object URL. One export at a time: the button disables while pending.
  const handleExport = async () => {
    setExportState({ isPending: true, error: null, status: null });
    try {
      const result = await exportBusinessesCsv();
      if (!result.ok) {
        setExportState({ isPending: false, error: result.error, status: null });
        return;
      }

      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);

      setExportState({
        isPending: false,
        error: null,
        status: `Exported ${result.rowCount} ${result.rowCount === 1 ? 'row' : 'rows'} → ${
          result.fileName
        }`,
      });
    } catch {
      setExportState({ isPending: false, error: 'The export failed. Try again.', status: null });
    }
  };

  return (
    <header className="bg-card border-border border-b">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-input text-micro font-bold">
            LH
          </span>
          <span className="block leading-tight">
            <b className="block text-sm font-bold">Command Deck</b>
            <small className="text-muted-foreground block font-mono text-micro">
              localhub admin
            </small>
          </span>
        </div>

        <nav className="flex gap-1" aria-label="Admin sections">
          {TABS.map((tab) => {
            const isActive = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'rounded-menu px-3 py-1 text-tiny transition-colors',
                  isActive
                    ? 'bg-brand-soft text-brand-strong font-semibold'
                    : 'text-muted-foreground hover:bg-panel hover:text-foreground'
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <span className="bg-border h-4 w-px" aria-hidden="true" />

        <nav className="flex flex-wrap items-center gap-3" aria-label="Admin stubs">
          {STUBS.map((stub) => {
            const isActive = pathname === stub.href;
            return (
              <Link
                key={stub.href}
                href={stub.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'text-tiny transition-colors hover:text-foreground',
                  isActive ? 'text-foreground font-semibold' : 'text-muted-foreground'
                )}
              >
                {stub.label}
              </Link>
            );
          })}
        </nav>

        <span className="flex-1" />

        {/* The prototype has no notification surface; the app's existing menu
            is kept on the chrome rather than dropped (PRESERVE rule). */}
        <NotificationMenu />
        <Button
          variant="outline"
          size="sm"
          className="rounded-menu"
          onClick={handleExport}
          disabled={exportState.isPending}
        >
          {exportState.isPending ? 'Exporting…' : 'Export CSV'}
        </Button>
        <span
          className="bg-brand-soft text-brand-strong border-brand-border grid size-8 place-items-center rounded-full border text-xs font-bold"
          aria-label="Signed in as a Super Admin"
        >
          CA
        </span>
      </div>

      {exportState.error === null ? null : (
        <p role="alert" className="text-destructive px-4 pb-3 text-tiny">
          {exportState.error}
        </p>
      )}
      {exportState.status === null ? null : (
        <p
          role="status"
          className="bg-foreground text-background mx-4 mb-3 rounded-menu px-3 py-2 font-mono text-xs"
        >
          {exportState.status}
        </p>
      )}
    </header>
  );
}
