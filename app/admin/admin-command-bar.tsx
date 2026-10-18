'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function AdminCommandBar() {
  const pathname = usePathname();
  const router = useRouter();

  const items = [
    { label: 'Overview', href: '/admin' },
    { label: 'Approvals', href: '/admin/approvals' },
    { label: 'Directory', href: '/admin/directory' },
    { label: 'Owners', href: '/admin/owners' },
    { label: 'Categories', href: '/admin/categories' },
    { label: 'Audit', href: '/admin/audit' },
    { label: 'Flagged', href: '/admin/flagged' },
    { label: 'Analytics', href: '/admin/analytics' },
    { label: 'Settings', href: '/admin/settings' },
  ];

  return (
    <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Admin navigation">
      {items.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Button
            key={item.label}
            variant={isActive ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => router.push(item.href)}
            className={isActive ? 'font-semibold' : 'text-muted-foreground'}
            aria-current={isActive ? 'page' : undefined}
          >
            {item.label}
          </Button>
        );
      })}
    </nav>
  );
}
