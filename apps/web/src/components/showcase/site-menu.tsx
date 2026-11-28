'use client';

import { Menu, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { usePathname } from '@/i18n/navigation.ts';

/**
 * The small-screen menu of the public site (under 1280 px). Like the console's `MobileNav` it is
 * a <details>, so it works before hydration, and its button turns into a close (X) button while
 * it is open. Once hydrated the page behind stays still while it is open, and it closes on
 * navigation, on Esc and on a tap outside. The panel itself scrolls when it is taller than the
 * screen.
 */
export function SiteMenu({
  openLabel,
  closeLabel,
  children,
}: {
  openLabel: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    // The page behind an open menu stays still (as behind the full-screen seat picker).
    const html = document.documentElement;
    const was = html.style.overflow;
    html.style.overflow = 'hidden';
    const close = () => {
      if (ref.current) ref.current.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      ref.current?.querySelector('summary')?.focus();
    };
    // A tap outside only closes the menu (it doesn't also follow a link behind it); a link in the
    // menu closes it too, even one to the page already open.
    const onClick = (e: MouseEvent) => {
      const d = ref.current;
      if (!d) return;
      if (!d.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if ((e.target as Element).closest('a')) close();
    };
    // Widened past the breakpoint, the menu is hidden: don't leave the page locked behind it.
    const wide = window.matchMedia('(min-width: 80rem)');
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick, true);
    wide.addEventListener('change', close);
    return () => {
      html.style.overflow = was;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick, true);
      wide.removeEventListener('change', close);
    };
  }, [open]);
  return (
    <details
      ref={ref}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group/menu relative xl:hidden"
    >
      <summary className="inline-flex size-10 cursor-pointer list-none items-center justify-center rounded-pill border border-line bg-surface [&::-webkit-details-marker]:hidden">
        <Menu aria-hidden="true" className="size-5 group-open/menu:hidden" />
        <X aria-hidden="true" className="hidden size-5 group-open/menu:block" />
        <span className="sr-only group-open/menu:hidden">{openLabel}</span>
        <span className="sr-only hidden group-open/menu:inline">{closeLabel}</span>
      </summary>
      {children}
    </details>
  );
}
