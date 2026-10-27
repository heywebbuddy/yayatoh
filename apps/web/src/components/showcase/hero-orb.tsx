'use client';

import type { PublicMediaDto } from '@yayatoh/media';
import { cx } from '@yayatoh/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { MediaPicture } from '../media-picture.tsx';
import { useReducedMotion } from './use-reduced-motion.ts';

/** Bars per side, the circle's radius and the radius of the outer silhouette (100-unit space). */
const PER_SIDE = 11;
const R = 34;
const R_OUT = 49;
const START = R * 0.8;
const KEY_SPLINES = '0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1;0.4 0 0.6 1';

/** A small deterministic generator, so the server and the browser draw the same bars. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
  ys: string;
  hs: string;
  dur: string;
  begin: string;
}

/**
 * The equalizer teeth: vertical bars standing out of the circle's left and right edges, side by
 * side with no gaps, whose tops and bottoms follow a larger circle, so the outline stays round but
 * jagged. Each bar's height beats between about 35% and 100% of its slot on its own rhythm.
 */
function makeBars(): Bar[] {
  const rand = rng(7);
  const step = (R_OUT - START) / PER_SIDE;
  const out: Bar[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < PER_SIDE; i++) {
      const near = START + i * step;
      const far = near + step;
      const full = (Math.sqrt(R_OUT * R_OUT - far * far) || 2) * 2;
      const x = side < 0 ? 50 - far : 50 + near;
      const levels = [0.5, 1, 0.38, 0.85, 0.62, 0.5].map((l) => Math.min(1, l * (0.75 + rand() * 0.45)));
      const yOf = (l: number) => 50 - (full * l) / 2;
      out.push({
        x,
        y: yOf(levels[0] ?? 0.5),
        w: step + 0.05,
        h: full * (levels[0] ?? 0.5),
        ys: levels.map((l) => yOf(l).toFixed(2)).join(';'),
        hs: levels.map((l) => (full * l).toFixed(2)).join(';'),
        dur: `${(0.7 + rand() * 1.1).toFixed(2)}s`,
        begin: `-${(rand() * 2).toFixed(2)}s`,
      });
    }
  }
  return out;
}
const BARS = makeBars();

/**
 * The home hero's centrepiece, after the reference: a large circle holding a photo under a warm
 * red-to-amber wash, with equalizer teeth built into its left and right edges and faint sound
 * rings pulsing outward; it drifts up slower than the page on scroll (`animate-drift`).
 *
 * Strict CSP: the bars are SVG with their geometry in attributes and their beat in SMIL
 * `<animate>` (no style attributes, no script-set styles); the rings are CSS classes; the
 * scroll parallax is a CSS scroll-driven animation (no script, no style writes). Under reduced motion the `<animate>` elements are
 * not rendered, so the bars stand still, and nothing drifts.
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
  useEffect(() => setMounted(true), []);
  const live = mounted && !reduced;
  const body = (
    <div className={cx('animate-drift relative aspect-square', className)}>
      {['', 'delay-[2s]', 'delay-[4s]'].map((d) => (
        <span
          key={d || 'a'}
          aria-hidden="true"
          className={cx(
            'animate-ring-pulse pointer-events-none absolute inset-[10%] rounded-full border border-ember/40',
            d,
          )}
        />
      ))}
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        focusable="false"
      >
        <defs>
          <linearGradient id="orb-bars" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" className="[stop-color:var(--color-ember)]" />
            <stop offset="0.55" className="[stop-color:var(--color-flame)]" />
            <stop offset="1" className="[stop-color:var(--color-rose)]" />
          </linearGradient>
        </defs>
        {BARS.map((b) => (
          <rect key={b.x} x={b.x} y={b.y} width={b.w} height={b.h} fill="url(#orb-bars)">
            {live ? (
              <>
                <animate
                  attributeName="y"
                  values={b.ys}
                  dur={b.dur}
                  begin={b.begin}
                  repeatCount="indefinite"
                  calcMode="spline"
                  keySplines={KEY_SPLINES}
                />
                <animate
                  attributeName="height"
                  values={b.hs}
                  dur={b.dur}
                  begin={b.begin}
                  repeatCount="indefinite"
                  calcMode="spline"
                  keySplines={KEY_SPLINES}
                />
              </>
            ) : null}
          </rect>
        ))}
      </svg>
      <div className="absolute inset-[16%] overflow-hidden rounded-full bg-surface-2 elevation-pop">
        {cover ? (
          <MediaPicture
            image={{ ...cover, decorative: true }}
            sizes="(min-width: 768px) 440px, 70vw"
            className="size-full object-cover"
            eager
          />
        ) : (
          <div className="size-full bg-ember-soft" />
        )}
        {/* A warm duotone wash that keeps the photo readable, plus a soft shade at the foot. */}
        <div className="absolute inset-0 bg-linear-to-br from-ember/45 via-flame/20 to-rose/45 mix-blend-soft-light" />
        <div className="absolute inset-0 bg-linear-to-br from-ember/30 via-transparent to-flame/30" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/35 to-transparent" />
      </div>
      {children}
    </div>
  );
  return body;
}
