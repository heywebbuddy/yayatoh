import type { ModuleKey, ProfileKey } from '@yayatoh/platform';
import type { EventMode } from './modes.ts';
import type { CcRole } from './roles.ts';

/**
 * The widget registry's description of a widget (M3.2): who may see it, for which profiles and
 * modes, how big it is and which realtime channel keeps it current. Pure and browser-safe; the
 * server side pairs each with its loader (`widgets.ts`). A widget missing from the registry, or
 * not allowed for the caller, never renders, and its loader refuses.
 */
export const WIDGET_KEYS = [
  'readiness',
  'sales',
  'tickets',
  'checkins',
  'seatFill',
  'devices',
  'timeline',
  'alerts',
  // Batch 3d merge: M3.4a's staff views (the Scan PWA's staff mode) on the Command Center.
  'entrances',
  'deviceBoard',
  // M3.3a live mode.
  'liveFeed',
  'checkinSpeed',
  'scanIssues',
  'capacity',
  'staffPresence',
  // M3.3b: the event's help queue (guest and staff requests), for live mode to place.
  'assistance',
  // M3.8b marketing analytics: campaign → registrations and revenue, and email deliverability.
  'campaigns',
  'deliverability',
] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];

export const WIDGET_SIZES = ['sm', 'md', 'lg'] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

/** Realtime channels (M3.1b registry keys) a widget follows. */
export type WidgetChannel =
  | 'event.checkins'
  | 'event.devices'
  | 'event.metrics'
  | 'org.alerts'
  | 'event.assistance';

/** Every channel a widget follows (its own, then the extra ones). */
export function followedChannels(meta: Pick<WidgetMeta, 'channel' | 'alsoFollows'>): WidgetChannel[] {
  return [...(meta.channel ? [meta.channel] : []), ...(meta.alsoFollows ?? [])];
}

export function isWidgetKey(v: unknown): v is WidgetKey {
  return typeof v === 'string' && (WIDGET_KEYS as readonly string[]).includes(v);
}

export interface WidgetMeta {
  readonly key: WidgetKey;
  /** The module the org must be entitled to. */
  readonly module: ModuleKey;
  /** The permission its loader needs (on top of the role check). */
  readonly permission: string;
  readonly roles: readonly CcRole[];
  /** Profiles it applies to (`all` = every profile). */
  readonly profiles: readonly ProfileKey[] | 'all';
  readonly modes: readonly EventMode[];
  readonly size: WidgetSize;
  readonly channel: WidgetChannel | null;
  /** More channels that also change it (the live feed follows devices and alerts too). */
  readonly alsoFollows?: readonly WidgetChannel[];
  /** Revenue: never on the door layout (roadmap M3.2 acceptance). */
  readonly revenue?: boolean;
}

const ALL_MODES: readonly EventMode[] = ['planning', 'pre_show', 'live', 'wrap'];
const SELLING: readonly ProfileKey[] = ['gala', 'concert', 'conference', 'community', 'agency', 'other'];

export const WIDGET_META: Readonly<Record<WidgetKey, WidgetMeta>> = {
  readiness: {
    key: 'readiness',
    module: 'core',
    permission: 'events:read',
    roles: ['owner', 'ops', 'marketing'],
    profiles: 'all',
    modes: ['planning', 'pre_show'],
    size: 'md',
    channel: null,
  },
  sales: {
    key: 'sales',
    module: 'reports',
    permission: 'orders:read',
    roles: ['owner', 'ops', 'finance'],
    profiles: SELLING,
    modes: ALL_MODES,
    size: 'md',
    channel: 'event.metrics',
    revenue: true,
  },
  tickets: {
    key: 'tickets',
    module: 'ticketing',
    permission: 'events:read',
    roles: ['owner', 'ops', 'finance', 'marketing'],
    profiles: SELLING,
    modes: ALL_MODES,
    size: 'sm',
    channel: 'event.metrics',
  },
  checkins: {
    key: 'checkins',
    module: 'checkin',
    permission: 'events:read',
    roles: ['owner', 'ops', 'door'],
    profiles: 'all',
    modes: ['pre_show', 'live', 'wrap'],
    size: 'sm',
    channel: 'event.checkins',
  },
  seatFill: {
    key: 'seatFill',
    module: 'seating',
    permission: 'events:read',
    roles: ['owner', 'ops', 'door'],
    profiles: ['wedding', 'gala', 'conference'],
    modes: ['pre_show', 'live', 'wrap'],
    size: 'sm',
    channel: 'event.metrics',
  },
  devices: {
    key: 'devices',
    module: 'checkin',
    permission: 'events:read',
    roles: ['owner', 'ops', 'door'],
    profiles: 'all',
    modes: ['pre_show', 'live'],
    size: 'sm',
    channel: 'event.devices',
  },
  timeline: {
    key: 'timeline',
    module: 'core',
    permission: 'events:read',
    roles: ['owner', 'ops', 'finance', 'door', 'marketing'],
    profiles: 'all',
    modes: ALL_MODES,
    size: 'md',
    channel: null,
  },
  // M3.4a staff views: today's check-ins per entrance and per date, and the device board (each
  // device's state, battery, backlog and where it scans). Door work: never revenue.
  entrances: {
    key: 'entrances',
    module: 'checkin',
    permission: 'events:read',
    roles: ['owner', 'ops', 'door'],
    profiles: 'all',
    modes: ['pre_show', 'live', 'wrap'],
    size: 'md',
    channel: 'event.checkins',
  },
  deviceBoard: {
    key: 'deviceBoard',
    module: 'checkin',
    permission: 'events:read',
    roles: ['owner', 'ops', 'door'],
    profiles: 'all',
    modes: ['pre_show', 'live'],
    size: 'lg',
    channel: 'event.devices',
  },
  // M3.3a live mode: the door at work. Door work, never revenue.
  liveFeed: {
    key: 'liveFeed',
    module: 'checkin',
    permission: 'events:read',
    roles: ['owner', 'ops', 'door'],
    profiles: 'all',
    modes: ['pre_show', 'live'],
    size: 'lg',
    channel: 'event.checkins',
    alsoFollows: ['event.devices', 'org.alerts'],
  },
  checkinSpeed: {
    key: 'checkinSpeed',
    module: 'checkin',
    permission: 'events:read',
    roles: ['owner', 'ops', 'door'],
    profiles: 'all',
    modes: ['live'],
    size: 'lg',
    channel: 'event.checkins',
  },
  scanIssues: {
    key: 'scanIssues',
    module: 'checkin',
    permission: 'events:read',
    roles: ['owner', 'ops', 'door'],
    profiles: 'all',
    modes: ['live', 'wrap'],
    size: 'md',
    channel: 'event.checkins',
  },
  capacity: {
    key: 'capacity',
    module: 'checkin',
    permission: 'events:read',
    roles: ['owner', 'ops', 'door'],
    profiles: 'all',
    modes: ['pre_show', 'live'],
    size: 'md',
    channel: 'event.checkins',
  },
  staffPresence: {
    key: 'staffPresence',
    module: 'checkin',
    permission: 'events:read',
    roles: ['owner', 'ops', 'door'],
    profiles: 'all',
    modes: ['pre_show', 'live'],
    size: 'md',
    channel: null,
  },
  // M3.3b guest assistance: waiting, assigned, in progress and overdue help requests, the most
  // urgent first. M3.3a's live layouts place it (owner, ops, door); members can show it.
  assistance: {
    key: 'assistance',
    module: 'checkin',
    permission: 'assistance:read',
    roles: ['owner', 'ops', 'door'],
    profiles: 'all',
    modes: ['pre_show', 'live'],
    size: 'md',
    channel: 'event.assistance',
  },
  // M3.8b: this event's campaigns, channels and links → orders and revenue (first and last touch).
  // Money: never on the door layout.
  campaigns: {
    key: 'campaigns',
    module: 'marketing',
    permission: 'marketing:read',
    roles: ['owner', 'marketing'],
    profiles: SELLING,
    modes: ALL_MODES,
    size: 'lg',
    channel: null,
    revenue: true,
  },
  // M3.8b: the org's email bounce and complaint rates (7 days), the auto-pause and the alert.
  deliverability: {
    key: 'deliverability',
    module: 'marketing',
    permission: 'messages:read',
    roles: ['owner', 'marketing'],
    profiles: 'all',
    modes: ALL_MODES,
    size: 'md',
    channel: 'org.alerts',
  },
  // The slot for the M3.2b alert engine: its loader is a placeholder until the engine registers.
  alerts: {
    key: 'alerts',
    module: 'core',
    permission: 'events:read',
    roles: ['owner', 'ops', 'finance', 'door', 'marketing'],
    profiles: 'all',
    modes: ALL_MODES,
    size: 'lg',
    channel: 'org.alerts',
  },
};

/**
 * Default layouts per role and mode: the widgets shown, in order. Widgets the role may see in that
 * mode but that are not listed start hidden (the user can show them).
 */
export const DEFAULT_LAYOUTS: Readonly<Record<CcRole, Readonly<Record<EventMode, readonly WidgetKey[]>>>> = {
  owner: {
    planning: ['readiness', 'sales', 'tickets', 'alerts', 'timeline'],
    pre_show: ['readiness', 'alerts', 'sales', 'tickets', 'devices', 'seatFill', 'timeline'],
    live: [
      'checkins',
      'alerts',
      'liveFeed',
      'checkinSpeed',
      'capacity',
      'scanIssues',
      'devices',
      'deviceBoard',
      'staffPresence',
      'assistance',
      'seatFill',
      'sales',
      'tickets',
      'timeline',
    ],
    wrap: ['sales', 'tickets', 'checkins', 'alerts', 'timeline'],
  },
  ops: {
    planning: ['readiness', 'tickets', 'sales', 'alerts', 'timeline'],
    pre_show: ['readiness', 'alerts', 'devices', 'tickets', 'seatFill', 'deviceBoard', 'timeline'],
    live: [
      'checkins',
      'devices',
      'alerts',
      'liveFeed',
      'checkinSpeed',
      'capacity',
      'scanIssues',
      'seatFill',
      'tickets',
      'entrances',
      'deviceBoard',
      'staffPresence',
      'assistance',
      'timeline',
    ],
    wrap: ['checkins', 'tickets', 'sales', 'alerts', 'timeline'],
  },
  finance: {
    planning: ['sales', 'tickets', 'alerts', 'timeline'],
    pre_show: ['sales', 'tickets', 'alerts', 'timeline'],
    live: ['sales', 'tickets', 'alerts'],
    wrap: ['sales', 'tickets', 'alerts', 'timeline'],
  },
  door: {
    planning: ['timeline', 'alerts'],
    pre_show: ['devices', 'checkins', 'seatFill', 'alerts', 'deviceBoard', 'timeline'],
    live: [
      'checkins',
      'devices',
      'seatFill',
      'alerts',
      'liveFeed',
      'checkinSpeed',
      'capacity',
      'scanIssues',
      'entrances',
      'deviceBoard',
      'staffPresence',
      'assistance',
      'timeline',
    ],
    wrap: ['checkins', 'timeline'],
  },
  marketing: {
    planning: ['campaigns', 'readiness', 'tickets', 'deliverability', 'alerts', 'timeline'],
    pre_show: ['campaigns', 'tickets', 'readiness', 'deliverability', 'alerts', 'timeline'],
    live: ['tickets', 'campaigns', 'alerts', 'timeline'],
    wrap: ['campaigns', 'tickets', 'deliverability', 'timeline'],
  },
};

export interface WidgetScope {
  readonly role: CcRole;
  readonly profile: ProfileKey;
  /** The org's effective modules. */
  readonly modules: ReadonlySet<string>;
}

/** Whether the registry lets this role see the widget at all (any mode): the loaders' rule. */
export function widgetAllowed(meta: WidgetMeta | undefined, scope: WidgetScope): meta is WidgetMeta {
  if (!meta) return false;
  if (!meta.roles.includes(scope.role)) return false;
  if (meta.revenue && scope.role === 'door') return false;
  if (meta.profiles !== 'all' && !meta.profiles.includes(scope.profile)) return false;
  return scope.modules.has(meta.module);
}

/** The widgets available in a mode for this scope, in registry order. */
export function availableWidgets(
  registry: Readonly<Partial<Record<string, WidgetMeta>>>,
  scope: WidgetScope,
  mode: EventMode,
): WidgetMeta[] {
  return WIDGET_KEYS.map((k) => registry[k]).filter(
    (m): m is WidgetMeta => widgetAllowed(m, scope) && m.modes.includes(mode),
  );
}

/** A user's saved arrangement (per event): widget order and the widgets they hid. */
export interface SavedLayout {
  readonly order: readonly string[];
  readonly hidden: readonly string[];
}

export interface LayoutSlot {
  readonly key: WidgetKey;
  readonly size: WidgetSize;
  readonly hidden: boolean;
}

/**
 * The layout to show: the saved order (unknown, forbidden and out-of-mode keys dropped), then the
 * mode's remaining widgets in their default order (listed ones shown, others hidden).
 */
export function resolveLayout(
  registry: Readonly<Partial<Record<string, WidgetMeta>>>,
  scope: WidgetScope,
  mode: EventMode,
  saved: SavedLayout | null,
): LayoutSlot[] {
  const available = new Map(availableWidgets(registry, scope, mode).map((m) => [m.key as string, m]));
  const defaults = DEFAULT_LAYOUTS[scope.role][mode].filter((k) => available.has(k));
  const hidden = new Set(saved?.hidden ?? []);
  const out: LayoutSlot[] = [];
  const seen = new Set<string>();
  const push = (key: string, isHidden: boolean) => {
    const meta = available.get(key);
    if (!meta || seen.has(key)) return;
    seen.add(key);
    out.push({ key: meta.key, size: meta.size, hidden: isHidden });
  };
  for (const k of saved?.order ?? []) push(k, hidden.has(k));
  for (const k of defaults) push(k, hidden.has(k));
  for (const k of available.keys()) push(k, true);
  return out;
}

/** Move one widget up or down in a list of keys (keyboard alternative to dragging). */
export function moveWidget<T extends string>(order: readonly T[], key: T, delta: -1 | 1): T[] {
  const i = order.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j] as T, next[i] as T];
  return next;
}
