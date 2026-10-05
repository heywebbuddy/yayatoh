'use client';

import { StatusDot } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useRealtime } from '@/lib/use-realtime.ts';

const EVENTS = ['alert'] as const;
const DOT = { live: 'success', connecting: 'warning', offline: 'neutral' } as const;

/**
 * The alerts page follows the org's alerts channel (M3.1b `org.alerts`, M3.2b): any alert that
 * fires, changes, is acknowledged elsewhere or resolves re-reads the page within a moment.
 */
export function AlertsLive({ url }: { url: string }) {
  const t = useTranslations('alerts.live');
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const state = useRealtime(url, EVENTS, {
    alert: () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        router.refresh();
      }, 250);
    },
  });
  return (
    <div data-testid="alerts-live" data-live={state}>
      <StatusDot status={DOT[state]} label={t(state)} live={state === 'live'} />
    </div>
  );
}
