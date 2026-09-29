import { compileForOrgTx, segmentDefinitionTx, templateDefinition } from '@yayatoh/audiences';
import { contactsForSendTx, marketingReachTx, normalizeEmail, segmentContactIdsTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, type DomainEvent, DomainError, requireOrg, uuidv7, zonedTimeToUtc } from '@yayatoh/kernel';
import { createTrackedLinkTx } from '@yayatoh/marketing';
import {
  cancelQueuedByPrefixTx,
  createNotifier,
  marketingSuppressionsTx,
  orgQuotaLimitsTx,
  queuedSinceByPrefixTx,
  sendOutcomesTx,
  storeContentTx,
} from '@yayatoh/notifications';
import { erasedAddressesTx, normalizeAddress, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { assertNotPausedTx, organizationBrandTx } from '@yayatoh/tenancy';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audienceOf, type CampaignRow, loadCampaignTx, toCampaignDto, transitionTx } from './campaigns.ts';
import {
  type CampaignChannel,
  CampaignContent,
  linkBlocks,
  MAX_TEST_ADDRESSES,
} from './domain/blocks.ts';
import { EXCLUSION_REASONS, type ExclusionReason, exclusionReason } from './domain/lifecycle.ts';
import { type CampaignEventInfo, ORIGIN_TOKEN, renderCampaign } from './domain/render.ts';
import { ratePerMinute } from './domain/scheduler.ts';
import { CampaignDto, type ReachDto, ReachDto as ReachDtoSchema } from './dto.ts';
import { campaignLinks, campaignRecipients, campaigns } from './schema.ts';

/** The largest audience one campaign may snapshot. */
export const MAX_RECIPIENTS = 200_000;
/** Test recipients per campaign per hour (test sends are not counted, but they are mail). */
export const TEST_SENDS_PER_HOUR = 20;
export const MIN_SCHEDULE_LEAD_MS = 60_000;
export const MAX_SCHEDULE_AHEAD_MS = 366 * 86_400_000;

/** Dedupe-key prefixes: a campaign's messages (results) and its test sends (never counted). */
export const sendPrefix = (campaignId: string) => `campaign:${campaignId}:`;
export const testPrefix = (campaignId: string) => `campaign-test:${campaignId}:`;

const notifier = createNotifier();

function contentOrThrow(row: CampaignRow): CampaignContent {
  const c = CampaignContent.safeParse(row.content);
  if (!c.success) throw new DomainError('invalid_state', 'The campaign needs fixing', { reason: 'content_invalid' });
  if (row.channel !== 'email' && !c.data.smsBody)
    throw new DomainError('validation_failed', 'A text message is required', {
      field: 'smsBody',
      reason: 'sms_body_required',
    });
  return c.data;
}

/** The audience's contact ids now (the snapshot's input). */
async function audienceContactIdsTx(tx: TenantTx, orgId: string, row: CampaignRow): Promise<string[]> {
  const a = audienceOf(row);
  if (!a) throw new DomainError('invalid_state', 'Choose an audience first', { reason: 'no_audience' });
  let definition: Awaited<ReturnType<typeof segmentDefinitionTx>>;
  try {
    definition =
      a.kind === 'segment'
        ? await segmentDefinitionTx(tx, a.segmentId)
        : templateDefinition(a.templateKey, { eventId: a.eventId, ticketTypeIds: a.ticketTypeIds });
  } catch (err) {
    if (err instanceof DomainError)
      throw new DomainError('invalid_state', 'The audience is gone', { reason: 'audience_missing' });
    throw err;
  }
  const where = await compileForOrgTx(tx, orgId, definition, null);
  const ids = await segmentContactIdsTx(tx, where, MAX_RECIPIENTS + 1);
  if (ids.length > MAX_RECIPIENTS)
    throw new DomainError('invalid_state', 'The audience is too large', { reason: 'audience_too_large' });
  return ids;
}

/**
 * Who in the audience gets the campaign (M3.6b snapshot rules): an address for the channel, not
 * erased, not suppressed (bounce, complaint), not unsubscribed from marketing, and express
 * marketing consent for the channel in the crm ledger. Everyone else is counted by reason.
 */
export async function reachTx(
  tx: TenantTx,
  orgId: string,
  row: CampaignRow,
): Promise<{ contactId: string; reason: ExclusionReason | null }[]> {
  const channel = row.channel as CampaignChannel;
  const ids = await audienceContactIdsTx(tx, orgId, row);
  const reach = await marketingReachTx(tx, ids, channel);
  const addressOf = (r: (typeof reach)[number]) =>
    channel === 'email' ? normalizeEmail(r.email) : (r.phone?.trim() ?? null);
  const addresses = reach.map(addressOf).filter((a): a is string => Boolean(a));
  const blocked = await marketingSuppressionsTx(tx, channel, addresses);
  const erased = channel === 'email' ? await erasedAddressesTx(tx, addresses) : new Map();
  return reach.map((r) => {
    const address = addressOf(r);
    const e = address && channel === 'email' ? erased.get(normalizeAddress(address)) : undefined;
    const reconsented = Boolean(e && r.consent === 'granted' && r.consentAt && r.consentAt > e.erasedAt);
    return {
      contactId: r.contactId,
      reason: exclusionReason({
        address,
        consent: r.consent,
        suppressed: address ? blocked.get(address) === 'suppressed' : false,
        unsubscribed: address ? blocked.get(address) === 'unsubscribed' : false,
        erased: Boolean(e) && !reconsented,
      }),
    };
  });
}

export function summarizeReach(rows: readonly { reason: ExclusionReason | null }[]): ReachDto {
  const by = new Map<ExclusionReason, number>();
  for (const r of rows) if (r.reason) by.set(r.reason, (by.get(r.reason) ?? 0) + 1);
  return {
    total: rows.length,
    eligible: rows.filter((r) => !r.reason).length,
    excluded: EXCLUSION_REASONS.filter((k) => by.has(k)).map((reason) => ({ reason, count: by.get(reason) ?? 0 })),
  };
}

/** "Who would get it if you sent now": the snapshot rules without writing anything. */
export const estimateReachQuery = tenantQuery({
  name: 'campaigns.estimateReach',
  input: z.object({ campaignId: z.uuid() }),
  output: ReachDtoSchema,
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId);
    return summarizeReach(await reachTx(tx, requireOrg(ctx), row));
  },
});

/** Event facts for event cards. */
async function eventInfosTx(tx: TenantTx, content: CampaignContent) {
  const out = new Map<string, CampaignEventInfo>();
  for (const b of content.blocks) {
    if ((b.type !== 'eventCard' && b.type !== 'button') || out.has(b.eventId)) continue;
    const e = await findEventTx(tx, b.eventId);
    if (e)
      out.set(e.id, {
        name: e.name,
        startsAt: e.startsAt,
        timezone: e.timezone,
        venue: [e.venueName, e.city].filter(Boolean).join(', ') || null,
      });
  }
  return out;
}

/** A url-safe UTM campaign value from the campaign's name. */
export function utmCampaign(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'campaign';
}

/**
 * The tracked link (M3.8a) of every button and event card, created once per block and reused by
 * test sends and the send: `{{@origin}}/r/{code}` in stored content.
 */
async function ensureLinksTx(tx: TenantTx, ctx: Ctx, row: CampaignRow, content: CampaignContent) {
  const existing = await tx.select().from(campaignLinks).where(eq(campaignLinks.campaignId, row.id));
  const byBlock = new Map(existing.map((l) => [l.blockId, l.code]));
  for (const b of linkBlocks(content)) {
    if (byBlock.has(b.id)) continue;
    const link = await createTrackedLinkTx(tx, ctx, {
      eventId: b.eventId,
      source: 'yayatoh',
      medium: row.channel,
      campaign: utmCampaign(row.name),
      content: b.id,
      label: row.name.slice(0, 80),
      destinationPath: b.type === 'button' ? b.path : null,
      campaignId: row.id,
    });
    await tx.insert(campaignLinks).values({
      orgId: requireOrg(ctx),
      campaignId: row.id,
      blockId: b.id,
      linkId: link.id,
      code: link.code,
    });
    byBlock.set(b.id, link.code);
  }
  return new Map([...byBlock].map(([block, code]) => [block, `${ORIGIN_TOKEN}/r/${code}`]));
}

/** Render the campaign with its links and brand kit and store it for the dispatcher. */
async function storeRenderedTx(
  tx: TenantTx,
  ctx: Ctx,
  row: CampaignRow,
  content: CampaignContent,
  opts: { test: boolean },
): Promise<{ contentId: string; subject: string }> {
  const orgId = requireOrg(ctx);
  const org = await organizationBrandTx(tx, orgId);
  if (!org) throw new DomainError('not_found');
  const links = await ensureLinksTx(tx, ctx, row, content);
  const r = renderCampaign({
    content,
    locale: row.locale,
    brand: {
      name: org.name,
      brandColor: org.brandColor,
      logoUrl: org.logoPath ? `${ORIGIN_TOKEN}${org.logoPath}` : null,
      logoAlt: org.logoAlt,
      poweredByVisible: org.poweredByVisible,
    },
    events: await eventInfosTx(tx, content),
    links,
    test: opts.test,
    imageOrigin: ORIGIN_TOKEN,
  });
  const contentId = await storeContentTx(tx, orgId, {
    subject: r.subject,
    preheader: r.preheader,
    html: r.html,
    text: r.text,
    smsBody: row.channel === 'email' ? null : content.smsBody,
    locale: r.lang,
  });
  return { contentId, subject: r.subject };
}

/**
 * Test sends (M3.6b): the campaign as it will look, to up to five addresses the sender types,
 * marked "[Test]" with a banner, never counted in results and never gated by marketing consent
 * (the sender asked for it). Merge fields show their fallbacks. At most TEST_SENDS_PER_HOUR test
 * recipients per campaign per hour.
 */
export const testSendCommand = tenantCommand({
  name: 'campaigns.testSend',
  input: z.object({
    campaignId: z.uuid(),
    addresses: z
      .array(z.email().trim().max(254))
      .min(1)
      .max(MAX_TEST_ADDRESSES)
      .transform((a) => [...new Set(a.map((x) => x.trim()))]),
  }),
  output: z.object({ queued: z.int() }),
  entitlement: 'marketing',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    if (row.status === 'cancelled' || row.status === 'sent')
      throw new DomainError('invalid_state', 'This campaign is closed', { reason: 'closed' });
    if (row.channel !== 'email')
      throw new DomainError('invalid_state', 'Test sends are by email', { reason: 'test_email_only' });
    const content = contentOrThrow(row);
    const recent = await queuedSinceByPrefixTx(tx, testPrefix(row.id), new Date(ctx.now.getTime() - 3_600_000));
    if (recent + input.addresses.length > TEST_SENDS_PER_HOUR)
      throw new DomainError('rate_limited', 'Too many test sends', { reason: 'test_limit' });
    const { contentId, subject } = await storeRenderedTx(tx, ctx, row, content, { test: true });
    const batch = uuidv7(ctx.now.getTime());
    let queued = 0;
    for (const [i, email] of input.addresses.entries()) {
      queued += (
        await notifier.enqueue(tx, {
          kind: 'campaigns.test',
          to: { email, name: null, locale: row.locale },
          channels: ['email'],
          params: { subject, _content: contentId },
          dedupeKey: `${testPrefix(row.id)}${batch}:${i}`,
        })
      ).queued;
    }
    return { queued };
  },
  audit: (input, r) => ({
    action: 'campaign.test_send',
    targetType: 'campaign',
    targetId: input.campaignId,
    data: { recipients: r.queued },
  }),
});

type Emit = (event: DomainEvent) => void;

const event = (type: string, campaignId: string, payload: Record<string, unknown>): DomainEvent => ({
  type,
  version: 1,
  aggregateType: 'campaign',
  aggregateId: campaignId,
  payload: { campaignId, ...payload },
});

/** The org's per-minute rate for the channel, from its monthly quota (fair scheduler input). */
export async function campaignRateTx(tx: TenantTx, channel: CampaignChannel): Promise<number> {
  const limits = await orgQuotaLimitsTx(tx);
  return ratePerMinute(limits[channel]);
}

/**
 * Start the send (now, or when a schedule comes due): take the recipient snapshot with the
 * consent rules, create the tracked links, render and store the email, and hand the campaign to
 * the fair scheduler (`sending`). Refused while staff paused the org's messaging, without an
 * audience, or when nobody in it may receive marketing on the channel.
 */
async function startSendTx(tx: TenantTx, ctx: Ctx, row: CampaignRow, emit: Emit): Promise<CampaignRow> {
  const orgId = requireOrg(ctx);
  campaignLifecycleGuard(row, 'start');
  const content = contentOrThrow(row);
  await assertNotPausedTx(tx, 'pause_messaging');
  const reach = await reachTx(tx, orgId, row);
  const summary = summarizeReach(reach);
  if (summary.eligible === 0)
    throw new DomainError('invalid_state', 'Nobody in this audience can receive it', {
      reason: 'no_recipients',
      excluded: summary.excluded,
    });
  const { contentId } = await storeRenderedTx(tx, ctx, row, content, { test: false });
  for (let i = 0; i < reach.length; i += 2_000) {
    await tx
      .insert(campaignRecipients)
      .values(
        reach.slice(i, i + 2_000).map((r) => ({
          orgId,
          campaignId: row.id,
          contactId: r.contactId,
          status: r.reason ? 'excluded' : 'pending',
          reason: r.reason,
        })),
      )
      .onConflictDoNothing();
  }
  const updated = await transitionTx(
    tx,
    row,
    'start',
    {
      startedAt: ctx.now,
      contentId,
      ratePerMinute: await campaignRateTx(tx, row.channel as CampaignChannel),
      failureReason: null,
    },
    ctx.now,
  );
  emit(
    event('campaigns.send_started', row.id, {
      orgId,
      channel: row.channel,
      recipients: summary.eligible,
      excluded: summary.total - summary.eligible,
    }),
  );
  return updated;
}

function campaignLifecycleGuard(row: CampaignRow, e: 'start') {
  if (row.status !== 'draft' && row.status !== 'scheduled')
    throw new DomainError('invalid_state', `campaign: cannot ${e} from ${row.status}`, { reason: 'not_startable' });
}

const CampaignRef = z.object({ campaignId: z.uuid() });

/** Send now: the snapshot is taken in this request; the count is in the result. */
export const sendNowCommand = tenantCommand({
  name: 'campaigns.sendNow',
  input: CampaignRef,
  output: CampaignDto,
  entitlement: 'marketing',
  permission: 'messages:send',
  idempotent: true,
  handler: async ({ input, ctx, tx, emit }) =>
    toCampaignDto(await startSendTx(tx, ctx, await loadCampaignTx(tx, input.campaignId, true), emit)),
  audit: (input) => ({ action: 'campaign.send', targetType: 'campaign', targetId: input.campaignId }),
});

/** `YYYY-MM-DDTHH:mm` in the org's timezone. */
const LocalDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

/**
 * Schedule the send for a local date and time in the org's timezone (DST-aware). The audience
 * and content must be ready; the snapshot is taken when the time comes.
 */
export const scheduleCampaignCommand = tenantCommand({
  name: 'campaigns.scheduleCampaign',
  input: z.object({ campaignId: z.uuid(), at: LocalDateTime }),
  output: CampaignDto,
  entitlement: 'marketing',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    contentOrThrow(row);
    if (!audienceOf(row)) throw new DomainError('invalid_state', 'Choose an audience first', { reason: 'no_audience' });
    const org = await organizationBrandTx(tx, requireOrg(ctx));
    const at = zonedTimeToUtc(input.at, org?.timezone ?? 'UTC');
    if (Number.isNaN(at.getTime()))
      throw new DomainError('validation_failed', 'Invalid date', { field: 'at', reason: 'invalid_date' });
    if (at.getTime() < ctx.now.getTime() + MIN_SCHEDULE_LEAD_MS)
      throw new DomainError('validation_failed', 'Pick a time in the future', { field: 'at', reason: 'in_past' });
    if (at.getTime() > ctx.now.getTime() + MAX_SCHEDULE_AHEAD_MS)
      throw new DomainError('validation_failed', 'Too far ahead', { field: 'at', reason: 'too_far' });
    return toCampaignDto(await transitionTx(tx, row, 'schedule', { scheduledAt: at, failureReason: null }, ctx.now));
  },
  audit: (input) => ({
    action: 'campaign.schedule',
    targetType: 'campaign',
    targetId: input.campaignId,
    data: { at: input.at },
  }),
});

export const unscheduleCampaignCommand = tenantCommand({
  name: 'campaigns.unscheduleCampaign',
  input: CampaignRef,
  output: CampaignDto,
  entitlement: 'marketing',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    return toCampaignDto(await transitionTx(tx, row, 'unschedule', { scheduledAt: null }, ctx.now));
  },
  audit: (input) => ({ action: 'campaign.unschedule', targetType: 'campaign', targetId: input.campaignId }),
});

/** Pause mid-send: the scheduler releases nothing more (at most one chunk is already queued). */
export const pauseCampaignCommand = tenantCommand({
  name: 'campaigns.pauseCampaign',
  input: CampaignRef,
  output: CampaignDto,
  entitlement: 'marketing',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    return toCampaignDto(await transitionTx(tx, row, 'pause', { pausedAt: ctx.now }, ctx.now));
  },
  audit: (input) => ({ action: 'campaign.pause', targetType: 'campaign', targetId: input.campaignId }),
});

export const resumeCampaignCommand = tenantCommand({
  name: 'campaigns.resumeCampaign',
  input: CampaignRef,
  output: CampaignDto,
  entitlement: 'marketing',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    await assertNotPausedTx(tx, 'pause_messaging');
    return toCampaignDto(await transitionTx(tx, row, 'resume', { pausedAt: null }, ctx.now));
  },
  audit: (input) => ({ action: 'campaign.resume', targetType: 'campaign', targetId: input.campaignId }),
});

/**
 * Cancel before it is done: a scheduled campaign never starts; mid-send, recipients not yet
 * released are dropped and messages still waiting in the queue are cancelled.
 */
export const cancelCampaignCommand = tenantCommand({
  name: 'campaigns.cancelCampaign',
  input: CampaignRef,
  output: CampaignDto,
  entitlement: 'marketing',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    const updated = await transitionTx(tx, row, 'cancel', { cancelledAt: ctx.now }, ctx.now);
    await tx
      .update(campaignRecipients)
      .set({ status: 'cancelled', updatedAt: ctx.now })
      .where(and(eq(campaignRecipients.campaignId, row.id), eq(campaignRecipients.status, 'pending')));
    await cancelQueuedByPrefixTx(tx, sendPrefix(row.id), 'campaign_cancelled', ctx.now);
    return toCampaignDto(updated);
  },
  audit: (input) => ({ action: 'campaign.cancel', targetType: 'campaign', targetId: input.campaignId }),
});

/**
 * A scheduled campaign whose time came (the worker's tick, a system actor). If it cannot start
 * (no one to send to, the audience is gone, messaging paused) it is cancelled with the reason and
 * `campaigns.send_failed@1` is emitted for the alert engine; nothing is sent.
 */
export const startScheduledCommand = tenantCommand({
  name: 'campaigns.startScheduled',
  input: CampaignRef,
  output: z.object({ status: z.string(), reason: z.string().nullable() }),
  entitlement: 'marketing',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx, emit }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    if (row.status !== 'scheduled' || !row.scheduledAt || row.scheduledAt > ctx.now)
      return { status: row.status, reason: null };
    const events: DomainEvent[] = [];
    try {
      const started = await tx.transaction((sp) => startSendTx(sp, ctx, row, (e) => events.push(e)));
      for (const e of events) emit(e);
      return { status: started.status, reason: null };
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const reason = String(err.details?.reason ?? err.code).slice(0, 64);
      await transitionTx(tx, row, 'cancel', { cancelledAt: ctx.now, failureReason: reason }, ctx.now);
      emit(event('campaigns.send_failed', row.id, { orgId: requireOrg(ctx), reason, failed: 0 }));
      return { status: 'cancelled', reason };
    }
  },
  audit: (input, r) => ({
    action: 'campaign.start_scheduled',
    targetType: 'campaign',
    targetId: input.campaignId,
    data: r,
  }),
});

/** Recipients the org released to the dispatcher in the last minute (all its campaigns). */
async function releasedLastMinuteTx(tx: TenantTx, now: Date): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(campaignRecipients)
    .where(gt(campaignRecipients.releasedAt, new Date(now.getTime() - 60_000)));
  return row?.n ?? 0;
}

/**
 * Release up to `max` pending recipients of a sending campaign to the dispatcher (the pg-boss
 * `campaigns.release` job, a system actor), within the org's per-minute rate. Each recipient's
 * row is claimed (SKIP LOCKED) and becomes one message under the dedupe key campaign+contact, in
 * one transaction: a retried or duplicated job can never send anyone the campaign twice. When no
 * one is pending the campaign is `sent` (delivery continues in the dispatcher).
 */
export const releaseChunkCommand = tenantCommand({
  name: 'campaigns.releaseChunk',
  input: z.object({ campaignId: z.uuid(), max: z.int().min(1).max(5_000) }),
  output: z.object({ released: z.int(), status: z.string() }),
  entitlement: 'marketing',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    if (row.status !== 'sending' || !row.contentId) return { released: 0, status: row.status };
    const rate = row.ratePerMinute ?? (await campaignRateTx(tx, row.channel as CampaignChannel));
    const budget = Math.max(0, rate - (await releasedLastMinuteTx(tx, ctx.now)));
    const n = Math.min(input.max, budget);
    let released = 0;
    if (n > 0) {
      const claim = await tx
        .select({ id: campaignRecipients.id, contactId: campaignRecipients.contactId })
        .from(campaignRecipients)
        .where(and(eq(campaignRecipients.campaignId, row.id), eq(campaignRecipients.status, 'pending')))
        .orderBy(asc(campaignRecipients.id))
        .limit(n)
        .for('update', { skipLocked: true });
      const people = await contactsForSendTx(
        tx,
        claim.map((c) => c.contactId),
      );
      const subject = (CampaignContent.safeParse(row.content).data?.subject ?? row.name).slice(0, 150);
      for (const c of claim) {
        const p = people.get(c.contactId);
        const address = row.channel === 'email' ? p?.email : p?.phone;
        if (!p || !address) {
          await tx
            .update(campaignRecipients)
            .set({ status: 'excluded', reason: 'no_address', updatedAt: ctx.now })
            .where(eq(campaignRecipients.id, c.id));
          continue;
        }
        await notifier.enqueue(tx, {
          kind: 'marketing.message',
          to: {
            email: row.channel === 'email' ? p.email : null,
            phone: row.channel === 'email' ? null : p.phone,
            name: p.name,
            contactId: c.contactId,
            locale: row.locale,
          },
          channels: [row.channel as CampaignChannel],
          params: { subject, body: '', name: p.name ?? '', _content: row.contentId },
          dedupeKey: `${sendPrefix(row.id)}${c.contactId}`,
        });
        await tx
          .update(campaignRecipients)
          .set({ status: 'queued', releasedAt: ctx.now, updatedAt: ctx.now })
          .where(eq(campaignRecipients.id, c.id));
        released += 1;
      }
    }
    const [left] = await tx
      .select({ n: count() })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.campaignId, row.id), eq(campaignRecipients.status, 'pending')));
    if ((left?.n ?? 0) === 0) {
      await transitionTx(tx, row, 'complete', { completedAt: ctx.now }, ctx.now);
      return { released, status: 'sent' };
    }
    return { released, status: 'sending' };
  },
  audit: (input, r) => ({
    action: 'campaign.release',
    targetType: 'campaign',
    targetId: input.campaignId,
    data: r,
  }),
});

/**
 * Once a sent campaign's last message left the queue: results are final. Emits
 * `campaigns.send_completed@1` (totals, for M3.8b) and, when messages failed at the provider,
 * `campaigns.send_failed@1` (for the M3.2b alert engine; this module never calls it).
 */
export const finalizeCampaignCommand = tenantCommand({
  name: 'campaigns.finalizeCampaign',
  input: CampaignRef,
  output: z.object({ finalized: z.boolean() }),
  entitlement: 'marketing',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx, emit }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    if (row.status !== 'sent' || row.finalizedAt) return { finalized: false };
    const o = await sendOutcomesTx(tx, sendPrefix(row.id));
    if (o.queued > 0) return { finalized: false };
    await tx.update(campaigns).set({ finalizedAt: ctx.now, updatedAt: ctx.now }).where(eq(campaigns.id, row.id));
    const orgId = requireOrg(ctx);
    emit(
      event('campaigns.send_completed', row.id, {
        orgId,
        channel: row.channel,
        sent: o.sent,
        notSent: o.suppressed + o.canceled,
        failed: o.failed,
      }),
    );
    if (o.failed > 0)
      emit(event('campaigns.send_failed', row.id, { orgId, reason: 'messages_failed', failed: o.failed }));
    return { finalized: true };
  },
  audit: (input, r) => ({
    action: 'campaign.finalize',
    targetType: 'campaign',
    targetId: input.campaignId,
    data: r,
  }),
});
