'use client';

import type { SessionLevel } from '@yayatoh/command-center/client';
import { cx, ProgressBar, StatusDot } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation.ts';

/**
 * M5.9a conference pack tiles: session rooms live, session fill and lines, exhibitor and sponsor
 * activity. Each renders its loader's allowlisted DTO (counts, titles, exhibitor and sponsor
 * names); no people and no money reach them.
 */

interface Ctx {
  readonly locale: string;
  readonly timeZone: string;
  readonly base: string;
}

export type SessionAttendance = {
  timeZone: string;
  nearPct: number;
  running: number;
  nearlyFull: number;
  sessions: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    room: string | null;
    inRoom: number;
    capacity: number | null;
    level: SessionLevel;
    running: boolean;
  }[];
  more: number;
  kiosksOffline: number;
};

export type SessionFill = {
  nearPct: number;
  waitlistMax: number;
  limited: number;
  nearlyFull: number;
  full: number;
  waiting: number;
  longLines: number;
  roomsTooSmall: number;
  top: {
    id: string;
    title: string;
    enrolled: number;
    capacity: number;
    waiting: number;
    level: SessionLevel;
    roomTooSmall: boolean;
  }[];
};

export type ExhibitorActivity = {
  exhibitors: number;
  staffed: number;
  people: number;
  leads: { total: number; withoutLeads: number; top: { name: string; leads: number }[] } | null;
};

export type SponsorActivity = {
  sponsors: number;
  tiers: { tier: string; sponsors: number }[];
  deliverablesOverdue: number | null;
};

const num = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);
const LEVEL_DOT = { none: 'neutral', ok: 'success', near: 'warning', over: 'danger' } as const;
const LEVEL_BAR = { none: 'primary', ok: 'success', near: 'warning', over: 'danger' } as const;
/** In-widget tables (ADR 0022 table rhythm, without a second card frame). */
const TH = 'px-3 py-2 text-label tracking-[0.06em] text-ink-2 uppercase';
const TD = 'px-3 py-2.5 tabular-nums';
const TR = 'border-b border-line transition-colors duration-150 last:border-0 hover:bg-surface-2';
const CAPTION = 'pb-2 text-start text-[13px] font-bold text-ink';
const OPEN =
  'inline-flex min-h-7 items-center self-start text-body font-bold text-primary-ink underline underline-offset-2';

function Level({ level, near }: { level: SessionLevel; near: number }) {
  const t = useTranslations('commandCenter.widget.sessionLevel');
  return <StatusDot status={LEVEL_DOT[level]} label={t(level, { near })} />;
}

export function SessionAttendanceBody({ d, c }: { d: SessionAttendance; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.sessionAttendance');
  const time = new Intl.DateTimeFormat(c.locale, { timeStyle: 'short', timeZone: d.timeZone });
  return (
    <div className="flex flex-col gap-3" data-testid="cc-session-attendance">
      <p className="m-0 flex flex-wrap items-center gap-x-3 text-body text-ink">
        <span className="font-bold">{t('running', { count: d.running })}</span>
        {d.nearlyFull > 0 ? (
          <span className="text-danger">{t('nearlyFull', { count: d.nearlyFull })}</span>
        ) : null}
        {d.kiosksOffline > 0 ? (
          <StatusDot status="danger" label={t('kiosks', { count: d.kiosksOffline })} />
        ) : null}
      </p>
      {d.sessions.length === 0 ? (
        <p className="m-0 text-body text-ink-2">{t('none')}</p>
      ) : (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1)
        <section className="overflow-x-auto" aria-label={t('table')} tabIndex={0}>
          <table className="w-full border-collapse text-body">
            <caption className={CAPTION}>{t('table')}</caption>
            <thead>
              <tr className="border-b border-line">
                {[t('session'), t('in'), t('capacity'), t('status')].map((h, i) => (
                  <th key={h} scope="col" className={cx(TH, i ? 'text-end' : 'text-start')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.sessions.map((s) => (
                <tr key={s.id} className={TR} data-level={s.level} data-running={s.running}>
                  <th scope="row" className="px-3 py-2.5 text-start font-normal">
                    <span className="block font-bold text-ink">{s.title}</span>
                    <span className="block text-caption text-ink-2">
                      {[
                        s.room,
                        s.running
                          ? t('until', { time: time.format(new Date(s.endsAt)) })
                          : t('starts', { time: time.format(new Date(s.startsAt)) }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {s.capacity && s.running ? (
                      <ProgressBar
                        value={Math.min(s.inRoom, s.capacity)}
                        max={s.capacity}
                        label={t('meter', { title: s.title })}
                        tone={LEVEL_BAR[s.level]}
                      />
                    ) : null}
                  </th>
                  <td className={cx(TD, 'text-end')}>{num(s.inRoom, c.locale)}</td>
                  <td className={cx(TD, 'text-end')}>
                    {s.capacity === null ? '—' : num(s.capacity, c.locale)}
                  </td>
                  <td className={cx(TD, 'text-end')}>
                    <Level level={s.level} near={d.nearPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {d.more > 0 ? <p className="m-0 text-caption text-ink-2">{t('more', { count: d.more })}</p> : null}
      <Link href={`${c.base}/onsite/sessions`} className={OPEN}>
        {t('open')}
      </Link>
    </div>
  );
}

export function SessionFillBody({ d, c }: { d: SessionFill; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.sessionFill');
  if (d.limited === 0) return <p className="m-0 text-body text-ink-2">{t('none')}</p>;
  const facts = [
    t('full', { count: d.full }),
    t('waiting', { count: d.waiting }),
    ...(d.longLines > 0 ? [t('longLines', { count: d.longLines, max: d.waitlistMax })] : []),
    ...(d.roomsTooSmall > 0 ? [t('roomsTooSmall', { count: d.roomsTooSmall })] : []),
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="cc-session-fill">
      <p className="m-0 text-card text-ink tabular-nums" data-testid="cc-session-fill-near">
        {t('nearlyFull', { count: d.nearlyFull, limited: d.limited, near: d.nearPct })}
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-caption text-ink-2">
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {d.top.length > 0 ? (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable (WCAG 2.1.1)
        <section className="overflow-x-auto" aria-label={t('table')} tabIndex={0}>
          <table className="w-full border-collapse text-body">
            <caption className={CAPTION}>{t('table')}</caption>
            <thead>
              <tr className="border-b border-line">
                {[t('session'), t('enrolled'), t('waitingHeader'), t('status')].map((h, i) => (
                  <th key={h} scope="col" className={cx(TH, i ? 'text-end' : 'text-start')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.top.map((s) => (
                <tr key={s.id} className={TR} data-level={s.level}>
                  <th scope="row" className="px-3 py-2.5 text-start font-normal">
                    <span className="block font-bold text-ink">{s.title}</span>
                    {s.roomTooSmall ? (
                      <span className="block text-caption text-danger">{t('roomSmall')}</span>
                    ) : null}
                  </th>
                  <td className={cx(TD, 'text-end')}>
                    {t('ofCapacity', {
                      enrolled: num(s.enrolled, c.locale),
                      capacity: num(s.capacity, c.locale),
                    })}
                  </td>
                  <td className={cx(TD, 'text-end')}>{num(s.waiting, c.locale)}</td>
                  <td className={cx(TD, 'text-end')}>
                    <Level level={s.level} near={d.nearPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <Link href={`${c.base}/registration/enrollment`} className={OPEN}>
        {t('open')}
      </Link>
    </div>
  );
}

export function ExhibitorActivityBody({ d, c }: { d: ExhibitorActivity; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.exhibitorActivity');
  if (d.exhibitors === 0)
    return (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-body text-ink-2">{t('none')}</p>
        <Link href={`${c.base}/exhibitors`} className={OPEN}>
          {t('add')}
        </Link>
      </div>
    );
  return (
    <div className="flex flex-col gap-3" data-testid="cc-exhibitor-activity">
      <p className="m-0 text-card text-ink tabular-nums">
        {t('staffed', { staffed: num(d.staffed, c.locale), total: num(d.exhibitors, c.locale) })}
      </p>
      <p className="m-0 text-caption text-ink-2">{t('people', { count: d.people })}</p>
      {d.leads ? (
        <div className="flex flex-col gap-1" data-testid="cc-exhibitor-leads">
          <p className="m-0 text-body text-ink">
            {t('leads', { count: d.leads.total })}
            {d.leads.withoutLeads > 0 ? (
              <span className="text-danger"> · {t('withoutLeads', { count: d.leads.withoutLeads })}</span>
            ) : null}
          </p>
          {d.leads.top.length > 0 ? (
            <>
              <h3 className="m-0 text-caption font-bold text-ink-2">{t('top')}</h3>
              <ol className="m-0 flex list-none flex-col gap-1 p-0">
                {d.leads.top.map((e) => (
                  <li key={e.name} className="flex justify-between gap-3 text-body">
                    <span>{e.name}</span>
                    <span className="tabular-nums">{num(e.leads, c.locale)}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      ) : (
        <p className="m-0 text-caption text-ink-2">{t('leadsPending')}</p>
      )}
      <Link href={`${c.base}/exhibitors/portal`} className={OPEN}>
        {t('open')}
      </Link>
    </div>
  );
}

export function SponsorActivityBody({ d, c }: { d: SponsorActivity; c: Ctx }) {
  const t = useTranslations('commandCenter.widget.sponsorActivity');
  if (d.sponsors === 0)
    return (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-body text-ink-2">{t('none')}</p>
        <Link href={`${c.base}/sponsors`} className={OPEN}>
          {t('add')}
        </Link>
      </div>
    );
  return (
    <div className="flex flex-col gap-3" data-testid="cc-sponsor-activity">
      <p className="m-0 text-card text-ink tabular-nums">{t('total', { count: d.sponsors })}</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {d.tiers.map((x) => (
          <li key={x.tier} className="flex justify-between gap-3 text-body">
            <span>{x.tier}</span>
            <span className="tabular-nums">{num(x.sponsors, c.locale)}</span>
          </li>
        ))}
      </ul>
      {d.deliverablesOverdue === null ? (
        <p className="m-0 text-caption text-ink-2">{t('deliverablesPending')}</p>
      ) : (
        <p className={cx('m-0 text-body', d.deliverablesOverdue > 0 ? 'text-danger' : 'text-ink-2')}>
          {t('overdue', { count: d.deliverablesOverdue })}
        </p>
      )}
      <Link href={`${c.base}/sponsors`} className={OPEN}>
        {t('open')}
      </Link>
    </div>
  );
}
