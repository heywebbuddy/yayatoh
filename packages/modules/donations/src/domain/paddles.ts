/**
 * Pure paddle-raise rules (M4.8c): paddle numbers, calls (a level being called), spotter entries
 * and their review. Universal (no `node:*`): the spotter page imports it in the browser to check a
 * typed number against the event's paddles before it is queued.
 */

/** Paddle numbers are whole numbers from 1 to 99,999. Bulk assignment starts at 100 by default. */
export const PADDLE_MIN = 1;
export const PADDLE_MAX = 99_999;
export const DEFAULT_PADDLE_START = 100;
/** At most this many paddles per event (the guests module allows 3,000 guests). */
export const MAX_PADDLES_PER_EVENT = 3_000;

/** A paddle belongs to one guest or to one party (a household, a company's table). */
export const PADDLE_HOLDER_KINDS = ['guest', 'party'] as const;
export type PaddleHolderKind = (typeof PADDLE_HOLDER_KINDS)[number];

/** Bulk assignment: every guest (or party) without a paddle, or only those of purchased tables. */
export const BULK_SCOPES = ['all', 'tables'] as const;
export type BulkScope = (typeof BULK_SCOPES)[number];

/**
 * A call is one level being called (armed). `open` while the auctioneer calls it; `closed` when
 * they move on; `withdrawn` when an arm with no paddles is undone. One open call per event.
 */
export const CALL_STATUSES = ['open', 'closed', 'withdrawn'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/**
 * A spotter's entry: `recorded` (counts), `duplicate` (the same paddle at the same call already
 * recorded: kept for the recorder, never dropped, not counted), `confirmed` (the recorder made it
 * a pledge) or `voided` (set aside by the recorder or by the console's undo).
 */
export const ENTRY_STATUSES = ['recorded', 'duplicate', 'confirmed', 'voided'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** Why the server refuses a spotter's entry (it is then not stored; the spotter sees why). */
export const ENTRY_REFUSALS = ['paddle_unknown', 'call_unknown', 'call_withdrawn'] as const;
export type EntryRefusal = (typeof ENTRY_REFUSALS)[number];

/** What a spotter's device hears back for one entry. */
export type EntryOutcome =
  | { readonly status: 'recorded' | 'duplicate' | 'confirmed' | 'voided' }
  | { readonly status: 'refused'; readonly reason: EntryRefusal };

/** A pledge from the paddle raise (M4.8c). Collection (paid, written off) arrives with M4.8e. */
export const PLEDGE_STATUSES = ['confirmed', 'cancelled'] as const;
export type PledgeStatus = (typeof PLEDGE_STATUSES)[number];

/** Spotters sync at most this many entries per request. */
export const MAX_SYNC_BATCH = 100;

/** A typed paddle number, or null when it isn't one ("12", " 012 " → 12; "1.5", "abc", "0" → null). */
export function parsePaddleNumber(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  const n = Number(s);
  return n >= PADDLE_MIN && n <= PADDLE_MAX ? n : null;
}

export const isPaddleNumber = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= PADDLE_MIN && n <= PADDLE_MAX;

/**
 * The next `count` free numbers from `start` upwards, skipping every number in `taken`.
 * Returns fewer when the range runs out.
 */
export function nextPaddleNumbers(taken: Iterable<number>, count: number, start = DEFAULT_PADDLE_START) {
  const used = new Set(taken);
  const out: number[] = [];
  for (let n = Math.max(PADDLE_MIN, start); n <= PADDLE_MAX && out.length < count; n++)
    if (!used.has(n)) out.push(n);
  return out;
}

/**
 * The stored status of a new entry: a duplicate when this call already has a counted or
 * duplicate entry for the same paddle (voided ones don't count).
 */
export function entryStatusFor(existing: readonly EntryStatus[]): 'recorded' | 'duplicate' {
  return existing.some((s) => s !== 'voided') ? 'duplicate' : 'recorded';
}

/** Running totals of one call: counted entries times the level's amount; duplicates aside. */
export function callTotals(amountMinor: number, statuses: readonly EntryStatus[]) {
  const counted = statuses.filter((s) => s === 'recorded' || s === 'confirmed').length;
  return {
    count: counted,
    totalMinor: counted * amountMinor,
    duplicates: statuses.filter((s) => s === 'duplicate').length,
    confirmed: statuses.filter((s) => s === 'confirmed').length,
  };
}

/** What the console's Undo reverses, given the latest call and its entries (newest first). */
export type UndoStep =
  | { readonly kind: 'void_entry'; readonly entryId: string }
  | { readonly kind: 'withdraw_call' }
  | { readonly kind: 'reopen_call' }
  | { readonly kind: 'nothing' };

/**
 * Undo reverses the last step of the room: while a level is open, the newest paddle still
 * waiting for review is set aside (or, with none recorded, the arm itself is withdrawn); after a
 * close, the level reopens. Confirmed pledges are never undone here (the recorder voids them).
 */
export function undoStep(
  latest: { readonly status: CallStatus } | null,
  entriesNewestFirst: readonly { readonly id: string; readonly status: EntryStatus }[],
): UndoStep {
  if (!latest || latest.status === 'withdrawn') return { kind: 'nothing' };
  if (latest.status === 'closed') return { kind: 'reopen_call' };
  const live = entriesNewestFirst.filter((e) => e.status !== 'voided');
  if (live.length === 0) return { kind: 'withdraw_call' };
  const next = live.find((e) => e.status === 'recorded' || e.status === 'duplicate');
  return next ? { kind: 'void_entry', entryId: next.id } : { kind: 'nothing' };
}
