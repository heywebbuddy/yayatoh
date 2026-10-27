import type { ListingDto } from '@yayatoh/marketplace';
import type { PublicMediaDto } from '@yayatoh/media';
import { buttonClass, cx } from '@yayatoh/ui';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation.ts';
import { MediaPicture } from '../media-picture.tsx';
import { artGlow, GLOW } from './categories.ts';

const FAN = [
  'rotate-[-9deg] translate-y-3 z-0',
  'rotate-[-1deg] -translate-y-2 z-10 scale-105',
  'rotate-[8deg] translate-y-4 z-0',
];

/** "Earn more from every event": the organizer call to action with a fan of real event posters. */
export async function OrganizerCta({
  events,
  covers,
}: {
  events: readonly ListingDto[];
  covers: ReadonlyMap<string, PublicMediaDto>;
}) {
  const t = await getTranslations('showcase.organizerCta');
  const fan = events.slice(0, 3);
  return (
    <section
      aria-labelledby="organizer-cta"
      className="relative grid items-center gap-10 overflow-hidden rounded-[36px] border border-line bg-surface p-6 md:grid-cols-2 md:p-12"
    >
      <div
        aria-hidden="true"
        className="animate-glow pointer-events-none absolute -end-24 -top-24 size-96 rounded-full bg-ember opacity-30 blur-3xl"
      />
      <div className="relative flex flex-col items-start gap-5">
        <h2
          id="organizer-cta"
          className="font-display text-[32px] leading-[1.02] font-black tracking-[-0.03em] uppercase md:text-[48px]"
        >
          {t('title')}
        </h2>
        <p className="max-w-md text-[16px] text-ink-2">{t('lede')}</p>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-body text-ink-2">
          {(['one', 'two', 'three'] as const).map((k) => (
            <li key={k} className="flex items-center gap-2">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-ember" />
              {t(`points.${k}`)}
            </li>
          ))}
        </ul>
        <Link href="/signup" className={buttonClass('ember', 'lg', 'px-8')}>
          {t('cta')}
        </Link>
      </div>
      <div
        aria-hidden="true"
        className="relative mx-auto flex h-[260px] w-full max-w-[420px] items-center justify-center md:h-[340px]"
      >
        {(fan.length > 0 ? fan : [null, null, null]).map((l, i) => {
          const cover = l ? covers.get(l.slug) : null;
          const key = l?.slug ?? `placeholder-${i}`;
          return (
            <div
              key={key}
              className={cx(
                '-ms-10 aspect-[3/4] w-[44%] overflow-hidden rounded-card border border-white/15 elevation-pop first:ms-0',
                FAN[i],
              )}
            >
              {cover ? (
                <MediaPicture
                  image={{ ...cover, decorative: true }}
                  sizes="180px"
                  className="size-full object-cover"
                />
              ) : (
                <div className={cx('flex size-full items-end bg-linear-to-br p-3', GLOW[artGlow(key)].art)}>
                  <span className="font-display text-[22px] leading-none font-black text-white/90 uppercase">
                    {l?.name.slice(0, 2) ?? 'YY'}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
