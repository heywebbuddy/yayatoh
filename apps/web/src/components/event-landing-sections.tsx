import type { PublicMediaDto } from '@yayatoh/media';
import { groupByDay, type PublicProgramDto, speakerRoleRank } from '@yayatoh/program';
import { getTranslations } from 'next-intl/server';
import type { CSSProperties } from 'react';
import { AgendaRow } from '@/components/agenda-accordion.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { MediaPicture } from '@/components/media-picture.tsx';
import type { ProgramImages } from '@/components/program-sections.tsx';
import { SpeakerCarousel } from '@/components/speaker-carousel.tsx';
import { Link } from '@/i18n/navigation.ts';
import { zoneLabel } from '@/lib/zone-label.ts';

/** The centered section heading of the landing page (an accent bar above). */
export function LandingHeading({
  id,
  children,
  onBand = false,
}: {
  id: string;
  children: string;
  onBand?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <span
        aria-hidden="true"
        className={
          onBand ? 'h-1.5 w-12 rounded-full bg-current opacity-70' : 'ev-accent-bar h-1.5 w-12 rounded-full'
        }
      />
      <h2
        id={id}
        className="m-0 text-[length:calc(36px*var(--ev-scale,1))] leading-[1.1] font-extrabold tracking-[-0.03em]"
      >
        {children}
      </h2>
    </div>
  );
}

/** A simple agenda item from the showcase overlay (no session behind it). */
export type DemoAgendaItem = { time: string; title: string; room?: string };

/**
 * The agenda as the client's reference shows it: a centered heading over a stack of rounded
 * light-grey rows, each a monospace time range in the accent colour above a bold title. Sessions
 * with a description (or speakers) open as accordions; breaks stay plain.
 */
export async function EventAgenda({
  program,
  demo,
  slug,
  locale,
  timeZone,
  images = {},
  liveSessions = [],
  style,
}: {
  program: PublicProgramDto;
  demo: readonly DemoAgendaItem[];
  slug: string;
  locale: string;
  timeZone: string;
  images?: ProgramImages;
  liveSessions?: readonly string[];
  style?: CSSProperties;
}) {
  const t = await getTranslations('publicEvent');
  const tp = await getTranslations('eventPage');
  const tl = await getTranslations('engagement.participant');
  const ta = await getTranslations('agenda');
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' });
  const dayLabel = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const days = groupByDay(program.sessions, timeZone);
  if (days.length === 0 && demo.length === 0) return null;
  return (
    <section
      id="agenda"
      data-block="agenda"
      data-ev-section
      aria-labelledby="agenda-heading"
      style={style}
      className="ev-card flex flex-col gap-6 rounded-[28px] px-4 py-10 sm:px-8 md:py-14"
    >
      <LandingHeading id="agenda-heading">{t('agenda')}</LandingHeading>
      {days.length > 0 ? (
        <p className="m-0 -mt-3 text-center text-caption text-ink-2">
          {t('datesTimezone', { timezone: zoneLabel(timeZone, locale) })}
        </p>
      ) : null}
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-8">
        {days.map((d) => (
          <section key={d.day} aria-labelledby={`agenda-${d.day}`} className="flex flex-col gap-3">
            {days.length > 1 ? (
              <h3 id={`agenda-${d.day}`} className="m-0 text-card text-ink">
                {dayLabel.format(new Date(`${d.day}T00:00:00Z`))}
              </h3>
            ) : (
              <h3 id={`agenda-${d.day}`} className="sr-only">
                {dayLabel.format(new Date(`${d.day}T00:00:00Z`))}
              </h3>
            )}
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {d.items.map((s) => {
                const kind = [s.type, s.admission === 'optional' ? ta('optional') : undefined].filter(
                  Boolean,
                );
                const meta = [...kind, s.room, s.track].filter(Boolean).join(' · ') || null;
                const live = liveSessions.includes(s.id);
                const hasDetails = Boolean(s.description) || s.speakers.length > 0 || live;
                return (
                  <AgendaRow
                    key={s.id}
                    time={`${time.format(s.startsAt)}–${time.format(s.endsAt)}`}
                    title={s.title}
                    meta={meta}
                    expandLabel={tp('showDetails', { title: s.title })}
                  >
                    {hasDetails ? (
                      <div className="flex flex-col gap-3">
                        {s.description ? (
                          <Markdown source={s.description} className="flex flex-col gap-2" />
                        ) : null}
                        {s.speakers.length > 0 ? (
                          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0">
                            {s.speakers.map((p) => (
                              <li key={p.id}>
                                <Link
                                  href={`/events/${slug}/speakers/${p.id}`}
                                  className="inline-flex min-h-6 items-center gap-2 font-bold text-ink underline underline-offset-2"
                                >
                                  {images[p.id] ? (
                                    <MediaPicture
                                      image={images[p.id] as PublicMediaDto}
                                      sizes="28px"
                                      alt=""
                                      className="size-7 rounded-full object-cover"
                                    />
                                  ) : null}
                                  {p.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {live ? (
                          <Link
                            href={`/events/${slug}/live/${s.id}`}
                            className="inline-flex min-h-11 items-center self-start font-bold underline underline-offset-2"
                          >
                            {tl('join')}
                          </Link>
                        ) : null}
                      </div>
                    ) : undefined}
                  </AgendaRow>
                );
              })}
            </ol>
          </section>
        ))}
        {days.length === 0 ? (
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {demo.map((s) => (
              <AgendaRow
                key={`${s.time}-${s.title}`}
                time={s.time}
                title={s.title}
                meta={s.room ?? null}
                expandLabel=""
              />
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  );
}

const SHAPES = ['ev-shape-circle', 'ev-shape-quarter', 'ev-shape-pill', 'ev-shape-diamond'] as const;
const TONES = ['ev-tone-1', 'ev-tone-2', 'ev-tone-3'] as const;

/**
 * The speakers as the client's reference shows them: a bold full-width colour band with soft
 * background shapes and a centered white heading, over a carousel of white cards (photo beside a
 * decorative geometric shape in a varying accent, company, name, bold role and job title).
 */
export async function SpeakerBand({
  program,
  slug,
  images = {},
  style,
}: {
  program: PublicProgramDto;
  slug: string;
  images?: ProgramImages;
  style?: CSSProperties;
}) {
  if (program.speakers.length === 0) return null;
  const t = await getTranslations('publicEvent');
  const tp = await getTranslations('eventPage');
  const people = [...program.speakers].sort(
    (a, b) =>
      Number(b.featured) - Number(a.featured) ||
      speakerRoleRank(a.role) - speakerRoleRank(b.role) ||
      a.name.localeCompare(b.name),
  );
  return (
    <section
      id="speakers"
      data-block="speakers"
      aria-labelledby="speakers-heading"
      style={style}
      className="ev-band relative isolate flex flex-col gap-8 overflow-hidden rounded-[28px] px-4 py-12 sm:px-8 md:py-16"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -start-24 -top-28 -z-10 size-[380px] rounded-full bg-white/12"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-20 -bottom-32 -z-10 size-[460px] rotate-12 rounded-[120px] bg-black/10"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute end-[30%] top-10 -z-10 size-40 rounded-full bg-white/8"
      />
      <LandingHeading id="speakers-heading" onBand>
        {t('speakers')}
      </LandingHeading>
      <SpeakerCarousel label={t('speakers')} prevLabel={tp('previous')} nextLabel={tp('next')}>
        {people.map((p, i) => {
          const photo = images[p.id];
          return (
            <li
              key={p.id}
              className="flex w-[78%] max-w-[300px] shrink-0 snap-start flex-col gap-4 rounded-[24px] ev-white-card p-5 shadow-xl sm:w-[280px]"
            >
              <div className="relative flex h-44 items-end">
                <span
                  aria-hidden="true"
                  className={`ev-shape ${SHAPES[i % SHAPES.length]} ${TONES[i % TONES.length]}`}
                />
                {photo ? (
                  <MediaPicture
                    image={photo}
                    sizes="176px"
                    alt=""
                    className="relative size-40 rounded-[20px] object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className={`relative flex size-40 items-center justify-center rounded-[20px] text-[48px] font-extrabold ${TONES[i % TONES.length]} ev-tone-fill`}
                  >
                    {p.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase() ?? '')
                      .join('')}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {p.company ? (
                  <span className="text-[13px] font-extrabold tracking-[0.08em] ev-muted uppercase">
                    {p.company}
                  </span>
                ) : null}
                <Link
                  href={`/events/${slug}/speakers/${p.id}`}
                  className="text-[length:calc(20px*var(--ev-scale,1))] leading-tight font-extrabold underline-offset-2 hover:underline"
                >
                  {p.name}
                </Link>
                <span className="text-[15px] font-extrabold">
                  {t(`speakerRoles.${p.role}`)}
                </span>
                {p.title ? <span className="text-[14px] ev-muted">{p.title}</span> : null}
              </div>
            </li>
          );
        })}
      </SpeakerCarousel>
    </section>
  );
}
