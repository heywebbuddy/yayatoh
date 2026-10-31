'use client';

import { buttonClass, cx } from '@yayatoh/ui';
import { useEffect, useState } from 'react';

/**
 * The floating register / RSVP bar of an event page. It stays out of the way: hidden while the
 * passes (checkout) section is on screen, so it never covers a price, a seat or a heading there,
 * and the page reserves room for it at the foot (see `pb-24` on the page container).
 */
export function RegisterBar({ label }: { label: string }) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = document.getElementById('passes');
    if (!el) return;
    const io = new IntersectionObserver((entries) => setOver(entries.some((e) => e.isIntersecting)), {
      rootMargin: '0px 0px 80px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      aria-hidden={over ? true : undefined}
      className={cx(
        'pointer-events-none fixed inset-x-0 bottom-3 z-30 flex justify-center transition-opacity duration-200 motion-reduce:transition-none',
        over ? 'opacity-0' : 'opacity-100',
      )}
    >
      <a
        href="#passes"
        tabIndex={over ? -1 : undefined}
        className={cx(
          buttonClass('ember', 'lg'),
          'pointer-events-auto elevation-pop',
          over && 'pointer-events-none',
        )}
      >
        {label}
      </a>
    </div>
  );
}
