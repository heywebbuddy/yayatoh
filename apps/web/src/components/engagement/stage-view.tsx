'use client';

import type {
  ModPollDto,
  ModStateDto,
  PublicLiveStateDto,
  PublicPollDto,
  PublicQuestionDto,
} from '@yayatoh/engagement/client';
import { publicOrder } from '@yayatoh/engagement/client';
import { cx } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useLiveState } from './live-state.ts';
import { PollResultsView } from './poll-results.tsx';
import { StreamBadge } from './stream-badge.tsx';

type Poll = PublicPollDto | ModPollDto;

/**
 * The big screen and the presenter view (M5.7a): the poll on stage and the pinned question, then
 * the most upvoted approved questions. The big screen follows the public channel through its signed
 * link (results only when shown) and offers high contrast and reduced motion (also taken from the
 * system settings); the presenter follows the moderation channel and always sees the results.
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
  const dark = screen;
  const poll = state.polls.find((p) => p.id === state.stage.livePollId) as Poll | undefined;
  const approved = (state.questions as (PublicQuestionDto & { state?: string })[]).filter(
    (q) => q.state === undefined || q.state === 'approved',
  );
  const pinned = approved.find((q) => q.id === state.stage.pinnedQuestionId) ?? null;
  const next = publicOrder(approved.filter((q) => !q.answered && q.id !== pinned?.id)).slice(
    0,
    screen ? 3 : 5,
  );
  const muted = contrast ? 'text-white' : dark ? 'text-white/75' : 'text-zinc-600';
  const panel = contrast
    ? 'border-2 border-white'
    : dark
      ? 'border border-white/20'
      : 'border border-zinc-200';
  const motion = still ? 'transition-none' : 'transition-colors duration-700 motion-reduce:transition-none';
  const labels = {
    votes: (n: number) => t('votes', { count: n }),
    average: (n: string) => t('average', { value: n }),
    noWords: t('noWords'),
  };
  const toggle = cx(
    'min-h-11 rounded-pill px-4 text-caption font-medium',
    contrast ? 'border-2 border-white' : dark ? 'border border-white/40' : 'border border-zinc-300',
  );
  const Root = screen ? 'main' : 'div';
  return (
    <Root
      {...(screen ? { id: 'main' } : {})}
      data-stage={variant}
      data-contrast={contrast ? 'high' : 'normal'}
      data-motion={still ? 'reduced' : 'full'}
      className={cx(
        'flex min-h-dvh w-full flex-col gap-6 px-4 py-6 sm:px-10 sm:py-8',
        contrast ? 'bg-black text-white' : dark ? 'bg-ink text-white' : 'bg-white text-ink',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className={cx('font-mono text-label uppercase tracking-[0.2em]', muted)}>{eventName}</p>
          <h1
            className={cx(
              'font-light tracking-[-0.03em]',
              screen ? 'text-[32px] sm:text-[44px]' : 'text-title',
            )}
          >
            {sessionTitle}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StreamBadge state={stream} tone={dark ? 'dark' : 'light'} />
          {screen ? (
            <>
              <button
                type="button"
                className={toggle}
                aria-pressed={contrast}
                onClick={() => setContrast((v) => !v)}
              >
                {t('screen.highContrast')}
              </button>
              <button
                type="button"
                className={toggle}
                aria-pressed={still}
                onClick={() => setStill((v) => !v)}
              >
                {t('screen.reducedMotion')}
              </button>
            </>
          ) : null}
        </div>
      </header>
      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          {poll ? (
            <section
              aria-labelledby="stage-poll"
              className={cx('flex flex-col gap-4 rounded-panel p-6', panel, motion)}
              data-stage-poll={poll.question}
            >
              <p className={cx('font-mono text-label uppercase', muted)}>
                {poll.state === 'open' ? t('screen.pollOpen') : t('screen.pollClosed')} ·{' '}
                {t('votes', { count: poll.ballots })}
              </p>
              <h2
                id="stage-poll"
                className={screen ? 'text-[36px] font-medium sm:text-[52px]' : 'text-[28px] font-medium'}
              >
                {poll.question}
              </h2>
              {poll.results ? (
                <>
                  {!screen && !poll.showResults ? (
                    <p className={muted}>{t('screen.hiddenFromAudience')}</p>
                  ) : null}
                  <PollResultsView
                    kind={poll.kind}
                    results={poll.results}
                    labels={labels}
                    size={screen ? 'large' : 'normal'}
                    contrast={contrast}
                  />
                </>
              ) : (
                <p className={screen ? 'text-[28px]' : 'text-body'}>{t('screen.voteNow')}</p>
              )}
            </section>
          ) : null}
          {pinned ? (
            <section
              aria-labelledby="stage-question"
              className={cx('flex flex-col gap-3 rounded-panel p-6', panel, motion)}
              data-stage-question={pinned.body}
            >
              <p className={cx('font-mono text-label uppercase', muted)}>{t('screen.currentQuestion')}</p>
              <h2
                id="stage-question"
                className={
                  screen ? 'text-[36px] font-medium leading-tight sm:text-[52px]' : 'text-[28px] font-medium'
                }
              >
                {pinned.body}
              </h2>
              <p className={cx(screen ? 'text-[24px]' : 'text-body', muted)}>
                {[pinned.authorName ?? t('anonymous'), t('upvotes', { count: pinned.upvotes })].join(' · ')}
              </p>
            </section>
          ) : null}
          {!poll && !pinned ? (
            <section
              aria-labelledby="stage-idle"
              className={cx('flex flex-col gap-3 rounded-panel p-6', panel)}
            >
              <h2 id="stage-idle" className={screen ? 'text-[36px] font-light' : 'text-section'}>
                {t('screen.idle')}
              </h2>
            </section>
          ) : null}
        </div>
        <aside className="flex flex-col gap-6" aria-label={t('screen.sidebar')}>
          <section aria-labelledby="stage-next" className="flex flex-col gap-3">
            <h2 id="stage-next" className={cx('font-mono text-label uppercase', muted)}>
              {t('screen.topQuestions')}
            </h2>
            {next.length === 0 ? (
              <p className={muted}>{t('screen.noQuestions')}</p>
            ) : (
              <ol className="flex list-none flex-col gap-3 p-0">
                {next.map((q) => (
                  <li
                    key={q.id}
                    className={cx('flex flex-col gap-1 rounded-card p-4', panel, motion)}
                    data-stage-next={q.body}
                  >
                    <p className={screen ? 'text-[22px] leading-snug' : 'text-body'}>{q.body}</p>
                    <p className={cx('text-caption', muted)}>
                      {[q.authorName ?? t('anonymous'), t('upvotes', { count: q.upvotes })].join(' · ')}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {join ? (
            <section aria-labelledby="stage-join" className="flex flex-col items-start gap-3">
              <h2 id="stage-join" className={cx('font-mono text-label uppercase', muted)}>
                {t('screen.join')}
              </h2>
              <svg
                role="img"
                aria-label={t('qrLabel', { url: join.url })}
                viewBox={`0 0 ${join.qr.size} ${join.qr.size}`}
                shapeRendering="crispEdges"
                className="size-40 rounded-card bg-white p-2 text-ink"
              >
                <rect width={join.qr.size} height={join.qr.size} className="fill-white" />
                <path d={join.qr.d} fill="currentColor" />
              </svg>
              <p className={cx('break-all text-caption', muted)} dir="ltr">
                {join.url}
              </p>
            </section>
          ) : null}
        </aside>
      </div>
    </Root>
  );
}
