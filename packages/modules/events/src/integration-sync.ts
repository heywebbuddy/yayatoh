import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import { events } from './schema.ts';

/**
 * Events for marketing-tool syncs (M6.4d: HubSpot marketing events). Drafts never leave Yayatoh;
 * the push reads the rest in id order and sends what changed.
 */

export interface EventSyncRow {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timezone: string;
  readonly venueName: string | null;
  readonly city: string | null;
  readonly updatedAt: Date;
}

const COLUMNS = {
  id: events.id,
  name: events.name,
  status: events.status,
  startsAt: events.startsAt,
  endsAt: events.endsAt,
  timezone: events.timezone,
  venueName: events.venueName,
  city: events.city,
  updatedAt: events.updatedAt,
};

/** Events that are not drafts, after `afterId` in id order, one page. */
export async function eventsForSyncAfterTx(
  tx: TenantTx,
  afterId: string | null,
  limit: number,
): Promise<EventSyncRow[]> {
  return tx
    .select(COLUMNS)
    .from(events)
    .where(and(ne(events.status, 'draft'), afterId ? gt(events.id, afterId) : undefined))
    .orderBy(asc(events.id))
    .limit(Math.max(1, Math.min(limit, 500)));
}

/** One event for a sync (null when unknown or a draft). */
export async function eventForSyncTx(tx: TenantTx, eventId: string): Promise<EventSyncRow | null> {
  const [row] = await tx
    .select(COLUMNS)
    .from(events)
    .where(and(eq(events.id, eventId), ne(events.status, 'draft')));
  return row ?? null;
}
