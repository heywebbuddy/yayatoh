'use client';

import { cx } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import type { StreamState } from '@/lib/use-realtime.ts';

/** Live / reconnecting, said politely (the data on screen stays; it catches up on reconnect). */
export function StreamBadge({ state, tone = 'light' }: { state: StreamState; tone?: 'light' | 'dark' }) {
  const t = useTranslations('engagement.stream');
  return (
    <span
      role="status"
      data-stream-state={state}
      className={cx(
        'inline-flex min-h-6 items-center gap-2 text-caption',
        tone === 'dark' ? 'text-white' : 'text-ink-2',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-2 rounded-full',
          state === 'live' ? 'bg-success-dot' : state === 'offline' ? 'bg-brand' : 'bg-warning-dot',
        )}
      />
      {t(state)}
    </span>
  );
}
