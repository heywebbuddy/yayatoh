'use client';

import { Alert, Button } from '@yayatoh/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useCallback, useEffect, useState } from 'react';
import { errorMessageKey } from '@/lib/errors.ts';

export interface PushDeviceView {
  readonly id: string;
  readonly label: string | null;
  /** `endpointRef` of the subscription: lets this browser find itself in the list. */
  readonly ref: string | null;
  /** Already formatted for the reader's locale. */
  readonly since: string;
}

export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly timeZone: string;
}

export type PushActionResult = { readonly ok: boolean; readonly code: string | null };
export type RemoveDeviceState = { readonly removed: boolean; readonly code: string | null };

type Status = 'checking' | 'unsupported' | 'unavailable' | 'blocked' | 'off' | 'on';

const SCOPE = '/push/';

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Same as the server's `endpointRef`: sha256(endpoint), base64url, 22 characters. */
async function endpointRef(endpoint: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  let s = '';
  for (const b of digest) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

/** The push worker, active (subscribing needs an active worker; it controls no page). */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/push-sw.js', { scope: SCOPE });
  if (reg.active) return reg;
  const worker = reg.installing ?? reg.waiting;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('service worker did not activate')), 10_000);
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        clearTimeout(timer);
        resolve();
      }
    });
    if (!worker) {
      clearTimeout(timer);
      resolve();
    }
  });
  return reg;
}

/**
 * This site's notification permission, from the Permissions API when the browser has it. The static
 * `Notification.permission` can disagree with the real grant: browsers without a notification
 * platform (for example Chromium's headless shell) report `denied` while the permission is granted
 * and push subscriptions work, which would hide the opt-in behind a false "blocked".
 */
async function notificationPermission(): Promise<NotificationPermission> {
  try {
    const { state } = await navigator.permissions.query({ name: 'notifications' });
    if (state === 'granted' || state === 'denied') return state;
    if (state === 'prompt') return 'default';
  } catch {
    // No Permissions API (or no `notifications` name): fall back to the static value.
  }
  return Notification.permission;
}

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Web push opt-in for this browser (M1.10e), with the person's device list. Buyers use it on their
 * order page (the manage link is their credential), members in their notification settings. Native
 * buttons and forms (keyboard, screen readers), a polite status region for every outcome, and a
 * plain explanation when the browser can't or won't show notifications.
 */
export function WebPushControl({
  publicKey,
  devices,
  subscribe,
  unsubscribe,
  remove,
  hint,
  showDevices = true,
}: {
  publicKey: string | null;
  devices: readonly PushDeviceView[];
  subscribe: (sub: PushSubscriptionInput) => Promise<PushActionResult>;
  unsubscribe: (endpoint: string) => Promise<PushActionResult>;
  remove: (prev: RemoveDeviceState, form: FormData) => Promise<RemoveDeviceState>;
  hint: string;
  showDevices?: boolean;
}) {
  const t = useTranslations('webPush');
  const tr = useTranslations();
  const router = useRouter();
  const [status, setStatus] = useState<Status>('checking');
  const [thisRef, setThisRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeState, removeAction, removing] = useActionState(remove, { removed: false, code: null });
  const refs = devices.map((d) => d.ref).join(',');

  const check = useCallback(async () => {
    if (!supported()) return setStatus('unsupported');
    if (!publicKey) return setStatus('unavailable');
    const permission = await notificationPermission();
    if (permission === 'denied') return setStatus('blocked');
    const reg = await navigator.serviceWorker.getRegistration(SCOPE);
    const sub = await reg?.pushManager.getSubscription();
    const ref = sub ? await endpointRef(sub.endpoint) : null;
    setThisRef(ref);
    setStatus(ref && refs.split(',').includes(ref) && permission === 'granted' ? 'on' : 'off');
  }, [publicKey, refs]);

  useEffect(() => {
    check().catch(() => setStatus('off'));
  }, [check]);

  async function turnOn() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'blocked' : 'off');
        setError(t(permission === 'denied' ? 'blocked' : 'notAllowed'));
        return;
      }
      const reg = await activeRegistration();
      const key = keyBytes(publicKey);
      let sub = await reg.pushManager.getSubscription();
      // A subscription made with another key (rotated VAPID keys) can't be reused.
      if (sub && !sameKey(sub.options.applicationServerKey, key)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const json = sub.toJSON();
      const result = await subscribe({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (!result.ok) {
        setError(result.code === 'too_many_devices' ? t('tooMany') : t('failed'));
        return;
      }
      setThisRef(await endpointRef(sub.endpoint));
      setStatus('on');
      setMessage(t('turnedOn'));
      router.refresh();
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration(SCOPE);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribe(sub.endpoint);
        await sub.unsubscribe().catch(() => undefined);
      }
      setStatus('off');
      setMessage(t('turnedOff'));
      router.refresh();
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  const explain =
    status === 'unsupported'
      ? t('unsupported')
      : status === 'unavailable'
        ? t('unavailable')
        : status === 'blocked'
          ? t('blocked')
          : status === 'checking'
            ? t('checking')
            : status === 'on'
              ? t('on')
              : t('off');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-zinc-600">{hint}</p>
      <p className="text-body font-medium">{explain}</p>
      {status === 'off' ? (
        <Button type="button" onClick={turnOn} disabled={busy} className="self-start">
          {t('turnOn')}
        </Button>
      ) : null}
      {status === 'on' ? (
        <Button type="button" variant="secondary" onClick={turnOff} disabled={busy} className="self-start">
          {t('turnOff')}
        </Button>
      ) : null}
      <div role="status" aria-live="polite" className="text-body font-medium">
        {message ?? (removeState.removed ? t('removed') : null)}
      </div>
      {error ? <Alert title={error} /> : null}
      {removeState.code ? <Alert title={tr(errorMessageKey(removeState.code))} /> : null}
      {showDevices ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-body font-medium">{t('devices')}</h3>
          {devices.length === 0 ? (
            <p className="text-body text-zinc-600">{t('devicesNone')}</p>
          ) : (
            <ul aria-label={t('devices')} className="flex list-none flex-col divide-y divide-zinc-100 p-0">
              {devices.map((d) => {
                const label = d.label ?? t('unknownDevice');
                return (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
                  >
                    <span className="flex flex-col">
                      <span>
                        {label}
                        {d.ref && d.ref === thisRef ? (
                          <span className="ms-2 text-caption text-zinc-500">{t('thisDevice')}</span>
                        ) : null}
                      </span>
                      <span className="text-caption text-zinc-500">{t('since', { date: d.since })}</span>
                    </span>
                    <form action={removeAction}>
                      <input type="hidden" name="deviceId" value={d.id} />
                      <Button
                        type="submit"
                        variant="secondary"
                        size="sm"
                        disabled={removing}
                        aria-label={t('removeLabel', { label })}
                      >
                        {t('remove')}
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
