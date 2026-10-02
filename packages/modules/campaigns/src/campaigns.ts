import { segmentDefinitionTx } from '@yayatoh/audiences';
import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CAMPAIGN_CHANNELS,
  type CampaignChannel,
  CampaignContent,
  linkedEventIds,
  starterContent,
} from './domain/blocks.ts';
import { type CampaignStatus, campaignLifecycle } from './domain/lifecycle.ts';
import {
  type AudienceChoice,
  AudienceChoice as AudienceChoiceSchema,
  CampaignDto,
  CampaignName,
  CampaignSummaryDto,
  campaignSerializer,
  campaignSummarySerializer,
} from './dto.ts';
import { campaignRecipients, campaigns } from './schema.ts';

export type CampaignRow = typeof campaigns.$inferSelect;

const LOCALE = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);
const MAX_CAMPAIGNS = 200;

export function audienceOf(row: CampaignRow): AudienceChoice | null {
  if (row.audienceKind === 'segment' && row.segmentId) return { kind: 'segment', segmentId: row.segmentId };
  if (row.audienceKind === 'template' && row.templateKey && row.templateEventId) {
    const parsed = AudienceChoiceSchema.safeParse({
      kind: 'template',
      templateKey: row.templateKey,
      eventId: row.templateEventId,
      ticketTypeIds: row.templateTicketTypeIds,
    });
    return parsed.success ? parsed.data : null;
  }
  return null;
}

export function toCampaignDto(row: CampaignRow): CampaignDto {
  const content = CampaignContent.safeParse(row.content);
  return campaignSerializer.serialize({
    id: row.id,
    name: row.name,
    channel: row.channel as CampaignChannel,
    status: row.status as CampaignStatus,
    locale: row.locale,
    content: content.success ? content.data : null,
    audience: audienceOf(row),
    scheduledAt: row.scheduledAt,
    startedAt: row.startedAt,
    pausedAt: row.pausedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** A campaign of this org, locked for update when `lock` (every state change locks it first). */
export async function loadCampaignTx(tx: TenantTx, campaignId: string, lock = false): Promise<CampaignRow> {
  const q = tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new DomainError('not_found', 'Campaign not found');
  return row;
}

const nameTaken = (err: unknown) =>
  isUniqueViolation(err, 'campaigns_org_name_key')
    ? new DomainError('conflict', 'A campaign with this name exists', { field: 'name' })
    : err;

const who = (ctx: Ctx) => (ctx.actor.type === 'user' ? ctx.actor.userId : null);

/** The postal address of the org's latest campaign: new footers start from it. */
async function lastPostalAddressTx(tx: TenantTx): Promise<string> {
  const rows = await tx
    .select({ content: campaigns.content })
    .from(campaigns)
    .orderBy(desc(campaigns.updatedAt))
    .limit(5);
  for (const r of rows) {
    const c = CampaignContent.safeParse(r.content);
    const footer = c.success ? c.data.blocks.find((b) => b.type === 'footer') : undefined;
    if (footer?.type === 'footer' && footer.postalAddress) return footer.postalAddress;
  }
  return '';
}

/** Start a campaign: a draft with a heading, a paragraph and the mandatory footer. */
export const createCampaignCommand = tenantCommand({
  name: 'campaigns.createCampaign',
  input: z.object({
    name: CampaignName,
    channel: z.enum(CAMPAIGN_CHANNELS).default('email'),
    locale: LOCALE.default('en'),
  }),
  output: CampaignDto,
  entitlement: 'marketing',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const content = starterContent({ subject: input.name, postalAddress: await lastPostalAddressTx(tx) });
    try {
      const [row] = await tx
        .insert(campaigns)
        .values({
          orgId,
          name: input.name,
          channel: input.channel,
          locale: input.locale,
          content,
          createdBy: who(ctx),
          updatedBy: who(ctx),
        })
        .returning();
      if (!row) throw new DomainError('internal');
      return toCampaignDto(row);
    } catch (err) {
      throw nameTaken(err);
    }
  },
  audit: (input, r) => ({
    action: 'campaign.create',
    targetType: 'campaign',
    targetId: r.id,
    data: { channel: input.channel },
  }),
});

/** Every event the content links to must be this org's. */
async function assertEventsTx(tx: TenantTx, content: CampaignContent) {
  for (const id of linkedEventIds(content)) {
    if (!(await findEventTx(tx, id)))
      throw new DomainError('validation_failed', 'Event not found', {
        field: 'blocks',
        reason: 'event_not_found',
      });
  }
}

/** Save a draft's name, language and blocks (drafts only; a scheduled campaign is unscheduled first). */
export const saveCampaignCommand = tenantCommand({
  name: 'campaigns.saveCampaign',
  input: z.object({
    campaignId: z.uuid(),
    name: CampaignName,
    locale: LOCALE,
    content: CampaignContent,
  }),
  output: CampaignDto,
  entitlement: 'marketing',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    if (row.status !== 'draft')
      throw new DomainError('invalid_state', 'Only drafts can be edited', { reason: 'not_draft' });
    await assertEventsTx(tx, input.content);
    try {
      const [updated] = await tx
        .update(campaigns)
        .set({
          name: input.name,
          locale: input.locale,
          content: input.content,
          updatedBy: who(ctx),
          updatedAt: ctx.now,
        })
        .where(eq(campaigns.id, row.id))
        .returning();
      if (!updated) throw new DomainError('internal');
      return toCampaignDto(updated);
    } catch (err) {
      throw nameTaken(err);
    }
  },
  audit: (input) => ({ action: 'campaign.update', targetType: 'campaign', targetId: input.campaignId }),
});

/** Choose the audience: a saved segment or a template with its event (and ticket types). */
export const setAudienceCommand = tenantCommand({
  name: 'campaigns.setAudience',
  input: z.object({ campaignId: z.uuid(), audience: AudienceChoiceSchema }),
  output: CampaignDto,
  entitlement: 'marketing',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    if (row.status !== 'draft')
      throw new DomainError('invalid_state', 'Only drafts can be edited', { reason: 'not_draft' });
    const a = input.audience;
    if (a.kind === 'template' && !(await findEventTx(tx, a.eventId)))
      throw new DomainError('validation_failed', 'Event not found', { field: 'eventId' });
    // The segment must exist and resolve; the definition is read again when the send starts.
    if (a.kind === 'segment') await segmentDefinitionTx(tx, a.segmentId);
    const [updated] = await tx
      .update(campaigns)
      .set({
        audienceKind: a.kind,
        segmentId: a.kind === 'segment' ? a.segmentId : null,
        templateKey: a.kind === 'template' ? a.templateKey : null,
        templateEventId: a.kind === 'template' ? a.eventId : null,
        templateTicketTypeIds: a.kind === 'template' ? a.ticketTypeIds : [],
        updatedBy: who(ctx),
        updatedAt: ctx.now,
      })
      .where(eq(campaigns.id, row.id))
      .returning();
    if (!updated) throw new DomainError('internal');
    return toCampaignDto(updated);
  },
  audit: (input) => ({
    action: 'campaign.audience',
    targetType: 'campaign',
    targetId: input.campaignId,
    data: { kind: input.audience.kind },
  }),
});

export const deleteCampaignCommand = tenantCommand({
  name: 'campaigns.deleteCampaign',
  category: 'delete',
  input: z.object({ campaignId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'marketing',
  permission: 'marketing:write',
  handler: async ({ input, tx }) => {
    const row = await loadCampaignTx(tx, input.campaignId, true);
    if (row.status !== 'draft')
      throw new DomainError('invalid_state', 'Only drafts can be deleted', { reason: 'not_draft' });
    await tx.delete(campaigns).where(eq(campaigns.id, row.id));
    return { deleted: true };
  },
  audit: (input) => ({ action: 'campaign.delete', targetType: 'campaign', targetId: input.campaignId }),
});

export const listCampaignsQuery = tenantQuery({
  name: 'campaigns.listCampaigns',
  input: z.object({}),
  output: z.array(CampaignSummaryDto),
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ tx }) => {
    const rows = await tx
      .select({
        c: campaigns,
        recipients: sql<number | null>`(select count(*)::int from ${campaignRecipients} r
          where r.org_id = ${campaigns.orgId} and r.campaign_id = ${campaigns.id} and r.status <> 'excluded')`,
      })
      .from(campaigns)
      .orderBy(desc(campaigns.updatedAt), desc(campaigns.id))
      .limit(MAX_CAMPAIGNS);
    return rows.map(({ c, recipients }) =>
      campaignSummarySerializer.serialize({
        id: c.id,
        name: c.name,
        channel: c.channel as CampaignChannel,
        status: c.status as CampaignStatus,
        scheduledAt: c.scheduledAt,
        startedAt: c.startedAt,
        completedAt: c.completedAt,
        updatedAt: c.updatedAt,
        recipients: c.startedAt ? Number(recipients ?? 0) : null,
      }),
    );
  },
});

/**
 * Campaign names by id (batch 3g merge): marketing analytics (M3.8b, a lower tier) keys campaigns
 * by the id its tracked links and messages carry; the web and the Command Center tile name them
 * with this. Ids of other orgs or deleted campaigns are simply absent (RLS).
 */
export async function campaignNamesTx(
  tx: TenantTx,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .where(inArray(campaigns.id, unique));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export const CampaignNameDto = z.object({ id: z.uuid(), name: z.string() });

export const campaignNamesQuery = tenantQuery({
  name: 'campaigns.campaignNames',
  input: z.object({ ids: z.array(z.uuid()).max(MAX_CAMPAIGNS * 10) }),
  output: z.array(CampaignNameDto),
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, tx }) =>
    [...(await campaignNamesTx(tx, input.ids))].map(([id, name]) => ({ id, name })),
});

export const getCampaignQuery = tenantQuery({
  name: 'campaigns.getCampaign',
  input: z.object({ campaignId: z.uuid() }),
  output: CampaignDto,
  entitlement: 'marketing',
  permission: 'marketing:read',
  handler: async ({ input, tx }) => toCampaignDto(await loadCampaignTx(tx, input.campaignId)),
});

/** Apply a lifecycle event with a conditional update (the row is already locked). */
export async function transitionTx(
  tx: TenantTx,
  row: CampaignRow,
  event: keyof typeof campaignLifecycle.events,
  set: Partial<CampaignRow>,
  now: Date,
): Promise<CampaignRow> {
  const to = campaignLifecycle.next(row.status as CampaignStatus, event);
  const [updated] = await tx
    .update(campaigns)
    .set({ ...set, status: to, updatedAt: now })
    .where(and(eq(campaigns.id, row.id), eq(campaigns.status, row.status)))
    .returning();
  if (!updated) throw new DomainError('conflict', 'The campaign changed meanwhile');
  return updated;
}
