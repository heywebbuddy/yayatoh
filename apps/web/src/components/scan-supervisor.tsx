'use client';

import { Alert, Button, Input } from '@yayatoh/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import { StepUpProvider, useStepUp } from '@/components/step-up.tsx';
import { Link } from '@/i18n/navigation.ts';
import { errorMessageKey } from '@/lib/errors.ts';
import type { ScanClient } from '@/scan/client.ts';
import {
  loadSupervisorAction,
  type SupervisorAction,
  type SupervisorLoad,
  supervisorAction,
} from '@/server/scan-supervisor-actions.ts';

type Loaded = Extract<SupervisorLoad, { state: 'ok' }>;
type Device = Loaded['view']['devices'][number];

/**
 * Supervisor mode (M3.4a): a signed-in supervisor sees every device of the org and can force a
 * sync, move a device to another entrance, revoke it (step-up), and run kiosk mode (kiosk
 * operators too). The device's key picks the org; the member signed in on this phone acts.
 */
export function SupervisorPanel(props: { client: ScanClient; refreshKey: number; selfId: string | null }) {
  return (
    <StepUpProvider>
      <SupervisorInner {...props} />
    </StepUpProvider>
  );
}

function SupervisorInner({
  client,
  refreshKey,
  selfId,
}: {
  client: ScanClient;
  refreshKey: number;
  selfId: string | null;
}) {
  const t = useTranslations('scanStaff');
  const [load, setLoad] = useState<SupervisorLoad | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoad(await loadSupervisorAction(client.token, client.config.eventId));
    } catch {
      setLoad({ state: 'offline' });
    }
  }, [client]);
  // refreshKey is the realtime trigger: re-read when it changes.
  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  if (!load) return <p className="text-body text-zinc-600">{t('loading')}</p>;
  if (load.state === 'offline') return <p className="text-body text-zinc-600">{t('supervisorOffline')}</p>;
  if (load.state === 'signed_out')
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body">{t('supervisorSignIn')}</p>
        <Link
          href={`/sign-in?next=${encodeURIComponent('/scan')}`}
          className="inline-flex min-h-11 items-center self-start rounded-pill bg-accent-700 px-5 text-body font-medium text-white"
        >
          {t('signIn')}
        </Link>
      </div>
    );
  if (load.state === 'forbidden')
    return (
      <p className="text-body" data-testid="supervisor-denied">
        {t('supervisorDenied')}
      </p>
    );

  if (load.state !== 'ok') return null;
  const { view } = load;
  const checkpoints = view.checkpoints;
  const entrances = checkpoints.filter((c) => c.kind === 'entrance');
  const self = view.devices.find((d) => d.id === selfId) ?? null;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-zinc-600">
        {load.canSupervise ? t('supervisorHint') : t('kioskOperatorHint')}
      </p>
      <div
        role="status"
        aria-live="polite"
        className="text-body font-medium"
        data-testid="supervisor-message"
      >
        {message}
      </div>
      {load.canSupervise && self ? (
        <ClaimAlerts client={client} deviceId={self.id} onDone={setMessage} />
      ) : null}
      <section aria-labelledby="supervisor-devices" className="flex flex-col gap-3">
        <h2 id="supervisor-devices" className="text-section">
          {t('allDevices')}
        </h2>
        <ul className="flex list-none flex-col gap-3 p-0" aria-label={t('allDevices')}>
          {view.devices.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              token={client.token}
              eventId={client.config.eventId}
              checkpoints={checkpoints}
              entrances={entrances}
              canSupervise={load.canSupervise}
              isSelf={d.id === selfId}
              onDone={async (msg) => {
                setMessage(msg);
                await refresh();
              }}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ClaimAlerts({
  client,
  deviceId,
  onDone,
}: {
  client: ScanClient;
  deviceId: string;
  onDone: (m: string) => void;
}) {
  const t = useTranslations('scanStaff');
  const tr = useTranslations();
  const [error, setError] = useState<string | null>(null);
  const run = async (on: boolean) => {
    setError(null);
    const r = await supervisorAction(client.token, {
      action: 'alerts',
      eventId: client.config.eventId,
      deviceId,
      on,
    });
    if (r.code === 'not_found') setError(t('claimNeedsPush'));
    else if (r.code) setError(tr(errorMessageKey(r.code)));
    else onDone(on ? t('claimOnDone') : t('claimOffDone'));
  };
  return (
    <section aria-labelledby="supervisor-claim" className="flex flex-col gap-2">
      <h2 id="supervisor-claim" className="text-section">
        {t('claimTitle')}
      </h2>
      <p className="text-body text-zinc-600">{t('claimHint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void run(true)}>
          {t('claimOn')}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void run(false)}>
          {t('claimOff')}
        </Button>
      </div>
      {error ? <Alert title={error} /> : null}
    </section>
  );
}

function DeviceCard({
  device: d,
  token,
  eventId,
  checkpoints,
  entrances,
  canSupervise,
  isSelf,
  onDone,
}: {
  device: Device;
  token: string;
  eventId: string;
  checkpoints: Loaded['view']['checkpoints'];
  entrances: Loaded['view']['checkpoints'];
  canSupervise: boolean;
  isSelf: boolean;
  onDone: (message: string) => Promise<void>;
}) {
  const t = useTranslations('scanStaff');
  const tr = useTranslations();
  const format = useFormatter();
  const stepUp = useStepUp();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [busy, setBusy] = useState(false);
  const names = new Map(checkpoints.map((c) => [c.id, c.name]));
  const actionable = d.where !== 'elsewhere';

  async function run(a: SupervisorAction, done: string) {
    setBusy(true);
    setError(null);
    setPinError(null);
    try {
      let r = await supervisorAction(token, a);
      if (r.code === 'step_up_required' && (await stepUp.confirm())) r = await supervisorAction(token, a);
      if (!r.code) {
        setConfirmRevoke(false);
        await onDone(done);
        return;
      }
      if (a.action === 'kiosk_start' && r.field === 'pin') setPinError(t('pinInvalid'));
      else if (a.action === 'kiosk_start' && r.field === 'checkpointId') setError(t('kioskNeedsEntrance'));
      else setError(tr(errorMessageKey(r.code)));
    } finally {
      setBusy(false);
    }
  }

  const where =
    d.where === 'here'
      ? d.checkpointId
        ? (names.get(d.checkpointId) ?? t('wholeEvent'))
        : t('wholeEvent')
      : d.where === 'elsewhere'
        ? t('elsewhere')
        : t('unused');
  return (
    <li className="flex flex-col gap-3 rounded-card border border-zinc-200 px-4 py-3" data-device={d.label}>
      <div className="flex flex-col gap-0.5">
        <h3 className="text-body font-medium">
          {d.label}
          {isSelf ? ` · ${t('thisDevice')}` : ''}
          {d.mode === 'kiosk' ? ` · ${t('kiosk')}` : ''}
        </h3>
        <p className="flex flex-wrap gap-x-3 text-caption text-zinc-600">
          <span className={d.online ? 'text-green-900' : 'text-pink-700'}>
            {d.online ? t('online') : t('offline')}
          </span>
          <span>{where}</span>
          <span>
            {d.lastSeenAt
              ? t('lastSeen', { time: format.dateTime(new Date(d.lastSeenAt), { timeStyle: 'short' }) })
              : t('neverSeen')}
          </span>
          {d.batteryPct !== null ? <span>{t('battery', { percent: d.batteryPct })}</span> : null}
          <span>{t('backlog', { count: d.queueDepth ?? 0 })}</span>
          {d.pending ? <span>{t('pending')}</span> : null}
        </p>
      </div>
      {actionable && canSupervise ? (
        <div className="flex flex-wrap items-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run({ action: 'sync', eventId, deviceId: d.id }, t('syncDone', { label: d.label }))
            }
          >
            {t('syncNow')}
          </Button>
          {d.mode === 'scanner' ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = String(new FormData(e.currentTarget).get('checkpointId') ?? '');
                const name = v ? (names.get(v) ?? '') : t('wholeEvent');
                void run(
                  { action: 'switch', eventId, deviceId: d.id, checkpointId: v || null },
                  t('moveDone', { label: d.label, place: name }),
                );
              }}
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-move`} className="text-caption text-zinc-600">
                  {t('moveTo', { label: d.label })}
                </label>
                <select
                  id={`${id}-move`}
                  name="checkpointId"
                  defaultValue={d.checkpointId ?? ''}
                  className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
                >
                  <option value="">{t('wholeEvent')}</option>
                  {checkpoints.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="secondary" disabled={busy}>
                {t('move')}
              </Button>
            </form>
          ) : null}
          {confirmRevoke ? (
            <div className="flex basis-full flex-col gap-2 rounded-card border-2 border-pink-700 px-4 py-3">
              <p className="text-body">{t('revokeConfirm', { label: d.label })}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      { action: 'revoke', eventId, deviceId: d.id },
                      t('revokeDone', { label: d.label }),
                    )
                  }
                >
                  {t('revokeYes')}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirmRevoke(false)}>
                  {t('cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setConfirmRevoke(true)}>
              {t('revoke')}
            </Button>
          )}
        </div>
      ) : null}
      {actionable && !isSelf ? (
        d.mode === 'kiosk' ? (
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            disabled={busy}
            onClick={() =>
              void run(
                { action: 'kiosk_stop', eventId, deviceId: d.id },
                t('kioskStopped', { label: d.label }),
              )
            }
          >
            {t('kioskStop')}
          </Button>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const pin = String(f.get('pin') ?? '').trim();
              if (!/^\d{4,8}$/.test(pin)) {
                setPinError(t('pinInvalid'));
                return;
              }
              void run(
                {
                  action: 'kiosk_start',
                  eventId,
                  deviceId: d.id,
                  checkpointId: String(f.get('kioskCheckpointId') ?? '') || null,
                  pin,
                },
                t('kioskStarted', { label: d.label }),
              );
            }}
          >
            {entrances.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-kiosk`} className="text-caption text-zinc-600">
                  {t('kioskEntrance', { label: d.label })}
                </label>
                <select
                  id={`${id}-kiosk`}
                  name="kioskCheckpointId"
                  className="min-h-10 rounded-pill border border-zinc-200 bg-white px-4 text-body"
                >
                  {entrances.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <Input
              id={`${id}-pin`}
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              label={t('kioskPin', { label: d.label })}
              hint={t('kioskPinHint')}
              error={pinError ?? undefined}
            />
            <Button type="submit" disabled={busy}>
              {t('kioskStart')}
            </Button>
          </form>
        )
      ) : null}
      {error ? <Alert title={error} /> : null}
    </li>
  );
}
