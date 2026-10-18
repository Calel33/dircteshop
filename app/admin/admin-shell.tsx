import { AdminCommandBar } from './admin-command-bar';

/**
 * Admin chrome (prototype `.cmdbar` + page canvas). The command bar owns the
 * brand block, the five deck tabs, CSV export, notifications and the avatar;
 * each route renders its own content beneath it.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-screen flex-col">
      <AdminCommandBar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
