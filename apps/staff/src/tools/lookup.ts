/**
 * Lookup at the door by name, phone or email (M7.4c). One matching function (`findTicketHolders`
 * from `@yayatoh/checkin-engine`, the same the Scan PWA and the console use) over the manifest rows:
 * the phone's own saved manifest when there is one (offline, exact salted-hash match for email and
 * phone), or else the pages the device downloads through its staff route and keeps in memory only.
 *
 * What a match shows is an allowlist of five fields. Contact details are in the manifest only as
 * salted hashes and are never part of a match, and a field the manifest does not carry cannot be
 * shown because nothing here asks for it.
 */
import {
  findTicketHolders,
  type LookupKind,
  lookupKind,
  type ManifestRow,
  normalizeName,
} from '@yayatoh/checkin-engine';
import type { StaffApi } from './api';

/** The manifest rows to search, with the salt their hashes were made with. */
export interface ManifestSource {
  readonly salt: string;
  readonly rows: Iterable<ManifestRow>;
  /** Whether this phone already admitted the ticket today (the saved manifest knows). */
  admittedToday?(ticketId: string): boolean;
  /** `device` is the phone's saved manifest (works offline); `download` is held in memory only. */
  readonly origin: 'device' | 'download';
}

export interface HolderMatch {
  readonly ticketId: string;
  readonly shortCode: string;
  readonly holderName: string;
  readonly typeName: string;
  readonly status: 'active' | 'void';
  readonly admittedHere: boolean;
}

export type LookupOutcome =
  | { readonly state: 'too_short'; readonly kind: LookupKind }
  | { readonly state: 'done'; readonly kind: LookupKind; readonly matches: readonly HolderMatch[] };

/** A name needs two letters; an email or a phone number is checked whole. */
export function queryTooShort(query: string): boolean {
  const q = query.trim();
  return lookupKind(q) === 'name' && normalizeName(q).length < 2;
}

export async function lookupHolders(source: ManifestSource, query: string): Promise<LookupOutcome> {
  const q = query.trim();
  const kind = lookupKind(q);
  if (queryTooShort(q)) return { state: 'too_short', kind };
  const { rows } = await findTicketHolders(source.rows, source.salt, q);
  return {
    state: 'done',
    kind,
    // Copy field by field: nothing else on a row (hashes, access dates, session facts) goes on.
    matches: rows.map((r) => ({
      ticketId: r.ticketId,
      shortCode: r.shortCode,
      holderName: r.holderName,
      typeName: r.typeName,
      status: r.status,
      admittedHere: source.admittedToday?.(r.ticketId) ?? false,
    })),
  };
}

/** The most pages read in one go (2000 rows each): a guard against a server that never says complete. */
const MAX_PAGES = 50;

/** Download the whole manifest through the device's staff route, into memory only. */
export async function downloadManifest(api: StaffApi, eventId: string): Promise<ManifestSource> {
  const rows: ManifestRow[] = [];
  let salt = '';
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const p = await api.manifestPage(eventId, cursor);
    salt = p.salt;
    rows.push(...p.rows);
    if (p.complete || !p.cursor) break;
    cursor = p.cursor;
  }
  return { salt, rows, origin: 'download' };
}
