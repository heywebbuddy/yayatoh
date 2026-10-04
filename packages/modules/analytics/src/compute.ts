import { createHash } from 'node:crypto';
import { checkinFactsTx, dailyCheckinFactsTx } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { eventTouchPathsTx } from '@yayatoh/marketing';
import { dailyRefundFactsTx, dailySalesFactsTx, soldOrderDaysTx } from '@yayatoh/orders';
import { ticketTypeStatsTx } from '@yayatoh/ticketing';
import { attributionRowsOf, foldAttribution } from './attribution/models.ts';
import type { DailyMetric } from './schema.ts';
import { type DailyRow, type EventSnapshot, sortDaily } from './warehouse/port.ts';

/** `YYYY-MM-DD` of an instant in a time zone. */
export function dayIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Add rows that share a day, metric and currency; drop zeros; canonical order. */
export function foldDaily(rows: readonly DailyRow[]): DailyRow[] {
  const by = new Map<string, DailyRow>();
  for (const r of rows) {
    const k = `${r.day}|${r.metric}|${r.currency}`;
    const cur = by.get(k);
    by.set(k, cur ? { ...cur, value: cur.value + r.value } : { ...r });
  }
  return sortDaily([...by.values()].filter((r) => r.value !== 0));
}

/**
 * One event's warehouse snapshot, computed from the owning modules' exported reads inside the
 * caller's tenant transaction (M6.2a). Days are calendar days in `timeZone` (the org's):
 * - `orders` (sold orders, free ones included), `tickets` (paid tickets issued), `comp_tickets`
 *   and `gross` (per currency) by payment day — the same orders as the M1.12 sales facts;
 * - `refunded_tickets` and `refunds` (per currency) by the day the refund succeeded;
 * - `checkins`: each ticket with a live admission, on the day of its first one.
 * The state (valid tickets, tickets checked in, end) feeds no-shows. A missing event → `state: null`.
 * M6.2b: `attribution` — every model's share of each attributed sold order (marketing's touch
 * paths), by payment day, the same orders and days as `orders`.
 */
export async function computeEventSnapshotTx(
  tx: TenantTx,
  eventId: string,
  timeZone: string,
): Promise<EventSnapshot> {
  const event = await findEventTx(tx, eventId);
  if (!event) return { eventId, timeZone, daily: [], state: null, attribution: [] };
  const rows: DailyRow[] = [];
  const add = (day: string, metric: DailyMetric, value: number, currency = '') =>
    rows.push({ day, metric, currency, value });
  for (const s of await dailySalesFactsTx(tx, eventId, timeZone)) {
    add(s.day, 'orders', s.orders);
    add(s.day, s.comp ? 'comp_tickets' : 'tickets', s.tickets);
    add(s.day, 'gross', s.grossMinor, s.currency);
  }
  for (const r of await dailyRefundFactsTx(tx, eventId, timeZone)) {
    add(r.day, 'refunded_tickets', r.tickets);
    add(r.day, 'refunds', r.amountMinor, r.currency);
  }
  for (const c of await dailyCheckinFactsTx(tx, eventId, timeZone)) add(c.day, 'checkins', c.tickets);
  const types = await ticketTypeStatsTx(tx, eventId);
  const { tickets: checkedIn } = await checkinFactsTx(tx, { eventId });
  const paths = await eventTouchPathsTx(tx, eventId);
  const attribution = paths.length
    ? attributionRowsOf(await soldOrderDaysTx(tx, eventId, timeZone), paths)
    : [];
  return {
    eventId,
    timeZone,
    attribution,
    daily: foldDaily(rows),
    state: {
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      endDay: dayIn(event.endsAt, timeZone),
      validTickets: types.reduce((a, t) => a + t.valid, 0),
      checkedIn,
    },
  };
}

/** A stable content hash of a snapshot: equal hashes mean nothing to write. */
export function hashSnapshot(s: EventSnapshot): string {
  const canonical = JSON.stringify({
    e: s.eventId,
    tz: s.timeZone,
    d: foldDaily(s.daily).map((r) => [r.day, r.metric, r.currency, r.value]),
    s: s.state
      ? [
          s.state.startsAt.toISOString(),
          s.state.endsAt.toISOString(),
          s.state.endDay,
          s.state.validTickets,
          s.state.checkedIn,
        ]
      : null,
    // M6.2b: only when there is attribution, so the hashes of events without any stay as they were.
    ...(s.attribution?.length
      ? {
          a: foldAttribution(s.attribution).map((r) => [
            r.day,
            r.model,
            r.source,
            r.medium,
            r.campaign,
            r.linkId,
            r.currency,
            r.creditBps,
            r.revenueMinor,
          ]),
        }
      : {}),
  });
  return createHash('sha256').update(canonical).digest('hex');
}
