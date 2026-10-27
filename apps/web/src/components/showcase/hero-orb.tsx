'use client';

import type { PublicMediaDto } from '@yayatoh/media';
import { cx } from '@yayatoh/ui';
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { MediaPicture } from '../media-picture.tsx';

/** Bars on each side of the circle: angles from the horizontal, every 9 degrees. */
const ANGLES = Array.from({ length: 13 }, (_, i) => -54 + i * 9);

/**
 * The home hero's centrepiece, after the reference: a large circle holding a photo under a
 * red-orange duotone, with equalizer bars standing out of its left and right sides. Each bar
 * beats on its own random rhythm (tallest at the horizontal middle, shorter toward the top and
 * bottom), faint rings pulse outward, and the whole thing drifts up slower than the page on scroll.
 *
 * Smoothness and the strict CSP: the bars move with the compositor-only `scale` property (never
 * height); their per-bar numbers and angles are written to the elements with CSSOM after mount
 * (a style *attribute* would be blocked), and the framer-motion parallax mounts only after
 * hydration for the same reason. Under reduced motion the bars stand still at half length and
 * nothing drifts.
 */
export function HeroOrb({
  cover,
  children,
  className,
}: {
  cover: PublicMediaDto | null;
  /** The headline, drawn over the circle. */
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => setMounted(true), []);
  // Re-run once mounted: the parallax wrapper replaces the elements, so the first pass is lost.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `mounted` is the trigger
  useEffect(() => {
    const all = bars.current;
    all.forEach((wrap, i) => {
      const bar = wrap?.firstElementChild as HTMLElement | null;
      if (!wrap || !bar) return;
      const side = i < ANGLES.length ? 0 : 180;
      const angle = ANGLES[i % ANGLES.length] ?? 0;
      // Longest at the middle (0 degrees), shorter toward the poles.
      const reach = Math.cos((angle * Math.PI) / 180) ** 1.6;
      wrap.style.rotate = `${side + angle}deg`;
      bar.style.setProperty('--lo', String(0.08 + Math.random() * 0.14));
      bar.style.setProperty(
        '--hi',
        String(Math.min(1, (0.45 + Math.random() * 0.55) * (0.35 + reach * 0.65))),
      );
      bar.style.setProperty('--dur', `${(0.55 + Math.random() * 0.9).toFixed(2)}s`);
      bar.style.setProperty('--delay', `${(-Math.random() * 1.5).toFixed(2)}s`);
      bar.classList.add('animate-eq');
      wrap.classList.remove('opacity-0');
    });
  }, [mounted]);

  const frame = useRef<HTMLDivElement>(null);
  const body = (
    <div ref={frame} className={cx('relative aspect-square', className)}>
      {/* Sound rings, radiating from behind the circle. */}
      {['', 'delay-[2s]', 'delay-[4s]'].map((d) => (
        <span
          key={d || 'a'}
          aria-hidden="true"
          className={cx(
            'animate-ring-pulse pointer-events-none absolute inset-[6%] rounded-full border border-ember/40',
            d,
          )}
        />
      ))}
      {/* The bars: a wrapper rotated about the centre, its child the bar that scales outward. */}
      {[...ANGLES, ...ANGLES].map((a, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, decorative list
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 h-2.5 w-1/2 origin-left -translate-y-1/2 opacity-0 sm:h-3.5"
        >
          <span className="absolute inset-y-0 start-[64%] w-[34%] origin-left scale-x-[0.4] rounded-full bg-ember motion-reduce:scale-x-50" />
        </span>
      ))}
      <div className="absolute inset-[17%] overflow-hidden rounded-full bg-surface-2 elevation-pop">
        {cover ? (
          <MediaPicture
            image={{ ...cover, decorative: true }}
            sizes="(min-width: 768px) 360px, 60vw"
            className="size-full object-cover"
            eager
          />
        ) : (
          <div className="size-full bg-ember-soft" />
        )}
        {/* Duotone: the photo goes red to amber, then a shade keeps the headline readable. */}
        <div className="absolute inset-0 bg-ember opacity-60 mix-blend-multiply" />
        <div className="absolute inset-0 bg-ember opacity-25 mix-blend-screen" />
        <div className="absolute inset-0 bg-black/25" />
      </div>
      {children}
    </div>
  );
  return mounted && !reduced ? <Drift>{body}</Drift> : body;
}

/** The parallax: after hydration only, so framer-motion never renders a `style=""` attribute. */
function Drift({ children }: { children: ReactNode }) {
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 700], [0, -70]);
  return (
    <motion.div initial={false} style={{ y }} className="will-change-transform">
      {children}
    </motion.div>
  );
}
