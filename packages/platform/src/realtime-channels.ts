import { z } from 'zod';
import type { ModuleKey } from './modules.ts';
import { channelOrg } from './realtime.ts';

/**
 * The realtime channel registry (M3.1b). A channel is a named kind of live feed, scoped to one
 * org (and, for event channels, one event). Its definition says:
 *
 * - **who may attach** (`access`): the public, members whose role grants a permission (for an
 *   event channel an event-scoped role counts too), and/or the org's enrolled check-in devices;
 * - **what may travel on it** (`events`): one Zod schema per message type. Every payload is parsed
 *   through its schema before it is stored or sent, so unknown fields are dropped (an allowlist,
 *   like every other public output) and a message type the channel does not list is refused;
 * - **where its messages come from** (`source`): `log` channels are published through
 *   `platform.realtime_messages` (transactional, fanned out by LISTEN/NOTIFY, replayable by id);
 *   `feed` channels are served by a module's own live feed (the seat map's, M1.7f).
 *
 * Wire names are always org-scoped (`org:{orgId}:…`, ADR 0009): an org channel is
 * `org:{orgId}:{topic}`, an event channel `org:{orgId}:event:{eventId}:{topic}`. The same names are
 * used for SSE and for Ably, so a token or a stream for one org can never name another org's.
 */
export type RealtimeScope = 'org' | 'event';

export interface RealtimeAccess {
  /** Anyone may attach (the app still runs the channel's own public check, e.g. "on sale"). */
  readonly public?: boolean;
  /** Members whose role (org role, or an event role on an event channel) grants this permission. */
  readonly permission?: string;
  /** The org's enrolled check-in devices (door staff), by device token. */
  readonly devices?: boolean;
}

export type RealtimeEvents = Readonly<Record<string, z.ZodType>>;

export interface RealtimeChannelDef<E extends RealtimeEvents = RealtimeEvents> {
  /** Registry key, `{scope}.{topic}` (e.g. `event.checkins`). */
  readonly key: string;
  readonly scope: RealtimeScope;
  readonly topic: string;
  readonly access: RealtimeAccess;
  readonly events: E;
  readonly source: 'log' | 'feed';
  /** The payload of the `snapshot` a (re)connecting client gets (an allowlist too; default `{}`). */
  readonly snapshot?: z.ZodType;
  /** The module the org must be entitled to (checked for members and devices). */
  readonly entitlement?: ModuleKey;
  readonly description: string;
}

const TOPIC = /^[a-z][a-z0-9-]{0,39}$/;
const EVENT_NAME = /^[a-z][a-z0-9_.-]{0,39}$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EVENT_WIRE = new RegExp(`^org:(${UUID}):event:(${UUID}):([a-z][a-z0-9-]{0,39})$`);
const ORG_WIRE = new RegExp(`^org:(${UUID}):([a-z][a-z0-9-]{0,39})$`);
const EMPTY = z.object({});
/** Snapshot (`snapshot`) and resynchronise (`refresh`) are sent by the stream itself. */
const RESERVED = new Set(['snapshot', 'refresh']);

export function defineRealtimeChannel<E extends RealtimeEvents>(
  def: Omit<RealtimeChannelDef<E>, 'key'>,
): RealtimeChannelDef<E> {
  if (!TOPIC.test(def.topic)) throw new Error(`Invalid realtime topic: ${def.topic}`);
  if (!def.access.public && !def.access.permission && !def.access.devices)
    throw new Error(`Realtime channel ${def.topic} has no audience`);
  for (const name of Object.keys(def.events)) {
    if (!EVENT_NAME.test(name)) throw new Error(`Invalid realtime event name: ${name}`);
    if (def.source === 'log' && RESERVED.has(name))
      throw new Error(`Realtime event name ${name} is reserved for the stream`);
  }
  return { ...def, key: `${def.scope}.${def.topic}` };
}

/** The wire name of a channel for one org (and event). */
export function realtimeChannelName(
  def: Pick<RealtimeChannelDef, 'scope' | 'topic'>,
  orgId: string,
  eventId?: string | null,
): string {
  const name =
    def.scope === 'event' ? `org:${orgId}:event:${eventId ?? ''}:${def.topic}` : `org:${orgId}:${def.topic}`;
  if (!(def.scope === 'event' ? EVENT_WIRE : ORG_WIRE).test(name) || !channelOrg(name))
    throw new Error(`Invalid realtime channel: ${name}`);
  return name;
}

export interface ParsedChannel {
  readonly name: string;
  readonly orgId: string;
  readonly eventId: string | null;
  readonly scope: RealtimeScope;
  readonly topic: string;
}

/** Split a wire name into its parts, or null when it is not a well-formed channel name. */
export function parseRealtimeChannel(name: string): ParsedChannel | null {
  if (name.length > 160) return null;
  const e = EVENT_WIRE.exec(name);
  if (e) return { name, orgId: e[1] ?? '', eventId: e[2] ?? '', scope: 'event', topic: e[3] ?? '' };
  const o = ORG_WIRE.exec(name);
  if (o) return { name, orgId: o[1] ?? '', eventId: null, scope: 'org', topic: o[2] ?? '' };
  return null;
}

export interface ResolvedChannel<D extends RealtimeChannelDef = RealtimeChannelDef> extends ParsedChannel {
  readonly def: D;
}

export interface RealtimeRegistry<D extends RealtimeChannelDef = RealtimeChannelDef> {
  readonly channels: readonly D[];
  get(key: string): D | undefined;
  /** A wire name → its definition and parts; null for a malformed or unregistered channel. */
  resolve(name: string): ResolvedChannel<D> | null;
}

export function createRealtimeRegistry<D extends RealtimeChannelDef>(
  defs: readonly D[],
): RealtimeRegistry<D> {
  const byKey = new Map<string, D>();
  for (const d of defs) {
    if (byKey.has(d.key)) throw new Error(`Realtime channel ${d.key} is defined twice`);
    byKey.set(d.key, d);
  }
  return {
    channels: defs,
    get: (key) => byKey.get(key),
    resolve(name) {
      const p = parseRealtimeChannel(name);
      const def = p ? byKey.get(`${p.scope}.${p.topic}`) : undefined;
      return p && def ? { ...p, def } : null;
    },
  };
}

/**
 * A payload as it may travel on a channel: parsed through the event's allowlist schema (unknown
 * fields dropped). Throws for an event the channel does not carry or a payload that doesn't fit.
 */
export function realtimePayload(def: RealtimeChannelDef, event: string, data: unknown): unknown {
  const schema =
    event === 'snapshot' && def.source === 'log'
      ? (def.snapshot ?? EMPTY)
      : event === 'refresh' && def.source === 'log'
        ? EMPTY
        : Object.hasOwn(def.events, event)
          ? def.events[event]
          : undefined;
  if (!schema) throw new Error(`Realtime channel ${def.key} does not carry "${event}"`);
  return schema.parse(data);
}

/** Who may attach, decided from facts the app established (membership, device token, public check). */
export interface RealtimeCaller {
  /** The caller's permissions in the channel's org (org role plus, for event channels, event roles). */
  readonly can?: (permission: string) => boolean | Promise<boolean>;
  /** A device token that resolved to this org. */
  readonly deviceOrgId?: string | null;
  /** The user or device belongs to the channel's org (for a clear 403 vs. public fallback). */
  readonly memberOrgId?: string | null;
}

export type RealtimeDecision = 'allow' | 'public' | 'deny';

/**
 * The per-channel authorization rule, pure. Devices are accepted only by channels that take
 * devices and only for their own org; members only for their own org and with the permission.
 * A caller from another org never reaches a private channel, whatever it presents. `public`
 * means "allowed as the public" (the app then runs the channel's public check).
 */
export async function decideRealtimeAccess(
  channel: ResolvedChannel,
  caller: RealtimeCaller,
): Promise<RealtimeDecision> {
  const { access } = channel.def;
  if (caller.deviceOrgId) {
    if (caller.deviceOrgId === channel.orgId && access.devices) return 'allow';
    return access.public ? 'public' : 'deny';
  }
  if (caller.memberOrgId === channel.orgId && access.permission && caller.can) {
    if (await caller.can(access.permission)) return 'allow';
  }
  return access.public ? 'public' : 'deny';
}

// --- Channels for the next wave (M3.2/M3.3): defined now, deliberately minimal. ---------------

const isoTime = z.iso.datetime({ offset: true });

/**
 * Live check-ins at an event's doors: one message per admission or undo (no ticket, no holder:
 * the door screen re-reads its counts). Door staff and their devices may attach.
 */
export const CHECKINS_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'checkins',
  source: 'log',
  description: 'Admissions and undos at the doors of one event',
  entitlement: 'checkin',
  access: { permission: 'checkin:scan', devices: true },
  snapshot: z.object({ admitted: z.int().min(0), tickets: z.int().min(0) }),
  events: {
    admission: z.object({
      change: z.enum(['admitted', 'undone', 'synced']),
      checkpointId: z.uuid().nullable(),
      count: z.int().min(1).max(10_000),
      at: isoTime,
    }),
  },
});

/** Check-in devices of an event going online/offline, low battery, queue backlog (M3.3 device board). */
export const DEVICES_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'devices',
  source: 'log',
  description: 'Device board: presence, battery and queue of check-in devices',
  entitlement: 'checkin',
  access: { permission: 'checkin:scan', devices: true },
  events: {
    device: z.object({
      deviceId: z.uuid(),
      state: z.enum(['online', 'offline', 'revoked', 'wiped']),
      batteryPct: z.int().min(0).max(100).nullable(),
      queueDepth: z.int().min(0).nullable(),
      at: isoTime,
    }),
  },
});

/**
 * Event metrics tiles (placeholder: M3.1a builds the metric projectors in parallel). A message
 * names a metric and its new value; the tile re-reads anything richer.
 */
export const METRICS_CHANNEL = defineRealtimeChannel({
  scope: 'event',
  topic: 'metrics',
  source: 'log',
  description: 'Metric tiles of one event (values only)',
  entitlement: 'reports',
  access: { permission: 'events:read' },
  events: {
    metric: z.object({
      metric: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/),
      value: z.number().finite(),
      at: isoTime,
    }),
  },
});

/** Command Center alerts of an org (M3.2 alert engine): ids and states only, never details. */
export const ALERTS_CHANNEL = defineRealtimeChannel({
  scope: 'org',
  topic: 'alerts',
  source: 'log',
  description: 'Alert state changes of the org (the console re-reads the alert)',
  access: { permission: 'events:read' },
  events: {
    alert: z.object({
      alertId: z.uuid(),
      eventId: z.uuid().nullable(),
      state: z.enum(['open', 'acknowledged', 'snoozed', 'resolved']),
      severity: z.enum(['info', 'warning', 'critical']),
      at: isoTime,
    }),
  },
});

/** The generic channels platform defines; modules add theirs (the seat map's) when composing. */
export const CORE_REALTIME_CHANNELS = [
  CHECKINS_CHANNEL,
  DEVICES_CHANNEL,
  METRICS_CHANNEL,
  ALERTS_CHANNEL,
] as const;
