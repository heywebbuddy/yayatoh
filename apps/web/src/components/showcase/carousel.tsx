'use client';
import { cx } from '@yayatoh/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useRef } from 'react';
import { Link } from '@/i18n/navigation.ts';

/** A horizontally scrolling row that snaps to its items and hides its scrollbar. */
export function useScrollBy() {
  const ref = useRef<HTMLUListElement>(null);
  const by = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: (rtl ? -dir : dir) * el.clientWidth * 0.85, behavior: reduced ? 'auto' : 'smooth' });
  };
  return { ref, by };
}

/** The pill rows: scroll by touch, wheel or keyboard; no arrows. */
export function ScrollRow({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cx(
        'no-scrollbar m-0 flex list-none snap-x gap-3 overflow-x-auto scroll-smooth p-1 py-3',
        className,
      )}
    >
      {children}
    </ul>
  );
}

/**
 * A section of the marketplace: its title, "View all", previous and next buttons, and a track of
 * poster cards that slide. Children are `<li>` items.
 */
export function Carousel({
  id,
  title,
  viewAllHref,
  children,
}: {
  id: string;
  title: string;
  viewAllHref: string;
  children: ReactNode;
}) {
  const t = useTranslations('showcase');
  const { ref, by } = useScrollBy();
  const arrow =
    'inline-flex size-10 items-center justify-center rounded-pill border border-line bg-surface text-ink hover:border-ink-2 hover:bg-surface-3';
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2
          id={id}
          className="font-display text-[26px] leading-none font-black tracking-[-0.02em] uppercase md:text-[34px]"
        >
          {title}
        </h2>
        <div className="flex items-center gap-2">
          <Link
            href={viewAllHref}
            className="me-2 inline-flex min-h-10 items-center rounded-pill border border-line px-4 text-body font-bold text-ink hover:border-ink-2 hover:bg-surface-3"
          >
            {t('viewAll')}
          </Link>
          <button type="button" className={arrow} onClick={() => by(-1)} aria-label={t('prev')}>
            <ChevronLeft aria-hidden="true" className="size-5 rtl:rotate-180" />
          </button>
          <button type="button" className={arrow} onClick={() => by(1)} aria-label={t('next')}>
            <ChevronRight aria-hidden="true" className="size-5 rtl:rotate-180" />
          </button>
        </div>
      </div>
      <ul
        ref={ref}
        aria-labelledby={id}
        className="no-scrollbar -mx-1 m-0 flex list-none snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth p-1 pb-4"
      >
        {children}
      </ul>
    </section>
  );
}
