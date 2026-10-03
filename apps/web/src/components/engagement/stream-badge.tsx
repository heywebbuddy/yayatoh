'use client';

import { StatusPill } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import type { StreamState } from '@/lib/use-realtime.ts';

const TONE = { live: 'success', connecting: 'info', offline: 'waiting' } as const;

/**
 * Live / reconnecting, said politely (the data on screen stays; it catches up on reconnect). A
 * StatusPill (dot and word, ADR 0022); the dot pulses while live unless motion is reduced.
 */
export function StreamBadge({ state, still = false }: { state: StreamState; still?: boolean }) {
  const t = useTranslations('engagement.stream');
  return (
    <span role="status" data-stream-state={state} className="inline-flex">
      <StatusPill tone={TONE[state]} label={t(state)} live={state === 'live' && !still} />
    </span>
  );
}
