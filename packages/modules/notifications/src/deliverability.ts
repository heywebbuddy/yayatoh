import type { TenantTx } from '@yayatoh/db';
import { type SQL, sql } from 'drizzle-orm';
import { PLATFORM_SENDER } from './transports.ts';

export * from './deliverability-rules.ts';

/**
 * Send and deliverability tallies for marketing analytics (M3.8b). Numbers only: no address,
 * subject or provider id leaves here. Every read runs inside the caller's tenant transaction, so
 * RLS keeps it to the org.
 *
 * **Campaign join point.** M3.6b campaigns queue one message per recipient under the dedupe key
 * `campaign:{campaignId}:{contactId}` (test sends use `campaign-test:` and are never counted).
 * The campaign id here is read from that key, so these tallies work before (and without) the
 * campaigns module; its tracked links carry the same id (`marketing.tracking_links.campaign_id`).
 */
export const CAMPAIGN_DEDUPE_PREFIX = 'campaign:';

/** The dedupe key of a campaign's message to one contact (the M3.6b convention). */
export const campaignDedupeKey = (campaignId: string, contactId: string) =>
  `${CAMPAIGN_DEDUPE_PREFIX}${campaignId}:${contactId}`;

/** The platform sender's domain (mail from orgs without a verified sending domain). */
export const PLATFORM_SENDER_DOMAIN = PLATFORM_SENDER.slice(PLATFORM_SENDER.indexOf('@') + 1);

export interface SendTally {
  /** Messages the provider accepted (status `sent`). */
  readonly sent: number;
  /** Their latest report says delivered (a complaint means it was delivered too). */
  readonly delivered: number;
  /** Messages with a bounce report (hard or soft). */
  readonly bounced: number;
  /** Messages with a complaint report. */
  readonly complained: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Row = { k: string | null; channel: string; sent: number; delivered: number; bounced: number; complained: number };

async function tallyTx(tx: TenantTx, key: SQL, where: SQL): Promise<Row[]> {
  const rows = await tx.execute<Row>(sql`
    select ${key} as k, m.channel,
      count(*)::int as sent,
      count(*) filter (where m.delivery in ('delivered', 'complained'))::int as delivered,
      count(*) filter (where exists (select 1 from notifications.message_events e
        where e.org_id = m.org_id and e.message_id = m.id and e.type = 'bounced'))::int as bounced,
      count(*) filter (where exists (select 1 from notifications.message_events e
        where e.org_id = m.org_id and e.message_id = m.id and e.type = 'complained'))::int as complained
    from notifications.messages m
    where m.status = 'sent' and ${where}
    group by 1, 2`);
  return rows.map((r) => ({
    k: r.k === null ? null : String(r.k),
    channel: String(r.channel),
    sent: Number(r.sent),
    delivered: Number(r.delivered),
    bounced: Number(r.bounced),
    complained: Number(r.complained),
  }));
}

const tally = (r: Row): SendTally => ({
  sent: r.sent,
  delivered: r.delivered,
  bounced: r.bounced,
  complained: r.complained,
});

const campaignKey = sql`split_part(m.dedupe_key, ':', 2)`;
const isCampaign = sql`m.dedupe_key like 'campaign:%'`;
const sentBetween = (from: Date, to: Date) =>
  sql`m.sent_at >= ${from.toISOString()}::timestamptz and m.sent_at < ${to.toISOString()}::timestamptz`;

/** Each campaign's sends per channel, sent in `[from, to)`. */
export async function campaignSendStatsTx(
  tx: TenantTx,
  range: { readonly from: Date; readonly to: Date },
): Promise<Array<SendTally & { readonly campaignId: string; readonly channel: string }>> {
  const rows = await tallyTx(tx, campaignKey, sql`${isCampaign} and ${sentBetween(range.from, range.to)}`);
  return rows.flatMap((r) => (r.k && UUID.test(r.k) ? [{ campaignId: r.k, channel: r.channel, ...tally(r) }] : []));
}

export interface DeliverabilityBreakdown {
  readonly from: Date;
  readonly to: Date;
  /** All the org's email in the window. */
  readonly org: SendTally;
  /** Per sending domain (`null` = sent before the domain was recorded). */
  readonly domains: ReadonlyArray<SendTally & { readonly domain: string | null; readonly platform: boolean }>;
  /** Per campaign (M3.6b sends), email only. */
  readonly campaigns: ReadonlyArray<SendTally & { readonly campaignId: string }>;
}

/**
 * Email deliverability over a trailing window (the alert engine's window by default): the org,
 * each sending domain and each campaign. Rates are the caller's (basis points of `sent`).
 */
export async function deliverabilityBreakdownTx(
  tx: TenantTx,
  now: Date,
  windowMs: number,
): Promise<DeliverabilityBreakdown> {
  const from = new Date(now.getTime() - windowMs);
  const where = sql`m.channel = 'email' and ${sentBetween(from, new Date(now.getTime() + 1))}`;
  const [byDomain, byCampaign] = await Promise.all([
    tallyTx(tx, sql`m.sender_domain`, where),
    tallyTx(tx, campaignKey, sql`${where} and ${isCampaign}`),
  ]);
  const org = byDomain.reduce(
    (a, r) => ({
      sent: a.sent + r.sent,
      delivered: a.delivered + r.delivered,
      bounced: a.bounced + r.bounced,
      complained: a.complained + r.complained,
    }),
    { sent: 0, delivered: 0, bounced: 0, complained: 0 },
  );
  return {
    from,
    to: now,
    org,
    domains: byDomain
      .map((r) => ({ domain: r.k, platform: r.k === PLATFORM_SENDER_DOMAIN, ...tally(r) }))
      .sort((a, b) => b.sent - a.sent || String(a.domain).localeCompare(String(b.domain))),
    campaigns: byCampaign
      .flatMap((r) => (r.k && UUID.test(r.k) ? [{ campaignId: r.k, ...tally(r) }] : []))
      .sort((a, b) => b.sent - a.sent || a.campaignId.localeCompare(b.campaignId)),
  };
}
