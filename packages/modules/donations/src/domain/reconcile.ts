/**
 * M4.8g donations reconciliation, pure: the event's gifts as the ledger's memo entries remember
 * them against the charity's connected account (its balance transactions), like M1.6e does for
 * the platform balance. Each side is summed per reference (`order:<id>` for a gift's charge,
 * `refund:<id>` for a refund) and currency; a reference whose sums differ is a difference.
 */
export const RECON_PROVIDERS = ['fake', 'stripe'] as const;
export const RECON_ITEM_KINDS = ['missing_at_provider', 'missing_in_ledger', 'amount_mismatch'] as const;
export type ReconItemKind = (typeof RECON_ITEM_KINDS)[number];
/** `cleared`: a later run found both sides agreeing again. */
export const RECON_ITEM_STATUSES = ['open', 'resolved', 'cleared'] as const;
export type ReconItemStatus = (typeof RECON_ITEM_STATUSES)[number];
export const RECON_PAYOUT_STATUSES = ['pending', 'in_transit', 'paid', 'failed', 'canceled'] as const;

export interface ReconSide {
  readonly reference: string;
  readonly currency: string;
  /** Signed: a charge is positive, a refund negative. */
  readonly amountMinor: number;
}

export interface ReconDiff {
  readonly kind: ReconItemKind;
  readonly reference: string;
  readonly currency: string;
  readonly ledgerMinor: number;
  readonly providerMinor: number;
}

const keyOf = (s: { reference: string; currency: string }) => `${s.reference}\u0000${s.currency}`;

function sums(
  rows: readonly ReconSide[],
): Map<string, { reference: string; currency: string; sum: number; n: number }> {
  const out = new Map<string, { reference: string; currency: string; sum: number; n: number }>();
  for (const r of rows) {
    const k = keyOf(r);
    const cur = out.get(k) ?? { reference: r.reference, currency: r.currency, sum: 0, n: 0 };
    out.set(k, { ...cur, sum: cur.sum + r.amountMinor, n: cur.n + 1 });
  }
  return out;
}

/** The references whose ledger and provider sums differ, sorted by reference. */
export function reconcileDonations(
  ledger: readonly ReconSide[],
  provider: readonly ReconSide[],
): ReconDiff[] {
  const l = sums(ledger);
  const p = sums(provider);
  const out: ReconDiff[] = [];
  for (const k of new Set([...l.keys(), ...p.keys()])) {
    const a = l.get(k);
    const b = p.get(k);
    const ledgerMinor = a?.sum ?? 0;
    const providerMinor = b?.sum ?? 0;
    if (ledgerMinor === providerMinor) continue;
    const ref = (a ?? b) as { reference: string; currency: string };
    out.push({
      kind: !b ? 'missing_at_provider' : !a ? 'missing_in_ledger' : 'amount_mismatch',
      reference: ref.reference,
      currency: ref.currency,
      ledgerMinor,
      providerMinor,
    });
  }
  return out.sort((x, y) => x.reference.localeCompare(y.reference) || x.currency.localeCompare(y.currency));
}

/** Per currency: what each side counted (and the provider's fees on the event's charges). */
export interface ReconTotal {
  readonly currency: string;
  readonly ledgerMinor: number;
  readonly providerMinor: number;
  readonly feeMinor: number;
  /** The event's movements no payout has carried yet (net of fees). */
  readonly unpaidOutMinor: number;
  readonly unpaidOutCount: number;
}

export function reconTotals(
  ledger: readonly ReconSide[],
  provider: readonly (ReconSide & { feeMinor: number; payoutId: string | null })[],
): ReconTotal[] {
  const by = new Map<
    string,
    {
      ledgerMinor: number;
      providerMinor: number;
      feeMinor: number;
      unpaidOutMinor: number;
      unpaidOutCount: number;
    }
  >();
  const at = (c: string) => {
    const v = by.get(c) ?? {
      ledgerMinor: 0,
      providerMinor: 0,
      feeMinor: 0,
      unpaidOutMinor: 0,
      unpaidOutCount: 0,
    };
    by.set(c, v);
    return v;
  };
  for (const r of ledger) at(r.currency).ledgerMinor += r.amountMinor;
  for (const r of provider) {
    const v = at(r.currency);
    v.providerMinor += r.amountMinor;
    v.feeMinor += r.feeMinor;
    if (!r.payoutId) {
      v.unpaidOutMinor += r.amountMinor - r.feeMinor;
      v.unpaidOutCount += 1;
    }
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, v]) => ({ currency, ...v }));
}

/** The provider's movements that belong to the event: its gifts' charges and their refunds. */
export function eventMovements<T extends { reference: string | null; kind: string }>(
  txns: readonly T[],
  references: ReadonlySet<string>,
): (T & { reference: string })[] {
  return txns.filter(
    (t): t is T & { reference: string } =>
      (t.kind === 'charge' || t.kind === 'refund') && t.reference !== null && references.has(t.reference),
  );
}

/** Each payout's share of the event's donations (gross, fees, count), for payouts that carry any. */
export function payoutShares(
  movements: readonly { payoutId: string | null; amountMinor: number; feeMinor: number }[],
): Map<string, { grossMinor: number; feeMinor: number; count: number }> {
  const out = new Map<string, { grossMinor: number; feeMinor: number; count: number }>();
  for (const m of movements) {
    if (!m.payoutId) continue;
    const v = out.get(m.payoutId) ?? { grossMinor: 0, feeMinor: 0, count: 0 };
    out.set(m.payoutId, {
      grossMinor: v.grossMinor + m.amountMinor,
      feeMinor: v.feeMinor + m.feeMinor,
      count: v.count + 1,
    });
  }
  return out;
}

/**
 * How a stored difference changes when a run finds `diff` (or nothing) for its reference: a new
 * or changed difference is open again; one that is gone is cleared; a resolved one whose amounts
 * did not change stays resolved.
 */
export function nextItemStatus(
  prev: { status: ReconItemStatus; ledgerMinor: number; providerMinor: number } | null,
  diff: { ledgerMinor: number; providerMinor: number } | null,
): ReconItemStatus | null {
  if (!diff) return prev && prev.status === 'open' ? 'cleared' : (prev?.status ?? null);
  if (!prev) return 'open';
  const same = prev.ledgerMinor === diff.ledgerMinor && prev.providerMinor === diff.providerMinor;
  return prev.status === 'resolved' && same ? 'resolved' : 'open';
}
