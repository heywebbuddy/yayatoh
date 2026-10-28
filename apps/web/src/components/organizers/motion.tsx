'use client';

import { cx } from '@yayatoh/ui';
import { animate, inView, useMotionValueEvent, useScroll } from 'framer-motion';
import { type ElementType, type ReactNode, useEffect, useRef, useState } from 'react';

/*
 * Motion for the organizer landing page (framer-motion). The strict CSP refuses `style`
 * attributes in server-rendered HTML, so nothing here renders a motion component on the server:
 * the markup is plain and fully visible, and the animations are applied imperatively after
 * mount (the same approach as the home page's Reveal). Reduced motion keeps the plain markup.
 */
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A headline whose lines slide up through a mask when it scrolls into view. Each line is its own
 * block (`overflow-hidden`), so the words rise out of a cut edge.
 */
export function MaskLines({
  lines,
  as: Tag = 'h2',
  className,
  id,
}: {
  lines: readonly string[];
  as?: 'h1' | 'h2' | 'h3' | 'p';
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    const inner = [...el.querySelectorAll<HTMLElement>('[data-line]')];
    for (const l of inner) l.style.transform = 'translateY(110%)';
    const stop = inView(
      el,
      () => {
        inner.forEach((l, i) => {
          animate(l, { y: ['110%', '0%'] }, { duration: 0.8, delay: i * 0.09, ease: [0.22, 1, 0.36, 1] });
        });
      },
      { amount: 0.4 },
    );
    return () => stop();
  }, []);
  const T = Tag as ElementType;
  return (
    <T ref={ref} id={id} className={className}>
      {lines.map((line) => (
        <span key={line} className="block overflow-hidden pb-[0.08em]">
          <span data-line className="block will-change-transform">
            {line}
          </span>
        </span>
      ))}
    </T>
  );
}

/** A number that counts up from zero when it scrolls into view (the final value is the server HTML). */
export function CountUp({ to, suffix = '', className }: { to: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    const stop = inView(
      el,
      () => {
        const c = animate(0, to, {
          duration: 1.6,
          ease: [0.22, 1, 0.36, 1],
          onUpdate: (v) => {
            el.textContent = `${Math.round(v)}${suffix}`;
          },
        });
        return () => c.stop();
      },
      { amount: 0.8 },
    );
    return () => stop();
  }, [to, suffix]);
  return (
    <span ref={ref} className={className}>
      {to}
      {suffix}
    </span>
  );
}

/** Moves its content a little against the scroll (a parallax), by `distance` pixels top to bottom. */
export function Parallax({
  children,
  distance = 60,
  className,
}: {
  children: ReactNode;
  distance?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    const el = ref.current;
    if (!el || reduced()) return;
    el.style.transform = `translate3d(0, ${((p - 0.5) * -distance).toFixed(1)}px, 0)`;
  });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/** Slides in from the side (a small image chip beside a word) once its row is in view. */
export function Rise({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    el.style.opacity = '0';
    el.style.transform = 'translateY(32px)';
    const stop = inView(
      el,
      () => {
        animate(el, { opacity: [0, 1], y: [32, 0] }, { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] });
      },
      { amount: 0.2 },
    );
    return () => stop();
  }, [delay]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/**
 * The sticky feature showcase: the list of features scrolls, and the picture on the right stays
 * pinned and changes with the feature in view. Pictures are stacked and cross-fade with classes
 * (no inline style, no JavaScript needed to read any text). Under `lg` every feature carries its own picture.
 */
export function StickyShowcase({
  steps,
  panels,
  label,
}: {
  steps: readonly ReactNode[];
  panels: readonly ReactNode[];
  label: string;
}) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    const els = refs.current.filter((e): e is HTMLLIElement => e !== null);
    const stops = els.map((el, i) =>
      inView(
        el,
        () => {
          setActive(i);
        },
        { amount: 0.55 },
      ),
    );
    return () => {
      for (const s of stops) s();
    };
  }, []);
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
      <ol aria-label={label} className="m-0 flex list-none flex-col gap-10 p-0 lg:gap-0">
        {steps.map((s, i) => (
          <li
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={cx(
              'flex flex-col gap-6 transition-opacity duration-500 lg:min-h-[80vh] lg:justify-center motion-reduce:transition-none',
              i === active ? 'lg:opacity-100' : 'lg:opacity-60',
            )}
          >
            {s}
            <div className="lg:hidden">{panels[i]}</div>
          </li>
        ))}
      </ol>
      <div className="relative hidden lg:block">
        <div className="sticky top-28 h-[min(70vh,34rem)]">
          {panels.map((p, i) => (
            <div
              key={i}
              aria-hidden={i === active ? undefined : true}
              className={cx(
                'absolute inset-0 transition-all duration-700 motion-reduce:transition-none',
                i === active ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-6 scale-95 opacity-0',
              )}
            >
              {p}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
