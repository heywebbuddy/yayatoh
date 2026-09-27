'use client';

import { navItemClass } from '@yayatoh/ui';
import type { ReactNode } from 'react';
import { Link, usePathname } from '@/i18n/navigation.ts';

/** A sidebar link whose active state (zinc-100 pill + aria-current) follows the current path. */
export function SidebarLink({
  href,
  exact = false,
  children,
}: {
  href: string;
  exact?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={navItemClass(active)} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
}
