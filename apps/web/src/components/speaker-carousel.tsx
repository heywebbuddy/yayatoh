'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

/**
 * A horizontal carousel of speaker cards: native scroll-snap (so touch swipe and trackpads work),
 * previous/next buttons, and arrow keys while the track has focus. Scrolling is instant when the
 * visitor prefers reduced motion. Works right-to-left (the buttons follow reading direction).
 */
export function SpeakerCarousel({
  children,
  label,
  prevLabel,
  nextLabel,
}: {
  children: ReactNode;
  label: string;
  prevLabel: string;
  nextLabel: string;
}) {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    // scrollLeft is negative in RTL; its magnitude is the distance from the start edge.
    const pos = Math.abs(el.scrollLeft);
    setEdges({ start: pos < 4, end: pos + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const go = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector('li');
    const step = (card?.getBoundingClientRect().width ?? el.clientWidth) + 20;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: step * dir * (rtl ? -1 : 1), behavior: reduce ? 'auto' : 'smooth' });
  };

  const btn =
    'flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full ev-white-card shadow-lg transition-opacity focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-default disabled:opacity-40 motion-reduce:transition-none';

  return (
    <div className="flex flex-col gap-5">
      <ul
        ref={track}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the scrollable track takes focus for arrow keys.
        tabIndex={0}
        aria-label={label}
        onKeyDown={(e) => {
          const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            go(rtl ? -1 : 1);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            go(rtl ? 1 : -1);
          }
        }}
        className="m-0 flex list-none snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth p-1 pb-3 [scrollbar-width:none] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:scroll-auto"
      >
        {children}
      </ul>
      <div className="flex justify-center gap-3">
        <button
          type="button"
          className={btn}
          onClick={() => go(-1)}
          disabled={edges.start}
          aria-label={prevLabel}
        >
          <ChevronLeft aria-hidden="true" className="size-5 rtl:rotate-180" strokeWidth={2.6} />
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => go(1)}
          disabled={edges.end}
          aria-label={nextLabel}
        >
          <ChevronRight aria-hidden="true" className="size-5 rtl:rotate-180" strokeWidth={2.6} />
        </button>
      </div>
    </div>
  );
}
