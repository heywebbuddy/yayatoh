import type { PollKind, PollResultsDto } from '@yayatoh/engagement/client';
import { percent, wordWeight } from '@yayatoh/engagement/client';
import { cx, widthClass } from '@yayatoh/ui';

/**
 * A poll's results as text first (every count and share is read out), with bars or a word cloud
 * for the eye (M5.7a). No inline styles (strict CSP): bar widths are the design system's static
 * width classes (`widthClass`, nearest 5 %; the exact share is in the text), word sizes are
 * classes. The bars are decorative (`aria-hidden`), so nothing is announced twice.
 */
const WORD_SIZE = {
  normal: ['text-body', 'text-section', 'text-[24px]', 'text-[32px]', 'text-[40px]'],
  large: ['text-[24px]', 'text-[32px]', 'text-[44px]', 'text-[56px]', 'text-[72px]'],
} as const;

export function PollResultsView({
  kind,
  results,
  labels,
  size = 'normal',
  contrast = false,
  still = false,
}: {
  kind: PollKind;
  results: PollResultsDto;
  labels: { votes: (n: number) => string; average: (n: string) => string; noWords: string };
  size?: 'normal' | 'large';
  /** The big screen's high-contrast mode (white on black). */
  contrast?: boolean;
  /** Reduced motion: the bars jump to their new width. */
  still?: boolean;
}) {
  const large = size === 'large';
  if (kind === 'word_cloud') {
    const max = Math.max(0, ...results.counts.map((c) => c.count));
    if (results.counts.length === 0)
      return (
        <p className={cx('m-0', large ? 'text-[24px]' : 'text-body', contrast ? 'text-white' : 'text-ink-2')}>
          {labels.noWords}
        </p>
      );
    return (
      <ul
        className="m-0 flex list-none flex-wrap items-baseline gap-x-5 gap-y-2 p-0"
        data-testid="word-cloud"
      >
        {results.counts.map((c) => (
          <li
            key={c.key}
            className={cx(
              'leading-tight font-extrabold tracking-[-0.02em]',
              WORD_SIZE[size][wordWeight(c.count, max) - 1],
            )}
          >
            {c.label}
            <span className="sr-only"> — {labels.votes(c.count)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className={cx('flex flex-col', large ? 'gap-5' : 'gap-3')}>
      <ul
        className={cx('m-0 flex list-none flex-col p-0', large ? 'gap-5' : 'gap-3')}
        data-testid="poll-results"
      >
        {results.counts.map((c) => {
          const pct = percent(c.count, results.total);
          return (
            <li
              key={c.key}
              className={cx('flex flex-col', large ? 'gap-2' : 'gap-1.5')}
              data-result={c.label}
              data-count={c.count}
            >
              <span
                className={cx(
                  'flex items-baseline justify-between gap-3',
                  large ? 'text-[28px] font-bold' : 'text-body font-semibold',
                )}
              >
                <span className="min-w-0 break-words">{c.label}</span>
                <span
                  className={cx(
                    'shrink-0 tabular-nums',
                    contrast ? 'text-white' : large ? 'text-ink' : 'text-ink-2',
                  )}
                >
                  <span className={large ? 'font-extrabold' : 'font-bold text-ink'}>{pct}%</span> ·{' '}
                  {labels.votes(c.count)}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cx(
                  'block w-full overflow-hidden rounded-pill',
                  large ? 'h-4' : 'h-2',
                  contrast ? 'bg-white/30' : 'bg-surface-3',
                )}
              >
                <span
                  className={cx(
                    'block h-full rounded-pill',
                    contrast ? 'bg-warning-dot' : 'bg-primary',
                    still
                      ? 'transition-none'
                      : 'transition-[width] duration-500 ease-out motion-reduce:transition-none',
                    widthClass(pct),
                  )}
                />
              </span>
            </li>
          );
        })}
      </ul>
      {results.average !== null ? (
        <p className={cx('m-0 tabular-nums', large ? 'text-[28px] font-extrabold' : 'text-body font-bold')}>
          {labels.average(results.average.toFixed(1))}
        </p>
      ) : null}
    </div>
  );
}
