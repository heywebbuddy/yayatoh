import { defineSerializer } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { memberRoleTx, organizationDefaultsTx, roleCan } from '@yayatoh/tenancy';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { connectionTx } from '../connections.ts';
import {
  type connections,
  SLACK_MESSAGE_KINDS,
  SLACK_MESSAGE_STATUSES,
  SLACK_MIN_SEVERITIES,
  slackMessages,
  slackSettings,
} from '../schema.ts';
import { DIGEST_TIME, nextDigestAt } from './schedule.ts';

/**
 * Slack settings (M6.4c): a Slack connection's channel, its alerts (at or above a severity) and
 * its daily digest (a local time in the org's zone). Reads need `integrations:read`; changes and
 * test sends `integrations:manage` (owners and admins). Amounts in the digest are an opt-in of the
 * connection's owner, and only while they have finance permission (`finance:read`).
 */

export const SLACK_CONNECTOR = 'slack';
/** Recent Slack messages listed on the connection page. */
export const RECENT_SLACK_MESSAGES = 10;
const CHANNEL_ID = /^[CGD][A-Z0-9]{2,20}$/;

export const SlackSettingsDto = z.object({
  connectionId: z.uuid(),
  channelId: z.string().nullable(),
  channelName: z.string().nullable(),
  alertsEnabled: z.boolean(),
  alertMinSeverity: z.enum(SLACK_MIN_SEVERITIES),
  digestEnabled: z.boolean(),
  digestTime: z.string(),
  digestNextAt: z.date().nullable(),
  includeFinance: z.boolean(),
  /** Whether the connection's owner may switch amounts on (and they are the one asking). */
  financeAllowed: z.boolean(),
  timeZone: z.string(),
});
export type SlackSettingsDto = z.infer<typeof SlackSettingsDto>;

export const SlackMessageDto = z.object({
  id: z.uuid(),
  kind: z.enum(SLACK_MESSAGE_KINDS),
  status: z.enum(SLACK_MESSAGE_STATUSES),
  channelId: z.string(),
  attempts: z.int(),
  sentAt: z.date().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.date(),
});
export type SlackMessageDto = z.infer<typeof SlackMessageDto>;

export const SlackPanelDto = z.object({ settings: SlackSettingsDto, messages: z.array(SlackMessageDto) });
export type SlackPanelDto = z.infer<typeof SlackPanelDto>;
export const slackPanelSerializer = defineSerializer('integrations.slackPanel', SlackPanelDto);

type SettingsRow = typeof slackSettings.$inferSelect;
type ConnectionRow = typeof connections.$inferSelect;

async function slackConnectionTx(tx: TenantTx, connectionId: string, lock = false): Promise<ConnectionRow> {
  const c = await connectionTx(tx, connectionId, lock);
  if (c.connector !== SLACK_CONNECTOR) throw new DomainError('not_found', 'Not a Slack connection');
  return c;
}

/** Does this member (by user id) hold finance permission in the org right now? */
export async function hasFinanceTx(tx: TenantTx, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const role = await memberRoleTx(tx, userId);
  return role !== null && roleCan(role, 'finance:read');
}

const actorUser = (ctx: Ctx) => (ctx.actor.type === 'user' ? ctx.actor.userId : null);

async function orgZoneTx(tx: TenantTx, ctx: Ctx): Promise<string> {
  return (await organizationDefaultsTx(tx, requireOrg(ctx)))?.timezone ?? 'UTC';
}

export async function slackSettingsRowTx(tx: TenantTx, connectionId: string): Promise<SettingsRow | null> {
  const [row] = await tx.select().from(slackSettings).where(eq(slackSettings.connectionId, connectionId));
  return row ?? null;
}

const toSettings = (
  connectionId: string,
  s: SettingsRow | null,
  timeZone: string,
  financeAllowed: boolean,
): SlackSettingsDto => ({
  connectionId,
  channelId: s?.channelId ?? null,
  channelName: s?.channelName ?? null,
  alertsEnabled: s?.alertsEnabled ?? true,
  alertMinSeverity: (s?.alertMinSeverity ?? 'warning') as SlackSettingsDto['alertMinSeverity'],
  digestEnabled: s?.digestEnabled ?? false,
  digestTime: s?.digestTime ?? '08:00',
  digestNextAt: s?.digestEnabled ? (s.digestNextAt ?? null) : null,
  includeFinance: s?.includeFinance ?? false,
  financeAllowed,
  timeZone,
});

/** The connection page's Slack panel: settings and the latest messages (ids, kinds, statuses). */
export const slackPanelQuery = tenantQuery({
  name: 'integrations.slackPanel',
  input: z.object({ connectionId: z.uuid() }),
  output: SlackPanelDto,
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ input, ctx, tx }) => {
    const c = await slackConnectionTx(tx, input.connectionId);
    const user = actorUser(ctx);
    const [s, zone, finance, messages] = await Promise.all([
      slackSettingsRowTx(tx, c.id),
      orgZoneTx(tx, ctx),
      hasFinanceTx(tx, user),
      tx
        .select()
        .from(slackMessages)
        .where(eq(slackMessages.connectionId, c.id))
        .orderBy(desc(slackMessages.createdAt), desc(slackMessages.id))
        .limit(RECENT_SLACK_MESSAGES),
    ]);
    return {
      settings: toSettings(c.id, s, zone, finance && user !== null && c.connectedBy === user),
      messages: messages.map((m) => ({
        id: m.id,
        kind: m.kind as SlackMessageDto['kind'],
        status: m.status as SlackMessageDto['status'],
        channelId: m.channelId,
        attempts: m.attempts,
        sentAt: m.sentAt,
        errorCode: m.errorCode,
        createdAt: m.createdAt,
      })),
    };
  },
});

/**
 * Save a Slack connection's channel, alerts and digest. The channel comes from the picker (the
 * transport checked it against the workspace's list through the port). Switching amounts on is
 * for the connection's owner while they hold finance permission; anyone may switch them off.
 */
export const saveSlackSettingsCommand = tenantCommand({
  name: 'integrations.saveSlackSettings',
  input: z.object({
    connectionId: z.uuid(),
    channelId: z.string().regex(CHANNEL_ID),
    channelName: z.string().trim().min(1).max(80),
    alertsEnabled: z.boolean(),
    alertMinSeverity: z.enum(SLACK_MIN_SEVERITIES),
    digestEnabled: z.boolean(),
    digestTime: z.string().regex(DIGEST_TIME),
    includeFinance: z.boolean(),
  }),
  output: SlackSettingsDto,
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const c = await slackConnectionTx(tx, input.connectionId, true);
    if (c.status !== 'active' && c.status !== 'paused')
      throw new DomainError('invalid_state', 'Only a connected Slack can be set up');
    const user = actorUser(ctx);
    const prior = await slackSettingsRowTx(tx, c.id);
    const financeAllowed = user !== null && c.connectedBy === user && (await hasFinanceTx(tx, user));
    let financeOptedBy = prior?.financeOptedBy ?? null;
    if (input.includeFinance && !prior?.includeFinance) {
      if (!financeAllowed)
        throw new DomainError(
          'forbidden',
          'Only the connection’s owner with finance access can add amounts',
          {
            reason: 'finance_owner_only',
          },
        );
      financeOptedBy = user;
    }
    if (!input.includeFinance) financeOptedBy = null;
    const zone = await orgZoneTx(tx, ctx);
    const digestNextAt = input.digestEnabled ? nextDigestAt(ctx.now, input.digestTime, zone) : null;
    const values = {
      channelId: input.channelId,
      channelName: input.channelName,
      alertsEnabled: input.alertsEnabled,
      alertMinSeverity: input.alertMinSeverity,
      digestEnabled: input.digestEnabled,
      digestTime: input.digestTime,
      digestNextAt,
      includeFinance: input.includeFinance,
      financeOptedBy,
      updatedBy: user,
      updatedAt: ctx.now,
    };
    const [row] = await tx
      .insert(slackSettings)
      .values({ orgId, connectionId: c.id, ...values })
      .onConflictDoUpdate({ target: [slackSettings.orgId, slackSettings.connectionId], set: values })
      .returning();
    if (!row) throw new DomainError('internal');
    return toSettings(c.id, row, zone, financeAllowed);
  },
  audit: (input) => ({
    action: 'integrations.slack.settings',
    targetType: 'integration_connection',
    targetId: input.connectionId,
    data: {
      channelId: input.channelId,
      alerts: input.alertsEnabled,
      minSeverity: input.alertMinSeverity,
      digest: input.digestEnabled,
      digestTime: input.digestTime,
      includeFinance: input.includeFinance,
    },
  }),
});

/** Queue a test alert to the connection's channel (the transport sends it at once). */
export const queueSlackTestCommand = tenantCommand({
  name: 'integrations.queueSlackTest',
  input: z.object({ connectionId: z.uuid() }),
  output: z.object({ messageId: z.uuid(), channelName: z.string() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx }) => {
    const c = await slackConnectionTx(tx, input.connectionId, true);
    if (c.status !== 'active') throw new DomainError('invalid_state', 'Only an active connection sends');
    const s = await slackSettingsRowTx(tx, c.id);
    if (!s?.channelId)
      throw new DomainError('invalid_state', 'Pick a channel first', { reason: 'no_channel' });
    const id = uuidv7(ctx.now.getTime());
    await tx.insert(slackMessages).values({
      id,
      orgId: requireOrg(ctx),
      connectionId: c.id,
      channelId: s.channelId,
      kind: 'test',
      dedupeKey: `test:${id}`,
      payload: {},
      nextAttemptAt: ctx.now,
      requestedBy: actorUser(ctx),
    });
    return { messageId: id, channelName: s.channelName ?? s.channelId };
  },
  audit: (input, r) => ({
    action: 'integrations.slack.test',
    targetType: 'integration_connection',
    targetId: input.connectionId,
    data: { messageId: r.messageId },
  }),
});
