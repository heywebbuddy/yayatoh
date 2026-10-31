import type { PublicGivingDto } from '@yayatoh/donations';
import { pickupPointsQuery } from '@yayatoh/events';
import { createCtx, executeQuery, formatMoney, money } from '@yayatoh/kernel';
import { CalendarHeart, Clock, HeartHandshake, Mic2, Route, Sparkles, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { ports } from '@/server/ports.ts';

const panel = 'flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 elevation-card md:p-6';

interface AgendaRow {
  readonly time: string;
  readonly title: string;
  readonly room?: string | null;
}

/**
 * The band that opens the body of a public event page, different for each type of event: the
 * wedding's save-the-date, the gala's cause and giving meter, the conference's numbers, the
 * concert's set times, the tour's pickup points and route, the community's welcome. It reads data
 * the page already has (agenda, program counts, giving) plus the tour's pickup points; for the
 * other types it renders nothing.
 */
export async function EventProfileBand({
  profile,
  name,
  dateLabel,
  place,
  agenda,
  counts,
  giving,
  orgId,
  eventId,
  locale,
}: {
  profile: string;
  name: string;
  dateLabel: string;
  place: string | null;
  agenda: readonly AgendaRow[];
  counts: readonly { key: string; value: number }[];
  giving: PublicGivingDto | null;
  orgId: string | null;
  eventId: string | null;
  locale: string;
}) {
  const t = await getTranslations('eventBand');
  if (profile === 'wedding')
    return (
      <section aria-label={t('wedding.title')} className={`${panel} items-center text-center`}>
        <CalendarHeart aria-hidden="true" className="size-8 text-primary-ink" strokeWidth={1.5} />
        <p className="m-0 text-caption font-bold tracking-[0.2em] text-ink-2 uppercase">
          {t('wedding.title')}
        </p>
        <p className="m-0 [font-family:var(--font-heading-classic)] text-[28px] leading-tight md:text-[40px]">
          {name}
        </p>
        <p className="m-0 text-body text-ink-2">{[dateLabel, place].filter(Boolean).join(' · ')}</p>
        {agenda.length > 0 ? (
          <ol className="m-0 mt-2 flex w-full max-w-xl list-none flex-col gap-0 p-0 text-start">
            {agenda.slice(0, 6).map((a) => (
              <li key={`${a.time}-${a.title}`} className="flex gap-4 border-s-2 border-primary/40 py-2 ps-4">
                <span className="w-14 shrink-0 text-[14px] font-bold text-primary-ink tabular-nums">
                  {a.time}
                </span>
                <span className="text-[15px] font-bold">{a.title}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    );
  if (profile === 'gala') {
    const c = giving?.available ? giving.campaigns[0] : null;
    return (
      <section aria-label={t('gala.title')} className={panel}>
        <p className="m-0 flex items-center gap-2 text-caption font-bold tracking-[0.18em] text-primary-ink uppercase">
          <HeartHandshake aria-hidden="true" className="size-4" />
          {t('gala.title')}
        </p>
        {c ? (
          <>
            <p className="m-0 [font-family:var(--font-heading-classic)] text-[24px] leading-snug md:text-[30px]">
              {c.name}
            </p>
            {c.description ? <p className="m-0 max-w-2xl text-body text-ink-2">{c.description}</p> : null}
            {c.goalMinor ? (
              <div className="flex flex-col gap-2">
                <progress
                  className="h-3 w-full overflow-hidden rounded-pill accent-primary"
                  value={Math.min(c.raisedMinor, c.goalMinor)}
                  max={c.goalMinor}
                  aria-label={t('gala.progress')}
                />
                <p className="m-0 flex flex-wrap justify-between gap-2 text-body">
                  <span className="font-extrabold">
                    {t('gala.raised', { amount: formatMoney(money(c.raisedMinor, c.currency), locale) })}
                  </span>
                  <span className="text-ink-2">
                    {t('gala.goal', { amount: formatMoney(money(c.goalMinor, c.currency), locale) })}
                  </span>
                </p>
              </div>
            ) : (
              <p className="m-0 font-extrabold">
                {t('gala.raised', { amount: formatMoney(money(c.raisedMinor, c.currency), locale) })}
              </p>
            )}
          </>
        ) : (
          <p className="m-0 text-body text-ink-2">{t('gala.evening')}</p>
        )}
      </section>
    );
  }
  if (profile === 'conference' && counts.length > 0)
    return (
      <section aria-label={t('conference.title')} className={panel}>
        <p className="m-0 flex items-center gap-2 text-caption font-bold tracking-widest text-primary-ink uppercase">
          <Users aria-hidden="true" className="size-4" />
          {t('conference.title')}
        </p>
        <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {counts.map((s) => (
            <div key={s.key} className="flex flex-col-reverse gap-1">
              <dt className="text-caption text-ink-2">
                {t(`conference.counts.${s.key}` as 'conference.counts.sessions')}
              </dt>
              <dd className="m-0 text-[30px] leading-none font-extrabold tracking-[-0.03em] tabular-nums">
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    );
  if (profile === 'concert' && agenda.length > 0)
    return (
      <section aria-label={t('concert.title')} className={panel}>
        <p className="m-0 flex items-center gap-2 text-caption font-bold tracking-widest text-primary-ink uppercase">
          <Mic2 aria-hidden="true" className="size-4" />
          {t('concert.title')}
        </p>
        <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
          {agenda.map((a) => (
            <li
              key={`${a.time}-${a.title}`}
              className="flex min-w-40 flex-col gap-0.5 rounded-tile border border-line bg-surface-2 px-4 py-3"
            >
              <span className="flex items-center gap-1.5 text-[13px] font-bold text-primary-ink tabular-nums">
                <Clock aria-hidden="true" className="size-3.5" />
                {a.time}
              </span>
              <span className="text-[17px] font-extrabold">{a.title}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  if (profile === 'tour') {
    const points =
      orgId && eventId
        ? await executeQuery(
            pickupPointsQuery,
            { eventId },
            createCtx({ orgId, actor: { type: 'system', name: 'tour.public' } }),
            ports,
          ).catch(() => [])
        : [];
    if (points.length === 0 && agenda.length === 0) return null;
    return (
      <section aria-label={t('tour.title')} className={`${panel} md:grid md:grid-cols-2 md:gap-8`}>
        {points.length > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 flex items-center gap-2 text-caption font-bold tracking-widest text-primary-ink uppercase">
              <Route aria-hidden="true" className="size-4" />
              {t('tour.pickups')}
            </p>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {points.map((p, i) => (
                <li key={p.id} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-extrabold text-on-primary"
                  >
                    {i + 1}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[16px] font-extrabold">{p.name}</span>
                    {p.address ? <span className="text-caption text-ink-2">{p.address}</span> : null}
                    <span className="text-caption text-ink-2">
                      {p.minutesBefore > 0 ? t('tour.before', { minutes: p.minutesBefore }) : t('tour.at')}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {agenda.length > 0 ? (
          <div className="flex flex-col gap-3">
            <p className="m-0 flex items-center gap-2 text-caption font-bold tracking-widest text-primary-ink uppercase">
              <Sparkles aria-hidden="true" className="size-4" />
              {t('tour.itinerary')}
            </p>
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {agenda.map((a) => (
                <li key={`${a.time}-${a.title}`} className="flex gap-3 border-s-2 border-primary/40 ps-3">
                  <span className="w-14 shrink-0 text-[14px] font-bold tabular-nums">{a.time}</span>
                  <span className="text-[15px]">{a.title}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>
    );
  }
  if (profile === 'community')
    return (
      <section aria-label={t('community.title')} className={`${panel} sm:flex-row sm:items-center`}>
        <HeartHandshake aria-hidden="true" className="size-10 shrink-0 text-primary-ink" strokeWidth={1.5} />
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[20px] font-extrabold">{t('community.title')}</p>
          <p className="m-0 text-body text-ink-2">{t('community.body')}</p>
        </div>
      </section>
    );
  return null;
}
