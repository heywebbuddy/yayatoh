'use client';

import type { ConsoleLiveDto } from '@yayatoh/donations';
import { formatMoney, money } from '@yayatoh/kernel';
import { Card, StatCard, StatusPill } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useRealtime } from '@/lib/use-realtime.ts';

/**
 * The console's live panel (M4.8c): the level being called with its running count and total, and
 * the raise's totals, kept current over the console channel as spotters sync. When another console
 * arms or closes a level, the page refreshes so its buttons match.
 */
export function RaiseLive({ url, initial }: { url: string; initial: ConsoleLiveDto }) {
  const t = useTranslations('donations.raise');
  const locale = useLocale();
  const router = useRouter();
  const [live, setLive] = useState(initial);
  const openId = useRef(initial.open?.id ?? null);
  const state = useRealtime(url, ['snapshot', 'state'], {
    snapshot: (d) => apply(d),
    state: (d) => apply(d),
  });
  function apply(d: unknown) {
    const next = d as ConsoleLiveDto | null;
    if (!next?.totals) return;
    setLive(next);
    if (openId.current !== (next.open?.id ?? null)) {
      openId.current = next.open?.id ?? null;
      router.refresh();
    }
  }
  const fmt = (minor: number, currency: string) => formatMoney(money(minor, currency), locale);
  const n = new Intl.NumberFormat(locale);
  const open = live.open;
  return (
    <section aria-labelledby="live-heading" className="flex flex-col gap-4" data-live={state}>
      <Card tone="feature" size="panel" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="live-heading" className="m-0 text-card text-ink">
            {open ? t('nowCalling') : t('noneCalling')}
          </h2>
          <StatusPill
            tone={state === 'live' ? 'success' : state === 'offline' ? 'danger' : 'neutral'}
            label={t(`stream.${state}`)}
          />
        </div>
        {open ? (
          <>
            <p className="m-0 text-[28px] font-bold text-ink tabular-nums" data-testid="calling-level">
              {t('levelLine', { amount: fmt(open.amountMinor, open.currency), name: open.levelName })}
            </p>
            <p className="m-0 text-body text-ink tabular-nums" role="status" data-testid="level-running">
              {t('levelRunning', {
                count: open.count,
                total: fmt(open.totalMinor, open.currency),
              })}
            </p>
            {open.duplicates > 0 ? (
              <p className="m-0 text-caption text-ink-2">
                {t('duplicatesToCheck', { count: open.duplicates })}
              </p>
            ) : null}
          </>
        ) : (
          <p className="m-0 text-body text-ink-2">{t('noneCallingBody')}</p>
        )}
      </Card>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="raise-totals">
        <StatCard label={t('totalRaised')} value={fmt(live.totals.totalMinor, live.totals.currency)} />
        <StatCard label={t('paddlesRaised')} value={n.format(live.totals.count)} />
        <StatCard label={t('pledged')} value={fmt(live.totals.pledgedMinor, live.totals.currency)} />
        <StatCard label={t('toReview')} value={n.format(live.totals.toReview)} />
      </div>
    </section>
  );
}
