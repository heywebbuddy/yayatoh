/**
 * The version gate (M7.1c, decision P7-9). At launch the app reads `GET /v1/mobile/config` and
 * compares its own version with its entry in `apps`: below `minimumVersion` it shows the update
 * screen, below `latestVersion` a soft nudge. Any `426` from `/v1` shows the update screen too.
 *
 * Two rules keep the gate from locking anyone out:
 * - A check that cannot be made (offline, a 5xx, an unknown app) never blocks: state `unknown`.
 * - A Staff device inside its event window is never blocked (nobody can update at the door), so
 *   `suppressRequired` turns a hard block into the soft nudge.
 */
import type { YayatohClient } from '@yayatoh/sdk';
import { type ClientName, type UpgradeInfo } from '../client';

export type GateState =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'ok' }
  | { readonly kind: 'recommended'; readonly latest: string; readonly storeUrl: string | null }
  | { readonly kind: 'required'; readonly minimum: string | null; readonly latest: string | null; readonly storeUrl: string | null };

/** Dotted numbers compared part by part (`3.10.0` > `3.9.1`); a pre-release or build suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (v.split(/[-+]/, 1)[0] ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Only an https link is opened from a server response. */
export function safeStoreUrl(url: string | null | undefined): string | null {
  return typeof url === 'string' && /^https:\/\/[^\s]+$/i.test(url.trim()) ? url.trim() : null;
}

export interface AppPolicy {
  readonly minimumVersion: string;
  readonly latestVersion: string;
  readonly storeUrl: string;
}

export function evaluateVersion(appVersion: string, policy: AppPolicy | null | undefined): GateState {
  if (!policy) return { kind: 'unknown' };
  const storeUrl = safeStoreUrl(policy.storeUrl);
  if (compareVersions(appVersion, policy.minimumVersion) < 0)
    return { kind: 'required', minimum: policy.minimumVersion, latest: policy.latestVersion, storeUrl };
  if (compareVersions(appVersion, policy.latestVersion) < 0)
    return { kind: 'recommended', latest: policy.latestVersion, storeUrl };
  return { kind: 'ok' };
}

export interface VersionGate {
  readonly state: GateState;
  subscribe(listener: () => void): () => void;
  /** Reads `/v1/mobile/config` and updates the state. Never throws. */
  check(): Promise<GateState>;
  /** A `426` arrived: block now, with the link it carried. */
  upgradeRequired(info: UpgradeInfo): Promise<void>;
}

export interface VersionGateOptions {
  /** A client that sends no token: the config route needs none, and works below the minimum. */
  readonly api: YayatohClient;
  readonly client: ClientName;
  readonly appVersion: string;
  /** True while a Staff device is inside its event window. */
  readonly suppressRequired?: () => boolean | Promise<boolean>;
  readonly timeoutMs?: number;
}

export function createVersionGate(opts: VersionGateOptions): VersionGate {
  let state: GateState = { kind: 'unknown' };
  const listeners = new Set<() => void>();
  const set = (next: GateState) => {
    state = next;
    for (const l of listeners) l();
  };
  /** Never weakens an existing block with an `unknown`/`ok` from a later successful check. */
  const soften = async (next: GateState): Promise<GateState> => {
    if (next.kind === 'required' && (await Promise.resolve(opts.suppressRequired?.()).catch(() => false))) {
      return next.latest && compareVersions(opts.appVersion, next.latest) < 0
        ? { kind: 'recommended', latest: next.latest, storeUrl: next.storeUrl }
        : { kind: 'ok' };
    }
    return next;
  };
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async check() {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
        const { data } = await opts.api.GET('/v1/mobile/config', { signal: controller.signal }).finally(() => clearTimeout(timer));
        const policy = data?.apps?.[opts.client];
        // An unreadable answer leaves the state alone: it must not lift a block a 426 set.
        if (policy) set(await soften(evaluateVersion(opts.appVersion, policy)));
      } catch {
        // Offline or a timeout: not a reason to block.
      }
      return state;
    },
    async upgradeRequired(info) {
      set(
        await soften({
          kind: 'required',
          minimum: info.minimumVersion,
          latest: info.latestVersion,
          storeUrl: safeStoreUrl(info.storeUrl),
        }),
      );
    },
  };
}
