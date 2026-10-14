/**
 * The phone's push registration (M7.3d), through `POST /v1/me/devices` and
 * `DELETE /v1/me/devices/{token}` (M7.2c).
 *
 * - **Register** when the person is signed in and the phone allows notifications: send the token,
 *   the app id and version, the language and the time zone.
 * - **Refresh** when anything the server stores changes (the token, the language, the app version,
 *   the person), when the server said it stored the phone nowhere yet (`organizations: 0`: the
 *   person had no order or ticket), and every few days so the server sees the phone is alive.
 * - **Delete** at sign-out, while the session still works.
 *
 * Nothing here logs a token, and a failure never reaches the person: push is an extra, so a failed
 * registration is tried again at the next start, return to the foreground or purchase.
 */
import type { KeyValueStore } from '@yayatoh/mobile-core';
import type { YayatohClient } from '@yayatoh/sdk';
import type { DevicePushToken, PushPort } from './port';

export const REGISTRATION_KEY = 'yayatoh.push.registration.v1';
/** A registration that is unchanged is still repeated this often (the server keeps the newest phones). */
export const REREGISTER_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface DeviceFacts {
  readonly appId: string;
  readonly appVersion: string;
  /** APNs only: `sandbox` for a development build's token. */
  readonly environment: 'sandbox' | 'production';
}

interface Stored {
  readonly platform: DevicePushToken['platform'];
  readonly token: string;
  /** What was sent, to see whether anything changed. */
  readonly signature: string;
  readonly registeredAt: number;
  /** In how many organizations the server stored the phone. */
  readonly organizations: number;
}

export type SyncOutcome = 'registered' | 'unchanged' | 'skipped' | 'failed';

export interface PushRegistrar {
  /** Registers or refreshes. `force` repeats it even when nothing changed (after a purchase). */
  sync(options?: { readonly force?: boolean }): Promise<SyncOutcome>;
  /** Deletes the phone's registration on the server and forgets it here. */
  unregister(): Promise<void>;
  /** Registers again whenever the OS rotates the token. Returns its remover. */
  watchToken(): () => void;
}

export interface RegistrarOptions {
  readonly port: PushPort;
  readonly api: YayatohClient;
  readonly storage: KeyValueStore;
  readonly device: DeviceFacts;
  /** The app's language tag now (changes when the person picks another language). */
  readonly locale: () => string;
  /** The signed-in person's id, or null when signed out. */
  readonly userId: () => string | null;
  readonly timeZone?: () => string | undefined;
  readonly now?: () => number;
}

const defaultTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};

async function readStored(storage: KeyValueStore): Promise<Stored | null> {
  try {
    const raw = await storage.get(REGISTRATION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (
      (v.platform === 'apns' || v.platform === 'fcm') &&
      typeof v.token === 'string' &&
      typeof v.signature === 'string' &&
      typeof v.registeredAt === 'number'
    )
      return { ...(v as Stored), organizations: typeof v.organizations === 'number' ? v.organizations : 0 };
  } catch {
    // Unreadable: treat as never registered.
  }
  return null;
}

export function createPushRegistrar(options: RegistrarOptions): PushRegistrar {
  const { port, api, storage, device } = options;
  const now = options.now ?? Date.now;
  const timeZone = options.timeZone ?? defaultTimeZone;
  // One call at a time: a token rotation during a start-up sync must not register twice.
  let running: Promise<SyncOutcome> | null = null;

  const run = async (force: boolean): Promise<SyncOutcome> => {
    const userId = options.userId();
    if (!userId) return 'skipped';
    if ((await port.getPermission()) !== 'granted') return 'skipped';
    const token = await port.getDeviceToken();
    if (!token) return 'skipped';

    const locale = options.locale();
    const zone = timeZone();
    const signature = JSON.stringify([
      userId,
      token.platform,
      token.token,
      device.appId,
      device.appVersion,
      locale,
      zone ?? null,
      device.environment,
    ]);
    const stored = await readStored(storage);
    if (
      !force &&
      stored &&
      stored.signature === signature &&
      stored.organizations > 0 &&
      now() - stored.registeredAt < REREGISTER_AFTER_MS
    )
      return 'unchanged';

    try {
      const { data, response } = await api.POST('/v1/me/devices', {
        body: {
          platform: token.platform,
          token: token.token,
          appId: device.appId,
          appVersion: device.appVersion,
          locale,
          ...(zone ? { timeZone: zone } : {}),
          ...(token.platform === 'apns' ? { environment: device.environment } : {}),
        },
      });
      if (!response.ok || !data) return 'failed';
      const next: Stored = {
        platform: token.platform,
        token: token.token,
        signature,
        registeredAt: now(),
        organizations: data.organizations,
      };
      await storage.set(REGISTRATION_KEY, JSON.stringify(next)).catch(() => {});
      return 'registered';
    } catch {
      // Offline or a timeout: nothing was stored, so the next start tries again.
      return 'failed';
    }
  };

  const sync = (opts?: { readonly force?: boolean }): Promise<SyncOutcome> => {
    const force = opts?.force === true;
    if (running) {
      // A forced sync (after a purchase) must not be swallowed by one that started before it.
      return force ? running.then(() => sync(opts)) : running;
    }
    running = run(force).finally(() => {
      running = null;
    });
    return running;
  };

  return {
    sync,
    async unregister() {
      const stored = await readStored(storage);
      // Forget it here first: whatever the network does, this phone no longer thinks it is registered.
      await storage.delete(REGISTRATION_KEY).catch(() => {});
      if (!stored) return;
      try {
        await api.DELETE('/v1/me/devices/{token}', { params: { path: { token: stored.token } } });
      } catch {
        // Offline sign-out still signs out; the server drops the row when the phone registers for
        // someone else or the push service reports the token gone.
      }
    },
    watchToken() {
      return port.onTokenChange(() => void sync());
    },
  };
}
