import { createHash } from 'node:crypto';

/**
 * Deterministic ids for migrated rows (roadmap §7.5 "IDs"). A UUIDv7 whose 48-bit timestamp is the
 * legacy row's `created_at` (so index locality matches rows created later by the new app) and whose
 * remaining 74 bits come from SHA-256(`instance|table|legacy_id`). Re-running a rehearsal on the same
 * dump gives the same ids. The SQL twin is `legacy.det_uuid()` (src/sql.ts); a test keeps them equal.
 */
export const EPOCH_FALLBACK = new Date('2019-01-01T00:00:00Z');
const MAX_MS = 2 ** 48 - 1;

export function detUuid(createdAt: Date | string | null, key: string): string {
  // The migrator pool returns timestamptz as text (e.g. `2024-05-01 14:00:00+00`); Date parses it.
  const raw = createdAt == null ? undefined : new Date(createdAt).getTime();
  if (raw !== undefined && Number.isNaN(raw))
    throw new Error(`detUuid: not a timestamp: ${String(createdAt)}`);
  const ms = Math.min(MAX_MS, Math.max(0, Math.floor(raw ?? EPOCH_FALLBACK.getTime())));
  const h = createHash('sha256').update(key, 'utf8').digest('hex');
  const variant = (8 | (Number.parseInt(h[3] as string, 16) & 3)).toString(16);
  const hex = `${ms.toString(16).padStart(12, '0')}7${h.slice(0, 3)}${variant}${h.slice(4, 19)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The key hashed into a migrated row's id. Instance-scoped, so yay and abc ids never collide. */
export const legacyKey = (instance: string, table: string, legacyId: string | number) =>
  `${instance}|${table}|${legacyId}`;

const ASCII_SPACE = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

/**
 * The identity merge key `lower(nfkc(trim(email)))` (roadmap §7.5 T1). Trimmed again after NFKC,
 * because NFKC turns non-breaking and other Unicode spaces into plain spaces. SQL twin:
 * `legacy.email_norm()`.
 */
export function emailNorm(email: string): string {
  return email.replace(ASCII_SPACE, '').normalize('NFKC').replace(ASCII_SPACE, '').toLowerCase();
}

/** A usable address after normalization (one @, a dot in the domain, no spaces). */
export const EMAIL_PATTERN = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$';
const EMAIL_RE = new RegExp(EMAIL_PATTERN);
export const isValidEmail = (norm: string) => norm.length <= 254 && EMAIL_RE.test(norm);

/** Same alphabet as issued tickets' short codes (`@yayatoh/ticket-crypto` randomShortCode). */
export const SHORT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A migrated ticket's 8-character short code, derived from its id (and a salt that is raised only
 * when two tickets of an org would collide). SQL twin: `legacy.short_code()`.
 */
export function shortCode(ticketId: string, salt = 0): string {
  const h = createHash('sha256').update(`${ticketId}:${salt}`, 'utf8').digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += SHORT_CODE_ALPHABET[(h[i] as number) % SHORT_CODE_ALPHABET.length];
  return out;
}

/** A URL slug the new schema accepts (`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`), at most `max` chars. */
export function slugify(text: string, max = 60): string {
  const s = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return s || 'event';
}

/** RFC 4122 name-based UUID (version 5, SHA-1). */
export function uuidv5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new Error(`uuidv5: bad namespace ${namespace}`);
  const h = createHash('sha1').update(ns).update(name, 'utf8').digest();
  h[6] = ((h[6] as number) & 0x0f) | 0x50;
  h[8] = ((h[8] as number) & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Namespace of migrated seat-chart ids (uuidv5 of the URL namespace and `yayatoh:legacy-seats`). */
export const SEAT_NAMESPACE = uuidv5('6ba7b811-9dad-11d1-80b4-00c04fd430c8', 'yayatoh:legacy-seats');

/**
 * A migrated seat's stable id (roadmap §7.5: `seat_uuid = uuidv5(ns, "{inst}:seat:{id}")`). A legacy
 * table (a seat with capacity N) becomes N places: place 1 keeps the seat's own id, places 2…N
 * append `:{k}`.
 */
export const legacySeatUuid = (instance: string, seatId: number | string, place = 1) =>
  uuidv5(SEAT_NAMESPACE, place === 1 ? `${instance}:seat:${seatId}` : `${instance}:seat:${seatId}:${place}`);
