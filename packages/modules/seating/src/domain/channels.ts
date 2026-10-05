/**
 * Sales channels and allotments (M6.11b), pure: the same rules on the server and in the browser.
 *
 * A seat allotted to a channel is sold only through that channel until the channel's release
 * time; then (or when it is in no channel) any channel may sell it. A sale goes through exactly
 * one channel: online with a sponsor's or promoter's code → that channel; online without a code →
 * the event's `public` channel; the box office → the event's `box_office` channel. An event
 * without such a channel sells through "no channel", which only reaches seats in no channel.
 */

/** The kinds of sales channel (stored in `seat_channels.kind`). */
export const CHANNEL_KINDS = ['public', 'box_office', 'sponsor', 'promoter'] as const;
/** Channels sold through a code (the code is required for them, and only them). */
export const CODE_CHANNEL_KINDS = ['sponsor', 'promoter'] as const;

export const SALE_VIAS = ['online', 'box_office'] as const;
export type SaleVia = (typeof SALE_VIAS)[number];

export interface ChannelRef {
  readonly id: string;
  readonly kind: (typeof CHANNEL_KINDS)[number];
  readonly code: string | null;
  readonly releaseAt: Date | null;
}

/** Whether the channel still keeps its seats (its release time, if any, has not come). */
export function channelHolds(c: Pick<ChannelRef, 'releaseAt'>, now: Date): boolean {
  return c.releaseAt === null || c.releaseAt.getTime() > now.getTime();
}

/**
 * Whether a seat in `seatChannel` (null = in no channel) may be sold through `saleChannelId`
 * (null = no channel) at `now`.
 */
export function sellableThrough(
  seatChannel: Pick<ChannelRef, 'id' | 'releaseAt'> | null,
  saleChannelId: string | null,
  now: Date,
): boolean {
  if (!seatChannel || !channelHolds(seatChannel, now)) return true;
  return seatChannel.id === saleChannelId;
}

/** A code as typed → its stored form (upper-case, trimmed), or null when it can't be a code. */
export function normalizeChannelCode(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(v) ? v : null;
}

/**
 * The channel a sale goes through. A code (online only) must name one of the event's sponsor or
 * promoter channels: an unknown code is `invalid_code`, never a silent fallback to the public.
 */
export function saleChannel<C extends ChannelRef>(
  channels: readonly C[],
  sale: { readonly via: SaleVia; readonly code?: string | null },
): C | null | 'invalid_code' {
  if (sale.via === 'box_office') return channels.find((c) => c.kind === 'box_office') ?? null;
  if (sale.code !== undefined && sale.code !== null && sale.code.trim() !== '') {
    const code = normalizeChannelCode(sale.code);
    const hit = code ? channels.find((c) => c.code === code) : undefined;
    return hit ?? 'invalid_code';
  }
  return channels.find((c) => c.kind === 'public') ?? null;
}

/**
 * Seat numbers typed by an organizer ("1, 2, 5-8") → the set of labels, lower-cased. Ranges of
 * whole numbers expand (at most 500 per range); anything else is taken as a label.
 */
export function seatNumberList(v: string): Set<string> {
  const out = new Set<string>();
  for (const part of v.split(/[,;\s]+/)) {
    const p = part.trim().toLowerCase();
    if (!p) continue;
    const m = /^(\d{1,4})-(\d{1,4})$/.exec(p);
    if (m) {
      const from = Number(m[1]);
      const to = Number(m[2]);
      if (to >= from && to - from < 500) {
        for (let n = from; n <= to; n++) out.add(String(n));
        continue;
      }
    }
    out.add(p);
  }
  return out;
}
