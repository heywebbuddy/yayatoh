'use client';

import { type ReactNode, useEffect, useState } from 'react';

/**
 * The sticky frame of the public top bar. Once the page scrolls it takes the canvas colour (and a
 * short fade below), so the page never shows through the gap above or beside the floating bar.
 */
export function StickyBar({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div
      data-scrolled={scrolled || undefined}
      className="sticky top-0 z-50 px-3 pt-3 transition-colors duration-200 motion-reduce:transition-none sm:px-5 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-linear-to-b after:from-canvas after:to-transparent after:opacity-0 data-[scrolled]:bg-canvas data-[scrolled]:after:opacity-100"
    >
      {children}
    </div>
  );
}
