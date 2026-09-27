import { CODE_PREFIX, verifyTicketCode } from '@yayatoh/ticket-crypto';
import { type EventWindow, eventDay, ruleResult } from './rules.ts';

/** One manifest row (roadmap §5.4). Contact details only as per-event salted hashes. */
export interface ManifestRow {
  readonly ticketId: string;
  readonly shortCode: string;
  readonly rev: number;
  readonly status: 'active' | 'void';
  readonly ticketTypeId: string;
  readonly typeName: string;
  readonly accessDates: readonly { readonly date: string; readonly name: string }[];
  readonly holderName: string;
  readonly emailHash: string;
  readonly issuedAt: string;
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
  /** The event's live checkpoints; a device scans at one of them, or at the event as a whole. */
  readonly checkpoints: readonly ManifestCheckpoint[];
}

export interface ManifestCheckpoint {
  readonly id: string;
  readonly name: string;
  readonly kind: 'entrance' | 'zone';
  /** Zones: ticket types allowed in; empty = every type. */
  readonly ticketTypeIds: readonly string[];
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
  | 'not_today'
  | 'granted'
  | 'no_access';

export interface OfflineState {
  readonly header: ManifestHeader;
  readonly byId: ReadonlyMap<string, ManifestRow>;
  readonly byShortCode: ReadonlyMap<string, ManifestRow>;
  /** `${ticketId}:${day}` admitted on this device. */
  readonly admitted: ReadonlySet<string>;
  /** When this device last completed a manifest sync. */
  readonly lastSyncAt: Date;
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
): Promise<{ verdict: OfflineVerdict; ticketId: string | null; row: ManifestRow | null }> {
  const zone = state.header.checkpoints.find((c) => c.id === checkpointId && c.kind === 'zone') ?? null;
  const r = await entranceVerdict(state, rawCode, now);
  if (!zone) return r;
  // Passes that would get in (including re-entry and unknown-but-signed ones) are checked
  // against the zone; an unknown pass has no known type, so only an all-types zone takes it.
  if (r.verdict === 'admit' || r.verdict === 'duplicate' || r.verdict === 'provisional')
    return { ...r, verdict: zoneAllows(zone, r.row?.ticketTypeId ?? null) ? 'granted' : 'no_access' };
  return r;
}

async function entranceVerdict(
  state: OfflineState,
  rawCode: string,
  now: Date,
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
      if (state.admitted.has(admittedKey(v.ticketId, day)))
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
    row = state.byShortCode.get(code) ?? null;
    if (!row) return { verdict: 'invalid', ticketId: null, row: null };
  }
  const rule = ruleResult({
    now,
    event,
    ticket: { eventId: event.id, status: row.status, accessDates: row.accessDates },
  });
  if (rule !== 'ok') return { verdict: rule, ticketId: row.ticketId, row };
  if (state.admitted.has(admittedKey(row.ticketId, day)))
    return { verdict: 'duplicate', ticketId: row.ticketId, row };
  return { verdict: 'admit', ticketId: row.ticketId, row };
}

/** SHA-256 of `salt:value`, hex — the manifest's offline lookup hash for a normalized email. */
export async function lookupHash(salt: string, value: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${value.trim().toLowerCase()}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
