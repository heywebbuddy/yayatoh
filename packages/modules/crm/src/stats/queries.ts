import { defineSerializer } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { DomainError } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { asc, eq, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { contactScores, contactStats, contacts } from '../schema.ts';
import {
  ENGAGEMENT_BANDS,
  FREQUENCY_BANDS,
  NO_SHOW_BANDS,
  NO_SHOW_PRIOR_BPS,
  RECENCY_DAYS,
} from './formulas.ts';
import { RFM_SQL } from './rfm.ts';

/**
 * M6.1b reads. Stats without money need `contacts:read`; lifetime value (and the RFM monetary
 * quintile, which ranks spending) needs `finance:read` and lives in separate queries, so a role
 * without finance permission can never receive an amount.
 */

const Quintile = z.int().min(1).max(5);

export const ContactStatsDto = z.object({
  contactId: z.uuid(),
  name: z.string().nullable(),
  email: z.string(),
  /** False for a contact merged into another or erased (their stats stop counting). */
  live: z.boolean(),
  events: z.int(),
  eventsRegistered: z.int(),
  eventsAttended: z.int(),
  pastRegistered: z.int(),
  noShows: z.int(),
  sessionsAttended: z.int(),
  campaignsOpened: z.int(),
  firstSeenAt: z.date().nullable(),
  lastSeenAt: z.date().nullable(),
  engagementScore: z.int(),
  noShowBps: z.int(),
  /** RFM recency and frequency quintiles in the org; null outside the population (no events). */
  rfm: z.object({ recency: Quintile, frequency: Quintile }).nullable(),
  computedAt: z.date().nullable(),
});
export type ContactStatsDto = z.infer<typeof ContactStatsDto>;
const contactStatsSerializer = defineSerializer('crm.contactStats', ContactStatsDto);

export const ContactValueDto = z.object({
  contactId: z.uuid(),
  /** Lifetime value per currency (paid orders as the buyer, net of refunds), largest first. */
  lifetime: z.array(z.object({ currency: z.string(), amountMinor: z.int(), orders: z.int() })),
  monetaryQuintile: Quintile.nullable(),
  monetaryCurrency: z.string().nullable(),
});
export type ContactValueDto = z.infer<typeof ContactValueDto>;
const contactValueSerializer = defineSerializer('crm.contactValue', ContactValueDto);

const ERASED = '%@erased.invalid';

async function contactRowTx(tx: TenantTx, contactId: string) {
  const [c] = await tx
    .select({ id: contacts.id, name: contacts.name, email: contacts.email, mergedInto: contacts.mergedInto })
    .from(contacts)
    .where(eq(contacts.id, contactId));
  if (!c) throw new DomainError('not_found', 'Contact not found');
  return c;
}

async function rfmOfTx(tx: TenantTx, contactId: string) {
  const [r] = await tx.execute<{ recency: number; frequency: number; monetary: number }>(
    sql`select q.recency, q.frequency, q.monetary from ${RFM_SQL} q where q.contact_id = ${contactId}`,
  );
  return r
    ? { recency: Number(r.recency), frequency: Number(r.frequency), monetary: Number(r.monetary) }
    : null;
}

/** One contact's stats (the contact page and the timeline header). */
export const contactStatsQuery = tenantQuery({
  name: 'crm.contactStats',
  input: z.object({ contactId: z.uuid() }),
  output: ContactStatsDto,
  entitlement: 'core',
  permission: 'contacts:read',
  handler: async ({ input, tx }) => {
    const c = await contactRowTx(tx, input.contactId);
    const [s] = await tx.select().from(contactScores).where(eq(contactScores.contactId, c.id));
    const rfm = await rfmOfTx(tx, c.id);
    return contactStatsSerializer.serialize({
      contactId: c.id,
      name: c.name,
      email: c.email,
      live: c.mergedInto === null && !c.email.endsWith('@erased.invalid'),
      events: s?.events ?? 0,
      eventsRegistered: s?.eventsRegistered ?? 0,
      eventsAttended: s?.eventsAttended ?? 0,
      pastRegistered: s?.pastRegistered ?? 0,
      noShows: s?.noShows ?? 0,
      sessionsAttended: s?.sessionsAttended ?? 0,
      campaignsOpened: s?.campaignsOpened ?? 0,
      firstSeenAt: s?.firstSeenAt ?? null,
      lastSeenAt: s?.lastSeenAt ?? null,
      engagementScore: s?.engagementScore ?? 0,
      noShowBps: s?.noShowBps ?? NO_SHOW_PRIOR_BPS,
      rfm: rfm ? { recency: rfm.recency, frequency: rfm.frequency } : null,
      computedAt: s?.computedAt ?? null,
    });
  },
});

/** One contact's lifetime value and RFM monetary quintile: finance only. */
export const contactValueQuery = tenantQuery({
  name: 'crm.contactValue',
  input: z.object({ contactId: z.uuid() }),
  output: ContactValueDto,
  entitlement: 'core',
  permission: 'finance:read',
  handler: async ({ input, tx }) => {
    const c = await contactRowTx(tx, input.contactId);
    const rows = await tx
      .select({
        currency: contactStats.currency,
        spend: contactStats.spendMinor,
        orders: contactStats.orders,
      })
      .from(contactStats)
      .where(eq(contactStats.contactId, c.id))
      .orderBy(asc(contactStats.currency));
    const [s] = await tx
      .select({ currency: contactScores.monetaryCurrency })
      .from(contactScores)
      .where(eq(contactScores.contactId, c.id));
    const rfm = await rfmOfTx(tx, c.id);
    return contactValueSerializer.serialize({
      contactId: c.id,
      lifetime: rows
        .map((r) => ({ currency: r.currency, amountMinor: Number(r.spend), orders: r.orders }))
        .sort((a, b) => b.amountMinor - a.amountMinor || a.currency.localeCompare(b.currency)),
      monetaryQuintile: rfm?.monetary ?? null,
      monetaryCurrency: s?.currency ?? null,
    });
  },
});

const Band = z.object({ from: z.int(), count: z.int() });

export const OrgContactStatsDto = z.object({
  /** Live contacts (not merged, not erased). */
  contacts: z.int(),
  /** Live contacts with stats (took part in an event or left a signal). */
  withActivity: z.int(),
  /** Took part in at least one event (the RFM population). */
  participants: z.int(),
  attendedAny: z.int(),
  eventsRegistered: z.int(),
  eventsAttended: z.int(),
  sessionsAttended: z.int(),
  campaignsOpened: z.int(),
  /** Average engagement score of contacts with activity (rounded). */
  averageEngagement: z.int(),
  /** Org no-show rate over past registrations, in basis points (null without any). */
  noShowRateBps: z.int().nullable(),
  /** Distributions over contacts with activity; `from` is the band's lower bound. */
  engagement: z.array(Band),
  /** No-show propensity bands, in percent. */
  noShow: z.array(Band),
  /** Events taken part in (participants). */
  frequency: z.array(Band),
  /** Days since last seen: `from` is the band's upper bound in days, -1 = older. */
  recency: z.array(Band),
});
export type OrgContactStatsDto = z.infer<typeof OrgContactStatsDto>;
const orgStatsSerializer = defineSerializer('crm.orgContactStats', OrgContactStatsDto);

/** `case` over fixed numeric bands (constants, never input): the index of the band. */
const bandCase = (col: string, bands: readonly number[]) =>
  sql.raw(
    `case ${bands
      .map((b, i) => ({ b, i }))
      .reverse()
      .map(({ b, i }) => `when ${col} >= ${Number(b)} then ${i}`)
      .join(' ')} else 0 end`,
  );

const fill = (bands: readonly number[], rows: { band: number; n: number }[]) =>
  bands.map((from, i) => ({ from, count: Number(rows.find((r) => Number(r.band) === i)?.n ?? 0) }));

/** The org's contact totals and distributions (M6.1b org stats). No money. */
export const orgContactStatsQuery = tenantQuery({
  name: 'crm.orgContactStats',
  input: z.object({}),
  output: OrgContactStatsDto,
  entitlement: 'core',
  permission: 'contacts:read',
  handler: async ({ tx, ctx }) => {
    const live = sql`c.merged_into is null and c.email_norm not like ${ERASED}`;
    const [t] = await tx.execute<Record<string, number | string | null>>(sql`
      select
        (select count(*)::int from crm.contacts c where ${live}) as contacts,
        count(s.id)::int as with_activity,
        count(s.id) filter (where s.events > 0)::int as participants,
        count(s.id) filter (where s.events_attended > 0)::int as attended_any,
        coalesce(sum(s.events_registered), 0)::int as events_registered,
        coalesce(sum(s.events_attended), 0)::int as events_attended,
        coalesce(sum(s.sessions_attended), 0)::int as sessions_attended,
        coalesce(sum(s.campaigns_opened), 0)::int as campaigns_opened,
        coalesce(round(avg(s.engagement_score)), 0)::int as average_engagement,
        coalesce(sum(s.past_registered), 0)::int as past_registered,
        coalesce(sum(s.no_shows), 0)::int as no_shows
      from crm.contact_scores s join crm.contacts c on c.org_id = s.org_id and c.id = s.contact_id
      where ${live}`);
    const grouped = async (expr: SQL, where: SQL) =>
      tx.execute<{ band: number; n: number }>(sql`
        select ${expr} as band, count(*)::int as n
        from crm.contact_scores s join crm.contacts c on c.org_id = s.org_id and c.id = s.contact_id
        where ${live} and ${where} group by 1`);
    const engagement = await grouped(bandCase('s.engagement_score', ENGAGEMENT_BANDS), sql`true`);
    const noShow = await grouped(
      bandCase(
        's.no_show_bps',
        NO_SHOW_BANDS.map((p) => p * 100),
      ),
      sql`true`,
    );
    const frequency = await grouped(bandCase('s.events', FREQUENCY_BANDS), sql`s.events > 0`);
    const days = sql`floor(extract(epoch from (${ctx.now.toISOString()}::timestamptz - s.last_seen_at)) / 86400)`;
    const recency = await grouped(
      sql`case ${sql.join(
        RECENCY_DAYS.map((d, i) => sql`when ${days} <= ${d} then ${i}`),
        sql` `,
      )} else ${RECENCY_DAYS.length} end`,
      sql`s.last_seen_at is not null`,
    );
    const past = Number(t?.past_registered ?? 0);
    const noShows = Number(t?.no_shows ?? 0);
    return orgStatsSerializer.serialize({
      contacts: Number(t?.contacts ?? 0),
      withActivity: Number(t?.with_activity ?? 0),
      participants: Number(t?.participants ?? 0),
      attendedAny: Number(t?.attended_any ?? 0),
      eventsRegistered: Number(t?.events_registered ?? 0),
      eventsAttended: Number(t?.events_attended ?? 0),
      sessionsAttended: Number(t?.sessions_attended ?? 0),
      campaignsOpened: Number(t?.campaigns_opened ?? 0),
      averageEngagement: Number(t?.average_engagement ?? 0),
      noShowRateBps: past === 0 ? null : Math.floor((20_000 * noShows + past) / (2 * past)),
      engagement: fill(ENGAGEMENT_BANDS, engagement),
      noShow: fill(NO_SHOW_BANDS, noShow),
      frequency: fill(FREQUENCY_BANDS, frequency),
      recency: [...RECENCY_DAYS, -1].map((from, i) => ({
        from,
        count: Number(recency.find((r) => Number(r.band) === i)?.n ?? 0),
      })),
    });
  },
});

export const OrgValueDto = z.object({
  currencies: z.array(
    z.object({
      currency: z.string(),
      /** Live contacts who spent anything in this currency. */
      payers: z.int(),
      totalMinor: z.int(),
      averageMinor: z.int(),
      /** The smallest lifetime value in the top fifth of payers (the "M = 5" line). */
      topFifthFromMinor: z.int(),
      maxMinor: z.int(),
    }),
  ),
});
export type OrgValueDto = z.infer<typeof OrgValueDto>;
const orgValueSerializer = defineSerializer('crm.orgValue', OrgValueDto);

/** Lifetime value across the org, per currency: finance only. */
export const orgValueQuery = tenantQuery({
  name: 'crm.orgValue',
  input: z.object({}),
  output: OrgValueDto,
  entitlement: 'core',
  permission: 'finance:read',
  handler: async ({ tx }) => {
    const rows = await tx.execute<{
      currency: string;
      payers: number;
      total: string;
      average: string;
      top: string;
      max: string;
    }>(sql`
      select v.currency, count(*)::int as payers, sum(v.spend_minor)::text as total,
             (sum(v.spend_minor) / count(*))::bigint::text as average,
             (percentile_disc(0.8) within group (order by v.spend_minor))::text as top,
             max(v.spend_minor)::text as max
      from crm.contact_stats v join crm.contacts c on c.org_id = v.org_id and c.id = v.contact_id
      where v.spend_minor > 0 and c.merged_into is null and c.email_norm not like ${ERASED}
      group by v.currency order by sum(v.spend_minor) desc, v.currency`);
    return orgValueSerializer.serialize({
      currencies: rows.map((r) => ({
        currency: r.currency,
        payers: Number(r.payers),
        totalMinor: Number(r.total),
        averageMinor: Number(r.average),
        topFifthFromMinor: Number(r.top),
        maxMinor: Number(r.max),
      })),
    });
  },
});
