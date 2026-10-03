'use client';

import { cx, navItemClass, navTileClass } from '@yayatoh/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** A staff console sidebar row (ADR 0022); active follows the path, with aria-current. */
export function NavLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const active =
    href === '/' ? pathname === '/' || pathname.startsWith('/tenants') : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(navItemClass(active), 'shrink-0 max-lg:min-h-10 max-lg:pe-3')}
    >
      <span className={cx(navTileClass(active), 'max-lg:size-7 max-lg:rounded-[9px]')}>{icon}</span>
      <span className="whitespace-nowrap">{children}</span>
    </Link>
  );
}
