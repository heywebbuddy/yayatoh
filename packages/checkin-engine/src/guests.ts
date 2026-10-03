/**
 * Guest check-in on the day (M4.4b), shared by the server and the Scan PWA so a device decides
 * offline exactly as the server would: the guest snapshot's shape, name matching for the guest
 * kiosk, search by name or party with labels for staff, the A–Z board, and first-wins arrivals.
 * Universal: no `node:*`.
 */

export const GUEST_SNAPSHOT_VERSION = 1;

export type SnapshotGuestStatus = 'attending' | 'pending' | 'declined';

/** A guest's place on one chart: the event plan (`chart` null) or a sub-event's ("Reception"). */
export interface SnapshotPlace {
  readonly chart: string | null;
  readonly kind: 'table' | 'row';
  readonly label: string;
}

export interface SnapshotGuest {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  /** The name as the host wrote it, or null for an unnamed plus-one. */
  readonly name: string | null;
  /** For an unnamed plus-one: their host's name ("Guest of …"). */
  readonly guestOf: string | null;
  readonly status: SnapshotGuestStatus;
  readonly places: readonly SnapshotPlace[];
  /** When the guest arrived (ISO), or null. */
  readonly arrivedAt: string | null;
}

export interface SnapshotParty {
  readonly id: string;
  readonly name: string;
  /** The host's free-text labels ("Bride", "VIP", "Family"): staff filter chips. */
  readonly tags: readonly string[];
  readonly guests: readonly SnapshotGuest[];
}

/** What a device downloads for guest check-in, the guest kiosk and the A–Z board. */
export interface GuestSnapshot {
  readonly version: number;
  readonly eventId: string;
  readonly generatedAt: string;
  readonly parties: readonly SnapshotParty[];
}

/** Lower case, accents and punctuation dropped, spaces collapsed: "  José  O'Neil" → "jose oneil". */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FoundGuest {
  readonly party: SnapshotParty;
  readonly guest: SnapshotGuest;
}

export type KioskMatch =
  | { readonly status: 'found'; readonly party: SnapshotParty; readonly guest: SnapshotGuest }
  /** Two guests share the name, or the guest declined: staff sort it out. */
  | { readonly status: 'see_staff' }
  | { readonly status: 'no_match' };

/**
 * The guest kiosk: the guest types their own full name; only an exact match (accents, case and
 * punctuation aside) of exactly one guest who hasn't declined finds them. Partial names find
 * nothing, so the kiosk can't be used to browse the guest list.
 */
export function matchGuestByName(snapshot: GuestSnapshot, typed: string): KioskMatch {
  const want = normalizeName(typed);
  if (want.length < 3 || !want.includes(' ')) return { status: 'no_match' };
  const hits: FoundGuest[] = [];
  for (const party of snapshot.parties)
    for (const guest of party.guests)
      if (guest.name && normalizeName(guest.name) === want) hits.push({ party, guest });
  if (hits.length === 0) return { status: 'no_match' };
  const [hit] = hits;
  if (hits.length > 1 || !hit || hit.guest.status === 'declined') return { status: 'see_staff' };
  return { status: 'found', party: hit.party, guest: hit.guest };
}

/** Every label the parties carry, A–Z (the staff screen's filter chips). */
export function snapshotLabels(snapshot: GuestSnapshot, locale?: string): string[] {
  const seen = new Map<string, string>();
  for (const p of snapshot.parties)
    for (const t of p.tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, locale, { sensitivity: 'base' }));
}

/**
 * Staff check-in search: parties whose name or any guest's name contains the query (accents and
 * case aside) and that carry every chosen label. A party matched by its own name shows all its
 * guests; otherwise only the matching ones. An empty query with no labels finds nothing.
 */
export function searchGuests(
  snapshot: GuestSnapshot,
  query: string,
  labels: readonly string[] = [],
  limit = 50,
): SnapshotParty[] {
  const q = normalizeName(query);
  const want = labels.map((l) => l.toLowerCase());
  if (!q && want.length === 0) return [];
  const out: SnapshotParty[] = [];
  for (const party of snapshot.parties) {
    const tags = new Set(party.tags.map((t) => t.toLowerCase()));
    if (!want.every((l) => tags.has(l))) continue;
    if (!q || normalizeName(party.name).includes(q)) {
      out.push(party);
    } else {
      const guests = party.guests.filter((g) =>
        normalizeName(g.name ?? (g.guestOf ? `${g.guestOf}` : '')).includes(q),
      );
      if (guests.length) out.push({ ...party, guests });
    }
    if (out.length >= limit) break;
  }
  return out;
}

export interface BoardEntry {
  readonly guestId: string;
  readonly name: string;
  /** Sort key: last name, then first name. */
  readonly places: readonly SnapshotPlace[];
}

export interface BoardGroup {
  /** "A"…"Z" (accents folded), or "#" for names that start with anything else. */
  readonly letter: string;
  readonly entries: readonly BoardEntry[];
}

const letterOf = (s: string): string => {
  const c = normalizeName(s).charAt(0).toUpperCase();
  return /^[A-Z]$/.test(c) ? c : '#';
};

/**
 * The A–Z board: every named guest who hasn't declined and has a place, by last name (then first
 * name), grouped by the last name's first letter. Unnamed plus-ones and unseated guests aren't on
 * it (they'd only read "Guest of …" or "no table").
 */
export function boardGroups(snapshot: GuestSnapshot, locale?: string): BoardGroup[] {
  const rows: { entry: BoardEntry; last: string; first: string }[] = [];
  for (const party of snapshot.parties)
    for (const g of party.guests) {
      if (!g.name || g.status === 'declined' || g.places.length === 0) continue;
      const last = g.lastName ?? g.name;
      rows.push({ entry: { guestId: g.id, name: g.name, places: g.places }, last, first: g.firstName ?? '' });
    }
  const cmp = (a: string, b: string) => a.localeCompare(b, locale, { sensitivity: 'base' });
  rows.sort(
    (a, b) => cmp(a.last, b.last) || cmp(a.first, b.first) || a.entry.guestId.localeCompare(b.entry.guestId),
  );
  const groups: { letter: string; entries: BoardEntry[] }[] = [];
  for (const r of rows) {
    const letter = letterOf(r.last);
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.entries.push(r.entry);
    else groups.push({ letter, entries: [r.entry] });
  }
  // "#" goes last, like a phone book.
  return [...groups.filter((g) => g.letter !== '#'), ...groups.filter((g) => g.letter === '#')];
}

/** Split board groups into pages of at most `size` lines (a letter heading counts as a line). */
export function boardPages(groups: readonly BoardGroup[], size: number): BoardGroup[][] {
  const pages: BoardGroup[][] = [];
  let page: BoardGroup[] = [];
  let used = 0;
  for (const g of groups) {
    let rest = [...g.entries];
    while (rest.length) {
      if (used + 2 > size && page.length) {
        pages.push(page);
        page = [];
        used = 0;
      }
      const take = Math.max(1, size - used - 1);
      page.push({ letter: g.letter, entries: rest.slice(0, take) });
      used += 1 + Math.min(take, rest.length);
      rest = rest.slice(take);
    }
  }
  if (page.length) pages.push(page);
  return pages;
}

/**
 * When a device saw a guest arrive, on the server's clock: its own time corrected by its measured
 * offset, never in the future (a fast clock can't make an arrival later than now).
 */
export function correctedArrival(deviceTs: Date, clockOffsetMs: number, now: Date): Date {
  const t = deviceTs.getTime() + clockOffsetMs;
  return new Date(Math.min(t, now.getTime()));
}

/** First wins: whether an arrival seen at `candidate` replaces one recorded at `current`. */
export function earlierArrival(current: Date | null, candidate: Date): boolean {
  return current === null || candidate.getTime() < current.getTime();
}
