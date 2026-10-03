'use client';

import { Button, EmptyState, StatusPill } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtime } from '@/lib/use-realtime.ts';
import { GalleryPhoto } from './photo.tsx';
import type { PhotoView } from './types.ts';

/** How long each photo stays while playing. */
const SLIDE_MS = 7_000;

/**
 * The live slideshow (M4.5b): published photos, newest first, one at a time, advancing on its
 * own. A new photo arrives over Server-Sent Events (ids only) and is shown next; a removed one
 * disappears at once. Pause/play, previous and next are 44 px buttons and also the arrow keys and
 * Space; autoplay stops on hover or focus and never starts under reduced motion (WCAG 2.2.2).
 * The live region announces only what a person did (or a newly arrived photo while paused),
 * never each automatic change.
 */
export function GallerySlideshow({
  initial,
  stream,
  reload,
  title,
}: {
  initial: readonly PhotoView[];
  /** The SSE URL (the realtime route for hosts, the gallery stream for guests). */
  stream: string;
  reload: () => Promise<readonly PhotoView[]>;
  title: string;
}) {
  const t = useTranslations('gallery.slideshow');
  const [photos, setPhotos] = useState<readonly PhotoView[]>(initial);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  const [announce, setAnnounce] = useState('');
  const rootRef = useRef<HTMLElement>(null);
  const currentId = photos[index]?.id ?? null;
  const currentRef = useRef(currentId);
  currentRef.current = currentId;

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
  }, []);

  const photosRef = useRef(photos);
  photosRef.current = photos;

  const refresh = useCallback(async () => {
    const next = await reload();
    const known = new Set(photosRef.current.map((p) => p.id));
    const fresh = next.filter((p) => !known.has(p.id));
    const current = next.find((p) => p.id === currentRef.current);
    // Keep showing the current photo; play the newly arrived ones next.
    setPhotos(
      current ? [current, ...fresh, ...next.filter((p) => p.id !== current.id && known.has(p.id))] : next,
    );
    setIndex(0);
    if (fresh.length && known.size) setAnnounce(t('arrived', { count: fresh.length }));
  }, [reload, t]);

  const live = useRealtime(stream, ['snapshot', 'item'], {
    item: () => void refresh(),
    snapshot: () => void refresh(),
  });

  const count = photos.length;
  const go = useCallback(
    (delta: number, spoken: boolean) => {
      if (count === 0) return;
      setIndex((i) => {
        const next = (i + delta + count) % count;
        if (spoken) setAnnounce(t('position', { n: next + 1, total: count }));
        return next;
      });
    },
    [count, t],
  );

  useEffect(() => {
    if (!playing || held || count < 2) return;
    const timer = setInterval(() => go(1, false), SLIDE_MS);
    return () => clearInterval(timer);
  }, [playing, held, count, go]);

  useEffect(() => {
    if (index >= count && count > 0) setIndex(0);
  }, [index, count]);

  const toggle = () => {
    setPlaying((p) => {
      setAnnounce(p ? t('paused') : t('playing'));
      return !p;
    });
  };

  const photo = photos[index];
  const alt = (p: PhotoView, n: number) =>
    p.caption ?? (p.by ? t('altBy', { name: p.by, n, total: count }) : t('alt', { n, total: count }));

  return (
    <section
      ref={rootRef}
      aria-roledescription={t('roleDescription')}
      aria-label={title}
      className="flex flex-col gap-4"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (e.key === 'ArrowRight') go(document.dir === 'rtl' ? -1 : 1, true);
        else if (e.key === 'ArrowLeft') go(document.dir === 'rtl' ? 1 : -1, true);
        else if (e.key === ' ' && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          toggle();
        } else return;
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill
          tone={live === 'live' ? 'success' : live === 'offline' ? 'danger' : 'waiting'}
          label={t(`stream.${live}`)}
          live={live === 'live'}
        />
        <span className="text-caption text-ink-2" data-testid="slide-count">
          {count === 0 ? t('none') : t('position', { n: index + 1, total: count })}
        </span>
      </div>
      {photo ? (
        <figure
          className="m-0 flex flex-col items-center gap-3 rounded-card bg-tag p-3"
          aria-label={t('position', { n: index + 1, total: count })}
          data-testid="slide"
          data-photo-id={photo.id}
        >
          <GalleryPhoto
            photo={photo}
            alt={alt(photo, index + 1)}
            sizes="100vw"
            eager
            className="block max-h-[70dvh] w-auto max-w-full rounded-control object-contain"
          />
          {photo.caption || photo.by || photo.byHost ? (
            <figcaption className="text-center text-body text-tag-ink" dir="auto">
              {photo.caption ? <span className="font-bold">{photo.caption}</span> : null}
              {photo.caption && (photo.by || photo.byHost) ? ' · ' : null}
              {photo.by ? t('by', { name: photo.by }) : photo.byHost ? t('byHosts') : null}
            </figcaption>
          ) : null}
        </figure>
      ) : (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      )}
      <fieldset className="m-0 flex flex-wrap items-center gap-3 border-0 p-0">
        <legend className="sr-only">{t('controls')}</legend>
        <Button variant="secondary" onClick={() => go(-1, true)} disabled={count < 2}>
          {t('previous')}
        </Button>
        <Button variant="secondary" onClick={toggle} aria-pressed={!playing} disabled={count < 2}>
          {playing ? t('pause') : t('play')}
        </Button>
        <Button variant="secondary" onClick={() => go(1, true)} disabled={count < 2}>
          {t('next')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const el = rootRef.current;
            if (!el) return;
            if (document.fullscreenElement) void document.exitFullscreen();
            else void el.requestFullscreen?.();
          }}
        >
          {t('fullscreen')}
        </Button>
      </fieldset>
      <p className="m-0 text-caption text-ink-2">{t('keys')}</p>
      <p aria-live="polite" className="sr-only" data-testid="slideshow-announce">
        {announce}
      </p>
    </section>
  );
}
