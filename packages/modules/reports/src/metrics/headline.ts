import type { TenantTx } from '@yayatoh/db';
import type { EventDto } from '@yayatoh/events';
import { eventRowsTx } from './read.ts';

/** An event's headline numbers (M6.7a agency snapshots), from the same rows as the event's KPIs. */
export interface EventHeadline {
  readonly ordersSold: number;
  readonly ticketsValid: number;
  readonly checkins: number;
  /** Gross sales per currency, minor units (finance-gated by the caller). */
  readonly gross: Readonly<Record<string, number>>;
  /** `projection` (metric_snapshots) or `live` (the event has no projection yet). */
  readonly source: 'projection' | 'live';
}

/**
 * The event's projected headline numbers inside the caller's tenant transaction: orders sold,
 * valid tickets, tickets checked in and gross sales per currency. Read from `metric_snapshots`, or
 * live from the sources while the event has no projection (the same rule as `reports.eventKpis`).
 */
export async function eventHeadlineTx(tx: TenantTx, event: EventDto, now: Date): Promise<EventHeadline> {
  const rows = await eventRowsTx(tx, event, now);
  const v = (key: string) => rows.values.get(`${key}|`) ?? 0;
  const gross: Record<string, number> = {};
  for (const [k, value] of rows.values)
    if (k.startsWith('sales.gross|') && k.length > 'sales.gross|'.length && value !== 0)
      gross[k.slice('sales.gross|'.length)] = value;
  return {
    ordersSold: v('orders.sold'),
    ticketsValid: v('tickets.valid'),
    checkins: v('checkins.tickets'),
    gross,
    source: rows.live ? 'live' : 'projection',
  };
}
