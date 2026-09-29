'use client';

import { StatusDot } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useRealtime } from '@/lib/use-realtime.ts';

const EVENTS = ['snapshot', 'admission'] as const;
const DOT = { live: 'success', connecting: 'warning', offline: 'neutral' } as const;

/**
 * The door screen follows the event's check-ins live (M3.1b, `event.checkins`): each admission,
 * undo or synced batch from any scanner re-reads the page's counts within a moment, and the tally
 * since opening is announced politely. The page's 10-second refresh stays as the fallback.
 */
export function LiveCheckins({ url }: { url: string }) {
  const t = useTranslations('checkinLive');
  const router = useRouter();
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connected = useRef(false);
  const refresh = () => {
    if (timer.current) return;
    // One re-read per burst of scans.
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
    }, 250);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const state = useRealtime(url, EVENTS, {
    admission: (data) => {
      const d = data as { change?: string; count?: number } | null;
      const n = typeof d?.count === 'number' ? d.count : 1;
      setCount((c) => (d?.change === 'undone' ? c : c + n));
      refresh();
    },
    // The first snapshot is what the page already shows; a later one follows a gap: re-read.
    snapshot: () => {
      if (connected.current) refresh();
      connected.current = true;
    },
  });
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1"
      data-testid="live-checkins"
      data-live={state}
      data-stream={url}
    >
      <StatusDot status={DOT[state]} label={t(`state.${state}`)} live={state === 'live'} />
      <p className="text-caption text-zinc-600" aria-live="polite" role="status">
        {count > 0 ? t('since', { count }) : t('waiting')}
      </p>
    </div>
  );
}
