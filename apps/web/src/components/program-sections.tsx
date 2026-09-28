import { groupByDay, type PublicProgramDto, type PublicSessionDto } from '@yayatoh/program';
import { getTranslations } from 'next-intl/server';
import { Markdown } from '@/components/markdown.tsx';
import { Link } from '@/i18n/navigation.ts';

const h2 = 'text-[28px] font-normal tracking-[-0.03em]';

/** One session row of the public agenda (times in the event's timezone). */
export function SessionRow({
  s,
  slug,
  time,
  day,
}: {
  s: PublicSessionDto;
  slug: string;
  time: Intl.DateTimeFormat;
  /** Shown before the times when the list mixes days (the speaker page). */
  day?: string;
}) {
  return (
    <li className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:gap-6">
      <span className="w-32 shrink-0 font-mono text-caption text-zinc-600">
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
                className="inline-flex min-h-6 items-center text-zinc-700 underline underline-offset-2"
              >
                {p.name}
              </Link>
            ))}
          </span>
        ) : null}
        {s.description ? (
          <Markdown source={s.description} className="flex flex-col gap-2 text-caption text-zinc-600" />
        ) : null}
      </span>
      {s.room || s.track ? (
        <span className="text-caption text-zinc-500">{[s.room, s.track].filter(Boolean).join(' · ')}</span>
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
}: {
  program: PublicProgramDto;
  slug: string;
  locale: string;
  timeZone: string;
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
          <p className="text-caption text-zinc-500">
            {t('datesTimezone', { timezone: timeZone.replace(/_/g, ' ') })}
          </p>
          {days.map((d) => (
            <section key={d.day} aria-labelledby={`agenda-${d.day}`} className="flex flex-col gap-2">
              <h3 id={`agenda-${d.day}`} className="text-section">
                {dayLabel.format(new Date(`${d.day}T00:00:00Z`))}
              </h3>
              <ol className="list-none divide-y divide-zinc-100 rounded-card border border-zinc-200 p-0">
                {d.items.map((s) => (
                  <SessionRow key={s.id} s={s} slug={slug} time={time} />
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
            {program.speakers.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 rounded-card border border-zinc-200 p-4">
                <Link
                  href={`/events/${slug}/speakers/${p.id}`}
                  className="inline-flex min-h-6 items-center font-medium underline underline-offset-2"
                >
                  {p.name}
                </Link>
                {p.title || p.company ? (
                  <span className="text-caption text-zinc-600">
                    {[p.title, p.company].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </li>
            ))}
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
              <li key={x.id} className="flex flex-col gap-1 rounded-card border border-zinc-200 p-4">
                <span className="font-medium">{x.name}</span>
                {x.boothLabel ? (
                  <span className="text-caption text-zinc-600">{t('booth', { booth: x.boothLabel })}</span>
                ) : null}
                {x.description ? (
                  <Markdown
                    source={x.description}
                    className="flex flex-col gap-2 text-caption text-zinc-600"
                  />
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
          {program.sponsorTiers.map((tier) => (
            <section key={tier.name} aria-label={tier.name} className="flex flex-col gap-2">
              <h3 className="font-mono text-label uppercase text-zinc-600">{tier.name}</h3>
              <ul className="flex list-none flex-wrap gap-3 p-0">
                {tier.sponsors.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-col gap-1 rounded-card border border-zinc-200 px-4 py-3"
                  >
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
                        className="flex flex-col gap-2 text-caption text-zinc-600"
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
