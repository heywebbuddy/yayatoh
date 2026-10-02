import type { PublicMediaDto } from '@yayatoh/media';
import { groupByDay, type PublicProgramDto, type PublicSessionDto } from '@yayatoh/program';
import { getTranslations } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { MediaPicture } from '@/components/media-picture.tsx';
import { Link } from '@/i18n/navigation.ts';
import { sponsorLogoClass } from '@/lib/program-media.ts';

/** M1.4h: speaker photos and exhibitor/sponsor logos by row id (allowlisted `PublicMediaDto`). */
export type ProgramImages = Readonly<Record<string, PublicMediaDto>>;

const h2 = 'text-[28px] font-extrabold tracking-[-0.03em]';

/** One session row of the public agenda (times in the event's timezone). */
export function SessionRow({
  s,
  slug,
  time,
  day,
  images = {},
}: {
  s: PublicSessionDto;
  slug: string;
  time: Intl.DateTimeFormat;
  /** Shown before the times when the list mixes days (the speaker page). */
  day?: string;
  images?: ProgramImages;
}) {
  return (
    <li className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6">
      <span className="w-32 shrink-0 font-mono text-caption text-ink-2">
        {day ? <span className="block font-sans">{day}</span> : null}
        {time.format(s.startsAt)}–{time.format(s.endsAt)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium">{s.title}</span>
        {s.speakers.length > 0 ? (
          <span className="flex flex-wrap gap-x-2 text-caption">
            {s.speakers.map((p) => (
              <Link
                key={p.id}
                href={`/events/${slug}/speakers/${p.id}`}
                className="inline-flex min-h-6 items-center gap-1.5 text-ink-2 underline underline-offset-2"
              >
                {images[p.id] ? (
                  // The name follows, so the avatar adds nothing for screen readers.
                  <MediaPicture
                    image={images[p.id] as PublicMediaDto}
                    sizes="24px"
                    alt=""
                    className="size-6 rounded-full object-cover"
                  />
                ) : null}
                {p.name}
              </Link>
            ))}
          </span>
        ) : null}
        {s.description ? (
          <Markdown source={s.description} className="flex flex-col gap-2 text-caption text-ink-2" />
        ) : null}
      </span>
      {s.room || s.track ? (
        <span className="text-caption text-ink-2">{[s.room, s.track].filter(Boolean).join(' · ')}</span>
      ) : null}
    </li>
  );
}

/**
 * The public program (M1.4f): agenda grouped by day in the event's timezone, speakers,
 * exhibitors and sponsors. Each section appears only when it has content.
 */
export async function ProgramSections({
  program,
  slug,
  locale,
  timeZone,
  images = {},
}: {
  program: PublicProgramDto;
  slug: string;
  locale: string;
  timeZone: string;
  images?: ProgramImages;
}) {
  const t = await getTranslations('publicEvent');
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' });
  const dayLabel = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const days = groupByDay(program.sessions, timeZone);
  return (
    <>
      {days.length > 0 ? (
        <section
          id="agenda"
          aria-labelledby="agenda-heading"
          className="flex flex-col gap-4 px-6 pb-10 md:px-16"
        >
          <h2 id="agenda-heading" className={h2}>
            {t('agenda')}
          </h2>
          <p className="text-caption text-ink-2">
            {t('datesTimezone', { timezone: timeZone.replace(/_/g, ' ') })}
          </p>
          {days.map((d) => (
            <section key={d.day} aria-labelledby={`agenda-${d.day}`} className="flex flex-col gap-2">
              <h3 id={`agenda-${d.day}`} className="text-section">
                {dayLabel.format(new Date(`${d.day}T00:00:00Z`))}
              </h3>
              <ol className="list-none divide-y divide-line rounded-card border border-line p-0">
                {d.items.map((s) => (
                  <SessionRow key={s.id} s={s} slug={slug} time={time} images={images} />
                ))}
              </ol>
            </section>
          ))}
        </section>
      ) : null}
      {program.speakers.length > 0 ? (
        <section
          id="speakers"
          aria-labelledby="speakers-heading"
          className="flex flex-col gap-4 px-6 pb-10 md:px-16"
        >
          <h2 id="speakers-heading" className={h2}>
            {t('speakers')}
          </h2>
          <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {program.speakers.map((p) => {
              const photo = images[p.id];
              return (
                <li key={p.id} className="flex items-center gap-3 rounded-card border border-line p-4">
                  {photo ? (
                    <MediaPicture
                      image={photo}
                      sizes="64px"
                      className="size-16 shrink-0 rounded-full object-cover"
                    />
                  ) : null}
                  <span className="flex min-w-0 flex-col gap-1">
                    <Link
                      href={`/events/${slug}/speakers/${p.id}`}
                      className="inline-flex min-h-6 items-center font-medium underline underline-offset-2"
                    >
                      {p.name}
                    </Link>
                    {p.title || p.company ? (
                      <span className="text-caption text-ink-2">
                        {[p.title, p.company].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {program.exhibitors.length > 0 ? (
        <section
          id="exhibitors"
          aria-labelledby="exhibitors-heading"
          className="flex flex-col gap-4 px-6 pb-10 md:px-16"
        >
          <h2 id="exhibitors-heading" className={h2}>
            {t('exhibitors')}
          </h2>
          <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {program.exhibitors.map((x) => (
              <li key={x.id} className="flex flex-col gap-1 rounded-card border border-line p-4">
                {images[x.id] ? (
                  <MediaPicture
                    image={images[x.id] as PublicMediaDto}
                    sizes="192px"
                    className="h-12 w-auto max-w-48 self-start object-contain"
                  />
                ) : null}
                <span className="font-medium">{x.name}</span>
                {x.boothLabel ? (
                  <span className="text-caption text-ink-2">{t('booth', { booth: x.boothLabel })}</span>
                ) : null}
                {x.description ? (
                  <Markdown source={x.description} className="flex flex-col gap-2 text-caption text-ink-2" />
                ) : null}
                {x.websiteUrl ? (
                  <a
                    href={x.websiteUrl}
                    rel="noopener noreferrer nofollow"
                    className="inline-flex min-h-6 items-center text-caption underline underline-offset-2"
                  >
                    {t('website', { name: x.name })}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {program.sponsorTiers.length > 0 ? (
        <section
          id="sponsors"
          aria-labelledby="sponsors-heading"
          className="flex flex-col gap-4 px-6 pb-10 md:px-16"
        >
          <h2 id="sponsors-heading" className={h2}>
            {t('sponsors')}
          </h2>
          {program.sponsorTiers.map((tier, rank) => (
            <section key={tier.name} aria-label={tier.name} className="flex flex-col gap-2">
              <h3 className="text-label uppercase text-ink-2">{tier.name}</h3>
              <ul className="flex list-none flex-wrap gap-3 p-0">
                {tier.sponsors.map((s) => (
                  <li key={s.id} className="flex flex-col gap-1 rounded-card border border-line px-4 py-3">
                    {images[s.id] ? (
                      // Logos are sized by tier: the first tier's are the largest.
                      <MediaPicture
                        image={images[s.id] as PublicMediaDto}
                        sizes="320px"
                        className={`${sponsorLogoClass(rank)} w-auto max-w-full self-start object-contain`}
                      />
                    ) : null}
                    {s.websiteUrl ? (
                      <a
                        href={s.websiteUrl}
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-6 items-center font-medium underline underline-offset-2"
                      >
                        {s.name}
                      </a>
                    ) : (
                      <span className="font-medium">{s.name}</span>
                    )}
                    {s.description ? (
                      <Markdown
                        source={s.description}
                        className="flex flex-col gap-2 text-caption text-ink-2"
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      ) : null}
    </>
  );
}
