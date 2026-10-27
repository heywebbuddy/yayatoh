'use client';

import { cx } from '@yayatoh/ui';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { MediaPicture, type PictureSource } from '@/components/media-picture.tsx';

export interface GalleryLabels {
  /** "Open photo {n} of {total}": `{n}` and `{total}` are filled in here. */
  readonly open: string;
  readonly dialog: string;
  readonly close: string;
  readonly previous: string;
  readonly next: string;
  /** "{n} of {total}". */
  readonly counter: string;
  readonly thumbnails: string;
}

const fill = (s: string, n: number, total: number) =>
  s.replace('{n}', String(n)).replace('{total}', String(total));

/**
 * A public photo grid that opens into a full-screen slider: click (or Enter) a photo to view it
 * large, then previous/next buttons, the arrow keys, swiping or the thumbnail strip move through
 * all of them; Escape or the close button returns focus to the photo that opened it. A native
 * modal `<dialog>` keeps focus inside while it is open.
 */
export function GalleryLightbox({
  images,
  labels,
  sizes,
  gridClassName,
  imageClassName,
  featureFirst = false,
}: {
  images: readonly (PictureSource & { readonly id: string })[];
  labels: GalleryLabels;
  sizes: string;
  gridClassName: string;
  imageClassName: string;
  /** The first photo spans two columns and rows (the guest site's strip). */
  featureFirst?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const openers = useRef<(HTMLButtonElement | null)[]>([]);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const swipe = useRef<number | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const total = images.length;
  const current = index === null ? null : images[index];

  const go = useCallback(
    (step: number) => setIndex((i) => (i === null ? i : (i + step + total) % total)),
    [total],
  );

  function open(i: number) {
    setIndex(i);
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  useEffect(() => {
    if (index !== null) thumbs.current[index]?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [index]);

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const rtl = document.documentElement.dir === 'rtl';
    go((e.key === 'ArrowRight') !== rtl ? 1 : -1);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') swipe.current = e.clientX;
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (start === null) return;
    const dx = e.clientX - start;
    if (Math.abs(dx) < 40) return;
    const rtl = document.documentElement.dir === 'rtl';
    go(dx < 0 !== rtl ? 1 : -1);
  }

  const nameOf = (img: PictureSource) => (img.decorative ? '' : (img.alt ?? ''));
  const control =
    'grid size-11 shrink-0 place-items-center rounded-pill bg-white/10 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

  return (
    <>
      <ul className={gridClassName}>
        {images.map((img, k) => (
          <li
            key={img.id}
            className={cx(
              'overflow-hidden rounded-tile bg-surface-2',
              featureFirst && k === 0 ? 'col-span-2 row-span-2' : '',
            )}
          >
            <button
              ref={(el) => {
                openers.current[k] = el;
              }}
              type="button"
              onClick={() => open(k)}
              aria-label={[fill(labels.open, k + 1, total), nameOf(img)].filter(Boolean).join(': ')}
              aria-haspopup="dialog"
              className="group block size-full cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <MediaPicture
                image={img}
                sizes={sizes}
                alt=""
                eager
                className={cx(imageClassName, 'transition-transform duration-300 group-hover:scale-[1.03]')}
              />
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialog}
        aria-label={labels.dialog}
        onKeyDown={onKeyDown}
        onClose={() => {
          const was = index;
          setIndex(null);
          if (was !== null) openers.current[was]?.focus();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/95 p-0 text-white backdrop:bg-black/80"
      >
        {current && index !== null ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p aria-live="polite" className="m-0 text-body text-white/80">
                {fill(labels.counter, index + 1, total)}
              </p>
              <button type="button" onClick={close} aria-label={labels.close} className={control}>
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <div
              className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center gap-2 px-2"
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                swipe.current = null;
              }}
            >
              {total > 1 ? (
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label={labels.previous}
                  className={cx(control, 'hidden sm:grid')}
                >
                  <ChevronLeft aria-hidden="true" className="size-6 rtl:rotate-180" />
                </button>
              ) : null}
              <figure className="m-0 flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3">
                <MediaPicture
                  key={current.id}
                  image={current}
                  sizes="100vw"
                  eager
                  className="max-h-[72dvh] w-auto max-w-full rounded-tile object-contain"
                />
                {nameOf(current) ? (
                  <figcaption className="max-w-prose text-center text-body text-white/80">
                    {nameOf(current)}
                  </figcaption>
                ) : null}
              </figure>
              {total > 1 ? (
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label={labels.next}
                  className={cx(control, 'hidden sm:grid')}
                >
                  <ChevronRight aria-hidden="true" className="size-6 rtl:rotate-180" />
                </button>
              ) : null}
            </div>
            {total > 1 ? (
              <div className="flex items-center gap-2 px-4 pb-4 pt-2">
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label={labels.previous}
                  className={cx(control, 'sm:hidden')}
                >
                  <ChevronLeft aria-hidden="true" className="size-6 rtl:rotate-180" />
                </button>
                <ul
                  aria-label={labels.thumbnails}
                  className="m-0 flex min-w-0 flex-1 list-none gap-2 overflow-x-auto p-1 sm:justify-center"
                >
                  {images.map((img, k) => (
                    <li key={img.id} className="shrink-0">
                      <button
                        ref={(el) => {
                          thumbs.current[k] = el;
                        }}
                        type="button"
                        onClick={() => setIndex(k)}
                        aria-label={fill(labels.counter, k + 1, total)}
                        aria-current={k === index ? 'true' : undefined}
                        className={cx(
                          'block overflow-hidden rounded-card border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                          k === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100',
                        )}
                      >
                        <MediaPicture image={img} sizes="96px" alt="" className="h-14 w-20 object-cover" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label={labels.next}
                  className={cx(control, 'sm:hidden')}
                >
                  <ChevronRight aria-hidden="true" className="size-6 rtl:rotate-180" />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
