'use client';

import type { TvBoardDto } from '@yayatoh/command-center';
import { BarChart, buttonClass, ChartTable, cx } from '@yayatoh/ui';
import { Maximize } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';

/** How often the screen re-reads its board. */
const REFRESH_MS = 5_000;

type Board = Omit<TvBoardDto, never>;

const num = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);
const dec = (n: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);

/** A glass tile on the dark board (ADR 0022: the Command Center's dark look, sized for a room). */
function Tile({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <section
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-6 elevation-card glass md:p-8"
      data-testid={testId}
    >
      <h2 className="m-0 text-[15px] font-extrabold tracking-[0.08em] text-ink-2 uppercase">{label}</h2>
      {children}
    </section>
  );
}

/** The venue screen is always dark: a lit room reads it better and it never glares. */
const TV_FRAME = 'min-h-dvh bg-page text-ink';

const BIG = 'm-0 leading-none font-extrabold tracking-[-0.04em] tabular-nums';
const SUB = 'm-0 text-[20px] font-semibold text-ink-2';

const LEVEL_TEXT = {
  none: 'text-ink',
  ok: 'text-success',
  near: 'text-warning',
  over: 'text-danger',
};

/**
 * The TV board (M3.3a): large type for a venue screen, read-only, re-read every 5 seconds from the
 * display link's endpoint. When the link is revoked the screen says so at its next refresh.
 */
export function TvBoard({ token, initial, locale }: { token: string; initial: Board; locale: string }) {
  const t = useTranslations('tv');
  const [board, setBoard] = useState<Board>(initial);
  const [off, setOff] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/tv/${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (!alive) return;
        if (res.status === 404) {
          setOff(true);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        setBoard((await res.json()) as Board);
        setStale(false);
      } catch {
        if (alive) setStale(true);
      }
    };
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [token]);

  if (off)
    return (
      <main
        data-theme="dark"
        className={cx(TV_FRAME, 'flex flex-col items-center justify-center gap-3 p-8 text-center')}
      >
        <h1 className="m-0 text-title text-ink">{t('offTitle')}</h1>
        <p className={SUB}>{t('offDescription')}</p>
      </main>
    );

  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'medium', timeZone: board.timeZone });
  const clock = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: board.timeZone });
  const bars = board.speed.series.map((p) => ({ label: clock.format(new Date(p.at)), value: p.count }));
  const cap = board.capacity;
  return (
    <main
      data-theme="dark"
      className={cx(TV_FRAME, 'flex flex-col gap-6 p-6 md:p-10')}
      data-testid="tv-board"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="m-0 inline-flex items-center gap-2 text-[15px] font-extrabold tracking-[0.08em] text-success uppercase">
            <span
              aria-hidden="true"
              className="size-2.5 animate-pulse rounded-full bg-success-dot motion-reduce:animate-none"
            />
            {t('eyebrow')}
          </p>
          <h1 className="m-0 text-[40px] leading-[1.05] font-extrabold tracking-[-0.045em] text-balance md:text-display">
            {board.eventName}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <p
            role="status"
            aria-live="polite"
            className="m-0 text-body font-semibold text-ink-2 tabular-nums"
            data-testid="tv-updated"
          >
            {stale
              ? t('stale', { time: time.format(new Date(board.asOf)) })
              : t('updated', { time: time.format(new Date(board.asOf)) })}
          </p>
          <button
            type="button"
            className={buttonClass('secondary')}
            onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
          >
            <Maximize aria-hidden="true" className="size-4" />
            {t('fullScreen')}
          </button>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Tile label={t('checkedIn')} testId="tv-checkins">
          <p className={cx(BIG, 'text-[96px] text-ink')} data-testid="tv-checkins-today">
            {num(board.checkins.today, locale)}
          </p>
          <p className={SUB}>
            {t('ofValid', {
              total: num(board.checkins.total, locale),
              valid: num(board.checkins.valid, locale),
            })}
          </p>
        </Tile>
        <Tile label={t('capacity')} testId="tv-capacity">
          <p className={cx(BIG, 'text-[64px]', LEVEL_TEXT[cap.level])}>
            {cap.percent === null ? num(cap.inside, locale) : `${num(cap.percent, locale)}%`}
          </p>
          <p className={SUB}>
            {cap.capacity === null
              ? t('insideNoCap', { inside: num(cap.inside, locale) })
              : t('inside', { inside: num(cap.inside, locale), capacity: num(cap.capacity, locale) })}
          </p>
          <p className={cx('m-0 text-[20px] font-extrabold', LEVEL_TEXT[cap.level])}>
            {t(`level.${cap.level}`)}
          </p>
        </Tile>
        <Tile label={t('speed')} testId="tv-speed">
          <p className={cx(BIG, 'text-[64px] text-ink')}>{dec(board.speed.scansPerMin, locale)}</p>
          <p className={SUB}>
            {board.speed.queueMin === null
              ? t('perMinuteStopped')
              : t('perMinute', { minutes: board.speed.queueMin })}
          </p>
        </Tile>
        <Tile label={t('devices')} testId="tv-devices">
          <p className={cx(BIG, 'text-[64px] text-ink')}>
            {t('devicesValue', {
              online: num(board.devices.online, locale),
              total: num(board.devices.total, locale),
            })}
          </p>
        </Tile>
        <Tile label={t('issues')} testId="tv-issues">
          <p className="m-0 text-[28px] leading-tight font-extrabold text-ink">
            {t('issuesValue', { duplicates: board.issues.duplicates, refused: board.issues.refused })}
          </p>
        </Tile>
        {board.speed.entrances.length > 0 ? (
          <Tile label={t('entrances')} testId="tv-entrances">
            <table className="w-full border-collapse text-[20px]">
              <caption className="sr-only">{t('entrances')}</caption>
              <thead>
                <tr className="border-b border-line-strong">
                  <th
                    scope="col"
                    className="py-2 text-start text-[15px] font-extrabold tracking-[0.06em] text-ink-2 uppercase"
                  >
                    {t('entrance')}
                  </th>
                  <th
                    scope="col"
                    className="py-2 text-end text-[15px] font-extrabold tracking-[0.06em] text-ink-2 uppercase"
                  >
                    {t('entrancePerMinute')}
                  </th>
                  <th
                    scope="col"
                    className="py-2 text-end text-[15px] font-extrabold tracking-[0.06em] text-ink-2 uppercase"
                  >
                    {t('entranceQueue')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {board.speed.entrances.map((e) => (
                  <tr key={e.name ?? '-'} className="border-b border-line last:border-0">
                    <th scope="row" className="py-3 text-start font-bold">
                      {e.name ?? t('noEntrance')}
                    </th>
                    <td className="py-3 text-end font-bold tabular-nums">{dec(e.scansPerMin, locale)}</td>
                    <td className="py-3 text-end font-bold tabular-nums">
                      {e.queueMin === null ? '—' : t('minutes', { count: e.queueMin })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tile>
        ) : null}
      </div>
      <section className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-6 elevation-card glass md:p-8">
        <h2 className="m-0 text-[15px] font-extrabold tracking-[0.08em] text-ink-2 uppercase">
          {t('chartTitle')}
        </h2>
        <BarChart title={t('chartTitle')} bars={bars} height={180} />
        <div className="text-ink-2">
          <ChartTable
            toggle={t('showTable')}
            caption={t('chartTitle')}
            headers={[t('minute'), t('checkedInColumn')]}
            rows={bars.map((b) => [b.label, num(b.value, locale)])}
          />
        </div>
      </section>
    </main>
  );
}
