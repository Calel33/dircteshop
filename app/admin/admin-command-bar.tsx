'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function AdminCommandBar() {
  const pathname = usePathname();
  const router = useRouter();

  const items = [
    { label: 'Overview', href: '/admin' },
    { label: 'Directory', href: '/admin/directory' },
    { label: 'Audit', href: '/admin/audit' },
    { label: 'Owners', href: '#', disabled: true },
    { label: 'Categories', href: '#', disabled: true },
  ];

  return (
    <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Admin navigation">
      {items.map((item) => (
        <Button
          key={item.label}
          variant={pathname === item.href ? 'default' : 'ghost'}
          size="sm"
          disabled={item.disabled}
          onClick={() => !item.disabled && router.push(item.href)}
          className={pathname === item.href ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}
          title={item.disabled ? 'Coming in B6b' : undefined}
          aria-current={pathname === item.href ? 'page' : undefined}
        >
          {item.label}
        </Button>
      ))}
    </nav>
  );
}
