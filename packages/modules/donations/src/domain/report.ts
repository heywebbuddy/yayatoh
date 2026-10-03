/**
 * M4.8g donations reports, pure: every way money reached the charity for an event as one list of
 * lines (online and QR gifts, paddle pledges paid by card, link or offline, ticket donations),
 * then the totals per source, level, donor and currency. Money is never summed across currencies.
 */
export const REPORT_SOURCES = ['online', 'qr', 'paddle', 'ticket'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

/** How the money arrived: a card charge on the charity's account, or recorded by the host. */
export const LINE_METHODS = ['card', 'check', 'wire', 'stock', 'daf', 'cash', 'other'] as const;
export type LineMethod = (typeof LINE_METHODS)[number];

export interface DonationLine {
  /** The gift, collection or order line it comes from (stable, for exports). */
  readonly id: string;
  readonly source: ReportSource;
  readonly method: LineMethod;
  readonly campaignName: string | null;
  readonly levelId: string | null;
  readonly levelName: string | null;
  readonly donorName: string;
  readonly donorEmail: string | null;
  /** The donor asked not to be named (P4-13); the host still sees who gave. */
  readonly anonymous: boolean;
  readonly employer: string | null;
  readonly tributeKind: 'honor' | 'memory' | null;
  readonly tributeName: string | null;
  readonly paddleNumber: number | null;
  readonly date: Date;
  /** The gift itself (before any covered fee). */
  readonly amountMinor: number;
  /** The processing fee the donor chose to cover (P4-10); goes to the charity. */
  readonly feeCoverMinor: number;
  readonly refundedMinor: number;
  readonly currency: string;
  /** The order paid on the provider, when there is one (`order:<id>` in reconciliation). */
  readonly orderId: string | null;
}

/** What reached the charity from the line: the charge (gift and fee cover) less refunds. */
export const lineNet = (l: Pick<DonationLine, 'amountMinor' | 'feeCoverMinor' | 'refundedMinor'>) =>
  Math.max(0, l.amountMinor + l.feeCoverMinor - l.refundedMinor);

export interface PledgeFact {
  readonly amountMinor: number;
  readonly currency: string;
  readonly levelId: string | null;
  readonly levelName: string | null;
  /** The pledge's collection state (`open` when the night is not closed yet). */
  readonly status: 'open' | 'scheduled' | 'charging' | 'invoiced' | 'paid' | 'paid_offline' | 'written_off';
  /** Paid by card or pay link: `card` or `link`. */
  readonly paidBy: 'card' | 'link' | null;
}

export interface MatchFact {
  readonly id: string;
  readonly sponsorName: string;
  readonly publicName: string | null;
  readonly campaignName: string;
  readonly ratioPercent: number;
  readonly capMinor: number;
  readonly currency: string;
  readonly status: 'active' | 'closed' | 'cancelled';
  readonly matchedMinor: number;
  readonly giftCount: number;
}

export interface CurrencyTotals {
  readonly currency: string;
  /** Card money on the charity's account: gifts and paddle pledges paid by card or link, net. */
  readonly onlineNetMinor: number;
  readonly offlineMinor: number;
  readonly ticketMinor: number;
  /** Everything received: online net, offline and ticket donations. */
  readonly raisedMinor: number;
  readonly feeCoverMinor: number;
  readonly refundedMinor: number;
  readonly pledgedMinor: number;
  readonly pledgeCollectedMinor: number;
  readonly writtenOffMinor: number;
  readonly pledgeOpenMinor: number;
  readonly matchedMinor: number;
  readonly lineCount: number;
  readonly donorCount: number;
}

export interface SourceRow {
  readonly source: ReportSource;
  readonly currency: string;
  readonly count: number;
  readonly netMinor: number;
}

export interface LevelRow {
  readonly levelId: string | null;
  readonly name: string | null;
  readonly currency: string;
  readonly giftCount: number;
  readonly giftNetMinor: number;
  readonly pledgeCount: number;
  readonly pledgedMinor: number;
}

export interface DonorRow {
  readonly key: string;
  readonly name: string;
  readonly email: string | null;
  readonly anonymous: boolean;
  readonly currency: string;
  readonly count: number;
  readonly netMinor: number;
}

export interface PledgeRow {
  readonly currency: string;
  readonly count: number;
  readonly pledgedMinor: number;
  readonly cardMinor: number;
  readonly linkMinor: number;
  readonly offlineMinor: number;
  readonly writtenOffMinor: number;
  readonly openMinor: number;
}

const bump = <K, V>(m: Map<K, V>, k: K, init: () => V, f: (v: V) => V) => m.set(k, f(m.get(k) ?? init()));

/** One donor per email (or name, for offline pledges without one), per currency. */
export const donorKey = (l: Pick<DonationLine, 'donorEmail' | 'donorName'>) =>
  l.donorEmail ? `e:${l.donorEmail.toLowerCase()}` : `n:${l.donorName.trim().toLowerCase()}`;

export function bySource(lines: readonly DonationLine[]): SourceRow[] {
  const m = new Map<string, SourceRow>();
  for (const l of lines) {
    const net = lineNet(l);
    bump(
      m,
      `${l.source}|${l.currency}`,
      () => ({ source: l.source, currency: l.currency, count: 0, netMinor: 0 }),
      (v) => ({ ...v, count: v.count + 1, netMinor: v.netMinor + net }),
    );
  }
  const order = (s: ReportSource) => REPORT_SOURCES.indexOf(s);
  return [...m.values()].sort(
    (a, b) => order(a.source) - order(b.source) || a.currency.localeCompare(b.currency),
  );
}

/**
 * Per level: gifts given at the level (online and QR; paddle money is counted as pledges, so a
 * pledge paid later is not counted twice) and the paddle pledges called at it.
 */
export function byLevel(lines: readonly DonationLine[], pledges: readonly PledgeFact[]): LevelRow[] {
  const m = new Map<string, LevelRow>();
  const init = (levelId: string | null, name: string | null, currency: string) => () => ({
    levelId,
    name,
    currency,
    giftCount: 0,
    giftNetMinor: 0,
    pledgeCount: 0,
    pledgedMinor: 0,
  });
  for (const l of lines) {
    if (l.source !== 'online' && l.source !== 'qr') continue;
    bump(m, `${l.levelId ?? ''}|${l.currency}`, init(l.levelId, l.levelName, l.currency), (v) => ({
      ...v,
      giftCount: v.giftCount + 1,
      giftNetMinor: v.giftNetMinor + lineNet(l),
    }));
  }
  for (const p of pledges)
    bump(m, `${p.levelId ?? ''}|${p.currency}`, init(p.levelId, p.levelName, p.currency), (v) => ({
      ...v,
      name: v.name ?? p.levelName,
      pledgeCount: v.pledgeCount + 1,
      pledgedMinor: v.pledgedMinor + p.amountMinor,
    }));
  // Levels by money, own amounts (no level) last.
  return [...m.values()].sort(
    (a, b) =>
      Number(a.levelId === null) - Number(b.levelId === null) ||
      b.giftNetMinor + b.pledgedMinor - (a.giftNetMinor + a.pledgedMinor) ||
      (a.name ?? '').localeCompare(b.name ?? ''),
  );
}

/** Per donor, largest first; a donor who asked for anonymity on any gift is flagged. */
export function byDonor(lines: readonly DonationLine[]): DonorRow[] {
  const m = new Map<string, DonorRow>();
  for (const l of lines) {
    const key = donorKey(l);
    bump(
      m,
      `${key}|${l.currency}`,
      () => ({
        key,
        name: l.donorName,
        email: l.donorEmail,
        anonymous: false,
        currency: l.currency,
        count: 0,
        netMinor: 0,
      }),
      (v) => ({
        ...v,
        anonymous: v.anonymous || l.anonymous,
        count: v.count + 1,
        netMinor: v.netMinor + lineNet(l),
      }),
    );
  }
  return [...m.values()].sort((a, b) => b.netMinor - a.netMinor || a.name.localeCompare(b.name));
}

/** Pledged vs collected (card, link, offline) vs written off vs still open, per currency. */
export function pledgeSummary(pledges: readonly PledgeFact[]): PledgeRow[] {
  const m = new Map<string, PledgeRow>();
  for (const p of pledges)
    bump(
      m,
      p.currency,
      () => ({
        currency: p.currency,
        count: 0,
        pledgedMinor: 0,
        cardMinor: 0,
        linkMinor: 0,
        offlineMinor: 0,
        writtenOffMinor: 0,
        openMinor: 0,
      }),
      (v) => {
        const a = p.amountMinor;
        const card = p.status === 'paid' && p.paidBy !== 'link' ? a : 0;
        const link = p.status === 'paid' && p.paidBy === 'link' ? a : 0;
        const offline = p.status === 'paid_offline' ? a : 0;
        const off = p.status === 'written_off' ? a : 0;
        return {
          ...v,
          count: v.count + 1,
          pledgedMinor: v.pledgedMinor + a,
          cardMinor: v.cardMinor + card,
          linkMinor: v.linkMinor + link,
          offlineMinor: v.offlineMinor + offline,
          writtenOffMinor: v.writtenOffMinor + off,
          openMinor: v.openMinor + (a - card - link - offline - off),
        };
      },
    );
  return [...m.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export function currencyTotals(
  lines: readonly DonationLine[],
  pledges: readonly PledgeFact[],
  matches: readonly MatchFact[],
): CurrencyTotals[] {
  const currencies = new Set([
    ...lines.map((l) => l.currency),
    ...pledges.map((p) => p.currency),
    ...matches.filter((x) => x.status !== 'cancelled').map((x) => x.currency),
  ]);
  const pledgeRows = new Map(pledgeSummary(pledges).map((p) => [p.currency, p]));
  return [...currencies].sort().map((currency) => {
    const ls = lines.filter((l) => l.currency === currency);
    const sum = (f: (l: DonationLine) => number, keep: (l: DonationLine) => boolean = () => true) =>
      ls.filter(keep).reduce((n, l) => n + f(l), 0);
    const card = (l: DonationLine) => l.method === 'card' && l.source !== 'ticket';
    const onlineNetMinor = sum(lineNet, card);
    const offlineMinor = sum(lineNet, (l) => l.method !== 'card');
    const ticketMinor = sum(lineNet, (l) => l.source === 'ticket');
    const p = pledgeRows.get(currency);
    return {
      currency,
      onlineNetMinor,
      offlineMinor,
      ticketMinor,
      raisedMinor: onlineNetMinor + offlineMinor + ticketMinor,
      feeCoverMinor: sum((l) => l.feeCoverMinor, card),
      refundedMinor: sum((l) => l.refundedMinor, card),
      pledgedMinor: p?.pledgedMinor ?? 0,
      pledgeCollectedMinor: (p?.cardMinor ?? 0) + (p?.linkMinor ?? 0) + (p?.offlineMinor ?? 0),
      writtenOffMinor: p?.writtenOffMinor ?? 0,
      pledgeOpenMinor: p?.openMinor ?? 0,
      matchedMinor: matches
        .filter((x) => x.currency === currency && x.status !== 'cancelled')
        .reduce((n, x) => n + x.matchedMinor, 0),
      lineCount: ls.length,
      donorCount: new Set(ls.map(donorKey)).size,
    };
  });
}
