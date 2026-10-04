'use client';

import { STATION_HEARTBEAT_MS } from '@yayatoh/badges/client';
import { StatusPill } from '@yayatoh/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

type Beat = { ok: boolean; code?: string };

/**
 * A print station's heartbeat (M5.5b): while this page is open on the computer next to the printer
 * it tells the server every 30 s that the printer is in use. Closing the page (or losing the
 * network) for 90 s turns the printer offline. The state is announced politely.
 */
export function PrintStation({ beat }: { beat: () => Promise<Beat> }) {
  const t = useTranslations('badgePrinting');
  const format = useFormatter();
  const [state, setState] = useState<{ ok: boolean | null; at: Date | null; code?: string }>({
    ok: null,
    at: null,
  });
  useEffect(() => {
    let alive = true;
    const send = () =>
      beat()
        .then((r) => {
          if (alive) setState({ ok: r.ok, at: new Date(), ...(r.code ? { code: r.code } : {}) });
        })
        .catch(() => {
          if (alive) setState((s) => ({ ...s, ok: false }));
        });
    void send();
    const id = window.setInterval(send, STATION_HEARTBEAT_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [beat]);
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2">
      {state.ok === null ? (
        <StatusPill tone="neutral" label={t('stationConnecting')} />
      ) : state.ok ? (
        <>
          <StatusPill tone="success" label={t('status.online')} live />
          <span className="text-caption text-ink-2">
            {t('stationLive', { time: format.dateTime(state.at ?? new Date(), { timeStyle: 'medium' }) })}
          </span>
        </>
      ) : (
        <>
          <StatusPill tone="danger" label={t('stationProblem')} />
          <span className="text-caption text-ink-2">
            {state.code === 'invalid_state' ? t('stationArchived') : t('stationError')}
          </span>
        </>
      )}
    </div>
  );
}
