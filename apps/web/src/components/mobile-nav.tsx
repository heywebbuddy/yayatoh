'use client';

import { cx, iconButtonClass } from '@yayatoh/ui';
import { Menu, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { usePathname } from '@/i18n/navigation.ts';

/**
 * Below 1024 px the sidebar is a drawer (ADR 0022). It is a <details> so it works before
 * hydration; once hydrated it closes on navigation, on Esc and on a tap outside. While it is open
 * the page behind it stays still (QA #24), and the shell lifts its header above the page.
 */
export function MobileNav({
  openLabel,
  closeLabel,
  children,
}: {
  openLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const was = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = was;
    };
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = ref.current;
      if (e.key === 'Escape' && d?.open) {
        d.open = false;
        d.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <details
      ref={ref}
      data-mobile-nav=""
      className="group lg:hidden"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className={cx(iconButtonClass('secondary', 'md'), 'list-none [&::-webkit-details-marker]:hidden')}
      >
        <Menu aria-hidden="true" className="group-open:hidden" strokeWidth={2} />
        <X aria-hidden="true" className="hidden group-open:block" strokeWidth={2} />
        <span className="sr-only group-open:hidden">{openLabel}</span>
        <span className="sr-only hidden group-open:inline">{closeLabel}</span>
      </summary>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="fixed inset-0 z-40 cursor-default bg-scrim"
        onClick={() => {
          if (ref.current) ref.current.open = false;
        }}
      />
      {children}
    </details>
  );
}
