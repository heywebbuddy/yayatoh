'use client';

import type {
  ModPollDto,
  ModStateDto,
  PublicLiveStateDto,
  PublicPollDto,
  PublicQuestionDto,
} from '@yayatoh/engagement/client';
import { publicOrder } from '@yayatoh/engagement/client';
import { buttonClass, cardClass, cx, StatusPill } from '@yayatoh/ui';
import { Contrast, Maximize, Pause } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import { useLiveState } from './live-state.ts';
import { PollResultsView } from './poll-results.tsx';
import { StreamBadge } from './stream-badge.tsx';

type Poll = PublicPollDto | ModPollDto;

/** The room's uppercase eyebrow (the Command Center TV board's tile label). */
const EYEBROW = 'm-0 text-[15px] font-extrabold tracking-[0.08em] uppercase';

/**
 * The big screen and the presenter view (M5.7a): the poll on stage and the pinned question, then
 * the most upvoted approved questions. The big screen follows the public channel through its signed
 * link (results only when shown) and offers high contrast and reduced motion (also taken from the
 * system settings); the presenter follows the moderation channel and always sees the results.
 *
 * The big screen is always dark (ADR 0022, like the Command Center TV board): a `data-theme="dark"`
 * subtree with glass tiles and 800-weight type; high contrast swaps the glass for white on black.
 * The presenter view sits in the console and follows the person's theme; its page header (title,
 * breadcrumb) comes from the page.
 */
export function StageView({
  variant,
  eventName,
  sessionTitle,
  initial,
  streamUrl,
  join,
  defaults = {},
}: {
  variant: 'screen' | 'presenter';
  eventName: string;
  sessionTitle: string;
  initial: PublicLiveStateDto | ModStateDto;
  streamUrl: string;
  join: { url: string; qr: { d: string; size: number } } | null;
  defaults?: { contrast?: boolean; reducedMotion?: boolean };
}) {
  const t = useTranslations('engagement');
  const tv = useTranslations('tv');
  const { state, stream } = useLiveState<PublicLiveStateDto | ModStateDto>(streamUrl, initial);
  const [contrast, setContrast] = useState(defaults.contrast ?? false);
  const [still, setStill] = useState(defaults.reducedMotion ?? false);
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
  const screen = variant === 'screen';
  const hc = screen && contrast;
  const poll = state.polls.find((p) => p.id === state.stage.livePollId) as Poll | undefined;
  const approved = (state.questions as (PublicQuestionDto & { state?: string })[]).filter(
    (q) => q.state === undefined || q.state === 'approved',
  );
  const pinned = approved.find((q) => q.id === state.stage.pinnedQuestionId) ?? null;
  const next = publicOrder(approved.filter((q) => !q.answered && q.id !== pinned?.id)).slice(
    0,
    screen ? 3 : 5,
  );
  const muted = hc ? 'text-white' : 'text-ink-2';
  const motion = still
    ? 'transition-none'
    : 'transition-[border-color,background-color] duration-700 motion-reduce:transition-none';
  /** A stage tile: glass on the dark screen and in the console, a white frame in high contrast. */
  const tile = (padding: 'panel' | 'row' = 'panel') =>
    hc
      ? cx(
          'rounded-panel border-2 border-white bg-black text-white',
          padding === 'panel' ? 'p-6 md:p-8' : 'p-4',
        )
      : padding === 'panel'
        ? cx(cardClass('default', 'panel'), screen && 'md:p-8')
        : 'rounded-tile border border-line bg-surface p-4 glass';
  const labels = {
    votes: (n: number) => t('votes', { count: n }),
    average: (n: string) => t('average', { value: n }),
    noWords: t('noWords'),
  };
  const toggle = (pressed: boolean) =>
    hc
      ? cx(
          'inline-flex min-h-11 items-center gap-2 rounded-control border-2 border-white px-[18px] text-body font-bold',
          pressed ? 'bg-white text-black' : 'bg-black text-white',
        )
      : buttonClass(pressed ? 'primary' : 'secondary');
  const open = poll?.state === 'open';
  const meta = poll
    ? [
        poll.state === 'open' ? t('screen.pollOpen') : t('screen.pollClosed'),
        t('votes', { count: poll.ballots }),
      ]
    : [];
  const author = (q: PublicQuestionDto) =>
    [q.authorName ?? t('anonymous'), t('upvotes', { count: q.upvotes })].join(' · ');

  const body: ReactNode = (
    <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="flex min-w-0 flex-col gap-6">
        {poll ? (
          <section
            aria-labelledby="stage-poll"
            className={cx('flex flex-col gap-4', tile(), motion)}
            data-stage-poll={poll.question}
          >
            {screen ? (
              <p className={cx(EYEBROW, 'inline-flex flex-wrap items-center gap-x-3 gap-y-1', muted)}>
                <span
                  className={cx(
                    'inline-flex items-center gap-2',
                    hc ? 'text-white' : open ? 'text-success' : 'text-ink-2',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'size-2.5 shrink-0 rounded-full',
                      open ? 'bg-success-dot' : 'bg-ink-3',
                      hc && !open && 'bg-white',
                      open && !still && 'animate-pulse motion-reduce:animate-none',
                    )}
                  />
                  {meta[0]}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{meta[1]}</span>
              </p>
            ) : (
              <p className="m-0 flex flex-wrap items-center gap-2 text-caption text-ink-2">
                <StatusPill tone={open ? 'success' : 'neutral'} label={meta[0]} live={open && !still} />
                <span className="font-bold tabular-nums">{meta[1]}</span>
              </p>
            )}
            <h2
              id="stage-poll"
              className={cx(
                'm-0 leading-[1.08] font-extrabold tracking-[-0.035em] text-balance',
                screen ? 'text-[36px] md:text-[52px]' : 'text-[28px]',
              )}
            >
              {poll.question}
            </h2>
            {poll.results ? (
              <>
                {!screen && !poll.showResults ? (
                  <p className="m-0 text-body font-semibold text-ink-2">{t('screen.hiddenFromAudience')}</p>
                ) : null}
                <PollResultsView
                  kind={poll.kind}
                  results={poll.results}
                  labels={labels}
                  size={screen ? 'large' : 'normal'}
                  contrast={hc}
                  still={still}
                />
              </>
            ) : (
              <p className={cx('m-0 font-bold', screen ? 'text-[28px]' : 'text-body', muted)}>
                {t('screen.voteNow')}
              </p>
            )}
          </section>
        ) : null}
        {pinned ? (
          <section
            aria-labelledby="stage-question"
            className={cx('flex flex-col gap-3', tile(), motion)}
            data-stage-question={pinned.body}
          >
            {screen ? (
              <p className={cx(EYEBROW, hc ? 'text-white' : 'text-brand-ink')}>
                {t('screen.currentQuestion')}
              </p>
            ) : (
              <p className="m-0">
                <StatusPill tone="brand" label={t('screen.currentQuestion')} />
              </p>
            )}
            <h2
              id="stage-question"
              className={cx(
                'm-0 leading-[1.12] font-extrabold tracking-[-0.03em] break-words',
                screen ? 'text-[36px] md:text-[52px]' : 'text-[28px]',
              )}
            >
              {pinned.body}
            </h2>
            <p className={cx('m-0 font-semibold tabular-nums', screen ? 'text-[24px]' : 'text-body', muted)}>
              {author(pinned)}
            </p>
          </section>
        ) : null}
        {!poll && !pinned ? (
          <section
            aria-labelledby="stage-idle"
            className={cx('flex flex-col justify-center gap-3', tile(), screen && 'flex-1')}
          >
            <h2
              id="stage-idle"
              className={cx(
                'm-0 font-extrabold tracking-[-0.035em] text-balance',
                screen ? 'text-[36px] leading-[1.08] md:text-[52px]' : 'text-card',
              )}
            >
              {t('screen.idle')}
            </h2>
          </section>
        ) : null}
      </div>
      <aside className="flex min-w-0 flex-col gap-6" aria-label={t('screen.sidebar')}>
        <section aria-labelledby="stage-next" className="flex flex-col gap-3">
          <h2 id="stage-next" className={cx(screen ? EYEBROW : 'm-0 text-card text-ink', screen && muted)}>
            {t('screen.topQuestions')}
          </h2>
          {next.length === 0 ? (
            <p className={cx('m-0 font-semibold', screen ? 'text-[20px]' : 'text-body', muted)}>
              {t('screen.noQuestions')}
            </p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {next.map((q) => (
                <li
                  key={q.id}
                  className={cx('flex flex-col gap-1.5', tile('row'), motion)}
                  data-stage-next={q.body}
                >
                  <p
                    className={cx(
                      'm-0 font-bold break-words',
                      screen ? 'text-[22px] leading-snug' : 'text-body',
                    )}
                  >
                    {q.body}
                  </p>
                  <p
                    className={cx(
                      'm-0 font-semibold tabular-nums',
                      screen ? 'text-body' : 'text-caption',
                      muted,
                    )}
                  >
                    {author(q)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
        {join ? (
          <section aria-labelledby="stage-join" className={cx('flex flex-col items-start gap-3', tile())}>
            <h2 id="stage-join" className={cx(screen ? EYEBROW : 'm-0 text-card text-ink', screen && muted)}>
              {t('screen.join')}
            </h2>
            {/* QR codes stay black on white in every theme and mode, so every phone can read them. */}
            <svg
              role="img"
              aria-label={t('qrLabel', { url: join.url })}
              viewBox={`0 0 ${join.qr.size} ${join.qr.size}`}
              shapeRendering="crispEdges"
              className="size-44 rounded-tile bg-white p-2.5 text-black"
            >
              <rect width={join.qr.size} height={join.qr.size} className="fill-white" />
              <path d={join.qr.d} fill="currentColor" />
            </svg>
            <p className={cx('m-0 break-all text-body font-semibold', muted)} dir="ltr">
              {join.url}
            </p>
          </section>
        ) : null}
      </aside>
    </div>
  );

  if (!screen)
    return (
      <div
        data-stage={variant}
        data-contrast="normal"
        data-motion={still ? 'reduced' : 'full'}
        className="flex flex-col gap-6"
      >
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
      data-stage={variant}
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
            {sessionTitle}
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
            {t('screen.highContrast')}
          </button>
          <button
            type="button"
            className={toggle(still)}
            aria-pressed={still}
            onClick={() => setStill((v) => !v)}
          >
            <Pause aria-hidden="true" className="size-[18px]" />
            {t('screen.reducedMotion')}
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
