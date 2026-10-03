'use client';

import type { ScreenStateDto } from '@yayatoh/donations';
import { thermometer } from '@yayatoh/donations/screen';
import { formatMoney } from '@yayatoh/kernel';
import { buttonClass, cardClass, cx, StatusPill } from '@yayatoh/ui';
import { Contrast, Maximize, Pause } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StreamBadge } from '@/components/engagement/stream-badge.tsx';
import { useRealtime } from '@/lib/use-realtime.ts';

/** The room's uppercase eyebrow (as on the big screen of live polls and the TV board). */
const EYEBROW = 'm-0 text-[15px] font-extrabold tracking-[0.08em] uppercase';
const EVENTS = ['snapshot', 'state', 'link'] as const;

/**
 * The live giving screen (M4.8d): a thermometer for the room's projectors. The goal and the total
 * (paid gifts and counted paddles), how many gifts, the level being called with its paddles, a QR
 * code to the giving page, and thanks to donors who asked to be named (P4-13). Every message carries
 * the whole allowlisted state, and a reconnect gets a snapshot, so a screen that lost its stream is
 * whole again either way. When the host replaces the link, an open screen stops.
 *
 * `screen` is the projector (always dark, ADR 0022; high contrast swaps the glass for white on
 * black; reduced motion stops the fill's animation and the live dot; both also follow the system's
 * settings). `preview` sits in the console and follows the person's theme.
 */
export function GivingScreen({
  variant,
  eventName,
  initial,
  streamUrl,
  version,
  give,
  defaults = {},
}: {
  variant: 'screen' | 'preview';
  eventName: string;
  initial: ScreenStateDto;
  streamUrl: string;
  /** The link's version: a newer one on the channel means this link was replaced. */
  version?: number;
  give: { url: string; qr: { d: string; size: number } } | null;
  defaults?: { contrast?: boolean; reducedMotion?: boolean };
}) {
  const t = useTranslations('donations.screen');
  // The room's screen toggles read as on the live-polls big screen and the TV board.
  const te = useTranslations('engagement.screen');
  const tv = useTranslations('tv');
  const locale = useLocale();
  const [state, setState] = useState(initial);
  const [replaced, setReplaced] = useState(false);
  const [contrast, setContrast] = useState(defaults.contrast ?? false);
  const [still, setStill] = useState(defaults.reducedMotion ?? false);
  const screen = variant === 'screen';
  const stream = useRealtime(replaced ? null : streamUrl, EVENTS, {
    snapshot: (d) => d && setState(d as ScreenStateDto),
    state: (d) => d && setState(d as ScreenStateDto),
    link: (d) => {
      const v = (d as { version?: number } | null)?.version;
      if (screen && version !== undefined && typeof v === 'number' && v > version) setReplaced(true);
    },
  });
  useEffect(() => {
    // The system's own preferences turn the modes on (the toggles can still change them).
    if (defaults.contrast === undefined && window.matchMedia?.('(prefers-contrast: more)').matches)
      setContrast(true);
    if (
      defaults.reducedMotion === undefined &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
      setStill(true);
  }, [defaults.contrast, defaults.reducedMotion]);

  const hc = screen && contrast;
  const campaign = state.campaign;
  const currency = campaign?.currency ?? 'USD';
  const fmt = (minor: number, cur = currency) => formatMoney({ amount: minor, currency: cur }, locale);
  const fill = thermometer(state.totalMinor, campaign?.goalMinor ?? 0);
  // The fill's exact width, set through the CSSOM (the strict CSP refuses style attributes).
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (bar.current) bar.current.style.inlineSize = `${fill.percent}%`;
  }, [fill.percent]);

  const muted = hc ? 'text-white' : 'text-ink-2';
  const tile = hc
    ? 'rounded-panel border-2 border-white bg-black p-6 text-white md:p-8'
    : cx(cardClass('default', 'panel'), screen && 'md:p-8');
  const toggle = (pressed: boolean) =>
    hc
      ? cx(
          'inline-flex min-h-11 items-center gap-2 rounded-control border-2 border-white px-[18px] text-body font-bold',
          pressed ? 'bg-white text-black' : 'bg-black text-white',
        )
      : buttonClass(pressed ? 'primary' : 'secondary');

  if (replaced)
    return (
      <main
        id="main"
        data-theme="dark"
        className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-page p-10 text-center text-ink"
      >
        <h1 className="m-0 text-[40px] leading-[1.05] font-extrabold tracking-[-0.045em]">
          {t('replacedTitle')}
        </h1>
        <p role="alert" className="m-0 text-[20px] text-ink-2">
          {t('replacedBody')}
        </p>
      </main>
    );

  const total = (
    <section
      aria-labelledby="screen-total"
      data-testid="screen-thermometer"
      className={cx('flex flex-col gap-5', tile)}
    >
      <h2 id="screen-total" className={cx(screen ? EYEBROW : 'm-0 text-card text-ink', screen && muted)}>
        {t('totalLabel')}
      </h2>
      <p
        aria-live="polite"
        data-testid="screen-total"
        className={cx(
          'm-0 leading-none font-extrabold tracking-[-0.045em] tabular-nums',
          screen ? 'text-[64px] md:text-[112px]' : 'text-[44px]',
        )}
      >
        {fmt(state.totalMinor)}
      </p>
      {campaign ? (
        <>
          <div
            role="progressbar"
            aria-label={t('progressLabel')}
            aria-valuemin={0}
            aria-valuemax={campaign.goalMinor}
            aria-valuenow={Math.min(state.totalMinor, campaign.goalMinor)}
            aria-valuetext={t('progressText', {
              total: fmt(state.totalMinor),
              goal: fmt(campaign.goalMinor),
            })}
            className={cx(
              'overflow-hidden rounded-pill',
              screen ? 'h-10 md:h-14' : 'h-6',
              hc ? 'border-2 border-white bg-black' : 'bg-surface-3',
            )}
          >
            <div
              ref={bar}
              data-testid="screen-fill"
              data-percent={fill.percent}
              className={cx(
                'h-full rounded-pill',
                hc ? 'bg-white' : 'bg-success-dot',
                still
                  ? 'transition-none'
                  : 'transition-[inline-size] duration-1000 ease-out motion-reduce:transition-none',
              )}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className={cx('m-0 font-bold tabular-nums', screen ? 'text-[22px]' : 'text-body', muted)}>
              {t('goal', { goal: fmt(campaign.goalMinor), percent: fill.percent })}
            </p>
            {fill.reached ? <StatusPill tone="success" label={t('goalReached')} /> : null}
          </div>
        </>
      ) : null}
      <p
        data-testid="screen-gifts"
        className={cx('m-0 font-bold tabular-nums', screen ? 'text-[22px]' : 'text-body', muted)}
      >
        {t('gifts', { count: state.gifts })}
      </p>
    </section>
  );

  const calling = state.calling ? (
    <section
      aria-labelledby="screen-calling"
      data-testid="screen-calling"
      className={cx('flex flex-col gap-2', tile)}
    >
      <h2 id="screen-calling" className={cx(screen ? EYEBROW : 'm-0 text-card text-ink', screen && muted)}>
        {t('calling')}
      </h2>
      <p
        className={cx(
          'm-0 leading-[1.05] font-extrabold tracking-[-0.04em] tabular-nums',
          screen ? 'text-[44px] md:text-[64px]' : 'text-[28px]',
        )}
      >
        {t('callingLevel', {
          amount: fmt(state.calling.amountMinor, state.calling.currency),
          name: state.calling.levelName,
        })}
      </p>
      <p className={cx('m-0 font-bold tabular-nums', screen ? 'text-[22px]' : 'text-body', muted)}>
        {t('paddles', { count: state.calling.paddles })}
      </p>
    </section>
  ) : null;

  const thanks = (
    <section
      aria-labelledby="screen-thanks"
      data-testid="screen-thanks"
      className={cx('flex flex-col gap-3', tile)}
    >
      <h2 id="screen-thanks" className={cx(screen ? EYEBROW : 'm-0 text-card text-ink', screen && muted)}>
        {t('thanksTitle')}
      </h2>
      {state.thanks.length === 0 ? (
        <p className={cx('m-0', screen ? 'text-[20px]' : 'text-body', muted)}>{t('thanksEmpty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {state.thanks.map((name, i) => (
            <li
              // Names repeat (two donors called Ada); the position keeps keys unique.
              key={`${i}:${name}`}
              className={cx('font-bold', screen ? 'text-[26px] md:text-[32px]' : 'text-body')}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const qr = give ? (
    <section aria-labelledby="screen-give" className={cx('flex flex-col items-start gap-3', tile)}>
      <h2 id="screen-give" className={cx(screen ? EYEBROW : 'm-0 text-card text-ink', screen && muted)}>
        {t('scanToGive')}
      </h2>
      {/* QR codes stay black on white in every theme and mode, so every phone can read them. */}
      <svg
        role="img"
        aria-label={t('qrLabel', { url: give.url })}
        viewBox={`0 0 ${give.qr.size} ${give.qr.size}`}
        shapeRendering="crispEdges"
        className={cx('rounded-tile bg-white p-2.5 text-black', screen ? 'size-52' : 'size-36')}
      >
        <rect width={give.qr.size} height={give.qr.size} className="fill-white" />
        <path d={give.qr.d} fill="currentColor" />
      </svg>
      <p className={cx('m-0 break-all text-body font-semibold', muted)} dir="ltr">
        {give.url}
      </p>
    </section>
  ) : null;

  const body = (
    <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="flex min-w-0 flex-col gap-6">
        {total}
        {calling}
      </div>
      <aside className="flex min-w-0 flex-col gap-6" aria-label={t('sideLabel')}>
        {qr}
        {thanks}
      </aside>
    </div>
  );

  if (!screen)
    return (
      <div data-screen="preview" data-motion={still ? 'reduced' : 'full'} className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <StreamBadge state={stream} still={still} />
        </div>
        {body}
      </div>
    );

  return (
    <main
      id="main"
      data-theme="dark"
      data-screen="screen"
      data-contrast={contrast ? 'high' : 'normal'}
      data-motion={still ? 'reduced' : 'full'}
      className={cx(
        'flex min-h-dvh w-full flex-col gap-6 p-6 md:gap-8 md:p-10',
        contrast ? 'bg-black text-white' : 'bg-page text-ink',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <p className={cx(EYEBROW, muted)}>{eventName}</p>
          <h1 className="m-0 text-[40px] leading-[1.05] font-extrabold tracking-[-0.045em] text-balance md:text-display">
            {campaign?.name ?? eventName}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StreamBadge state={stream} still={still} />
          <button
            type="button"
            className={toggle(contrast)}
            aria-pressed={contrast}
            onClick={() => setContrast((v) => !v)}
          >
            <Contrast aria-hidden="true" className="size-[18px]" />
            {te('highContrast')}
          </button>
          <button
            type="button"
            className={toggle(still)}
            aria-pressed={still}
            onClick={() => setStill((v) => !v)}
          >
            <Pause aria-hidden="true" className="size-[18px]" />
            {te('reducedMotion')}
          </button>
          <button
            type="button"
            className={toggle(false)}
            onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
          >
            <Maximize aria-hidden="true" className="size-[18px]" />
            {tv('fullScreen')}
          </button>
        </div>
      </header>
      {body}
    </main>
  );
}
