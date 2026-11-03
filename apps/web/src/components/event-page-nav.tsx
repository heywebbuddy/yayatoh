'use client';

import { cx } from '@yayatoh/ui';
import { useEffect, useRef, useState } from 'react';

export type EventNavItem = { id: string; label: string };

/** A sticky block (the pass sidebar) stays in the reading band, so it must not outrank the page's sections. */
const insideSticky = (el: HTMLElement) => {
  for (let n: HTMLElement | null = el; n && n.tagName !== 'MAIN'; n = n.parentElement) {
    if (getComputedStyle(n).position === 'sticky') return true;
  }
  return false;
};

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The event page's section menu: one link per section the page actually has. A click scrolls
 * smoothly to the section (instantly with reduced motion); the section in view is highlighted
 * (`aria-current`) as the visitor scrolls. On narrow screens the row scrolls sideways and keeps the
 * current link in view.
 */
export function EventPageNav({ items, label }: { items: readonly EventNavItem[]; label: string }) {
  const [active, setActive] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const els = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        // The highest section in the reading band wins (page order, not observer order).
        const inBand = items.filter((i) => visible.has(i.id));
        const first =
          inBand.find((i) => {
            const el = document.getElementById(i.id);
            return el !== null && !insideSticky(el);
          }) ?? inBand[0];
        if (first) setActive(first.id);
      },
      // The band just below the sticky bar: a section is "current" once its top passes it.
      { rootMargin: '-150px 0px -55% 0px', threshold: 0 },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, [items]);

  useEffect(() => {
    if (!active || !listRef.current) return;
    const link = listRef.current.querySelector<HTMLElement>(`[data-target="${active}"]`);
    link?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  }, [active]);

  return (
    <nav aria-label={label} className="min-w-0 grow">
      <ul
        ref={listRef}
        className="ev-nav-scroll ev-nav-fade m-0 flex list-none gap-1 overflow-x-auto p-0 [scrollbar-width:none]"
      >
        {items.map((i) => (
          <li key={i.id} className="shrink-0">
            <a
              href={`#${i.id}`}
              data-target={i.id}
              aria-current={active === i.id ? 'location' : undefined}
              onClick={(e) => {
                const el = document.getElementById(i.id);
                if (!el) return;
                e.preventDefault();
                el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
                history.replaceState(null, '', `#${i.id}`);
                setActive(i.id);
                // Move focus for keyboard and screen-reader users without a second scroll.
                if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
                el.focus({ preventScroll: true });
              }}
              className={cx(
                'inline-flex min-h-10 items-center rounded-pill px-3.5 text-body font-bold whitespace-nowrap transition-colors motion-reduce:transition-none',
                active === i.id
                  ? 'bg-[var(--ev-accent,var(--color-primary))] text-[var(--ev-on-accent,var(--color-on-primary))]'
                  : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
              )}
            >
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
