import type { PublicMediaDto } from '@yayatoh/media';
import { buttonClass, cx } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { MediaPicture } from '../media-picture.tsx';
import { jaggedCirclePath } from './jagged.ts';

const JAG = jaggedCirclePath();

/** The sound-wave circle: an image (or red-orange-pink art) clipped to a jagged round edge. */
export function JaggedCircle({
  cover,
  className,
  children,
}: {
  cover?: PublicMediaDto | null | undefined;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cx('relative aspect-square', className)}>
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="yy-jag" clipPathUnits="objectBoundingBox">
            <path d={JAG} />
          </clipPath>
        </defs>
      </svg>
      {/* A slow glow behind the rim, so the edge looks lit. */}
      <div
        aria-hidden="true"
        className="animate-glow absolute inset-[6%] rounded-full bg-ember opacity-70 blur-3xl"
      />
      <div className="absolute inset-0 overflow-hidden [clip-path:url(#yy-jag)]">
        {cover ? (
          <MediaPicture
            image={cover}
            sizes="(min-width: 1024px) 560px, 90vw"
            className="size-full object-cover"
            eager
          />
        ) : (
          <div className="size-full bg-ember">
            <div className="size-full bg-linear-to-br from-white/30 via-transparent to-black/40" />
          </div>
        )}
        <div className="absolute inset-0 bg-linear-to-t from-black/45 via-transparent to-transparent" />
      </div>
      {children}
    </div>
  );
}

/** The home hero: a big headline over a large circular image with a jagged edge. */
export async function ShowcaseHero({
  cover,
  featured,
}: {
  cover?: PublicMediaDto | null | undefined;
  featured?: { name: string; href: string } | null;
}) {
  const t = await getTranslations('showcase.hero');
  return (
    <section
      aria-labelledby="hero-title"
      className="relative flex flex-col items-center gap-8 pt-10 text-center md:pt-16"
    >
      <div className="relative flex w-full flex-col items-center">
        <JaggedCircle cover={cover} className="w-[min(78vw,560px)]" />
        <h1
          id="hero-title"
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-2 font-display text-[clamp(34px,8.4vw,112px)] leading-[0.95] font-black tracking-[-0.04em] text-balance text-white uppercase [text-shadow:0_4px_40px_var(--color-scrim)]"
        >
          {t('title')}
        </h1>
      </div>
      <p className="max-w-xl text-[16px] text-ink-2 md:text-[18px]">{t('lede')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/events" className={buttonClass('white', 'lg', 'px-8')}>
          {t('cta')}
        </Link>
        {featured ? (
          <Link href={featured.href} className={buttonClass('secondary', 'lg', 'rounded-pill px-6')}>
            {featured.name}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
