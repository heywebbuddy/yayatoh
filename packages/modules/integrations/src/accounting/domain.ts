import { z } from 'zod';

/**
 * Accounting summaries (M6.5d, decision P6-6): one **daily summary journal** per org, day (in the
 * org's time zone) and currency, posted to the org's books (QuickBooks Online, Xero) instead of
 * one entry per order. Pure rules here; no I/O, browser-safe (the console imports them).
 *
 * The organizer's view of a day:
 * - ticket sales (gross) and donations are income: **credits**;
 * - refunds given back to buyers and donors, and Yayatoh's fees, are **debits**;
 * - payouts land in the organizer's bank: a **debit** to the payouts account;
 * - the **clearing** account (money Yayatoh or the processor holds for the organizer) takes the
 *   balance, so every journal balances to zero.
 * Amounts are integer minor units, debit positive and credit negative, like the payments ledger.
 */

/** What each line of a summary journal is for; each is mapped to one account of the org's chart. */
export const ACCOUNT_CATEGORIES = ['sales', 'donations', 'refunds', 'fees', 'payouts', 'clearing'] as const;
export type AccountCategory = (typeof ACCOUNT_CATEGORIES)[number];

export const JOURNAL_KINDS = ['journal', 'reversal'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];
/**
 * `pending`: waiting to be sent; `posted`: the provider has it; `failed`: the provider refused it
 * or did not answer (retryable failures may have reached it); `superseded`: never reached the
 * provider and replaced by a newer revision (no provider effect, so no reversal).
 */
export const JOURNAL_STATUSES = ['pending', 'posted', 'failed', 'superseded'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

/** One account at the provider (its chart of accounts), as the mapping stores it. */
export const ProviderAccount = z.object({
  id: z.string().min(1).max(100),
  code: z.string().max(40).nullable(),
  name: z.string().min(1).max(200),
  /** The provider's account type (`Income`, `EXPENSE`, `BANK`…), shown to help choose. */
  type: z.string().max(60),
});
export type ProviderAccount = z.infer<typeof ProviderAccount>;

/** The chart-of-accounts mapping: one provider account per category. */
export const AccountMap = z.object(
  Object.fromEntries(ACCOUNT_CATEGORIES.map((c) => [c, ProviderAccount])) as Record<
    AccountCategory,
    typeof ProviderAccount
  >,
);
export type AccountMap = z.infer<typeof AccountMap>;

/** One day's totals (minor units, all non-negative except fees, which refunds of fees can turn negative). */
export interface DaySummary {
  readonly salesMinor: number;
  readonly donationsMinor: number;
  readonly refundsMinor: number;
  readonly feesMinor: number;
  readonly payoutsMinor: number;
}

export const DaySummarySchema = z.object({
  salesMinor: z.int(),
  donationsMinor: z.int(),
  refundsMinor: z.int(),
  feesMinor: z.int(),
  payoutsMinor: z.int(),
});

export const EMPTY_SUMMARY: DaySummary = {
  salesMinor: 0,
  donationsMinor: 0,
  refundsMinor: 0,
  feesMinor: 0,
  payoutsMinor: 0,
};

export const isEmptySummary = (s: DaySummary) =>
  s.salesMinor === 0 &&
  s.donationsMinor === 0 &&
  s.refundsMinor === 0 &&
  s.feesMinor === 0 &&
  s.payoutsMinor === 0;

/** A summary's identity: changes exactly when one of its totals changes (the re-post trigger). */
export const summaryKey = (s: DaySummary) =>
  [s.salesMinor, s.donationsMinor, s.refundsMinor, s.feesMinor, s.payoutsMinor].join(':');

/** One line of a journal: debit positive, credit negative. */
export const JournalLine = z.object({
  category: z.enum(ACCOUNT_CATEGORIES),
  accountId: z.string().min(1).max(100),
  accountCode: z.string().max(40).nullable(),
  accountName: z.string().min(1).max(200),
  amountMinor: z.int().refine((n) => n !== 0, 'A line is never zero'),
});
export type JournalLine = z.infer<typeof JournalLine>;

/** The signed amount per category for one day (debit positive). Sums to zero. */
export function categoryAmounts(s: DaySummary): Record<AccountCategory, number> {
  for (const v of Object.values(s))
    if (!Number.isSafeInteger(v)) throw new Error('Summary amounts are integers');
  return {
    sales: -s.salesMinor,
    donations: -s.donationsMinor,
    refunds: s.refundsMinor,
    fees: s.feesMinor,
    payouts: s.payoutsMinor,
    clearing: s.salesMinor + s.donationsMinor - s.refundsMinor - s.feesMinor - s.payoutsMinor,
  };
}

/** The day's journal lines with the mapping's accounts (zero lines left out), in category order. */
export function journalLines(s: DaySummary, map: AccountMap): JournalLine[] {
  const amounts = categoryAmounts(s);
  return ACCOUNT_CATEGORIES.flatMap((category) => {
    const amountMinor = amounts[category];
    if (amountMinor === 0) return [];
    const a = map[category];
    return [{ category, accountId: a.id, accountCode: a.code, accountName: a.name, amountMinor }];
  });
}

/** The lines that undo a posted journal exactly (same accounts, opposite signs). */
export const reversalLines = (lines: readonly JournalLine[]): JournalLine[] =>
  lines.map((l) => ({ ...l, amountMinor: -l.amountMinor }));

/** Total debits of a journal (what the console shows as its amount). */
export const debitTotal = (lines: readonly { amountMinor: number }[]) =>
  lines.reduce((t, l) => (l.amountMinor > 0 ? t + l.amountMinor : t), 0);

export const linesBalance = (lines: readonly { amountMinor: number }[]) =>
  lines.reduce((t, l) => t + l.amountMinor, 0) === 0;

/** Why a mapping cannot be saved. */
export interface AccountMapProblem {
  readonly category: AccountCategory;
  readonly code: 'missing' | 'unknown_account' | 'clearing_shared';
}

/**
 * Check a chosen mapping against the provider's chart: every category mapped to an account the
 * provider has, and the clearing account used for nothing else (its line is the day's balance; a
 * shared account would hide it).
 */
export function validateAccountMap(
  chosen: Readonly<Partial<Record<AccountCategory, string>>>,
  accounts: readonly ProviderAccount[],
): AccountMapProblem[] {
  const problems: AccountMapProblem[] = [];
  const ids = new Set(accounts.map((a) => a.id));
  for (const category of ACCOUNT_CATEGORIES) {
    const id = chosen[category];
    if (!id) problems.push({ category, code: 'missing' });
    else if (!ids.has(id)) problems.push({ category, code: 'unknown_account' });
  }
  const clearing = chosen.clearing;
  if (clearing)
    for (const category of ACCOUNT_CATEGORIES)
      if (category !== 'clearing' && chosen[category] === clearing)
        problems.push({ category, code: 'clearing_shared' });
  return problems;
}

/** The latest state of one day and currency at one connection, as planning needs it. */
export interface DayHistoryRow {
  readonly id: string;
  readonly kind: JournalKind;
  readonly revision: number;
  readonly status: JournalStatus;
  /** For a journal: its summary key. */
  readonly summaryKey: string | null;
  /** For a reversal: the journal it undoes. */
  readonly reversesId: string | null;
  /** Failed with an answer that may have reached the provider (timeouts, 5xx, 429). */
  readonly uncertain: boolean;
  /** The account mapping version a journal's lines were built with. */
  readonly mapVersion: number;
}

/** What to do with one day and currency. */
export interface DayPlan {
  /** Rows that never reached the provider and are replaced (no provider effect). */
  readonly supersede: readonly string[];
  /** The posted journal to reverse first, if any. */
  readonly reverse: string | null;
  /** Post a new revision of the day (the summary is not empty and differs from what stands). */
  readonly post: boolean;
  /** Whether nothing changes (the books already say this). */
  readonly unchanged: boolean;
  /** A row is still in flight with an uncertain outcome: wait for it (never guess). */
  readonly blocked: boolean;
}

/**
 * Decide how to bring one day in the books to `summary` (decision P6-6: **reverse and re-post,
 * never edit**). What "stands" in the books is the newest posted journal that no posted reversal
 * undoes. Rows not yet sent are replaced freely; a row whose outcome is uncertain blocks the day
 * until it settles (its retry keeps the same idempotency key, so it lands at most once).
 */
export function planDay(
  history: readonly DayHistoryRow[],
  summary: DaySummary,
  mapVersion: number,
): DayPlan {
  const none: DayPlan = { supersede: [], reverse: null, post: false, unchanged: true, blocked: false };
  if (history.some((r) => r.status === 'failed' && r.uncertain)) return { ...none, blocked: true };
  const unsent = history.filter((r) => r.status === 'pending' || r.status === 'failed');
  const reversed = new Set(
    history.filter((r) => r.kind === 'reversal' && r.status === 'posted').map((r) => r.reversesId),
  );
  const standing =
    history
      .filter((r) => r.kind === 'journal' && r.status === 'posted' && !reversed.has(r.id))
      .sort((a, b) => b.revision - a.revision)[0] ?? null;
  const target = isEmptySummary(summary) ? null : summaryKey(summary);
  const standingKey = standing?.summaryKey ?? null;
  if (standingKey === target) {
    // The books are right; anything unsent (a reversal or revision now unneeded) goes.
    return { ...none, supersede: unsent.map((r) => r.id), unchanged: unsent.length === 0 };
  }
  // The pending rows already say exactly this: keep them (a re-run writes nothing new).
  const pendingJournal = unsent.find((r) => r.kind === 'journal');
  const pendingReversal = unsent.find((r) => r.kind === 'reversal');
  const wantsReversal = standing !== null;
  // An unsent journal built with an older mapping is rebuilt with the current one.
  const sameJournal =
    target === null
      ? !pendingJournal
      : pendingJournal?.summaryKey === target && pendingJournal.mapVersion === mapVersion;
  const sameReversal = wantsReversal
    ? pendingReversal?.reversesId === standing?.id
    : pendingReversal === undefined;
  if (sameJournal && sameReversal && unsent.length === Number(!!pendingJournal) + Number(!!pendingReversal))
    return none;
  return {
    supersede: unsent.map((r) => r.id),
    reverse: standing?.id ?? null,
    post: target !== null,
    unchanged: false,
    blocked: false,
  };
}

/** The idempotency key of one journal at the provider: org + day + currency + revision (+ kind). */
export const journalKey = (
  orgId: string,
  day: string,
  currency: string,
  revision: number,
  kind: JournalKind,
) => `yayatoh:${orgId}:${day}:${currency}:r${revision}${kind === 'reversal' ? ':reversal' : ''}`;

/** The short reference books show (QuickBooks DocNumber: at most 21 characters). */
export const journalReference = (day: string, currency: string, revision: number, kind: JournalKind) =>
  `YY-${day.replaceAll('-', '')}-${currency}-${revision}${kind === 'reversal' ? 'R' : ''}`;

/** The narration books show (English: the books are the organizer's accountant's). */
export const journalMemo = (day: string, currency: string, revision: number, kind: JournalKind) =>
  kind === 'reversal'
    ? `Reversal of Yayatoh daily summary ${day} ${currency} (revision ${revision})`
    : `Yayatoh daily summary ${day} ${currency} (revision ${revision})`;

/** Minor units as an exact decimal string (`12345`, 2 → `123.45`; `-5`, 2 → `-0.05`). No floats. */
export function minorToDecimal(amountMinor: number, exponent: number): string {
  if (!Number.isSafeInteger(amountMinor)) throw new Error('Amounts are integers');
  const neg = amountMinor < 0;
  const digits = String(Math.abs(amountMinor));
  if (exponent === 0) return `${neg ? '-' : ''}${digits}`;
  const padded = digits.padStart(exponent + 1, '0');
  return `${neg ? '-' : ''}${padded.slice(0, -exponent)}.${padded.slice(-exponent)}`;
}

/** A decimal string or number back to minor units, exactly; null when it has too many places. */
export function decimalToMinor(value: string | number, exponent: number): number | null {
  const s = typeof value === 'number' ? String(value) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[3] ?? '').replace(/0+$/, '');
  if (frac.length > exponent) return null;
  const n = Number(`${m[2]}${frac.padEnd(exponent, '0')}`);
  return Number.isSafeInteger(n) ? (m[1] ? -n : n) : null;
}

/** `YYYY-MM-DD` arithmetic on calendar days (no time zones involved). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The calendar day of an instant in an IANA zone. */
export function dayIn(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** How far back a mapping may start posting (one year: summaries are recomputed each run). */
export const MAX_BACKFILL_DAYS = 366;
