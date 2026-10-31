'use client';

import { cx } from '@yayatoh/ui';
import { Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from '@/i18n/navigation.ts';

export interface HeroSlide {
  readonly key: string;
  readonly name: string;
  readonly meta: string;
  readonly href: string;
  /** The server-rendered picture (a MediaPicture or generated art). */
  readonly picture: ReactNode;
}

/**
 * A rotating hero slider of featured events: the pictures cross-fade, each slide names its event
 * and links to it, dots jump to a slide, and a button pauses it. It rotates by itself only when the
 * visitor has not asked for reduced motion, and stops while a control has focus or is hovered.
 * Classes only (opacity transitions), no inline styles.
 */
export function HeroSlider({ slides, children }: { slides: readonly HeroSlide[]; children?: ReactNode }) {
  const t = useTranslations('homeFinder');
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches && slides.length > 1);
  }, [slides.length]);
  useEffect(() => {
    if (!playing || hold) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % slides.length), 5500);
    return () => window.clearInterval(id);
  }, [playing, hold, slides.length]);
  const current = slides[active];
  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('sliderLabel')}
      className="relative isolate overflow-hidden rounded-[36px] border border-line bg-surface-2"
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
    >
      <div className="relative aspect-[4/5] w-full sm:aspect-[16/9] lg:aspect-[21/9]">
        {slides.map((s, i) => (
          // biome-ignore lint/a11y/useSemanticElements: the ARIA carousel pattern marks each slide as a group
          <div
            key={s.key}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} / ${slides.length}`}
            aria-hidden={i === active ? undefined : true}
            className={cx(
              'absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none',
              i === active ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            {s.picture}
          </div>
        ))}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-black/10"
        />
        {current ? (
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-5 text-white md:p-8">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="m-0 text-caption font-bold tracking-widest uppercase opacity-90">
                {t('featured')}
              </p>
              <Link
                href={current.href}
                className="font-display text-[22px] leading-tight font-black tracking-[-0.02em] uppercase underline-offset-4 hover:underline md:text-[34px] [overflow-wrap:anywhere]"
              >
                {current.name}
              </Link>
              <p className="m-0 text-[15px] opacity-90">{current.meta}</p>
            </div>
            {slides.length > 1 ? (
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? t('pause') : t('play')}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-pill border border-white/30 bg-black/50 text-white backdrop-blur hover:bg-black/70"
              >
                {playing ? (
                  <Pause aria-hidden="true" className="size-5" />
                ) : (
                  <Play aria-hidden="true" className="size-5" />
                )}
              </button>
            ) : null}
          </div>
        ) : null}
        {slides.length > 1 ? (
          <div className="absolute inset-x-0 bottom-28 flex justify-center gap-2 sm:bottom-24 lg:bottom-28">
            {slides.map((s, i) => (
              <button
                key={s.key}
                type="button"
                aria-label={t('goTo', { name: s.name })}
                aria-current={i === active ? 'true' : undefined}
                onClick={() => setActive(i)}
                className="inline-flex size-6 items-center justify-center"
              >
                <span
                  className={cx(
                    'block h-2 rounded-pill bg-white transition-all motion-reduce:transition-none',
                    i === active ? 'w-7' : 'w-2 opacity-60',
                  )}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
