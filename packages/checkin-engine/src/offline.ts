import {
  CODE_PREFIX,
  legacyPayloadHash,
  legacyQrPayload,
  verifyStatement,
  verifyTicketCode,
} from '@yayatoh/ticket-crypto';
import { type EventWindow, eventDay, ruleResult } from './rules.ts';
import { inRoomKey, type SessionAccessFacts, type SessionGateRule, sessionGateResult } from './session.ts';

/** One manifest row (roadmap §5.4). Contact details only as per-event salted hashes. */
export interface ManifestRow {
  readonly ticketId: string;
  readonly shortCode: string;
  readonly rev: number;
  readonly status: 'active' | 'void';
  readonly ticketTypeId: string;
  readonly typeName: string;
  readonly accessDates: readonly { readonly date: string; readonly name: string }[];
  /** Multi-date events (M1.4b): the date this ticket admits (see the header's `occurrences`). */
  readonly occurrenceId?: string | null;
  readonly holderName: string;
  readonly emailHash: string;
  readonly issuedAt: string;
  /**
   * Migrated tickets (M2.2c, M1.9e): the legacy QR payloads that still admit this ticket, as
   * `legacyPayloadHash(salt, payload)` (case-sensitive, domain-separated from the email lookup
   * hash), never the payloads, so old printed and app QR codes scan offline too. Absent on
   * tickets without one.
   */
  readonly legacyCodes?: readonly string[];
  /**
   * M5.6a (manifest v3): what the pass may do at sessions. Absent = every session (an event
   * without registration, or an older manifest).
   */
  readonly sessionAccess?: {
    readonly registrant: boolean;
    /** The sessions the pass gives; null = every session. */
    readonly sessionIds: readonly string[] | null;
  };
}

export interface ManifestHeader {
  readonly event: {
    readonly id: string;
    readonly name: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly timezone: string;
  };
  /** kid → base64 raw Ed25519 public key. */
  readonly publicKeys: Readonly<Record<string, string>>;
  readonly salt: string;
  readonly serverTime: string;
  /** Unknown-but-validly-signed tickets issued after the last sync (D17): admit and flag, or reject. */
  readonly unknownPolicy: 'provisional' | 'reject';
  /**
   * The event's live checkpoints the device may scan at; a device scans at one of them, or at
   * the event as a whole when it isn't scoped. A scoped device only receives its checkpoints.
   */
  readonly checkpoints: readonly ManifestCheckpoint[];
  /** Manifest format. 1 (absent) before checkpoint scopes; 2 adds `scope`. */
  readonly version?: number;
  /** Where this device may scan (M1.9d). Absent on version 1 manifests: the whole event. */
  readonly scope?: ManifestScope;
  /** Multi-date events (M1.4b): every date, so offline scans can tell a ticket's date. */
  readonly occurrences?: readonly ManifestOccurrence[];
  /**
   * M5.6a (v3): the sessions behind the device's session checkpoints, for the screen (title,
   * times) and the room count when the manifest was made. The gates themselves are in `scope`.
   */
  readonly sessions?: readonly ManifestSession[];
}

export interface ManifestSession {
  readonly checkpointId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  /** People in the room when the manifest was made. */
  readonly occupied: number;
}

/** A session checkpoint's gates, signed with the scope (v3): what an offline device checks. */
export interface SignedSessionGate extends SessionGateRule {
  readonly checkpointId: string;
  /** Ticket ids holding a place in the session (enrollment-required sessions only), sorted. */
  readonly enrolled: readonly string[];
}

export interface ManifestOccurrence {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: 'scheduled' | 'cancelled';
}

/**
 * The checkpoints a device may scan at, signed with the org's ticket key so a tampered local
 * copy can't widen it. `checkpointIds: null` = the whole event (no restriction).
 */
export interface ManifestScope {
  readonly eventId: string;
  readonly deviceId: string;
  readonly checkpointIds: readonly string[] | null;
  /** v3 (M5.6a): the gates of the session checkpoints in scope, signed with it. */
  readonly sessionGates?: readonly SignedSessionGate[];
  /** Detached signature over `scopeMessage(scope)` (see `verifyManifestScope`). */
  readonly signature: string;
}

export const MANIFEST_VERSION = 3;
export const SCOPE_TAG = 'checkin-scope-v1';

/**
 * The canonical signed form of a scope (sorted ids, fixed key order). A v3 scope also signs its
 * session gates (sorted by checkpoint, each with its sorted enrolled list); v2 scopes have none.
 */
export const scopeMessage = (s: Omit<ManifestScope, 'signature'>) =>
  JSON.stringify({
    eventId: s.eventId,
    deviceId: s.deviceId,
    checkpointIds: s.checkpointIds === null ? null : [...s.checkpointIds].sort(),
    ...(s.sessionGates
      ? {
          sessionGates: [...s.sessionGates]
            .sort((a, b) => (a.checkpointId < b.checkpointId ? -1 : a.checkpointId > b.checkpointId ? 1 : 0))
            .map((g) => ({
              checkpointId: g.checkpointId,
              sessionId: g.sessionId,
              capacity: g.capacity,
              enrollmentRequired: g.enrollmentRequired,
              enrolled: [...g.enrolled].sort(),
            })),
        }
      : {}),
  });

/** True when the header's scope was signed by one of the header's (org) keys for this event. */
export async function verifyManifestScope(header: ManifestHeader): Promise<boolean> {
  const s = header.scope;
  if (!s) return (header.version ?? 1) < 2;
  // A session checkpoint in a v3 header must have its gates signed.
  if (header.checkpoints.some((c) => c.kind === 'session') && !s.sessionGates) return false;
  if (s.eventId !== header.event.id) return false;
  const keys = new Map(Object.entries(header.publicKeys).map(([kid, k]) => [Number(kid), b64(k)]));
  return verifyStatement(SCOPE_TAG, scopeMessage(s), s.signature, keys);
}

/** Whether a scope lets a device scan at a checkpoint (null = the whole event). */
export const scopeAllows = (
  scope: Pick<ManifestScope, 'checkpointIds'> | null | undefined,
  checkpointId: string | null,
) =>
  !scope ||
  scope.checkpointIds === null ||
  (checkpointId !== null && scope.checkpointIds.includes(checkpointId));

export interface ManifestCheckpoint {
  readonly id: string;
  readonly name: string;
  readonly kind: 'entrance' | 'zone' | 'session';
  /** Zones: ticket types allowed in; empty = every type. */
  readonly ticketTypeIds: readonly string[];
  /** Session checkpoints (M5.6a): the program session it is the door of. */
  readonly sessionId?: string | null;
}

/** A zone admits a pass whose type it lists (or any pass, when it lists none). */
export const zoneAllows = (zone: Pick<ManifestCheckpoint, 'ticketTypeIds'>, ticketTypeId: string | null) =>
  zone.ticketTypeIds.length === 0 || (ticketTypeId !== null && zone.ticketTypeIds.includes(ticketTypeId));

export type OfflineVerdict =
  | 'admit'
  | 'provisional'
  | 'duplicate'
  | 'superseded'
  | 'invalid'
  | 'void'
  | 'wrong_event'
  | 'outside_window'
  | 'wrong_date'
  | 'not_today'
  | 'granted'
  | 'no_access'
  /** The device's scope doesn't include where it is scanning (checkpoint-scoped door staff). */
  | 'wrong_checkpoint'
  // M5.6a session checkpoints.
  /** Let into the session (attendance recorded). */
  | 'entered'
  /** Left the session (scan out). */
  | 'scanned_out'
  /** A scan out of someone the device never saw go in. */
  | 'not_in_room'
  /** Gate `enrollment`: not registered, or not enrolled in a session that needs it. */
  | 'not_enrolled'
  /** Gate `admission_level`: the pass doesn't include this session. */
  | 'admission_level'
  /** Gate `capacity`: the room is full. */
  | 'capacity';

export interface OfflineState {
  readonly header: ManifestHeader;
  readonly byId: ReadonlyMap<string, ManifestRow>;
  readonly byShortCode: ReadonlyMap<string, ManifestRow>;
  /** Legacy payload hash → row (`legacyIndex`; see `ManifestRow.legacyCodes`); absent = no lookup. */
  readonly byLegacyCode?: ReadonlyMap<string, ManifestRow>;
  /** `${ticketId}:${day}` admitted on this device. */
  readonly admitted: ReadonlySet<string>;
  /** When this device last completed a manifest sync. */
  readonly lastSyncAt: Date;
  /** M5.6a: `inRoomKey(ticketId, sessionId)` of people this device let into a session and not out. */
  readonly inRoom?: ReadonlySet<string>;
  /** M5.6a: the device's estimate of people in each session's room (session id → count). */
  readonly occupancy?: ReadonlyMap<string, number>;
}

export const admittedKey = (ticketId: string, day: string) => `${ticketId}:${day}`;

/** Milliseconds since the epoch encoded in a UUIDv7 (its first 48 bits). */
export const uuidv7Time = (id: string) => Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * The offline verdict table (ADR 0011). Pure: the caller records an `admit`/`provisional`
 * verdict in `admitted` and queues the scan for sync. `now` is the device's corrected time.
 * At a zone checkpoint a valid pass is `granted` or `no_access` instead (zones allow re-entry).
 */
export async function offlineVerdict(
  state: OfflineState,
  rawCode: string,
  now: Date,
  checkpointId: string | null = null,
  opts: { readonly direction?: 'in' | 'out' } = {},
): Promise<{ verdict: OfflineVerdict; ticketId: string | null; row: ManifestRow | null }> {
  // A scoped device refuses anywhere outside its checkpoints, before looking at the code.
  if (!scopeAllows(state.header.scope, checkpointId))
    return { verdict: 'wrong_checkpoint', ticketId: null, row: null };
  const session = state.header.checkpoints.find((c) => c.id === checkpointId && c.kind === 'session');
  if (session) return sessionVerdict(state, rawCode, now, session, opts.direction ?? 'in');
  const zone = state.header.checkpoints.find((c) => c.id === checkpointId && c.kind === 'zone') ?? null;
  const r = await entranceVerdict(state, rawCode, now);
  if (!zone) return r;
  // Passes that would get in (including re-entry and unknown-but-signed ones) are checked
  // against the zone; an unknown pass has no known type, so only an all-types zone takes it.
  if (r.verdict === 'admit' || r.verdict === 'duplicate' || r.verdict === 'provisional')
    return { ...r, verdict: zoneAllows(zone, r.row?.ticketTypeId ?? null) ? 'granted' : 'no_access' };
  return r;
}

/**
 * A session door (M5.6a): the event rules, then in → duplicate (already in) or the three gates
 * from the signed scope; out → `scanned_out` when this device saw them go in, else `not_in_room`.
 */
async function sessionVerdict(
  state: OfflineState,
  rawCode: string,
  now: Date,
  checkpoint: ManifestCheckpoint,
  direction: 'in' | 'out',
): Promise<{ verdict: OfflineVerdict; ticketId: string | null; row: ManifestRow | null }> {
  const r = await entranceVerdict(state, rawCode, now, false);
  const sessionId = checkpoint.sessionId ?? '';
  const gate = state.header.scope?.sessionGates?.find((g) => g.checkpointId === checkpoint.id);
  // A session door whose gates aren't signed admits nobody offline.
  if (!gate || gate.sessionId !== sessionId) return { ...r, verdict: 'invalid' };
  if (r.verdict !== 'admit' && r.verdict !== 'provisional') return r;
  const key = r.ticketId ? inRoomKey(r.ticketId, sessionId) : '';
  if (direction === 'out')
    return { ...r, verdict: state.inRoom?.has(key) ? 'scanned_out' : 'not_in_room' };
  if (state.inRoom?.has(key)) return { ...r, verdict: 'duplicate' };
  const access: SessionAccessFacts | null = r.row
    ? {
        registrant: r.row.sessionAccess?.registrant ?? true,
        sessionIds: r.row.sessionAccess?.sessionIds ?? null,
        enrolled: r.ticketId !== null && gate.enrolled.includes(r.ticketId),
      }
    : null;
  const result = sessionGateResult({
    rule: gate,
    access,
    occupied: state.occupancy?.get(sessionId) ?? 0,
  });
  return { ...r, verdict: result === 'ok' ? 'entered' : result };
}

async function entranceVerdict(
  state: OfflineState,
  rawCode: string,
  now: Date,
  checkAdmitted = true,
): Promise<{ verdict: OfflineVerdict; ticketId: string | null; row: ManifestRow | null }> {
  const code = rawCode.trim().toUpperCase();
  const h = state.header;
  const event: EventWindow = {
    id: h.event.id,
    startsAt: new Date(h.event.startsAt),
    endsAt: new Date(h.event.endsAt),
    timezone: h.event.timezone,
  };
  const day = eventDay(now, event.timezone);
  let row: ManifestRow | null = null;
  if (code.startsWith(CODE_PREFIX)) {
    const keys = new Map(Object.entries(h.publicKeys).map(([kid, k]) => [Number(kid), b64(k)]));
    const v = await verifyTicketCode(code, keys);
    if (!v.ok) return { verdict: 'invalid', ticketId: null, row: null };
    row = state.byId.get(v.ticketId) ?? null;
    if (!row) {
      // Signed by this org but not in our manifest. Ticket ids are UUIDv7, so the id tells when it
      // was issued: after our last sync → org policy (D17, default provisional); before → reject.
      if (checkAdmitted && state.admitted.has(admittedKey(v.ticketId, day)))
        return { verdict: 'duplicate', ticketId: v.ticketId, row: null };
      const issuedAfterSync = uuidv7Time(v.ticketId) > state.lastSyncAt.getTime();
      return {
        verdict: issuedAfterSync && h.unknownPolicy === 'provisional' ? 'provisional' : 'invalid',
        ticketId: v.ticketId,
        row: null,
      };
    }
    if (v.rev < row.rev) return { verdict: 'superseded', ticketId: row.ticketId, row };
    if (v.rev > row.rev) return { verdict: 'provisional', ticketId: row.ticketId, row };
  } else {
    // A migrated ticket's legacy QR (case-sensitive), before short codes, as on the server.
    const legacy = state.byLegacyCode?.size ? legacyQrPayload(rawCode) : null;
    if (legacy) row = state.byLegacyCode?.get(await legacyPayloadHash(h.salt, legacy)) ?? null;
    row ??= state.byShortCode.get(code) ?? null;
    if (!row) return { verdict: 'invalid', ticketId: null, row: null };
  }
  const occ = row.occurrenceId ? h.occurrences?.find((o) => o.id === row.occurrenceId) : undefined;
  const rule = ruleResult({
    now,
    event,
    ticket: {
      eventId: event.id,
      status: row.status,
      accessDates: row.accessDates,
      // A date missing from the manifest (deleted) admits nowhere: treat it as cancelled.
      occurrence: row.occurrenceId
        ? occ
          ? { startsAt: new Date(occ.startsAt), endsAt: new Date(occ.endsAt), status: occ.status }
          : { startsAt: new Date(0), endsAt: new Date(0), status: 'cancelled' }
        : null,
    },
  });
  if (rule !== 'ok') return { verdict: rule, ticketId: row.ticketId, row };
  if (checkAdmitted && state.admitted.has(admittedKey(row.ticketId, day)))
    return { verdict: 'duplicate', ticketId: row.ticketId, row };
  return { verdict: 'admit', ticketId: row.ticketId, row };
}

/** Index manifest rows by their legacy payload hashes (`legacyCodes`): the offline lookup for migrated tickets. */
export function legacyIndex(rows: Iterable<ManifestRow>): Map<string, ManifestRow> {
  const out = new Map<string, ManifestRow>();
  for (const r of rows) for (const h of r.legacyCodes ?? []) out.set(h, r);
  return out;
}

/** SHA-256 of `salt:value`, hex — the manifest's offline lookup hash for a normalized email. */
export async function lookupHash(salt: string, value: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${value.trim().toLowerCase()}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
