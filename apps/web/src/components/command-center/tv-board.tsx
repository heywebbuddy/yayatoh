'use client';

import type { TvBoardDto } from '@yayatoh/command-center';
import { BarChart, ChartTable, cx } from '@yayatoh/ui';
import { Maximize } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';

/** How often the screen re-reads its board. */
const REFRESH_MS = 5_000;

type Board = Omit<TvBoardDto, never>;

const num = (n: number, locale: string) => new Intl.NumberFormat(locale).format(n);
const dec = (n: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);

function Tile({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-3xl bg-zinc-800 p-6" data-testid={testId}>
      <h2 className="text-section text-zinc-300">{label}</h2>
      {children}
    </section>
  );
}

const LEVEL_TEXT = {
  none: 'text-white',
  ok: 'text-green-500',
  near: 'text-yellow-500',
  over: 'text-pink-500',
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
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-zinc-900 p-8 text-center text-white">
        <h1 className="text-[40px] font-light">{t('offTitle')}</h1>
        <p className="text-section text-zinc-300">{t('offDescription')}</p>
      </main>
    );

  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'medium', timeZone: board.timeZone });
  const clock = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: board.timeZone });
  const bars = board.speed.series.map((p) => ({ label: clock.format(new Date(p.at)), value: p.count }));
  const cap = board.capacity;
  return (
    <main className="flex min-h-dvh flex-col gap-6 bg-zinc-900 p-6 text-white md:p-10" data-testid="tv-board">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-section text-zinc-300">{t('eyebrow')}</p>
          <h1 className="text-[40px] leading-tight font-light md:text-[56px]">{board.eventName}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <p role="status" aria-live="polite" className="text-body text-zinc-300" data-testid="tv-updated">
            {stale
              ? t('stale', { time: time.format(new Date(board.asOf)) })
              : t('updated', { time: time.format(new Date(board.asOf)) })}
          </p>
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-pill border border-zinc-600 px-4 text-body text-white"
            onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
          >
            <Maximize aria-hidden="true" className="size-4" />
            {t('fullScreen')}
          </button>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Tile label={t('checkedIn')} testId="tv-checkins">
          <p className="text-[96px] leading-none font-light tabular-nums" data-testid="tv-checkins-today">
            {num(board.checkins.today, locale)}
          </p>
          <p className="text-section text-zinc-300">
            {t('ofValid', {
              total: num(board.checkins.total, locale),
              valid: num(board.checkins.valid, locale),
            })}
          </p>
        </Tile>
        <Tile label={t('capacity')} testId="tv-capacity">
          <p className={cx('text-[64px] leading-none font-light tabular-nums', LEVEL_TEXT[cap.level])}>
            {cap.percent === null ? num(cap.inside, locale) : `${num(cap.percent, locale)}%`}
          </p>
          <p className="text-section text-zinc-300">
            {cap.capacity === null
              ? t('insideNoCap', { inside: num(cap.inside, locale) })
              : t('inside', { inside: num(cap.inside, locale), capacity: num(cap.capacity, locale) })}
          </p>
          <p className="text-section">{t(`level.${cap.level}`)}</p>
        </Tile>
        <Tile label={t('speed')} testId="tv-speed">
          <p className="text-[64px] leading-none font-light tabular-nums">
            {dec(board.speed.scansPerMin, locale)}
          </p>
          <p className="text-section text-zinc-300">
            {board.speed.queueMin === null
              ? t('perMinuteStopped')
              : t('perMinute', { minutes: board.speed.queueMin })}
          </p>
        </Tile>
        <Tile label={t('devices')} testId="tv-devices">
          <p className="text-[64px] leading-none font-light tabular-nums">
            {t('devicesValue', {
              online: num(board.devices.online, locale),
              total: num(board.devices.total, locale),
            })}
          </p>
        </Tile>
        <Tile label={t('issues')} testId="tv-issues">
          <p className="text-section">
            {t('issuesValue', { duplicates: board.issues.duplicates, refused: board.issues.refused })}
          </p>
        </Tile>
        {board.speed.entrances.length > 0 ? (
          <Tile label={t('entrances')} testId="tv-entrances">
            <table className="w-full border-collapse text-section">
              <caption className="sr-only">{t('entrances')}</caption>
              <thead>
                <tr className="border-b border-zinc-600">
                  <th scope="col" className="py-2 text-start font-normal text-zinc-300">
                    {t('entrance')}
                  </th>
                  <th scope="col" className="py-2 text-end font-normal text-zinc-300">
                    {t('entrancePerMinute')}
                  </th>
                  <th scope="col" className="py-2 text-end font-normal text-zinc-300">
                    {t('entranceQueue')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {board.speed.entrances.map((e) => (
                  <tr key={e.name ?? '-'} className="border-b border-zinc-700">
                    <th scope="row" className="py-2 text-start font-normal">
                      {e.name ?? t('noEntrance')}
                    </th>
                    <td className="py-2 text-end tabular-nums">{dec(e.scansPerMin, locale)}</td>
                    <td className="py-2 text-end tabular-nums">
                      {e.queueMin === null ? '—' : t('minutes', { count: e.queueMin })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Tile>
        ) : null}
      </div>
      <section className="flex flex-col gap-2 rounded-3xl bg-zinc-800 p-6">
        <h2 className="text-section text-zinc-300">{t('chartTitle')}</h2>
        <BarChart title={t('chartTitle')} bars={bars} height={160} />
        <div className="text-zinc-300 [&_*]:text-inherit">
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
