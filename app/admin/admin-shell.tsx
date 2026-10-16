'use client';

import { NotificationMenu } from '@/components/notifications/notification-menu';

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border bg-card flex h-14 items-center justify-between px-4 border-b">
        <span className="font-display font-bold">Admin Portal</span>
        <NotificationMenu />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
