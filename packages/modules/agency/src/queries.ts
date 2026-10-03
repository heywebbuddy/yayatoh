import { tenantQuery } from '@yayatoh/platform';
import { AGENCY_GRANT_ROLES, agencyClientGrantsTx } from '@yayatoh/tenancy';
import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { checkinBps } from './domain.ts';
import { clientSnapshots, eventSnapshots } from './schema.ts';

/**
 * The agency's pages (M6.7a). Each reads only the agency's own snapshot rows, joined in memory to
 * the **live** grant list (`tenancy.agency_client_grants()`): a revoked client disappears at once,
 * and money shows only while the client's finance opt-in is on (and was on when computed).
 */

const Count = z.int().min(0);

export const ClientSnapshotDto = z.object({
  eventsTotal: Count,
  eventsUpcoming: Count,
  eventsLive: Count,
  nextEventName: z.string().nullable(),
  nextEventAt: z.date().nullable(),
  ordersSold: Count,
  ticketsValid: Count,
  checkins: Count,
  checkinBps: Count,
  campaigns: Count,
  sends: Count,
  deliveries: Count,
  clicks: Count,
  uniqueClickers: Count,
  conversionBps: Count,
  /** Gross sales per currency (minor units); null without the client's finance opt-in. */
  revenue: z.record(z.string().regex(/^[A-Z]{3}$/), z.int()).nullable(),
  refreshedAt: z.date(),
});
export type ClientSnapshotDto = z.infer<typeof ClientSnapshotDto>;

export const AgencyClientDto = z.object({
  clientOrgId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  timezone: z.string(),
  role: z.enum(AGENCY_GRANT_ROLES),
  finance: z.boolean(),
  grantedAt: z.date(),
  /** Null until the first refresh after the grant. */
  snapshot: ClientSnapshotDto.nullable(),
});
export type AgencyClientDto = z.infer<typeof AgencyClientDto>;

export const agencyClientsQuery = tenantQuery({
  name: 'agency.clients',
  input: z.object({}),
  output: z.array(AgencyClientDto),
  entitlement: 'agency',
  permission: 'agency:read',
  handler: async ({ tx }) => {
    const grants = await agencyClientGrantsTx(tx);
    if (grants.length === 0) return [];
    const rows = await tx.select().from(clientSnapshots);
    const byClient = new Map(rows.map((r) => [r.clientOrgId, r]));
    return grants.map((g) => {
      const s = byClient.get(g.clientOrgId);
      return {
        clientOrgId: g.clientOrgId,
        slug: g.slug,
        name: g.name,
        status: g.status,
        timezone: g.timezone,
        role: g.role,
        finance: g.finance,
        grantedAt: g.grantedAt,
        snapshot: s
          ? {
              eventsTotal: s.eventsTotal,
              eventsUpcoming: s.eventsUpcoming,
              eventsLive: s.eventsLive,
              nextEventName: s.nextEventName,
              nextEventAt: s.nextEventAt,
              ordersSold: s.ordersSold,
              ticketsValid: s.ticketsValid,
              checkins: s.checkins,
              checkinBps: checkinBps(s.checkins, s.ticketsValid),
              campaigns: s.campaigns,
              sends: s.sends,
              deliveries: s.deliveries,
              clicks: s.clicks,
              uniqueClickers: s.uniqueClickers,
              conversionBps: s.conversionBps,
              // Money only while the live grant still has the finance opt-in.
              revenue: g.finance && s.withFinance ? (s.revenue ?? {}) : null,
              refreshedAt: s.refreshedAt,
            }
          : null,
      };
    });
  },
});

export const AgencyEventDto = z.object({
  clientOrgId: z.uuid(),
  clientSlug: z.string(),
  clientName: z.string(),
  eventId: z.uuid(),
  name: z.string(),
  slug: z.string(),
  status: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string(),
  ordersSold: Count,
  ticketsValid: Count,
  checkins: Count,
  /** Null without the client's finance opt-in. */
  grossMinor: z.int().nullable(),
  currency: z.string(),
  refreshedAt: z.date(),
});
export type AgencyEventDto = z.infer<typeof AgencyEventDto>;

/** Client events across every live client, soonest first. */
export const agencyEventsQuery = tenantQuery({
  name: 'agency.events',
  input: z.object({}),
  output: z.array(AgencyEventDto),
  entitlement: 'agency',
  permission: 'agency:read',
  handler: async ({ tx }) => {
    const grants = new Map((await agencyClientGrantsTx(tx)).map((g) => [g.clientOrgId, g]));
    if (grants.size === 0) return [];
    const rows = await tx
      .select()
      .from(eventSnapshots)
      .orderBy(asc(eventSnapshots.startsAt), asc(eventSnapshots.id));
    return rows.flatMap((r) => {
      const g = grants.get(r.clientOrgId);
      if (!g) return [];
      return [
        {
          clientOrgId: r.clientOrgId,
          clientSlug: g.slug,
          clientName: g.name,
          eventId: r.eventId,
          name: r.name,
          slug: r.slug,
          status: r.status,
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          timezone: r.timezone,
          ordersSold: r.ordersSold,
          ticketsValid: r.ticketsValid,
          checkins: r.checkins,
          grossMinor: g.finance ? r.grossMinor : null,
          currency: r.currency,
          refreshedAt: r.refreshedAt,
        },
      ];
    });
  },
});
