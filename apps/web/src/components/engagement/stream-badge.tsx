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
        tone === 'dark' ? 'text-white' : 'text-zinc-600',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'size-2 rounded-full',
          state === 'live' ? 'bg-green-500' : state === 'offline' ? 'bg-pink-500' : 'bg-yellow-500',
        )}
      />
      {t(state)}
    </span>
  );
}
