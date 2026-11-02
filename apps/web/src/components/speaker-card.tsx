'use client';

import { cx } from '@yayatoh/ui';
import { Plus } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Link } from '@/i18n/navigation.ts';

/**
 * One portrait card of the event page's speaker section. The bio slides up over the portrait on
 * hover and keyboard focus; on touch (no hover) the round button opens and closes it. The name is
 * the card's link to the speaker page; the whole portrait is part of that link's hit area.
 */
export function SpeakerCard({
  href,
  name,
  role,
  meta,
  bio,
  portrait,
  bioLabel,
  profileLabel,
  featured = false,
}: {
  href: string;
  name: string;
  role: string;
  meta: string | null;
  bio: string;
  portrait: ReactNode;
  bioLabel: string;
  profileLabel: string;
  featured?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bioId = useId();
  return (
    <li
      data-open={open || undefined}
      className={cx(
        'ev-speaker group relative isolate flex flex-col overflow-hidden rounded-card bg-surface-2',
        featured && 'col-span-2 lg:row-span-2',
      )}
    >
      <div
        className={cx(
          'relative w-full overflow-hidden',
          featured ? 'aspect-[4/5] lg:aspect-auto lg:grow' : 'aspect-[4/5]',
        )}
      >
        {portrait}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/80 via-black/15 to-transparent"
        />
        {bio ? (
          <div
            id={bioId}
            className="ev-speaker-bio absolute inset-0 z-10 flex flex-col gap-3 bg-black/80 p-4 pb-28 text-white sm:p-5 sm:pb-32 backdrop-blur-sm"
          >
            <p className="m-0 line-clamp-4 text-caption leading-relaxed sm:line-clamp-6 sm:text-body">
              {bio}
            </p>
            <span className="text-caption font-bold text-white/80">{profileLabel}</span>
          </div>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 z-20 flex items-end gap-2 p-3 text-white sm:gap-3 sm:p-5">
          <div className="flex min-w-0 grow flex-col gap-1">
            <span className="ev-speaker-role max-w-full self-start truncate rounded-pill px-2.5 py-1 text-[11px] font-extrabold tracking-[0.06em] whitespace-nowrap uppercase">
              {role}
            </span>
            <Link
              href={href}
              className={cx(
                'leading-tight font-extrabold tracking-[-0.02em] text-white after:absolute after:inset-0 after:z-0 focus-visible:outline-none',
                featured
                  ? 'text-[length:calc(28px*var(--ev-scale,1))]'
                  : 'text-[length:calc(20px*var(--ev-scale,1))]',
              )}
            >
              {name}
            </Link>
            {meta ? <span className="line-clamp-2 text-caption text-white/80">{meta}</span> : null}
          </div>
          {bio ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bioId}
              aria-label={bioLabel}
              onClick={() => setOpen((v) => !v)}
              className="relative z-30 flex size-10 shrink-0 sm:size-11 cursor-pointer items-center justify-center rounded-full bg-white text-[#14110f] transition-transform hover:scale-105 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
            >
              <Plus
                aria-hidden="true"
                className="size-5 transition-transform group-data-[open]:rotate-45 motion-reduce:transition-none"
                strokeWidth={2.6}
              />
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
