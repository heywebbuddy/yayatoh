import { deviceWindowState } from '@yayatoh/checkin/routes';
import { PROBLEM_TYPE_BASE } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import type { CommandPorts } from '@yayatoh/kernel';
import { createMiddleware } from 'hono/factory';
import {
  MOBILE_CLIENTS,
  type MobileAppSettings,
  type MobileClient,
  type MobileSettings,
  type V1Env,
} from './context.ts';
import { clientInfo } from './telemetry.ts';

/**
 * Minimum app versions (M7.2d, decision P7-9). The mobile apps send `X-Yayatoh-Client:
 * <app>/<version> (<build>)`; an app below its minimum gets `426 Upgrade Required` (problem+json,
 * code `upgrade_required`, with the store link) from every route except the ones that tell it what
 * to do about it. Nothing else is ever refused: a missing, malformed or unknown header (the web,
 * the SDKs, integrations, the older apps) always passes, and a Staff device never gets a 426 while
 * its event is on (24 hours before the start to 2 hours after the end), because nobody can update
 * an app at the door.
 */

export const DEFAULT_MOBILE: MobileSettings = {
  minimumVersions: { ios: '0.0.0', android: '0.0.0' },
  latestVersions: { ios: '0.0.0', android: '0.0.0' },
  baseUrls: { api: 'https://api.yayatoh.com/v1', web: 'https://app.yayatoh.com' },
  features: { wallet: false, rsvp: false, agenda: false, offlineScanning: true },
};

export const resolveMobile = (m?: Partial<MobileSettings>): MobileSettings => ({ ...DEFAULT_MOBILE, ...m });

const STORE_URL_ENV: Record<MobileClient, string> = {
  'yayatoh-ios': 'IOS_ATTENDEE_STORE_URL',
  'yayatoh-android': 'ANDROID_ATTENDEE_STORE_URL',
  'yayatoh-staff-ios': 'IOS_STAFF_STORE_URL',
  'yayatoh-staff-android': 'ANDROID_STAFF_STORE_URL',
};

/**
 * The mobile settings an `apps/api` or web host takes from its environment: `MOBILE_CONFIG_JSON`
 * (any part of `MobileSettings`, as JSON) with the four store links filled in from their own names
 * unless the JSON already sets them. A store link that is not https is ignored.
 */
export function mobileSettingsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Partial<MobileSettings> | undefined {
  const json: Partial<MobileSettings> = env.MOBILE_CONFIG_JSON ? JSON.parse(env.MOBILE_CONFIG_JSON) : {};
  const apps: Partial<Record<MobileClient, Partial<MobileAppSettings>>> = { ...json.apps };
  for (const id of MOBILE_CLIENTS) {
    const url = env[STORE_URL_ENV[id]]?.trim();
    if (url?.startsWith('https://') && !apps[id]?.storeUrl) apps[id] = { ...apps[id], storeUrl: url };
  }
  const merged = Object.keys(apps).length ? { ...json, apps } : json;
  return Object.keys(merged).length ? merged : undefined;
}

const isMobileClient = (c: string): c is MobileClient => (MOBILE_CLIENTS as readonly string[]).includes(c);

/** Dotted numbers compared part by part (`3.10.0` > `3.9.1`); a pre-release or build suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[-+]/, 1)[0]?.split('.').map(Number) ?? [];
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Fill each app's settings: what `apps` says, else (attendee apps only) the older per-platform
 * `minimumVersions` / `latestVersions`, else no minimum; the store link falls back to the web app.
 */
export function mobileApps(
  m: Pick<MobileSettings, 'minimumVersions' | 'latestVersions' | 'baseUrls' | 'apps'>,
): Record<MobileClient, MobileAppSettings> {
  const out = {} as Record<MobileClient, MobileAppSettings>;
  for (const id of MOBILE_CLIENTS) {
    const platform = id.endsWith('ios') ? 'ios' : 'android';
    const staff = id.includes('staff');
    const own = m.apps?.[id];
    out[id] = {
      minimumVersion: own?.minimumVersion ?? (staff ? '0.0.0' : m.minimumVersions[platform]),
      latestVersion: own?.latestVersion ?? (staff ? '0.0.0' : m.latestVersions[platform]),
      storeUrl: own?.storeUrl || m.baseUrls.web,
    };
  }
  return out;
}

/** The routes a below-minimum app may still call: its configuration, health and the API documents. */
const ALWAYS = (path: string) =>
  path === '/mobile/config' || path === '/health' || path === '/openapi.json' || path.startsWith('/docs');

const MANIFEST = /\/events\/([0-9a-f-]{36})\/manifest$/i;

export interface VersionGateDeps {
  readonly ports: CommandPorts<TenantTx>;
  readonly settings: () => Record<MobileClient, MobileAppSettings>;
  readonly basePath: string;
  /** Test seam: the clock for the Staff event window. */
  readonly now?: () => Date;
}

/** The `426` body: problem+json with the app's minimum and where to get the update. */
export function upgradeRequired(client: MobileClient, version: string, app: MobileAppSettings) {
  return {
    type: `${PROBLEM_TYPE_BASE}upgrade_required`,
    title: 'Upgrade required',
    status: 426,
    code: 'upgrade_required',
    detail: `${client} ${version} is older than the minimum supported version ${app.minimumVersion}`,
    details: {
      client,
      version,
      minimumVersion: app.minimumVersion,
      latestVersion: app.latestVersion,
      storeUrl: app.storeUrl,
    },
  };
}

export function versionGate(deps: VersionGateDeps) {
  return createMiddleware<V1Env>(async (c, next) => {
    const { client, appVersion } = clientInfo(c.req.raw.headers);
    if (!isMobileClient(client) || appVersion === 'unknown') return next();
    const app = deps.settings()[client];
    if (compareVersions(appVersion, app.minimumVersion) >= 0) return next();
    const path = new URL(c.req.url).pathname.slice(deps.basePath.length) || '/';
    if (ALWAYS(path)) return next();

    // A device (`yyd_` token) inside its event's window is never turned away. A token that is not a
    // live device is left to the route's own 401. Any failure here lets the request through.
    const token = /^Bearer\s+(yyd_\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
    if (token) {
      try {
        const state = await deviceWindowState(token, deps.ports, {
          eventId: MANIFEST.exec(path)?.[1],
          now: deps.now?.(),
        });
        if (state !== 'outside') return next();
      } catch (err) {
        console.warn('version gate: device window unavailable', err);
        return next();
      }
    }
    return c.body(JSON.stringify(upgradeRequired(client, appVersion, app)), 426, {
      'content-type': 'application/problem+json',
      'cache-control': 'no-store',
    });
  });
}
