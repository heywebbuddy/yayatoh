import type { PlatformHero } from '@yayatoh/cms';
import { parseVideoUrl, videoEmbedUrl } from '@yayatoh/events/ui';
import type { PublicMediaDto } from '@yayatoh/media';
import { buttonClass, cx } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { MediaPicture } from '../media-picture.tsx';
import { HeroOrb } from './hero-orb.tsx';
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
    <div className={cx('animate-breathe relative aspect-square', className)}>
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
        <div className="absolute inset-0 bg-black/30 bg-linear-to-t from-black/50 via-transparent to-transparent" />
      </div>
      {children}
    </div>
  );
}

/** The home hero: a big headline over a large circular image with a jagged edge. */
export async function ShowcaseHero({
  cover,
  featured,
  override = null,
}: {
  cover?: PublicMediaDto | null | undefined;
  featured?: { name: string; href: string } | null;
  /** Staff-edited hero (admin console); empty fields keep the built-in copy. */
  override?: PlatformHero | null;
}) {
  const t = await getTranslations('showcase.hero');
  const embed = override?.videoUrl ? parseVideoUrl(override.videoUrl) : null;
  const hasMedia = Boolean(override?.videoFileUrl || embed || override?.imageUrl);
  const headline = override?.headline || t('title');
  const lede = override?.subtitle || t('lede');
  const ctaHref = override?.ctaHref || '/events';
  const ctaLabel = override?.ctaLabel || t('cta');
  if (hasMedia && override) {
    return (
      <section
        aria-labelledby="hero-title"
        className="relative flex flex-col items-center gap-8 overflow-x-clip pt-10 text-center md:pt-16"
      >
        <div className="relative aspect-video w-[min(94vw,1040px)] overflow-hidden rounded-card bg-ember">
          {override.videoFileUrl ? (
            <video
              src={override.videoFileUrl}
              poster={override.imageUrl ?? undefined}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              className="absolute inset-0 size-full object-cover"
            />
          ) : embed ? (
            <iframe
              src={`${videoEmbedUrl(embed)}${embed.provider === 'youtube' ? '?autoplay=1&mute=1&loop=1&controls=0&playlist=' + embed.id : '&autoplay=1&muted=1&loop=1&background=1'}`}
              title={headline}
              loading="lazy"
              allow="autoplay; encrypted-media; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              className="pointer-events-none absolute inset-0 size-full border-0"
            />
          ) : (
            <img src={override.imageUrl ?? ''} alt="" className="absolute inset-0 size-full object-cover" />
          )}
          <div className="absolute inset-0 bg-linear-to-t from-black/70 via-black/25 to-black/30" />
          <h1
            id="hero-title"
            className="absolute inset-0 m-0 flex items-center justify-center px-6 font-display text-[clamp(28px,6vw,80px)] leading-[0.98] font-black tracking-[-0.04em] text-balance text-white uppercase [text-shadow:0_2px_24px_var(--color-scrim)]"
          >
            {headline}
          </h1>
        </div>
        <p className="animate-rise max-w-xl text-[16px] text-ink-2 md:text-[18px]">{lede}</p>
        <div className="animate-rise flex flex-wrap items-center justify-center gap-3">
          <Link href={ctaHref} className={buttonClass('white', 'lg', 'px-8')}>
            {ctaLabel}
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
  return (
    <section
      aria-labelledby="hero-title"
      className="relative flex flex-col items-center gap-8 overflow-x-clip pt-10 text-center md:pt-16"
    >
      <HeroOrb cover={cover ?? null} className="w-[min(86vw,620px)]">
        <h1
          id="hero-title"
          className="pointer-events-none absolute inset-x-[-12%] top-1/2 -translate-y-1/2 px-2 font-display text-[clamp(32px,8vw,104px)] leading-[0.95] font-black tracking-[-0.04em] text-balance text-ink uppercase [text-shadow:0_2px_24px_var(--color-canvas),0_0_2px_var(--color-canvas)]"
        >
          {headline}
        </h1>
      </HeroOrb>
      <p className="animate-rise max-w-xl text-[16px] text-ink-2 [animation-delay:200ms] md:text-[18px]">
        {lede}
      </p>
      <div className="animate-rise flex flex-wrap items-center justify-center gap-3 [animation-delay:350ms]">
        <Link href={ctaHref} className={buttonClass('white', 'lg', 'px-8')}>
          {ctaLabel}
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
