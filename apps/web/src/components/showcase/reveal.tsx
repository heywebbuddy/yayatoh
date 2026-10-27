'use client';

import { cx } from '@yayatoh/ui';
import { type ReactNode, useEffect, useRef } from 'react';

/**
 * Fades its content in (and lifts it a little) the first time it scrolls into view. Server HTML is
 * fully visible: the hidden state is added after hydration and only to what is below the fold, and
 * never under reduced motion, so nothing depends on JavaScript to be readable. Classes only, no
 * inline styles (CSP). `delay` staggers siblings, in steps of 90 ms.
 */
const DELAYS = ['', 'delay-[90ms]', 'delay-[180ms]', 'delay-[270ms]', 'delay-[360ms]', 'delay-[450ms]'];

export function Reveal({
  children,
  className,
  delay = 0,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'section' | 'li';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    el.classList.add('reveal-pending');
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        el.classList.add('reveal-in');
        el.classList.remove('reveal-pending');
        io.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref as never} className={cx(DELAYS[Math.min(delay, 5)], className)}>
      {children}
    </Tag>
  );
}
