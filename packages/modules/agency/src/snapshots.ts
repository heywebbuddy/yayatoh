import { type TenantTx, withTenant } from '@yayatoh/db';
import { eventIdsTx, findEventTx, upcomingEventIdsTx } from '@yayatoh/events';
import { type Ctx, createCtx, requireOrg } from '@yayatoh/kernel';
import { analyticsReportTx } from '@yayatoh/marketing';
import { defineSubscriber, tenantCommand } from '@yayatoh/platform';
import { eventHeadlineTx } from '@yayatoh/reports';
import { type AgencyClientGrant, agencyClientGrantsTx, liveAgencyGrantTx } from '@yayatoh/tenancy';
import { and, eq, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { liveCount, nextEvent } from './domain.ts';
import { clientSnapshots, eventSnapshots } from './schema.ts';

/** Events a snapshot keeps per client: those ending in the last 30 days or later (at most 200). */
const RECENT_MS = 30 * 86_400_000;
const AHEAD_MS = 2 * 365 * 86_400_000;
/** Marketing figures cover the last 30 days in the client's time zone. */
const MARKETING_DAYS = 30;

const SNAPSHOT_ACTOR = 'agency.snapshots';

/** What one refresh computes for one client, inside the client's tenant (no money unless `finance`). */
export interface ComputedClient {
  readonly eventsTotal: number;
  readonly eventsUpcoming: number;
  readonly eventsLive: number;
  readonly nextEventName: string | null;
  readonly nextEventAt: Date | null;
  readonly ordersSold: number;
  readonly ticketsValid: number;
  readonly checkins: number;
  readonly campaigns: number;
  readonly sends: number;
  readonly deliveries: number;
  readonly clicks: number;
  readonly uniqueClickers: number;
  readonly conversionBps: number;
  readonly revenue: Record<string, number> | null;
  readonly events: readonly ComputedEvent[];
}

export interface ComputedEvent {
  readonly eventId: string;
  readonly name: string;
  readonly slug: string;
  readonly status: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timezone: string;
  readonly currency: string;
  readonly ordersSold: number;
  readonly ticketsValid: number;
  readonly checkins: number;
  readonly grossMinor: number | null;
}

/**
 * Compute a client's snapshot inside the client's own tenant transaction (`clientCtx` is a system
 * actor of the client org). It reads the client only through exported read functions and the
 * metric projections: events, `reports.metric_snapshots` (live while an event has none yet) and
 * the marketing analytics totals. Money (gross sales) is kept only when `finance` is on.
 */
export async function computeClientSnapshotTx(
  tx: TenantTx,
  clientCtx: Ctx,
  finance: boolean,
): Promise<ComputedClient> {
  const now = clientCtx.now;
  const total = (await eventIdsTx(tx)).length;
  const ids = await upcomingEventIdsTx(tx, new Date(now.getTime() - RECENT_MS), new Date(now.getTime() + AHEAD_MS));
  const events: ComputedEvent[] = [];
  const revenue: Record<string, number> = {};
  let ordersSold = 0;
  let ticketsValid = 0;
  let checkins = 0;
  for (const id of ids) {
    const event = await findEventTx(tx, id);
    if (!event) continue;
    const h = await eventHeadlineTx(tx, event, now);
    ordersSold += h.ordersSold;
    ticketsValid += h.ticketsValid;
    checkins += h.checkins;
    if (finance) for (const [cur, v] of Object.entries(h.gross)) revenue[cur] = (revenue[cur] ?? 0) + v;
    events.push({
      eventId: event.id,
      name: event.name,
      slug: event.slug,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      currency: event.currency,
      ordersSold: h.ordersSold,
      ticketsValid: h.ticketsValid,
      checkins: h.checkins,
      grossMinor: finance ? (h.gross[event.currency] ?? 0) : null,
    });
  }
  const marketing = await analyticsReportTx(tx, clientCtx, { days: MARKETING_DAYS, dimension: 'campaign' });
  const next = nextEvent(events, now);
  return {
    eventsTotal: total,
    eventsUpcoming: events.filter((e) => e.startsAt > now && e.status !== 'cancelled').length,
    eventsLive: liveCount(events, now),
    nextEventName: next?.name ?? null,
    nextEventAt: next?.startsAt ?? null,
    ordersSold,
    ticketsValid,
    checkins,
    campaigns: marketing.rows.length,
    sends: marketing.totals.sends ?? 0,
    deliveries: marketing.totals.deliveries ?? 0,
    clicks: marketing.totals.clicks,
    uniqueClickers: marketing.totals.uniqueClickers,
    conversionBps: marketing.totals.conversionBps,
    revenue: finance ? revenue : null,
    events,
  };
}

/** Write one client's computed snapshot into the agency's tenant transaction (replacing the old one). */
export async function writeClientSnapshotTx(
  tx: TenantTx,
  agencyOrgId: string,
  clientOrgId: string,
  grant: { grantId: string; finance: boolean },
  c: ComputedClient,
  now: Date,
): Promise<void> {
  const values = {
    grantId: grant.grantId,
    eventsTotal: c.eventsTotal,
    eventsUpcoming: c.eventsUpcoming,
    eventsLive: c.eventsLive,
    nextEventName: c.nextEventName,
    nextEventAt: c.nextEventAt,
    ordersSold: c.ordersSold,
    ticketsValid: c.ticketsValid,
    checkins: c.checkins,
    campaigns: c.campaigns,
    sends: c.sends,
    deliveries: c.deliveries,
    clicks: c.clicks,
    uniqueClickers: c.uniqueClickers,
    conversionBps: c.conversionBps,
    revenue: grant.finance ? c.revenue : null,
    withFinance: grant.finance,
    refreshedAt: now,
    updatedAt: now,
  };
  await tx
    .insert(clientSnapshots)
    .values({ orgId: agencyOrgId, clientOrgId, ...values })
    .onConflictDoUpdate({ target: [clientSnapshots.orgId, clientSnapshots.clientOrgId], set: values });
  await tx.delete(eventSnapshots).where(eq(eventSnapshots.clientOrgId, clientOrgId));
  if (c.events.length > 0)
    await tx.insert(eventSnapshots).values(
      c.events.map((e) => ({
        orgId: agencyOrgId,
        clientOrgId,
        ...e,
        grossMinor: grant.finance ? e.grossMinor : null,
        refreshedAt: now,
      })),
    );
}

/** Drop the agency's snapshots of clients it no longer holds a live grant from. */
async function pruneTx(tx: TenantTx, liveClientIds: readonly string[]): Promise<void> {
  if (liveClientIds.length === 0) {
    await tx.delete(eventSnapshots);
    await tx.delete(clientSnapshots);
    return;
  }
  await tx.delete(eventSnapshots).where(notInArray(eventSnapshots.clientOrgId, [...liveClientIds]));
  await tx.delete(clientSnapshots).where(notInArray(clientSnapshots.clientOrgId, [...liveClientIds]));
}

const clientCtxFor = (clientOrgId: string, now: Date) =>
  createCtx({ orgId: clientOrgId, actor: { type: 'system', name: SNAPSHOT_ACTOR }, now });

/** Compute a client under its own tenant (a separate transaction: the client's RLS, not the agency's). */
export function computeClient(g: AgencyClientGrant, now: Date): Promise<ComputedClient> {
  const ctx = clientCtxFor(g.clientOrgId, now);
  return withTenant(ctx, (tx) => computeClientSnapshotTx(tx, ctx, g.finance));
}

/**
 * Rebuild the agency's snapshots now (the Reports page's "Refresh", and after a grant): for every
 * live grant, the client's numbers computed under the client's tenant, written into the agency's.
 * Snapshots of clients whose grant ended are deleted. Runs only in an agency org (`agency`
 * entitlement); clients are found only through `tenancy.agency_client_grants()`.
 */
export const refreshAgencySnapshotsCommand = tenantCommand({
  name: 'agency.refreshSnapshots',
  input: z.object({}),
  output: z.object({ clients: z.int(), events: z.int(), refreshedAt: z.date() }),
  entitlement: 'agency',
  permission: 'agency:read',
  handler: async ({ ctx, tx }) => {
    const agencyOrgId = requireOrg(ctx);
    const grants = await agencyClientGrantsTx(tx);
    await pruneTx(
      tx,
      grants.map((g) => g.clientOrgId),
    );
    let events = 0;
    for (const g of grants) {
      const computed = await computeClient(g, ctx.now);
      await writeClientSnapshotTx(tx, agencyOrgId, g.clientOrgId, g, computed, ctx.now);
      events += computed.events.length;
    }
    return { clients: grants.length, events, refreshedAt: ctx.now };
  },
  audit: (_input, r) => ({
    action: 'agency.refreshSnapshots',
    targetType: 'agency_snapshots',
    targetId: null,
    data: { count: r.clients, total: r.events },
  }),
});

const GrantPayload = z.object({ grantId: z.uuid(), clientOrgId: z.uuid(), agencyOrgId: z.uuid() });

/**
 * Outbox subscriber (M6.7a): a new or changed grant snapshots that client for its agency at once,
 * and a revoked one removes the client's snapshots from the agency. It runs in the client's
 * transaction (the event's org), re-reads the grant there, and writes into the agency's tenant.
 */
export const agencySnapshotSubscriber = defineSubscriber({
  name: 'agency.snapshots',
  events: [
    'tenancy.agency_grant_created@1',
    'tenancy.agency_grant_changed@1',
    'tenancy.agency_grant_revoked@1',
  ],
  handle: async (tx, event) => {
    const p = GrantPayload.safeParse(event.payload);
    if (!p.success || p.data.clientOrgId !== event.orgId) return;
    const now = new Date();
    const agencyCtx = createCtx({ orgId: p.data.agencyOrgId, actor: { type: 'system', name: SNAPSHOT_ACTOR }, now });
    const grant = await liveAgencyGrantTx(tx, p.data.grantId);
    if (!grant || grant.agencyOrgId !== p.data.agencyOrgId) {
      await withTenant(agencyCtx, async (atx) => {
        await atx.delete(eventSnapshots).where(eq(eventSnapshots.clientOrgId, event.orgId));
        await atx
          .delete(clientSnapshots)
          .where(and(eq(clientSnapshots.clientOrgId, event.orgId), eq(clientSnapshots.grantId, p.data.grantId)));
      });
      return;
    }
    const computed = await computeClientSnapshotTx(tx, clientCtxFor(event.orgId, now), grant.finance);
    await withTenant(agencyCtx, (atx) =>
      writeClientSnapshotTx(atx, grant.agencyOrgId, event.orgId, grant, computed, now),
    );
  },
});
