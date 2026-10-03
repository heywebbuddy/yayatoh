'use client';

import { Button } from '@yayatoh/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { ScanClient, ScanOutcome, ServerResult } from '@/scan/client.ts';
import { GATE_OF_RESULT } from '@/scan/session-door.ts';

/**
 * M5.6a: at a session door, the Scan PWA scans people in or out and shows the room count (this
 * device's estimate until the next sync).
 */
export function SessionDoorControls({
  client,
  refreshKey,
  onDirection,
}: {
  client: ScanClient;
  refreshKey: unknown;
  onDirection: () => void;
}) {
  const t = useTranslations();
  const [direction, setDirection] = useState(client.direction);
  const [count, setCount] = useState<{ occupied: number; capacity: number | null } | null>(null);
  const door = client.sessionDoor;
  useEffect(() => {
    void client.roomCount().then(setCount);
  }, [client, refreshKey, door?.checkpointId]);
  if (!door) return null;
  return (
    <div className="flex flex-col gap-2">
      {door.title ? <p className="text-body font-semibold">{door.title}</p> : null}
      <fieldset className="flex flex-col gap-1.5 self-start">
        <legend className="text-[13px] font-bold text-ink">{t('sessionCheckin.direction')}</legend>
        <div className="flex gap-2">
          {(['in', 'out'] as const).map((d) => (
            <label
              key={d}
              className="flex min-h-12 cursor-pointer items-center gap-2 rounded-pill border border-line-strong bg-surface px-5 text-[15px] has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
            >
              <input
                type="radio"
                name="scan-app-direction"
                value={d}
                checked={direction === d}
                onChange={() => {
                  client.direction = d;
                  setDirection(d);
                  onDirection();
                }}
              />
              {t(d === 'in' ? 'sessionCheckin.scanIn' : 'sessionCheckin.scanOut')}
            </label>
          ))}
        </div>
      </fieldset>
      {count ? (
        <p className="text-caption text-ink-2" data-testid="scan-room-count">
          {count.capacity !== null
            ? t('sessionCheckin.roomCount', { count: count.occupied, capacity: count.capacity })
            : t('sessionCheckin.roomCountOpen', { count: count.occupied })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * M5.6a: a session door refused someone at a gate; staff may let them in anyway with a reason
 * (online only, audited). A second gate may refuse next; the gates already waived are kept.
 */
export function SessionOverride({
  client,
  outcome,
  online,
  onDone,
}: {
  client: ScanClient;
  outcome: ScanOutcome;
  online: boolean;
  onDone: (result: ServerResult) => void;
}) {
  const t = useTranslations();
  const shown = outcome.server ?? outcome.verdict;
  const gate = GATE_OF_RESULT[shown];
  const [waived, setWaived] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A new scan starts afresh.
  useEffect(() => {
    setWaived([]);
    setReason('');
    setError(null);
  }, [outcome.scanId]);
  if (!gate || !outcome.code || !outcome.sessionDoorId) return null;
  if (!online) return <p className="text-body">{t('sessionCheckin.overrideOffline')}</p>;
  return (
    <form
      aria-label={t('sessionCheckin.overrideLabel')}
      className="flex flex-col gap-3 rounded-panel border border-line p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length < 3) {
          setError(t('checkin.overrideNoteRequired'));
          return;
        }
        const gates = [...new Set([...waived, gate])];
        setBusy(true);
        void client
          .sessionOverride({
            code: outcome.code ?? '',
            checkpointId: outcome.sessionDoorId ?? '',
            gates,
            reason: reason.trim(),
          })
          .then((r) => {
            setBusy(false);
            if ('error' in r) {
              setError(
                r.error === 'nothing_to_override'
                  ? t('sessionCheckin.nothingToOverride')
                  : t('sessionCheckin.overrideFailed'),
              );
              return;
            }
            setWaived(gates);
            setError(null);
            onDone(r.result);
          });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="scan-app-override-reason" className="text-caption text-ink-2">
          {t('sessionCheckin.overrideReason')}
        </label>
        <input
          id="scan-app-override-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby="scan-app-override-hint"
          className="field field-lg w-full"
        />
        <p id="scan-app-override-hint" className="text-caption text-ink-2">
          {error ?? t('sessionCheckin.overrideHint')}
        </p>
      </div>
      <Button type="submit" variant="secondary" size="lg" disabled={busy} className="self-start">
        {t('sessionCheckin.overrideSubmit')}
      </Button>
    </form>
  );
}
