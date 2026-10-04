import { dailyCheckinFactsTx } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { eventIdsStartingBetweenTx, findEventTx, upcomingEventIdsTx } from '@yayatoh/events';
import { salesByEventTx } from '@yayatoh/orders';
import { organizationNameTx } from '@yayatoh/tenancy';
import type { DigestFacts, MoneyAmount } from './render.ts';
import { addDays, dayBounds } from './schedule.ts';

/** Events whose check-ins the digest counts: those that started up to this many days earlier. */
const CHECKIN_LOOKBACK_DAYS = 7;
/** Event names the digest looks up (the rest are counted only). */
const NAMED = 50;

/**
 * The daily digest's facts (M6.4c) for the digest sent on `day` (`YYYY-MM-DD` in the org's zone):
 * the previous day's sales per event and check-ins, and the events starting on `day`. Counts,
 * amounts (shown only on opt-in) and event names: never anything about a person.
 */
export async function digestFactsTx(
  tx: TenantTx,
  orgId: string,
  day: string,
  timeZone: string,
  url: string,
): Promise<DigestFacts> {
  const covered = addDays(day, -1);
  const span = dayBounds(covered, timeZone);
  const today = dayBounds(day, timeZone);
  const [orgName, sales, recent, todayIds] = await Promise.all([
    organizationNameTx(tx, orgId),
    salesByEventTx(tx, span),
    eventIdsStartingBetweenTx(
      tx,
      new Date(span.from.getTime() - CHECKIN_LOOKBACK_DAYS * 86_400_000),
      span.to,
    ),
    upcomingEventIdsTx(tx, today.from, today.to),
  ]);
  const byEvent = new Map<string, { orders: number; tickets: number; gross: MoneyAmount[] }>();
  const totals = { orders: 0, tickets: 0, gross: new Map<string, number>() };
  for (const s of sales) {
    const e = byEvent.get(s.eventId) ?? { orders: 0, tickets: 0, gross: [] };
    const tickets = s.tickets + s.compTickets;
    e.orders += s.orders;
    e.tickets += tickets;
    if (s.grossMinor !== 0) e.gross.push({ currency: s.currency, minor: s.grossMinor });
    byEvent.set(s.eventId, e);
    totals.orders += s.orders;
    totals.tickets += tickets;
    totals.gross.set(s.currency, (totals.gross.get(s.currency) ?? 0) + s.grossMinor);
  }
  const ranked = [...byEvent.entries()].sort(
    (a, b) => b[1].tickets - a[1].tickets || a[0].localeCompare(b[0]),
  );
  const named = await Promise.all(ranked.slice(0, NAMED).map(([id]) => findEventTx(tx, id)));
  const checkins = (await Promise.all(recent.map((id) => dailyCheckinFactsTx(tx, id, timeZone)))).reduce(
    (n, days) => n + (days.find((d) => d.day === covered)?.tickets ?? 0),
    0,
  );
  const todays = (await Promise.all(todayIds.map((id) => findEventTx(tx, id))))
    .filter((e) => e !== null && e.startsAt >= today.from && e.startsAt < today.to)
    .flatMap((e) => (e ? [{ name: e.name, startsAt: e.startsAt, timeZone: e.timezone }] : []))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return {
    orgName: orgName ?? '',
    day: covered,
    totals: {
      orders: totals.orders,
      tickets: totals.tickets,
      gross: [...totals.gross.entries()]
        .filter(([, minor]) => minor !== 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, minor]) => ({ currency, minor })),
    },
    events: ranked.map(([, e], i) => ({
      name: named[i]?.name ?? '',
      tickets: e.tickets,
      gross: e.gross,
    })),
    checkins,
    today: todays,
    url,
  };
}
