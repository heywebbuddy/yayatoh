import type { PublicMediaDto } from '@yayatoh/media';
import { groupByDay, type PublicProgramDto, speakerRoleRank } from '@yayatoh/program';
import { buttonClass } from '@yayatoh/ui';
import { ExternalLink, Map as MapIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { CSSProperties, ReactNode } from 'react';
import { AgendaRow } from '@/components/agenda-accordion.tsx';
import { Markdown } from '@/components/markdown.tsx';
import { MediaPicture } from '@/components/media-picture.tsx';
import type { ProgramImages } from '@/components/program-sections.tsx';
import { SpeakerCard } from '@/components/speaker-card.tsx';
import { Link } from '@/i18n/navigation.ts';
import { zoneLabel } from '@/lib/zone-label.ts';

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
      className="ev-card flex flex-col gap-8 rounded-panel p-6 md:p-10"
    >
      <div className="flex flex-col gap-4">
        <SectionIntro
          id="agenda-heading"
          eyebrow={tp('agendaEyebrow')}
          title={t('agenda')}
          lede={days.length > 0 ? t('datesTimezone', { timezone: zoneLabel(timeZone, locale) }) : null}
        />
      </div>
      <div className="flex w-full min-w-0 flex-col gap-8">
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
                                  className="inline-flex min-h-9 items-center gap-2 rounded-pill bg-surface py-1 ps-1 pe-3 font-bold text-ink hover:bg-surface-3"
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
                            className={buttonClass('secondary', 'md', 'self-start')}
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

/** Initials for a portrait without a photo. */
const initialsOf = (name: string) =>
  name
    .replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** The left-aligned section heading of the landing look: an eyebrow, a title and an optional lede. */
export function SectionIntro({
  id,
  eyebrow,
  title,
  lede,
  action,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  lede?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex max-w-[640px] flex-col gap-2">
        {eyebrow ? (
          <span className="ev-eyebrow text-label font-extrabold tracking-[0.14em] uppercase">{eyebrow}</span>
        ) : null}
        <h2
          id={id}
          className="m-0 font-display text-[length:calc(clamp(26px,3.4vw,34px)*var(--ev-scale,1))] leading-none font-black tracking-[-0.02em] uppercase [overflow-wrap:anywhere]"
        >
          {title}
        </h2>
        {lede ? <p className="m-0 text-body text-ink-2">{lede}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * The speakers as an image-led grid: large portraits (the featured people take a double tile),
 * name and role over the photo, the bio revealed on hover, focus or a tap. A speaker without a
 * photo gets an initials tile in the event's accent.
 */
export async function SpeakerGrid({
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
  // Only the first featured person gets the large tile, and only when the grid has room for it.
  const lead = people.length >= 4 && people[0]?.featured ? people[0].id : null;
  return (
    <section
      id="speakers"
      data-block="speakers"
      data-ev-section
      aria-labelledby="speakers-heading"
      style={style}
      className="flex flex-col gap-8 py-4"
    >
      <SectionIntro id="speakers-heading" eyebrow={tp('speakersEyebrow')} title={t('speakers')} />
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 lg:grid-cols-3">
        {people.map((p) => {
          const photo = images[p.id];
          return (
            <SpeakerCard
              key={p.id}
              href={`/events/${slug}/speakers/${p.id}`}
              name={p.name}
              role={t(`speakerRoles.${p.role}`)}
              meta={[p.title, p.company].filter(Boolean).join(' · ') || null}
              bio={p.bio}
              bioLabel={tp('speakerBio', { name: p.name })}
              profileLabel={tp('speakerProfile')}
              featured={p.id === lead}
              portrait={
                photo ? (
                  <MediaPicture
                    image={photo}
                    sizes={
                      p.id === lead ? '(min-width: 1024px) 50vw, 100vw' : '(min-width: 1024px) 25vw, 50vw'
                    }
                    alt=""
                    className="ev-speaker-photo size-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="ev-speaker-fallback flex size-full items-start justify-center pt-[22%] font-display text-[clamp(56px,8vw,96px)] leading-none font-black tracking-[-0.04em]"
                  >
                    {initialsOf(p.name)}
                  </span>
                )
              }
            />
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Exhibitors as logo-led cards: the logo on a quiet tile (initials without one), the name, the
 * booth as a badge, and a short description. The whole card opens the exhibitor page; the
 * website is its own small button above that link.
 */
export async function ExhibitorGrid({
  program,
  slug,
  images = {},
  exhibitorMap = false,
  style,
}: {
  program: PublicProgramDto;
  slug: string;
  images?: ProgramImages;
  exhibitorMap?: boolean;
  style?: CSSProperties;
}) {
  if (program.exhibitors.length === 0) return null;
  const t = await getTranslations('publicEvent');
  const tp = await getTranslations('eventPage');
  return (
    <section
      id="exhibitors"
      data-ev-section
      aria-labelledby="exhibitors-heading"
      style={style}
      className="ev-card flex flex-col gap-8 rounded-panel p-6 md:p-10"
    >
      <SectionIntro
        id="exhibitors-heading"
        eyebrow={tp('exhibitorsEyebrow')}
        title={t('exhibitors')}
        action={
          exhibitorMap ? (
            <Link href={`/events/${slug}/exhibitors`} className={buttonClass('secondary', 'md')}>
              <MapIcon aria-hidden="true" className="size-4" />
              {t('exhibitorMap')}
            </Link>
          ) : null
        }
      />
      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {program.exhibitors.map((x) => {
          const logo = images[x.id];
          return (
            <li
              key={x.id}
              className="ev-lift group relative flex flex-col gap-4 rounded-card border border-line bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-16 w-32 items-center justify-start">
                  {logo ? (
                    <MediaPicture
                      image={logo}
                      sizes="128px"
                      alt=""
                      className="max-h-16 w-auto max-w-32 object-contain"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="ev-accent-fill flex size-14 items-center justify-center rounded-tile text-[18px] font-black"
                    >
                      {initialsOf(x.name)}
                    </span>
                  )}
                </div>
                {x.boothLabel ? (
                  <span className="ev-badge inline-flex shrink-0 items-center rounded-pill px-3 py-1 text-caption font-extrabold tabular-nums">
                    {t('booth', { booth: x.boothLabel })}
                  </span>
                ) : null}
              </div>
              <div className="flex grow flex-col gap-1.5">
                <Link
                  href={`/events/${slug}/exhibitors/${x.id}`}
                  className="text-[length:calc(18px*var(--ev-scale,1))] leading-tight font-extrabold text-ink after:absolute after:inset-0 after:rounded-card focus-visible:outline-none"
                >
                  {x.name}
                </Link>
                {x.description ? (
                  <p className="m-0 line-clamp-3 text-caption text-ink-2">{plain(x.description)}</p>
                ) : null}
              </div>
              {x.websiteUrl ? (
                <a
                  href={x.websiteUrl}
                  rel="noopener noreferrer nofollow"
                  className="relative z-10 inline-flex min-h-9 max-w-full items-center gap-1.5 self-start rounded-pill border border-line px-3 text-caption font-bold whitespace-nowrap text-ink-2 hover:border-ink hover:text-ink"
                >
                  <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">{t('website', { name: x.name })}</span>
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A Markdown description as one plain line (cards show a short excerpt). */
const plain = (md: string) =>
  md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
