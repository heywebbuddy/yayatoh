'use client';

import { cx, navItemClass, navTileClass } from '@yayatoh/ui';
import type { ReactNode } from 'react';
import { Link, usePathname } from '@/i18n/navigation.ts';

/**
 * A sidebar row (ADR 0022): icon tile, label and an optional count. The active row (the lighter
 * band, white icon tile, aria-current) follows the current path.
 */
export function SidebarLink({
  href,
  exact = false,
  icon,
  badge,
  children,
}: {
  href: string;
  exact?: boolean;
  icon: ReactNode;
  badge?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={navItemClass(active)} aria-current={active ? 'page' : undefined}>
      <span className={navTileClass(active)}>{icon}</span>
      <span className="grow truncate">{children}</span>
      {badge ? (
        <span
          className={cx(
            'inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-[7px] px-1.5 text-caption font-extrabold tabular-nums',
            active ? 'bg-white text-black' : 'bg-white/10 text-side-strong',
          )}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
