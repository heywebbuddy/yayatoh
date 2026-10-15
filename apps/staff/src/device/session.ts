/**
 * The door device's session (M7.4a, decision P7-6): the `yyd_` token an organizer's enrolment QR
 * hands over, kept in secure storage, and everything that follows from it.
 *
 * - **Enrolment** proves the token with one call (the staff overview, which also names the device),
 *   then reads the event's name, dates and checkpoints from the manifest header.
 * - **Heartbeat** every 30 s: battery, the outbox's queue depth, the clock offset. The answer can
 *   carry a wipe, a sync request or a new checkpoint from a supervisor. A 401 means revoked or wiped.
 * - **Wipe / revoke** removes the token first (nothing can use it), then runs every `onWipe`
 *   callback (M7.4b deletes the manifest database), then shows the enrolment screen again.
 * - **Event window**: from 24 h before the event starts to 2 h after it ends the version gate only
 *   nudges (nobody can update an app at the door).
 *
 * Plain TypeScript with every native dependency injected, so it is tested without a phone. The
 * token never appears in a URL, a log line or an error: it is read from the link, stored, and sent
 * only in an `Authorization` header.
 */
import {
  type ApiClientOptions,
  type ClientIdentity,
  createApiClient,
  type KeyValueStore,
  type UpgradeInfo,
} from '@yayatoh/mobile-core';
import type { YayatohClient } from '@yayatoh/sdk';
import { type Enrolment, enrolmentFromLink } from './link';

export type DeviceStatus = 'unenrolled' | 'enrolled' | 'revoked' | 'wiped';
/** Why local data was erased. `replaced` and `forgotten` are the person's own choice. */
export type WipeReason = 'revoked' | 'wiped' | 'replaced' | 'forgotten';

export interface DeviceCheckpoint {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

export interface DeviceEvent {
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
}

export interface DeviceState {
  /** False until the stored enrolment has been read. */
  readonly loaded: boolean;
  readonly status: DeviceStatus;
  readonly deviceId: string | null;
  readonly eventId: string | null;
  /** Where this device scans; null is the whole event. */
  readonly checkpointId: string | null;
  /** True once the person has chosen (or been moved to) a place, or chose the whole event. */
  readonly checkpointChosen: boolean;
  /** The `yyd_` token, for the one client that sends it. Never log it. */
  readonly token: string | null;
  readonly event: DeviceEvent | null;
  readonly checkpoints: readonly DeviceCheckpoint[];
  /** The last heartbeat the server answered; null before the first, or while offline. */
  readonly lastHeartbeatAt: string | null;
}

export type EnrolOutcome =
  | { readonly kind: 'enrolled' }
  /** The link or code is not an enrolment link. */
  | { readonly kind: 'invalid_link' }
  /** The server refused the token: unknown, revoked or wiped. */
  | { readonly kind: 'rejected' }
  /** The token is fine but not for this event (or the event is gone). */
  | { readonly kind: 'wrong_event' }
  | { readonly kind: 'rateLimited'; readonly retryAfterSeconds: number | null }
  /** No network, a timeout or a 5xx: nothing was decided. */
  | { readonly kind: 'unavailable' };

export type HeartbeatOutcome =
  | { readonly kind: 'ok'; readonly synced: boolean; readonly moved: boolean }
  | { readonly kind: 'ended'; readonly reason: 'revoked' | 'wiped' }
  /** Offline or a 5xx: the device keeps scanning and tries again in 30 s. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'idle' };

export interface DeviceTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface DeviceSessionOptions {
  readonly storage: KeyValueStore;
  /** The configured API URL (`…/api/v1`). */
  readonly apiBaseUrl: string;
  readonly identity: ClientIdentity;
  readonly fetch?: typeof globalThis.fetch;
  /** A 426 on a device call: the version gate decides whether it may show. */
  readonly onUpgradeRequired?: (info: UpgradeInfo) => void;
  readonly now?: () => number;
  /** Battery level 0–100, or null where the phone cannot say. */
  readonly battery?: () => Promise<number | null>;
  readonly timers?: DeviceTimers;
  readonly heartbeatMs?: number;
  /** Where a failure is reported. Never pass a token, a link or a person's details. */
  readonly log?: (message: string) => void;
}

export const DEVICE_KEY = 'yayatoh.staff.device.v1';
/** What was last ended, so the enrolment screen can say why until the next enrolment. */
export const ENDED_KEY = 'yayatoh.staff.device.ended.v1';
export const HEARTBEAT_MS = 30_000;
/** The same window the server uses for its own 426 rule (M7.2d, P7-9). */
export const EVENT_WINDOW = { beforeMs: 24 * 3_600_000, afterMs: 2 * 3_600_000 } as const;

interface Stored {
  readonly token: string;
  readonly eventId: string;
  readonly deviceId: string;
  readonly checkpointId: string | null;
  readonly checkpointChosen: boolean;
  readonly event: DeviceEvent | null;
  readonly checkpoints: readonly DeviceCheckpoint[];
  /** The supervisor's checkpoint directive this device last applied (ISO time). */
  readonly appliedCheckpointAt: string | null;
  readonly appliedSyncAt: string | null;
}

interface Ended {
  readonly status: 'revoked' | 'wiped';
  /** False while the wipe callbacks have not all finished (the app was closed mid-wipe). */
  readonly wipeDone: boolean;
}

const EMPTY: DeviceState = {
  loaded: false,
  status: 'unenrolled',
  deviceId: null,
  eventId: null,
  checkpointId: null,
  checkpointChosen: false,
  token: null,
  event: null,
  checkpoints: [],
  lastHeartbeatAt: null,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseStored(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v) || typeof v.token !== 'string' || typeof v.eventId !== 'string') return null;
    if (typeof v.deviceId !== 'string') return null;
    return {
      token: v.token,
      eventId: v.eventId,
      deviceId: v.deviceId,
      checkpointId: typeof v.checkpointId === 'string' ? v.checkpointId : null,
      checkpointChosen: v.checkpointChosen === true,
      event: isRecord(v.event) ? (v.event as unknown as DeviceEvent) : null,
      checkpoints: Array.isArray(v.checkpoints) ? (v.checkpoints as DeviceCheckpoint[]) : [],
      appliedCheckpointAt: typeof v.appliedCheckpointAt === 'string' ? v.appliedCheckpointAt : null,
      appliedSyncAt: typeof v.appliedSyncAt === 'string' ? v.appliedSyncAt : null,
    };
  } catch {
    return null;
  }
}

function parseEnded(raw: string | null): Ended | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (isRecord(v) && (v.status === 'revoked' || v.status === 'wiped'))
      return { status: v.status, wipeDone: v.wipeDone !== false };
  } catch {
    // Unreadable means nothing to say.
  }
  return null;
}

const asDirective = (at: string | null | undefined, applied: string | null) =>
  !!at && (!applied || Date.parse(at) > Date.parse(applied));

/**
 * The device clock's offset from the server's (server − device), from one request: the server
 * stamped `serverTime` somewhere between the send and the answer, so the offset is the value in that
 * interval closest to zero. The same estimate the Scan PWA uses, so first-wins reconciliation of
 * offline scans orders doors the same way.
 */
export function clockOffsetMs(sample: { serverTime: number; sentAt: number; receivedAt: number }): number {
  const sentAt = Math.min(sample.sentAt, sample.receivedAt);
  const receivedAt = Math.max(sample.sentAt, sample.receivedAt);
  const low = sample.serverTime - receivedAt;
  const high = sample.serverTime - sentAt;
  if (low > 0) return low;
  if (high < 0) return high;
  return 0;
}

/** Whether `now` is from 24 h before the event starts to 2 h after it ends. */
export function insideEventWindow(
  event: Pick<DeviceEvent, 'startsAt' | 'endsAt'> | null,
  now: number,
): boolean {
  if (!event) return false;
  const start = Date.parse(event.startsAt);
  const end = Date.parse(event.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return now >= start - EVENT_WINDOW.beforeMs && now <= end + EVENT_WINDOW.afterMs;
}

const retryAfter = (response: Response): number | null => {
  const n = Number(response.headers.get('retry-after'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function createDeviceSession(options: DeviceSessionOptions) {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const timers: DeviceTimers = options.timers ?? {
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  };
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;

  let state: DeviceState = EMPTY;
  let stored: Stored | null = null;
  let loaded: Promise<DeviceState> | null = null;
  let clockOffset = 0;
  let timer: unknown = null;
  let beating: Promise<HeartbeatOutcome> | null = null;
  let pendingWipe = false;
  let queueSource: () => number | Promise<number> = () => 0;
  const listeners = new Set<() => void>();
  const wipeCallbacks = new Set<(reason: WipeReason) => void | Promise<void>>();
  const syncCallbacks = new Set<() => void | Promise<void>>();

  const setState = (next: Partial<DeviceState>) => {
    state = { ...state, ...next };
    for (const l of listeners) l();
  };

  const clientFor = (token: () => string | undefined, refresh = false): YayatohClient => {
    const opts: ApiClientOptions = {
      baseUrl: options.apiBaseUrl,
      identity: options.identity,
      tokens: {
        accessToken: async () => token(),
        // A 401 on any device call: ask the heartbeat whether the device was revoked or wiped. The
        // request itself is never repeated (the same token would be refused again).
        ...(refresh
          ? {
              refreshAfterUnauthorized: async () => {
                void api.handleUnauthorized();
                return false;
              },
            }
          : {}),
      },
      ...(options.onUpgradeRequired ? { onUpgradeRequired: options.onUpgradeRequired } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    };
    return createApiClient(opts);
  };

  /** The signed `/v1` client for the enrolled device; a 401 on it ends an unusable enrolment. */
  const deviceClient = clientFor(() => stored?.token, true);
  /** The heartbeat's own client: its 401 is the answer, never a reason to ask again. */
  const heartbeatClient = clientFor(() => stored?.token);

  const persist = async () => {
    if (!stored) return;
    try {
      await options.storage.set(DEVICE_KEY, JSON.stringify(stored));
    } catch {
      log('device: could not write secure storage');
    }
  };

  const publish = () => {
    if (!stored) return;
    setState({
      status: 'enrolled',
      deviceId: stored.deviceId,
      eventId: stored.eventId,
      checkpointId: stored.checkpointId,
      checkpointChosen: stored.checkpointChosen,
      token: stored.token,
      event: stored.event,
      checkpoints: stored.checkpoints,
    });
  };

  const writeEnded = async (ended: Ended | null) => {
    try {
      if (ended) await options.storage.set(ENDED_KEY, JSON.stringify(ended));
      else await options.storage.delete(ENDED_KEY);
    } catch {
      log('device: could not write secure storage');
    }
  };

  /** Everything local that the device's work left behind goes, whatever ended the enrolment. */
  const runWipeCallbacks = async (reason: WipeReason) => {
    await Promise.all(
      [...wipeCallbacks].map(async (cb) => {
        try {
          await cb(reason);
        } catch {
          log('device: a wipe callback failed');
        }
      }),
    );
  };

  /**
   * Ends the enrolment: the token goes first (nothing can use it), the screen leaves the scanner,
   * then every `onWipe` callback runs, then the marker says the wipe is complete.
   */
  const end = async (reason: WipeReason) => {
    stopHeartbeat();
    stored = null;
    clockOffset = 0;
    const status: DeviceStatus =
      reason === 'revoked' ? 'revoked' : reason === 'wiped' ? 'wiped' : 'unenrolled';
    try {
      await options.storage.delete(DEVICE_KEY);
    } catch {
      log('device: could not clear secure storage');
    }
    const showsNotice = reason === 'revoked' || reason === 'wiped';
    await writeEnded(showsNotice ? { status: reason as 'revoked' | 'wiped', wipeDone: false } : null);
    setState({
      status,
      deviceId: null,
      eventId: null,
      checkpointId: null,
      checkpointChosen: false,
      token: null,
      event: null,
      checkpoints: [],
      lastHeartbeatAt: null,
    });
    pendingWipe = true;
    await runWipeCallbacks(reason);
    pendingWipe = false;
    if (showsNotice) await writeEnded({ status: reason as 'revoked' | 'wiped', wipeDone: true });
  };

  async function load(): Promise<DeviceState> {
    let ended: Ended | null = null;
    try {
      stored = parseStored(await options.storage.get(DEVICE_KEY));
      ended = parseEnded(await options.storage.get(ENDED_KEY));
    } catch {
      log('device: could not read secure storage');
    }
    if (stored) {
      setState({ loaded: true });
      publish();
    } else {
      // The app was closed mid-wipe, or a revoked device is opened again: say why, and finish.
      pendingWipe = ended ? !ended.wipeDone : false;
      setState({ loaded: true, status: ended?.status ?? 'unenrolled' });
    }
    return state;
  }

  const stopHeartbeat = () => {
    if (timer !== null) timers.clearInterval(timer);
    timer = null;
  };

  /** Reads the event's name, dates and checkpoints from the manifest header (one row). */
  async function refreshEvent(): Promise<boolean> {
    const current = stored;
    if (!current) return false;
    try {
      const { data, response } = await deviceClient.GET('/v1/events/{eventId}/manifest', {
        params: { path: { eventId: current.eventId }, query: { limit: 1 } },
      });
      if (!response.ok || !data || stored !== current) return false;
      const header = data.header;
      const checkpoints = header.checkpoints.map((c) => ({ id: c.id, name: c.name, kind: String(c.kind) }));
      const keep = checkpoints.some((c) => c.id === current.checkpointId);
      stored = {
        ...current,
        event: {
          name: header.event.name,
          startsAt: header.event.startsAt,
          endsAt: header.event.endsAt,
          timezone: header.event.timezone,
        },
        checkpoints,
        // A place the server no longer offers falls back to the whole event.
        checkpointId: keep ? current.checkpointId : null,
      };
      await persist();
      publish();
      return true;
    } catch {
      return false;
    }
  }

  const api = {
    get state() {
      return state;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Reads the stored enrolment once; resolves when the state is known. */
    restore(): Promise<DeviceState> {
      loaded ??= load();
      return loaded;
    },

    /**
     * Enrols with a scanned or opened link (or its two parts). The key is proven with one call
     * before anything is stored. Replacing an enrolment erases the old one's local data first.
     */
    async enrol(input: string | Enrolment): Promise<EnrolOutcome> {
      await api.restore();
      const enrolment = typeof input === 'string' ? enrolmentFromLink(input) : input;
      if (!enrolment) return { kind: 'invalid_link' };
      const probe = clientFor(() => enrolment.token);
      const result = await probe
        .GET('/v1/staff/events/{eventId}/overview', { params: { path: { eventId: enrolment.eventId } } })
        .catch(() => null);
      if (!result) return { kind: 'unavailable' };
      const { data, response } = result;
      if (response.status === 401) return { kind: 'rejected' };
      if (response.status === 403 || response.status === 404) return { kind: 'wrong_event' };
      if (response.status === 429) return { kind: 'rateLimited', retryAfterSeconds: retryAfter(response) };
      if (!response.ok || !data) return { kind: 'unavailable' };
      const previous = stored;
      if (previous && previous.token !== enrolment.token) {
        stored = null;
        await end('replaced');
      } else if (!previous && pendingWipe) {
        // A wipe that was cut short finishes before the device starts again.
        await runWipeCallbacks('replaced');
      }
      // The same key scanned again keeps what the device already knows (its place, the event).
      const same =
        previous?.token === enrolment.token && previous.eventId === enrolment.eventId ? previous : null;
      stored = {
        token: enrolment.token,
        eventId: enrolment.eventId,
        deviceId: data.deviceId,
        checkpointId: same?.checkpointId ?? null,
        checkpointChosen: same?.checkpointChosen ?? false,
        event: same?.event ?? null,
        checkpoints: same?.checkpoints ?? [],
        appliedCheckpointAt: same?.appliedCheckpointAt ?? null,
        appliedSyncAt: same?.appliedSyncAt ?? null,
      };
      pendingWipe = false;
      await persist();
      await writeEnded(null);
      publish();
      // The event's dates and places come next; the picker offers a retry if this fails.
      await refreshEvent();
      api.startHeartbeat();
      return { kind: 'enrolled' };
    },

    /** Reads the event's name, dates and checkpoints again (the picker's retry). */
    refreshEvent,

    /** Chooses where this device scans; null is the whole event. False for a place not on offer. */
    async selectCheckpoint(id: string | null): Promise<boolean> {
      const current = stored;
      if (!current) return false;
      if (id !== null && current.checkpoints.length > 0 && !current.checkpoints.some((c) => c.id === id))
        return false;
      stored = { ...current, checkpointId: id, checkpointChosen: true };
      await persist();
      publish();
      // Tell the device board where it is now rather than at the next beat.
      void api.heartbeat();
      return true;
    },

    /** Removes this enrolment and every piece of local data that depends on it. */
    forget: () => end('forgotten'),

    /** Dismisses the "revoked" or "wiped" notice (the enrolment screen is showing). */
    async acknowledgeEnded(): Promise<void> {
      await api.restore();
      if (state.status === 'revoked' || state.status === 'wiped') {
        if (!pendingWipe) await writeEnded(null);
        setState({ status: 'unenrolled' });
      }
    },

    /**
     * Registers what must be deleted when the device is wiped, revoked or removed (M7.4b: the
     * manifest database). If a wipe was cut short by closing the app, it runs at once.
     */
    onWipe(callback: (reason: WipeReason) => void | Promise<void>): () => void {
      wipeCallbacks.add(callback);
      if (pendingWipe && !stored) {
        const reason: WipeReason = state.status === 'revoked' ? 'revoked' : 'wiped';
        void (async () => {
          try {
            await callback(reason);
          } catch {
            log('device: a wipe callback failed');
          }
        })();
      }
      return () => wipeCallbacks.delete(callback);
    },

    /** A supervisor asked this device to sync now (the heartbeat answer). */
    onSyncRequested(callback: () => void | Promise<void>): () => void {
      syncCallbacks.add(callback);
      return () => syncCallbacks.delete(callback);
    },

    /** Where the heartbeat reads the outbox's depth (M7.4b); 0 until something registers. */
    setQueueDepthSource(source: () => number | Promise<number>): () => void {
      queueSource = source;
      return () => {
        if (queueSource === source) queueSource = () => 0;
      };
    },

    /** The signed client for the enrolled device. It carries the token and nothing else does. */
    get api(): YayatohClient {
      return deviceClient;
    },

    /**
     * Whether the version gate must not block: inside the event window, and also while the dates
     * are not known yet on an enrolled device (the door must never be stranded; the server applies
     * the real window to the device's own calls).
     */
    async insideEventWindow(): Promise<boolean> {
      await api.restore();
      if (!stored) return false;
      return stored.event ? insideEventWindow(stored.event, now()) : true;
    },

    /** The device clock's offset from the server's, in ms (server − device). */
    get clockOffsetMs() {
      return clockOffset;
    },

    /** One heartbeat now. Calls made while one is in flight share it. */
    heartbeat(): Promise<HeartbeatOutcome> {
      beating ??= beat().finally(() => {
        beating = null;
      });
      return beating;
    },

    startHeartbeat() {
      if (timer !== null || !stored) return;
      timer = timers.setInterval(() => void api.heartbeat(), heartbeatMs);
      void api.heartbeat();
    },

    stopHeartbeat,

    /** A device call was refused (401): the heartbeat says whether it was revoked or wiped. */
    async handleUnauthorized(): Promise<void> {
      if (!stored) return;
      await api.heartbeat();
    },
  };

  async function beat(): Promise<HeartbeatOutcome> {
    const current = stored;
    if (!current) return { kind: 'idle' };
    let queueDepth = 0;
    try {
      queueDepth = Math.max(0, Math.floor(await queueSource()));
    } catch {
      log('device: could not read the queue depth');
    }
    let battery: number | null = null;
    try {
      battery = (await options.battery?.()) ?? null;
    } catch {
      log('device: could not read the battery');
    }
    const sentAt = now();
    const result = await heartbeatClient
      .POST('/v1/devices/heartbeat', {
        body: {
          batteryPct: battery === null ? null : Math.min(100, Math.max(0, Math.round(battery))),
          queueDepth,
          clockOffsetMs: Math.round(clockOffset),
          eventId: current.eventId,
          checkpointId: current.checkpointId,
          appVersion: options.identity.version,
        },
      })
      .catch(() => null);
    if (!result) return { kind: 'unavailable' };
    // The person removed or replaced the enrolment while the request was away.
    if (stored !== current) return { kind: 'idle' };
    const receivedAt = now();
    const { data, response } = result;
    if (response.status === 401) {
      await end('revoked');
      return { kind: 'ended', reason: 'revoked' };
    }
    if (!response.ok || !data) return { kind: 'unavailable' };
    if (data.commands.includes('wipe')) {
      await end('wiped');
      return { kind: 'ended', reason: 'wiped' };
    }
    const serverTime = Date.parse(data.serverTime);
    if (Number.isFinite(serverTime)) clockOffset = clockOffsetMs({ serverTime, sentAt, receivedAt });
    setState({ lastHeartbeatAt: new Date(receivedAt).toISOString() });

    let moved = false;
    let synced = false;
    let next = current;
    const directive = data.checkpoint;
    if (directive && asDirective(directive.requestedAt, current.appliedCheckpointAt)) {
      // A place this device cannot scan at falls back to the whole event.
      const known = directive.id !== null && current.checkpoints.some((c) => c.id === directive.id);
      next = {
        ...next,
        checkpointId: known ? directive.id : null,
        checkpointChosen: true,
        appliedCheckpointAt: directive.requestedAt,
      };
      moved = true;
    }
    const wantsSync = asDirective(data.syncRequestedAt, current.appliedSyncAt);
    if (wantsSync) next = { ...next, appliedSyncAt: data.syncRequestedAt ?? null };
    if (next !== current) {
      stored = next;
      await persist();
      publish();
    }
    if (wantsSync) {
      synced = true;
      await Promise.all(
        [...syncCallbacks].map(async (cb) => {
          try {
            await cb();
          } catch {
            log('device: a sync callback failed');
          }
        }),
      );
    }
    return { kind: 'ok', synced, moved };
  }

  return api;
}

export type DeviceSession = ReturnType<typeof createDeviceSession>;
