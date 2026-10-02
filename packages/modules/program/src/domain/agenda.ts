/**
 * Agenda model v2 (M5.2a). Pure: no database, no DOM, so the console, the commands, M5.2b's
 * enrollment and the tests share one definition.
 *
 * - "Pick one" groups: a registrant holds at most one session of a group (`groupPickDecision`).
 * - Agenda warnings next to the M1.4f schedule warnings: a room smaller than the session's
 *   capacity, and a grouped session that overlaps no other session of its group. Warnings,
 *   never errors: the write happens and the console shows them.
 * - The bulk agenda CSV: row validation (`readAgendaRow`) and the import plan (`planAgendaImport`)
 *   that makes re-running the same file change nothing.
 */
import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';
import { overlaps } from './schedule.ts';

/** P5-9: included sessions never need enrollment; optional sessions with a capacity will. */
export const ADMISSIONS = ['included', 'optional'] as const;
export type Admission = (typeof ADMISSIONS)[number];

/**
 * The agenda's publishing state. `live`: never drafted or published (M1.4f: every change shows
 * at once). `draft`: nothing public. `published`: the public agenda is the snapshot, which is
 * current. `changed`: published, but the agenda changed since (the public still sees the snapshot).
 */
export const AGENDA_STATES = ['live', 'draft', 'published', 'changed'] as const;
export type AgendaState = (typeof AGENDA_STATES)[number];

/* ------------------------------------------------------------------- pick-one groups ---- */

export type GroupPickDecision =
  | { readonly ok: true; readonly alreadyHeld: boolean }
  | { readonly ok: false; readonly reason: 'not_in_group' | 'one_per_group' };

/**
 * May a registrant take `sessionId` in a pick-one group? `held` is what they already hold (any
 * sessions; only the group's count). Exactly one pick per group: a second, different session of
 * the same group is refused; taking the one already held again is a no-op. M5.2b enforces it
 * before claiming a place (and `session_group_picks` guards it in the database).
 */
export function groupPickDecision(
  group: { readonly sessionIds: readonly string[] },
  held: readonly string[],
  sessionId: string,
): GroupPickDecision {
  if (!group.sessionIds.includes(sessionId)) return { ok: false, reason: 'not_in_group' };
  const mine = held.filter((id) => group.sessionIds.includes(id));
  if (mine.includes(sessionId)) return { ok: true, alreadyHeld: true };
  if (mine.length > 0) return { ok: false, reason: 'one_per_group' };
  return { ok: true, alreadyHeld: false };
}

/* ---------------------------------------------------------------------- warnings ---- */

export interface AgendaItem {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomId: string | null;
  readonly capacity: number | null;
  readonly groupId: string | null;
}

export type AgendaWarning =
  | {
      readonly kind: 'room_too_small';
      readonly sessionId: string;
      readonly roomId: string;
      readonly roomCapacity: number;
      readonly sessionCapacity: number;
    }
  | { readonly kind: 'group_not_overlapping'; readonly sessionId: string; readonly groupId: string };

export const AGENDA_WARNING_KINDS = ['room_too_small', 'group_not_overlapping'] as const;

/**
 * Agenda warnings, in session order (start, then id): a session whose capacity is larger than
 * its room's, and a session of a pick-one group (of two or more) that overlaps none of the
 * group's other sessions (a group is meant to be "one of these parallel sessions").
 */
export function agendaWarnings(
  items: readonly AgendaItem[],
  rooms: readonly { readonly id: string; readonly capacity: number | null }[],
): AgendaWarning[] {
  const sorted = [...items].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const out: AgendaWarning[] = [];
  for (const s of sorted) {
    const room = s.roomId ? rooms.find((r) => r.id === s.roomId) : undefined;
    if (room && room.capacity !== null && s.capacity !== null && s.capacity > room.capacity)
      out.push({
        kind: 'room_too_small',
        sessionId: s.id,
        roomId: room.id,
        roomCapacity: room.capacity,
        sessionCapacity: s.capacity,
      });
    if (s.groupId) {
      const others = sorted.filter((o) => o.groupId === s.groupId && o.id !== s.id);
      if (others.length > 0 && !others.some((o) => overlaps(s, o)))
        out.push({ kind: 'group_not_overlapping', sessionId: s.id, groupId: s.groupId });
    }
  }
  return out;
}

/* ------------------------------------------------------------------------ CSV import ---- */

/** The agenda CSV's columns (header names, any case and order; unknown columns are ignored). */
export const AGENDA_CSV_COLUMNS = [
  'key',
  'title',
  'starts',
  'ends',
  'type',
  'admission',
  'capacity',
  'room',
  'track',
  'group',
  'speakers',
  'description',
] as const;
export type AgendaCsvColumn = (typeof AGENDA_CSV_COLUMNS)[number];
export const REQUIRED_AGENDA_COLUMNS: readonly AgendaCsvColumn[] = ['title', 'starts', 'ends'];
export const MAX_AGENDA_IMPORT_ROWS = 500;

export const AGENDA_ROW_ERRORS = [
  'missing_title',
  'too_long',
  'formula',
  'invalid_starts',
  'invalid_ends',
  'ends_before_starts',
  'invalid_admission',
  'invalid_capacity',
  'group_needs_optional',
  'invalid_speaker',
  'unknown_speaker',
  'duplicate_key',
  'duplicate_row',
  /** The session is outside its date (multi-date events): move it in the console. */
  'outside_date',
  /** People hold places or picks: its group, admission and capacity can't change by import. */
  'has_enrollments',
] as const;
export type AgendaRowError = (typeof AGENDA_ROW_ERRORS)[number];

export interface AgendaSpeakerRef {
  readonly email: string;
  readonly name: string | null;
}

/** One valid CSV row, normalized. Times are instants (the file's wall-clock times in the event's zone). */
export interface AgendaRow {
  readonly key: string | null;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly type: string | null;
  readonly admission: Admission;
  readonly capacity: number | null;
  readonly room: string | null;
  readonly track: string | null;
  readonly group: string | null;
  readonly speakers: readonly AgendaSpeakerRef[];
  readonly description: string;
}

export type AgendaRowResult =
  | { readonly ok: true; readonly row: AgendaRow }
  | { readonly ok: false; readonly errors: readonly AgendaRowError[] };

const EMAIL = /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;
const LIMITS: Partial<Record<AgendaCsvColumn, number>> = {
  key: 80,
  title: 160,
  type: 60,
  room: 80,
  track: 80,
  group: 80,
  description: 5000,
};

/**
 * Formula injection (CSV injection): a cell that a spreadsheet would run as a formula is refused.
 * One leading apostrophe (how `csvCell` and spreadsheets escape such a value) is dropped first,
 * so an exported file imports back as the same text. "- Coffee" (a dash and a space) is text.
 */
export function formulaSafe(cell: string): { ok: true; value: string } | { ok: false } {
  const v = /^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;
  if (v === cell && (/^[=+@\t\r]/.test(v) || /^-[^\s-]/.test(v))) return { ok: false };
  return { ok: true, value: v };
}

/**
 * A wall-clock time in the event's zone → the instant, or null. Accepts `YYYY-MM-DD HH:MM` and
 * `YYYY-MM-DDTHH:MM` (seconds ignored); impossible dates (Feb 30, 25:00) are refused.
 */
export function parseAgendaTime(cell: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(cell.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d ||
    probe.getUTCHours() !== h ||
    probe.getUTCMinutes() !== mi
  )
    return null;
  return zonedTimeToUtc(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`, timeZone);
}

/** `Ada Lovelace <ada@example.org>; grace@example.org` → speaker references, or null if unreadable. */
export function parseSpeakers(cell: string): AgendaSpeakerRef[] | null {
  const out: AgendaSpeakerRef[] = [];
  for (const part of cell
    .split(/[;|]/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const named = /^(.*?)\s*<([^<>]+)>$/.exec(part);
    const email = (named ? (named[2] ?? '') : part).trim().toLowerCase();
    const name = named ? (named[1] ?? '').trim().replace(/\s+/g, ' ') : '';
    if (!EMAIL.test(email) || email.length > 254 || name.length > 120) return null;
    if (!out.some((s) => s.email === email)) out.push({ email, name: name || null });
  }
  return out;
}

/** Header names → column positions (case- and space-insensitive); missing required ones named. */
export function mapAgendaHeaders(headers: readonly string[]): {
  columns: Partial<Record<AgendaCsvColumn, number>>;
  missing: AgendaCsvColumn[];
} {
  const columns: Partial<Record<AgendaCsvColumn, number>> = {};
  headers.forEach((h, i) => {
    const name = h.trim().toLowerCase().replace(/\s+/g, '_') as AgendaCsvColumn;
    if ((AGENDA_CSV_COLUMNS as readonly string[]).includes(name) && columns[name] === undefined)
      columns[name] = i;
  });
  return { columns, missing: REQUIRED_AGENDA_COLUMNS.filter((c) => columns[c] === undefined) };
}

/** Validate one CSV row: every problem is reported (not just the first). */
export function readAgendaRow(
  cells: readonly string[],
  columns: Partial<Record<AgendaCsvColumn, number>>,
  timeZone: string,
): AgendaRowResult {
  const errors = new Set<AgendaRowError>();
  const text = (c: AgendaCsvColumn): string => {
    const raw = columns[c] === undefined ? '' : (cells[columns[c]] ?? '').trim();
    const safe = formulaSafe(raw);
    if (!safe.ok) {
      errors.add('formula');
      return '';
    }
    const limit = LIMITS[c];
    if (limit && safe.value.length > limit) errors.add('too_long');
    return c === 'description' ? safe.value : safe.value.replace(/\s+/g, ' ');
  };
  const orNull = (v: string) => (v ? v : null);
  const key = orNull(text('key'));
  const title = text('title');
  if (!title && !errors.has('formula')) errors.add('missing_title');
  const startsAt = parseAgendaTime(text('starts'), timeZone);
  if (!startsAt) errors.add('invalid_starts');
  const endsAt = parseAgendaTime(text('ends'), timeZone);
  if (!endsAt) errors.add('invalid_ends');
  if (startsAt && endsAt && endsAt <= startsAt) errors.add('ends_before_starts');
  const admissionCell = text('admission').toLowerCase();
  const admission = admissionCell === '' ? 'included' : admissionCell;
  if (!(ADMISSIONS as readonly string[]).includes(admission)) errors.add('invalid_admission');
  const capacityCell = text('capacity');
  const capacity = capacityCell === '' ? null : Number(capacityCell);
  if (capacity !== null && !(Number.isInteger(capacity) && capacity >= 1 && capacity <= 1_000_000))
    errors.add('invalid_capacity');
  const group = orNull(text('group'));
  if (group && admission === 'included') errors.add('group_needs_optional');
  const speakerCell = columns.speakers === undefined ? '' : (cells[columns.speakers] ?? '').trim();
  const speakers = formulaSafe(speakerCell).ok ? parseSpeakers(speakerCell) : null;
  if (!formulaSafe(speakerCell).ok) errors.add('formula');
  else if (!speakers) errors.add('invalid_speaker');
  const row = {
    key,
    title,
    type: orNull(text('type')),
    room: orNull(text('room')),
    track: orNull(text('track')),
    group,
    description: text('description'),
  };
  if (errors.size > 0 || !startsAt || !endsAt || !speakers) return { ok: false, errors: [...errors] };
  return {
    ok: true,
    row: {
      ...row,
      startsAt,
      endsAt,
      admission: admission as Admission,
      capacity,
      speakers,
    },
  };
}

/** A session as it is now, in the CSV's terms (names, not ids), to match and compare rows. */
export interface ExistingAgendaSession {
  readonly id: string;
  readonly key: string | null;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly type: string | null;
  readonly admission: Admission;
  readonly capacity: number | null;
  readonly room: string | null;
  readonly track: string | null;
  readonly group: string | null;
  readonly speakerEmails: readonly string[];
  readonly description: string;
  /** The date it belongs to (multi-date events): an import keeps it there. */
  readonly occurrence: { readonly startsAt: Date; readonly endsAt: Date } | null;
  /** People hold places or group picks (M5.2b). */
  readonly locked: boolean;
}

export type AgendaPlanRow =
  | { readonly line: number; readonly action: 'create'; readonly row: AgendaRow }
  | { readonly line: number; readonly action: 'update'; readonly row: AgendaRow; readonly sessionId: string }
  | {
      readonly line: number;
      readonly action: 'unchanged';
      readonly row: AgendaRow;
      readonly sessionId: string;
    }
  | {
      readonly line: number;
      readonly action: 'error';
      readonly title: string;
      readonly errors: readonly AgendaRowError[];
    };

const lower = (v: string | null) => (v === null ? null : v.toLowerCase());
const sameKey = (s: { title: string; startsAt: Date }) =>
  `${s.title.toLowerCase()}\u0000${s.startsAt.getTime()}`;

/** True when applying the row would change nothing (names compare case-insensitively). */
export function rowMatches(row: AgendaRow, s: ExistingAgendaSession): boolean {
  return (
    row.title === s.title &&
    row.startsAt.getTime() === s.startsAt.getTime() &&
    row.endsAt.getTime() === s.endsAt.getTime() &&
    lower(row.type) === lower(s.type) &&
    row.admission === s.admission &&
    row.capacity === s.capacity &&
    lower(row.room) === lower(s.room) &&
    lower(row.track) === lower(s.track) &&
    lower(row.group) === lower(s.group) &&
    row.description === s.description &&
    [...row.speakers.map((p) => p.email)].sort().join('\n') === [...s.speakerEmails].sort().join('\n')
  );
}

/**
 * The import plan: each row creates a session, updates the one it matches, changes nothing, or
 * can't be imported (with every reason). A row matches a session by its `key`, else by title
 * and start time. Speakers are matched by email; an unknown email needs a name
 * (`Name <email>`) to create the speaker. Rows are numbered like the file's lines (header = 1).
 */
export function planAgendaImport(
  rows: readonly (readonly string[])[],
  headers: readonly string[],
  timeZone: string,
  existing: {
    readonly sessions: readonly ExistingAgendaSession[];
    readonly speakerEmails: ReadonlySet<string>;
  },
  /** How the description is stored (the Markdown sanitizer), so an unchanged row compares equal. */
  cleanDescription: (s: string) => string = (s) => s,
): AgendaPlanRow[] {
  const { columns } = mapAgendaHeaders(headers);
  const byKey = new Map(existing.sessions.filter((s) => s.key).map((s) => [s.key?.toLowerCase(), s]));
  const byTitle = new Map(existing.sessions.map((s) => [sameKey(s), s]));
  const seenKeys = new Set<string>();
  const seenRows = new Set<string>();
  const read = rows.map((cells) => readAgendaRow(cells, columns, timeZone));
  // A speaker named once in the file (`Name <email>`) is known by email in every other row.
  const fileNames = new Map<string, string>();
  for (const r of read)
    if (r.ok)
      for (const p of r.row.speakers) if (p.name && !fileNames.has(p.email)) fileNames.set(p.email, p.name);
  return rows.map((cells, i): AgendaPlanRow => {
    const line = i + 2;
    const res = read[i] as AgendaRowResult;
    const titleCell = columns.title === undefined ? '' : (cells[columns.title] ?? '').trim();
    const title = formulaSafe(titleCell).ok ? titleCell.slice(0, 160) : '';
    if (!res.ok) return { line, action: 'error', title, errors: res.errors };
    const row: AgendaRow = {
      ...res.row,
      description: cleanDescription(res.row.description),
      speakers: res.row.speakers.map((p) => ({
        email: p.email,
        name: p.name ?? fileNames.get(p.email) ?? null,
      })),
    };
    const errors: AgendaRowError[] = [];
    if (row.key) {
      if (seenKeys.has(row.key.toLowerCase())) errors.push('duplicate_key');
      seenKeys.add(row.key.toLowerCase());
    } else {
      if (seenRows.has(sameKey(row))) errors.push('duplicate_row');
      seenRows.add(sameKey(row));
    }
    if (row.speakers.some((p) => !p.name && !existing.speakerEmails.has(p.email)))
      errors.push('unknown_speaker');
    if (errors.length) return { line, action: 'error', title: row.title, errors };
    const match = row.key ? byKey.get(row.key.toLowerCase()) : byTitle.get(sameKey(row));
    if (!match) return { line, action: 'create', row };
    if (
      match.occurrence &&
      (row.startsAt < match.occurrence.startsAt || row.endsAt > match.occurrence.endsAt)
    )
      errors.push('outside_date');
    if (
      match.locked &&
      (lower(row.group) !== lower(match.group) ||
        row.admission !== match.admission ||
        row.capacity !== match.capacity)
    )
      errors.push('has_enrollments');
    if (errors.length) return { line, action: 'error', title: row.title, errors };
    return {
      line,
      action: rowMatches(row, match) ? 'unchanged' : 'update',
      row,
      sessionId: match.id,
    };
  });
}

/** A session's start or end as the CSV writes it (`YYYY-MM-DD HH:MM` in the event's zone). */
export const agendaCsvTime = (instant: Date, timeZone: string) =>
  utcToZonedInput(instant, timeZone).replace('T', ' ');
