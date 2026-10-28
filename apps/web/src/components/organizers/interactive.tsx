'use client';

import { cx } from '@yayatoh/ui';
import { animate } from 'framer-motion';
import { ChevronLeft, ChevronRight, Plus, Quote, Star } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link } from '@/i18n/navigation.ts';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The templates row: scrolls sideways with snapping, with the mouse wheel while the pointer is over
 * it (until the row reaches its end, then the page continues), by dragging, with previous/next
 * buttons and with the keyboard (the row takes focus; arrow keys scroll it).
 */
export function ScrollRow({
  children,
  label,
  prev,
  next,
}: {
  children: ReactNode;
  label: string;
  prev: string;
  next: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rtl = () => getComputedStyle(el).direction === 'rtl';
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const x = Math.abs(el.scrollLeft);
      setEdge({ start: x <= 2, end: x >= max - 2 });
    };
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || e.ctrlKey) return;
      const max = el.scrollWidth - el.clientWidth;
      const dir = (rtl() ? -1 : 1) * Math.sign(e.deltaY);
      const x = Math.abs(el.scrollLeft);
      if ((dir > 0 && x >= max - 2) || (dir < 0 && x <= 2)) return;
      e.preventDefault();
      el.scrollBy({ left: (rtl() ? -1 : 1) * e.deltaY, behavior: 'auto' });
    };
    let down = false;
    let startX = 0;
    let startLeft = 0;
    let moved = false;
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      if (moved) {
        el.classList.add('cursor-grabbing', 'snap-none');
        el.scrollLeft = startLeft - dx;
      }
    };
    const onUp = () => {
      if (!down) return;
      down = false;
      el.classList.remove('cursor-grabbing', 'snap-none');
    };
    const onClick = (e: MouseEvent) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('click', onClick, true);
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('click', onClick, true);
      window.removeEventListener('resize', update);
    };
  }, []);
  const by = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    el.scrollBy({ left: (rtl ? -dir : dir) * el.clientWidth * 0.8, behavior: reduced() ? 'auto' : 'smooth' });
  };
  const btn =
    'inline-flex size-12 items-center justify-center rounded-full bg-black text-white transition-opacity hover:bg-black/80 disabled:opacity-30 motion-reduce:transition-none';
  return (
    <div className="flex flex-col gap-4">
      <ul
        ref={ref}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be focusable so the keyboard can scroll it
        tabIndex={0}
        aria-label={label}
        className="no-scrollbar m-0 flex cursor-grab list-none snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth p-0 pb-2 outline-offset-4 select-none"
      >
        {children}
      </ul>
      <div className="flex justify-end gap-2">
        <button type="button" aria-label={prev} disabled={edge.start} onClick={() => by(-1)} className={btn}>
          <ChevronLeft aria-hidden="true" className="size-6 rtl:rotate-180" />
        </button>
        <button type="button" aria-label={next} disabled={edge.end} onClick={() => by(1)} className={btn}>
          <ChevronRight aria-hidden="true" className="size-6 rtl:rotate-180" />
        </button>
      </div>
    </div>
  );
}

export interface QuoteItem {
  readonly id: string;
  readonly quote: string;
  readonly name: string;
  readonly role: string | null;
  readonly photoUrl: string | null;
  readonly rating: number | null;
}
const TONES = ['bg-lavender', 'bg-sand', 'bg-blush', 'bg-mint', 'bg-sky'];

function QuoteCard({ q, i, rating }: { q: QuoteItem; i: number; rating: string }) {
  return (
    <figure
      className={cx(
        'relative m-0 flex h-full w-[300px] shrink-0 flex-col gap-4 rounded-[32px] p-7 text-black transition-transform duration-300 hover:-translate-y-2 md:w-[380px] motion-reduce:transition-none',
        TONES[i % TONES.length],
      )}
    >
      <Quote aria-hidden="true" className="size-12 fill-black/15 text-black/15" />
      {q.rating ? (
        <div role="img" aria-label={rating} className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              aria-hidden="true"
              className={cx('size-5', n <= (q.rating ?? 0) ? 'fill-black text-black' : 'text-black/25')}
            />
          ))}
        </div>
      ) : null}
      <blockquote className="m-0 text-[17px] leading-relaxed font-semibold">{q.quote}</blockquote>
      <figcaption className="mt-auto flex items-center gap-3">
        {q.photoUrl ? (
          <img src={q.photoUrl} alt="" width={44} height={44} className="size-11 rounded-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex size-11 items-center justify-center rounded-full bg-black font-display font-black text-white"
          >
            {q.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="flex flex-col">
          <span className="font-bold">{q.name}</span>
          {q.role ? <span className="text-caption text-black/70">{q.role}</span> : null}
        </span>
      </figcaption>
    </figure>
  );
}

/** Testimonials as colourful tiles that drift sideways (a marquee) and stop under the pointer or focus. */
export function QuoteMarquee({
  items,
  ratings,
}: {
  items: readonly QuoteItem[];
  ratings: readonly string[];
}) {
  const list = items.length >= 4 ? items : [...items, ...items, ...items].slice(0, Math.max(4, items.length));
  return (
    <div className="group/marquee no-scrollbar -mx-4 overflow-hidden px-4 py-3 md:-mx-6 motion-reduce:overflow-x-auto">
      <ul className="m-0 flex w-max list-none gap-5 p-0 animate-marquee group-focus-within/marquee:[animation-play-state:paused] group-hover/marquee:[animation-play-state:paused] motion-reduce:animate-none">
        {list.map((q, i) => (
          <li key={`${q.id}-${i}`}>
            <QuoteCard q={q} i={i} rating={ratings[q.rating ?? 0] ?? ''} />
          </li>
        ))}
        {list.map((q, i) => (
          <li key={`copy-${q.id}-${i}`} aria-hidden="true" inert className="motion-reduce:hidden">
            <QuoteCard q={q} i={i} rating={ratings[q.rating ?? 0] ?? ''} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface FaqEntry {
  readonly q: string;
  readonly a: string;
}

/**
 * The FAQ accordion: one open at a time, the open item is highlighted, the plus turns into a cross,
 * and the answer opens and closes with a height animation (framer-motion, applied to the element
 * after mount, so the server HTML has no style attribute).
 */
export function FaqAccordion({ items }: { items: readonly FaqEntry[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const base = useId();
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const first = useRef(true);
  useEffect(() => {
    panels.current.forEach((el, i) => {
      if (!el) return;
      const isOpen = open === i;
      if (first.current || reduced()) {
        el.style.height = isOpen ? 'auto' : '0px';
        return;
      }
      const from = el.getBoundingClientRect().height;
      const to = isOpen ? el.scrollHeight : 0;
      if (from === to) return;
      el.style.height = `${from}px`;
      animate(el, { height: [`${from}px`, `${to}px`] }, { duration: 0.35, ease: [0.22, 1, 0.36, 1] }).then(
        () => {
          el.style.height = isOpen ? 'auto' : '0px';
        },
      );
    });
    first.current = false;
  }, [open]);
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <li
            key={it.q}
            className={cx(
              'rounded-[28px] border transition-colors duration-300 motion-reduce:transition-none',
              isOpen
                ? 'border-ember bg-ember-soft text-white'
                : 'border-line bg-surface text-ink hover:border-line-strong',
            )}
          >
            <h3 className="m-0">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`${base}-${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex min-h-16 w-full items-center justify-between gap-4 rounded-[28px] px-6 py-4 text-start text-[17px] font-bold"
              >
                {it.q}
                <span
                  aria-hidden="true"
                  className={cx(
                    'inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-transform duration-300 motion-reduce:transition-none',
                    isOpen ? 'rotate-45 bg-white text-black' : 'bg-surface-3 text-ink',
                  )}
                >
                  <Plus className="size-5" />
                </span>
              </button>
            </h3>
            <div
              ref={(el) => {
                panels.current[i] = el;
              }}
              id={`${base}-${i}`}
              inert={!isOpen}
              className={cx('overflow-hidden', isOpen ? '' : 'h-0')}
            >
              <p className="m-0 px-6 pb-6 text-body opacity-90">{it.a}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The "still have questions?" card beside the FAQ. */
export function ContactCard({ title, body, cta }: { title: string; body: string; cta: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[28px] bg-grape p-7 text-white">
      <p className="m-0 font-display text-[24px] leading-tight font-black uppercase">{title}</p>
      <p className="m-0 text-body opacity-90">{body}</p>
      <Link
        href="/contact"
        className="inline-flex min-h-12 items-center rounded-full bg-white px-6 font-bold text-black hover:bg-white/90"
      >
        {cta}
      </Link>
    </div>
  );
}
