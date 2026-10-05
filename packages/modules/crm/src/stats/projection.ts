import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { and, asc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
import {
  type ContactSignalKind,
  contactScores,
  contactSignals,
  contactStats,
  contacts,
  eventParticipation,
} from '../schema.ts';
import type { ComputedCurrencyStats, ComputedScores, StatsParticipation, StatsSignals } from './compute.ts';

/** Participation rows of these contacts, grouped per contact (the stats' main input). */
export async function statsParticipationTx(
  tx: TenantTx,
  contactIds: readonly string[],
): Promise<Map<string, StatsParticipation[]>> {
  const out = new Map<string, StatsParticipation[]>();
  if (contactIds.length === 0) return out;
  const rows = await tx
    .select({
      contactId: eventParticipation.contactId,
      eventId: eventParticipation.eventId,
      registered: eventParticipation.registered,
      checkedIn: eventParticipation.checkedIn,
      tickets: eventParticipation.tickets,
      orders: eventParticipation.orders,
      spendMinor: eventParticipation.spendMinor,
      currency: eventParticipation.currency,
      registeredAt: eventParticipation.registeredAt,
    })
    .from(eventParticipation)
    .where(inArray(eventParticipation.contactId, [...contactIds]));
  for (const { contactId, ...r } of rows) {
    const list = out.get(contactId) ?? [];
    list.push(r);
    out.set(contactId, list);
  }
  return out;
}

/** Distinct sessions attended and campaigns opened per contact, and when signals began and ended. */
export async function signalTotalsTx(
  tx: TenantTx,
  contactIds: readonly string[],
): Promise<Map<string, StatsSignals>> {
  const out = new Map<string, StatsSignals>();
  if (contactIds.length === 0) return out;
  const rows = await tx
    .select({
      contactId: contactSignals.contactId,
      sessions: sql<number>`count(*) filter (where ${contactSignals.kind} = 'session_attended')::int`,
      campaigns: sql<number>`count(*) filter (where ${contactSignals.kind} = 'campaign_opened')::int`,
      firstAt: sql<Date | string>`min(${contactSignals.occurredAt})`,
      lastAt: sql<Date | string>`max(${contactSignals.occurredAt})`,
    })
    .from(contactSignals)
    .where(inArray(contactSignals.contactId, [...contactIds]))
    .groupBy(contactSignals.contactId);
  for (const r of rows)
    out.set(r.contactId, {
      sessionsAttended: Number(r.sessions),
      campaignsOpened: Number(r.campaigns),
      firstAt: new Date(r.firstAt),
      lastAt: new Date(r.lastAt),
    });
  return out;
}

export const NO_SIGNALS: StatsSignals = {
  sessionsAttended: 0,
  campaignsOpened: 0,
  firstAt: null,
  lastAt: null,
};

/**
 * Record a signal (M6.1b): exactly once per (contact, kind, ref), so a replayed event changes
 * nothing. Returns whether the row is new. An unknown contact (RLS hides other orgs') is skipped.
 */
export async function recordContactSignalTx(
  tx: TenantTx,
  ctx: Ctx,
  s: {
    readonly contactId: string;
    readonly kind: ContactSignalKind;
    readonly refId: string;
    readonly eventId?: string | null;
    readonly occurredAt: Date;
  },
): Promise<boolean> {
  const orgId = requireOrg(ctx);
  const [known] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, s.contactId));
  if (!known) return false;
  const rows = await tx
    .insert(contactSignals)
    .values({
      orgId,
      contactId: s.contactId,
      kind: s.kind,
      refId: s.refId,
      eventId: s.eventId ?? null,
      occurredAt: s.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: contactSignals.id });
  return rows.length > 0;
}

/**
 * Write freshly computed stats for these contacts: `contact_scores` is upserted (or removed when a
 * contact has nothing left to count), and their `contact_stats` rows (lifetime value per
 * currency, `source = 'live'`) are replaced. Idempotent: the same input gives the same rows.
 */
export async function writeContactStatsTx(
  tx: TenantTx,
  ctx: Ctx,
  results: ReadonlyMap<string, { scores: ComputedScores; currencies: ComputedCurrencyStats[] } | null>,
): Promise<number> {
  const orgId = requireOrg(ctx);
  let written = 0;
  const empty = [...results].filter(([, v]) => v === null).map(([id]) => id);
  if (empty.length) {
    await tx.delete(contactScores).where(inArray(contactScores.contactId, empty));
    await tx.delete(contactStats).where(inArray(contactStats.contactId, empty));
  }
  for (const [contactId, r] of results) {
    if (!r) continue;
    written += 1;
    const s = r.scores;
    const values = {
      events: s.events,
      eventsRegistered: s.eventsRegistered,
      eventsAttended: s.eventsAttended,
      pastRegistered: s.pastRegistered,
      noShows: s.noShows,
      sessionsAttended: s.sessionsAttended,
      campaignsOpened: s.campaignsOpened,
      orders: s.orders,
      monetaryMinor: s.monetaryMinor,
      monetaryCurrency: s.monetaryCurrency,
      firstSeenAt: s.firstSeenAt,
      lastSeenAt: s.lastSeenAt,
      engagementScore: s.engagementScore,
      noShowBps: s.noShowBps,
      computedAt: ctx.now,
    };
    await tx
      .insert(contactScores)
      .values({ orgId, contactId, ...values })
      .onConflictDoUpdate({
        target: [contactScores.orgId, contactScores.contactId],
        set: { ...values, updatedAt: ctx.now },
      });
    const keep = r.currencies.map((c) => c.currency);
    await tx
      .delete(contactStats)
      .where(
        and(
          eq(contactStats.contactId, contactId),
          keep.length ? notInArray(contactStats.currency, keep) : undefined,
        ),
      );
    for (const c of r.currencies) {
      const row = {
        orders: c.orders,
        tickets: c.tickets,
        events: c.events,
        eventsAttended: c.eventsAttended,
        spendMinor: c.spendMinor,
        firstSeenAt: c.firstSeenAt,
        lastSeenAt: c.lastSeenAt,
      };
      // A row the legacy backfill wrote keeps its source (its next run rebuilds it the same way).
      await tx
        .insert(contactStats)
        .values({ orgId, contactId, currency: c.currency, source: 'live', ...row })
        .onConflictDoUpdate({
          target: [contactStats.orgId, contactStats.contactId, contactStats.currency],
          set: { ...row, updatedAt: ctx.now },
        });
    }
  }
  return written;
}

/**
 * One page of the org's contacts that have (or had) something to count, ordered by id (the
 * backfill and the daily rescore walk the org with it).
 */
export async function statsContactPageTx(
  tx: TenantTx,
  afterId: string | null,
  limit: number,
): Promise<string[]> {
  const rows = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        afterId ? gt(contacts.id, afterId) : undefined,
        sql`(exists (select 1 from crm.event_participation p where p.contact_id = ${contacts.id})
          or exists (select 1 from crm.contact_signals g where g.contact_id = ${contacts.id})
          or exists (select 1 from crm.contact_scores s where s.contact_id = ${contacts.id}))`,
      ),
    )
    .orderBy(asc(contacts.id))
    .limit(limit);
  return rows.map((r) => r.id);
}
