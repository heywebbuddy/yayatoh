/**
 * AI credits (M1.4f, decision D12): a small free allowance per org, metered at M6.6. Pure
 * arithmetic shared by the commands and the tests; no database.
 *
 * Rules:
 * - Each org gets `allowance` free drafts per calendar month (UTC).
 * - At the first use in a new month the balance is **topped up to** the allowance: unused free
 *   credits don't pile up month after month, and credits granted on top (support adjustments,
 *   later purchases) are never taken away.
 * - One draft costs one credit. A draft that fails at the provider is refunded once.
 * - The balance never goes below zero.
 */

export const DRAFT_KINDS = ['tagline', 'description', 'faq'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/**
 * M6.12b: what a credit was spent on. The event-copy kinds of M1.4f, the v2 drafts (campaign,
 * page, agenda), audience suggestions and matchmaking embeddings. Stored in `draft_kind`.
 */
export const COMPOSE_TASKS = ['campaign', 'page', 'agenda', 'audience'] as const;
export type ComposeTask = (typeof COMPOSE_TASKS)[number];
export const AI_PURPOSES = [...DRAFT_KINDS, ...COMPOSE_TASKS, 'embedding'] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

export const CREDIT_ENTRY_KINDS = ['grant', 'debit', 'refund', 'adjust'] as const;
export type CreditEntryKind = (typeof CREDIT_ENTRY_KINDS)[number];

/** Pending owner (owner-inbox): the free monthly allowance per org. */
export const FREE_MONTHLY_CREDITS = 20;
export const DRAFT_COST = 1;
/** Organizer notes sent with a draft request (data, never instructions). */
export const MAX_NOTES_LENGTH = 1000;

export interface CreditState {
  readonly balance: number;
  readonly period: string;
}

export interface LedgerEntry {
  readonly kind: CreditEntryKind;
  readonly amount: number;
  readonly balanceAfter: number;
}

/** The UTC month of an instant, `YYYY-MM`. */
export function periodOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Bring an account into `period`: a missing account opens with the allowance; a stale one is
 * topped up to it. Returns the entries to append (possibly none) and the new state.
 */
export function rollover(
  account: CreditState | null,
  period: string,
  allowance: number,
): { state: CreditState; entries: LedgerEntry[] } {
  if (allowance < 0 || !Number.isInteger(allowance)) throw new Error('allowance must be a whole number ≥ 0');
  const balance = account?.balance ?? 0;
  if (account && account.period === period) return { state: account, entries: [] };
  const topUp = Math.max(0, allowance - balance);
  const next = { balance: balance + topUp, period };
  return {
    state: next,
    entries: topUp > 0 ? [{ kind: 'grant', amount: topUp, balanceAfter: next.balance }] : [],
  };
}

/** The balance a reader should see without writing (a stale month shows the topped-up amount). */
export function effectiveBalance(account: CreditState | null, period: string, allowance: number): number {
  return rollover(account, period, allowance).state.balance;
}

/** Spend `cost` credits, or refuse when the balance can't cover it (never negative). */
export function debit(
  state: CreditState,
  cost = DRAFT_COST,
): { ok: true; state: CreditState; entry: LedgerEntry } | { ok: false } {
  if (cost <= 0 || !Number.isInteger(cost)) throw new Error('cost must be a whole number > 0');
  if (state.balance < cost) return { ok: false };
  const balance = state.balance - cost;
  return {
    ok: true,
    state: { ...state, balance },
    entry: { kind: 'debit', amount: -cost, balanceAfter: balance },
  };
}

/** Give back a debit's credits. */
export function refund(state: CreditState, debitAmount: number): { state: CreditState; entry: LedgerEntry } {
  const amount = Math.abs(debitAmount);
  const balance = state.balance + amount;
  return { state: { ...state, balance }, entry: { kind: 'refund', amount, balanceAfter: balance } };
}

/** Sum of a ledger: always equals the account balance. */
export function ledgerBalance(entries: readonly { readonly amount: number }[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}
