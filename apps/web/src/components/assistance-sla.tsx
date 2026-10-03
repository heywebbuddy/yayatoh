'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

const clock = (ms: number) => {
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * A help request's SLA timer (M3.3b): time left to take it, or how long it is overdue, ticking
 * each second while nobody has taken it. Not a live region (it would chatter); the state text next
 * to it says the rest.
 */
export function SlaTimer({
  dueAt,
  running,
  serverNow,
}: {
  dueAt: string;
  running: boolean;
  serverNow?: string;
}) {
  const t = useTranslations('assistance.sla');
  const [skew] = useState(() => (serverNow ? new Date(serverNow).getTime() - Date.now() : 0));
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now() + skew), 1_000);
    return () => window.clearInterval(id);
  }, [running, skew]);
  if (!running) return null;
  const left = new Date(dueAt).getTime() - now;
  return (
    <span
      data-testid="sla-timer"
      data-overdue={left < 0 ? 'true' : 'false'}
      className={`tabular-nums ${left < 0 ? 'font-medium text-danger' : 'text-ink-2'}`}
    >
      {left < 0 ? t('overdueBy', { time: clock(left) }) : t('takeWithin', { time: clock(left) })}
    </span>
  );
}
