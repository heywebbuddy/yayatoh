import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import {
  activeSuspensionsTx,
  liftCapabilityTx,
  organizationBrandTx,
  pauseCapabilityTx,
} from '@yayatoh/tenancy';
import { and, count, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MESSAGE_KINDS } from '../kinds.ts';
import { createNotifier } from '../notifier.ts';
import {
  addressSuppressions,
  autoPauses,
  frequencyCaps,
  messageEvents,
  messages,
  quotaLimits,
} from '../schema.ts';
import { maskEmail } from '../unsubscribe.ts';
import {
  CAP_LIMITS,
  CAP_SCOPES,
  COMPLAINT_WINDOW_DAYS,
  DEFAULT_CAPS,
  DEFAULT_MONTHLY_QUOTAS,
  QUOTA_CHANNELS,
} from './config.ts';
import { orgCapsTx, orgQuotaLimitsTx, usageTx } from './gate.ts';
import { complaintRateBps, quotaPeriod, shouldAutoPause } from './rules.ts';

/**
 * Console side of the policy gate (M3.5a): usage and quotas, frequency caps, the complaint-rate
 * auto-pause, the policy log (held and blocked messages with their reasons) and lifting an
 * address suppression. Every output is an allowlist; addresses are masked.
 */

/** Reasons the gate gives (M1.10 and M3.5a), for the log and the organizer's filters. */
export const POLICY_REASONS = [
  'consent_missing',
  'consent_withdrawn',
  'whatsapp_marketing_us',
  'state_quiet_hours',
  'quiet_hours',
  'frequency_cap',
  'quota_reached',
  'messaging_paused',
  'unsubscribed',
  'preference',
  'bounced',
  'complained',
] as const;

export const maskPhone = (phone: string) =>
  phone.length > 6
    ? `${phone.slice(0, 2)}${'•'.repeat(Math.max(3, phone.length - 6))}${phone.slice(-4)}`
    : '•••';

// ── usage and quotas ────────────────────────────────────────────────────────────────────────

export const UsageDto = z.object({
  period: z.string(),
  resetsAt: z.date(),
  channels: z.array(
    z.object({
      channel: z.enum(QUOTA_CHANNELS),
      used: z.int(),
      messages: z.int(),
      limit: z.int(),
      isDefault: z.boolean(),
      reached: z.boolean(),
      /** Messages waiting for the quota (held, not dropped). */
      waiting: z.int(),
    }),
  ),
});
export type UsageDto = z.infer<typeof UsageDto>;

export async function usageSummaryTx(tx: TenantTx, orgId: string, now: Date): Promise<UsageDto> {
  const org = await organizationBrandTx(tx, orgId);
  const { period, resetsAt } = quotaPeriod(now, org?.timezone ?? 'UTC');
  const [limits, usage, custom, waiting] = await Promise.all([
    orgQuotaLimitsTx(tx),
    usageTx(tx, period),
    tx.select({ channel: quotaLimits.channel }).from(quotaLimits),
    tx
      .select({ channel: messages.channel, n: count() })
      .from(messages)
      .where(and(eq(messages.status, 'queued'), eq(messages.reason, 'quota_reached')))
      .groupBy(messages.channel),
  ]);
  const customSet = new Set(custom.map((c) => c.channel));
  const waitingBy = new Map(waiting.map((w) => [w.channel, w.n]));
  return {
    period,
    resetsAt,
    channels: QUOTA_CHANNELS.map((channel) => ({
      channel,
      used: usage[channel].units,
      messages: usage[channel].messages,
      limit: limits[channel],
      isDefault: !customSet.has(channel),
      reached: usage[channel].units >= limits[channel],
      waiting: waitingBy.get(channel) ?? 0,
    })),
  };
}

/** This month's usage per channel against the org's limits, and what waits for them. */
export const messagingUsageQuery = tenantQuery({
  name: 'notifications.messagingUsage',
  input: z.object({}),
  output: UsageDto,
  entitlement: 'core',
  permission: 'org:read',
  handler: ({ ctx, tx }) => usageSummaryTx(tx, requireOrg(ctx), ctx.now),
});

/** Staff set (or reset to the default) one channel's monthly limit (platform actor, audited). */
export const setQuotaLimitCommand = tenantCommand({
  name: 'notifications.setQuotaLimit',
  input: z.object({
    channel: z.enum(QUOTA_CHANNELS),
    /** null returns the channel to the default. */
    monthlyLimit: z.int().min(0).max(10_000_000).nullable(),
    reason: z.string().trim().min(3).max(500),
  }),
  output: z.object({ channel: z.enum(QUOTA_CHANNELS), monthlyLimit: z.int(), isDefault: z.boolean() }),
  entitlement: null,
  permission: 'platform:messaging.quota',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    if (input.monthlyLimit === null) {
      await tx.delete(quotaLimits).where(eq(quotaLimits.channel, input.channel));
      return { channel: input.channel, monthlyLimit: DEFAULT_MONTHLY_QUOTAS[input.channel], isDefault: true };
    }
    const setBy = ctx.actor.type === 'system' ? ctx.actor.name : 'system';
    await tx
      .insert(quotaLimits)
      .values({
        orgId,
        channel: input.channel,
        monthlyLimit: input.monthlyLimit,
        reason: input.reason,
        setBy,
      })
      .onConflictDoUpdate({
        target: [quotaLimits.orgId, quotaLimits.channel],
        set: { monthlyLimit: input.monthlyLimit, reason: input.reason, setBy, updatedAt: ctx.now },
      });
    return { channel: input.channel, monthlyLimit: input.monthlyLimit, isDefault: false };
  },
  audit: (input, r) => ({
    action: 'messaging.quota.set',
    targetType: 'messaging_quota',
    targetId: input.channel,
    data: {
      channel: input.channel,
      monthlyLimit: r?.monthlyLimit,
      isDefault: r?.isDefault,
      reason: input.reason,
    },
  }),
});

// ── frequency caps ─────────────────────────────────────────────────────────────────────────

export const CapDto = z.object({
  scope: z.enum(CAP_SCOPES),
  maxMessages: z.int(),
  windowHours: z.int(),
  isDefault: z.boolean(),
});
export type CapDto = z.infer<typeof CapDto>;

export const frequencyCapsQuery = tenantQuery({
  name: 'notifications.frequencyCaps',
  input: z.object({}),
  output: z.array(CapDto),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ tx }) => {
    const caps = await orgCapsTx(tx);
    const saved = new Set(
      (await tx.select({ scope: frequencyCaps.scope }).from(frequencyCaps)).map((r) => r.scope),
    );
    return CAP_SCOPES.map((scope) => ({ scope, ...caps[scope], isDefault: !saved.has(scope) }));
  },
});

export const CapInput = z.object({
  scope: z.enum(CAP_SCOPES),
  maxMessages: z.int().min(CAP_LIMITS.maxMessages.min).max(CAP_LIMITS.maxMessages.max),
  windowHours: z.int().min(CAP_LIMITS.windowHours.min).max(CAP_LIMITS.windowHours.max),
});

/** The org's own caps (owners and admins). A value equal to the default is stored all the same. */
export const setFrequencyCapsCommand = tenantCommand({
  name: 'notifications.setFrequencyCaps',
  input: z.object({ caps: z.array(CapInput).min(1).max(CAP_SCOPES.length) }),
  output: z.object({ saved: z.int() }),
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const updatedBy = ctx.actor.type === 'user' ? ctx.actor.userId : 'system';
    for (const c of input.caps)
      await tx
        .insert(frequencyCaps)
        .values({ orgId, scope: c.scope, maxMessages: c.maxMessages, windowHours: c.windowHours, updatedBy })
        .onConflictDoUpdate({
          target: [frequencyCaps.orgId, frequencyCaps.scope],
          set: { maxMessages: c.maxMessages, windowHours: c.windowHours, updatedBy, updatedAt: ctx.now },
        });
    return { saved: input.caps.length };
  },
  audit: (input) => ({
    action: 'messaging.caps.set',
    targetType: 'messaging_caps',
    targetId: null,
    data: { caps: input.caps.map((c) => `${c.scope}:${c.maxMessages}/${c.windowHours}h`) },
  }),
});

export const DEFAULT_CAP_LIST = CAP_SCOPES.map((scope) => ({ scope, ...DEFAULT_CAPS[scope] }));

// ── complaint-rate auto-pause ──────────────────────────────────────────────────────────────

export const AUTO_PAUSE_ACTOR = 'system:notifications.complaint-rate';

/**
 * After new complaints: the org's complaint rate over optional emails sent in the window (30 days, and
 * since its last auto-pause, so a lifted org starts clean). Strictly above 0.3 % with enough
 * volume, optional messaging pauses (the `pause_messaging` suspension every sender honours),
 * the owners and admins are told, and staff see it in the console. Returns whether it paused.
 */
export async function evaluateComplaintRateTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
): Promise<boolean> {
  const orgId = requireOrg(ctx);
  const [last] = await tx
    .select({ createdAt: autoPauses.createdAt })
    .from(autoPauses)
    .orderBy(desc(autoPauses.createdAt))
    .limit(1);
  const windowStart = new Date(
    Math.max(ctx.now.getTime() - COMPLAINT_WINDOW_DAYS * 86_400_000, last?.createdAt.getTime() ?? 0),
  );
  // Optional email only: the pause stops optional messaging, so it measures what the org chose to
  // send (a spam click on a ticket email doesn't count; tickets keep going either way).
  const sentInWindow = and(
    eq(messages.channel, 'email'),
    eq(messages.status, 'sent'),
    ne(messages.category, 'transactional'),
    gte(messages.sentAt, windowStart),
  );
  const [sent] = await tx.select({ n: count() }).from(messages).where(sentInWindow);
  const [complained] = await tx
    .select({ n: sql<number>`count(distinct ${messageEvents.messageId})::int` })
    .from(messageEvents)
    .innerJoin(
      messages,
      and(eq(messages.orgId, messageEvents.orgId), eq(messages.id, messageEvents.messageId)),
    )
    .where(and(eq(messageEvents.type, 'complained'), sentInWindow));
  const s = sent?.n ?? 0;
  const c = complained?.n ?? 0;
  if (!shouldAutoPause(c, s)) return false;
  const rateBps = complaintRateBps(c, s);
  const already = (await activeSuspensionsTx(tx)).has('pause_messaging');
  const changed = await pauseCapabilityTx(
    tx,
    orgId,
    'pause_messaging',
    `Automatic: complaint rate ${(rateBps / 100).toFixed(2)}% (${c} of ${s} emails) is above 0.3%`,
    AUTO_PAUSE_ACTOR,
  );
  if (already && !changed) return false;
  const [row] = await tx
    .insert(autoPauses)
    .values({ orgId, complaints: c, sent: s, rateBps, windowStart })
    .returning({ id: autoPauses.id });
  emit({
    type: 'org.suspension_changed',
    version: 1,
    aggregateType: 'organization',
    aggregateId: orgId,
    payload: { orgId, kind: 'pause_messaging', paused: true },
  });
  emit({
    type: 'messaging.auto_paused',
    version: 1,
    aggregateType: 'organization',
    aggregateId: orgId,
    payload: { orgId, autoPauseId: row?.id ?? null, complaints: c, sent: s, rateBps },
  });
  await createNotifier().notifyMembers(tx, {
    kind: 'messaging.auto_paused',
    params: { rateBps },
    dedupeKey: `auto-paused:${row?.id ?? ctx.now.toISOString()}`,
    href: '/messaging',
  });
  return true;
}

export const AutoPauseDto = z.object({
  active: z.boolean(),
  since: z.date(),
  complaints: z.int(),
  sent: z.int(),
  rateBps: z.int(),
  liftedAt: z.date().nullable(),
});
export type AutoPauseDto = z.infer<typeof AutoPauseDto>;

/** The org's latest auto-pause (active while not lifted and messaging is still paused), or null. */
export async function latestAutoPauseTx(tx: TenantTx): Promise<AutoPauseDto | null> {
  const [row] = await tx.select().from(autoPauses).orderBy(desc(autoPauses.createdAt)).limit(1);
  if (!row) return null;
  const paused = (await activeSuspensionsTx(tx)).has('pause_messaging');
  return {
    active: paused && !row.liftedAt,
    since: row.createdAt,
    complaints: row.complaints,
    sent: row.sent,
    rateBps: row.rateBps,
    liftedAt: row.liftedAt,
  };
}

export const autoPauseQuery = tenantQuery({
  name: 'notifications.autoPause',
  input: z.object({}),
  output: AutoPauseDto.nullable(),
  entitlement: 'core',
  permission: 'org:read',
  handler: ({ tx }) => latestAutoPauseTx(tx),
});

/** Staff lift an auto-pause after review (platform actor, note required, audited). */
export const liftAutoPauseCommand = tenantCommand({
  name: 'notifications.liftAutoPause',
  input: z.object({ note: z.string().trim().min(3).max(500) }),
  output: z.object({ lifted: z.boolean() }),
  entitlement: null,
  permission: 'platform:messaging.auto_pause.lift',
  handler: async ({ input, ctx, tx, emit }) => {
    const liftedBy = ctx.actor.type === 'system' ? ctx.actor.name : 'system';
    const open = await tx
      .update(autoPauses)
      .set({ liftedAt: ctx.now, liftedBy, liftNote: input.note, updatedAt: ctx.now })
      .where(isNull(autoPauses.liftedAt))
      .returning({ id: autoPauses.id });
    if (open.length === 0)
      throw new DomainError('invalid_state', 'Not auto-paused', { reason: 'not_paused' });
    if (await liftCapabilityTx(tx, 'pause_messaging', liftedBy, ctx.now))
      emit({
        type: 'org.suspension_changed',
        version: 1,
        aggregateType: 'organization',
        aggregateId: requireOrg(ctx),
        payload: { orgId: requireOrg(ctx), kind: 'pause_messaging', paused: false },
      });
    return { lifted: true };
  },
  audit: (input) => ({
    action: 'messaging.auto_pause.lift',
    targetType: 'organization',
    targetId: null,
    data: { note: input.note },
  }),
});

// ── the policy log ─────────────────────────────────────────────────────────────────────────

export const PolicyLogDto = z.object({
  id: z.uuid(),
  kind: z.enum(MESSAGE_KINDS as [string, ...string[]]),
  channel: z.enum(['email', 'sms', 'whatsapp', 'push']),
  status: z.enum(['held', 'blocked']),
  reason: z.string(),
  recipient: z.string().nullable(),
  /** When it was blocked, or when a held message will be tried again. */
  at: z.date(),
});
export type PolicyLogDto = z.infer<typeof PolicyLogDto>;

/** Messages the gate held or blocked, newest first, with their reasons (masked recipients). */
export const policyLogQuery = tenantQuery({
  name: 'notifications.policyLog',
  input: z.object({ channel: z.enum(['email', 'sms', 'whatsapp', 'push']).optional() }),
  output: z.array(PolicyLogDto),
  entitlement: 'core',
  permission: 'messages:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select({
        id: messages.id,
        kind: messages.kind,
        channel: messages.channel,
        status: messages.status,
        reason: messages.reason,
        email: messages.recipientEmail,
        sendAfter: messages.sendAfter,
        updatedAt: messages.updatedAt,
      })
      .from(messages)
      .where(
        and(
          inArray(messages.reason, [...POLICY_REASONS]),
          or(eq(messages.status, 'queued'), eq(messages.status, 'suppressed')),
          input.channel ? eq(messages.channel, input.channel) : undefined,
        ),
      )
      .orderBy(desc(messages.updatedAt), desc(messages.id))
      .limit(50);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      channel: r.channel as PolicyLogDto['channel'],
      status: r.status === 'queued' ? ('held' as const) : ('blocked' as const),
      reason: r.reason ?? '',
      recipient: r.email ? maskEmail(r.email) : null,
      at: r.status === 'queued' ? r.sendAfter : r.updatedAt,
    }));
  },
});

/** Not-sent and waiting counts by channel and reason for a dedupe prefix (an announcement). */
export async function deliveryReasonsTx(
  tx: TenantTx,
  prefix: string,
): Promise<Array<{ channel: string; reason: string; count: number }>> {
  const rows = await tx
    .select({ channel: messages.channel, reason: messages.reason, n: count() })
    .from(messages)
    .where(
      and(
        sql`${messages.dedupeKey} like ${`${prefix.replace(/[\\%_]/g, '\\$&')}%`}`,
        sql`${messages.reason} is not null`,
        inArray(messages.status, ['queued', 'suppressed', 'failed', 'canceled']),
      ),
    )
    .groupBy(messages.channel, messages.reason)
    .orderBy(messages.channel, messages.reason);
  return rows.map((r) => ({ channel: r.channel, reason: r.reason ?? '', count: r.n }));
}

// ── address suppressions ───────────────────────────────────────────────────────────────────

export const AddressSuppressionDto = z.object({
  id: z.uuid(),
  channel: z.enum(['email', 'sms']),
  address: z.string(),
  reason: z.enum(['hard_bounce', 'soft_bounce', 'complaint']),
  since: z.date(),
  /** Complaints are the person's own "this is spam": only Yayatoh support can lift them. */
  liftable: z.boolean(),
});
export type AddressSuppressionDto = z.infer<typeof AddressSuppressionDto>;

export const addressSuppressionsQuery = tenantQuery({
  name: 'notifications.addressSuppressions',
  input: z.object({}),
  output: z.array(AddressSuppressionDto),
  entitlement: 'core',
  permission: 'messages:read',
  handler: async ({ tx }) => {
    const rows = await tx
      .select()
      .from(addressSuppressions)
      .orderBy(desc(addressSuppressions.createdAt), desc(addressSuppressions.id))
      .limit(100);
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel as 'email' | 'sms',
      address: r.channel === 'email' ? maskEmail(r.addressNorm) : maskPhone(r.addressNorm),
      reason: r.reason as AddressSuppressionDto['reason'],
      since: r.createdAt,
      liftable: r.reason !== 'complaint',
    }));
  },
});

/**
 * Lift a bounce suppression (the person fixed their mailbox, a typo was corrected): owners and
 * admins, with a note, audited without the address. Complaints are refused.
 */
export const liftAddressSuppressionCommand = tenantCommand({
  name: 'notifications.liftAddressSuppression',
  input: z.object({ id: z.uuid(), note: z.string().trim().min(3).max(500) }),
  output: z.object({ lifted: z.boolean(), channel: z.enum(['email', 'sms']), reason: z.string() }),
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, tx }) => {
    const [row] = await tx
      .select()
      .from(addressSuppressions)
      .where(eq(addressSuppressions.id, input.id))
      .for('update');
    if (!row) throw new DomainError('not_found', 'Suppression not found');
    if (row.reason === 'complaint')
      throw new DomainError('invalid_state', 'Complaints are lifted by Yayatoh support', {
        reason: 'complaint_not_liftable',
      });
    await tx.delete(addressSuppressions).where(eq(addressSuppressions.id, row.id));
    return { lifted: true, channel: row.channel as 'email' | 'sms', reason: row.reason };
  },
  audit: (input, r) => ({
    action: 'notifications.suppression.lift',
    targetType: 'address_suppression',
    targetId: input.id,
    data: { channel: r?.channel, reason: r?.reason, note: input.note },
  }),
});

export const AutoPausedOrgDto = z.object({
  orgId: z.uuid(),
  orgName: z.string(),
  orgSlug: z.string(),
  since: z.date(),
  complaints: z.int(),
  sent: z.int(),
  rateBps: z.int(),
});
export type AutoPausedOrgDto = z.infer<typeof AutoPausedOrgDto>;

/**
 * Staff console (platform_reader, audited by the caller): orgs whose messaging is auto-paused
 * right now, newest first. Allowlisted: org name/slug and the numbers that tripped the pause.
 */
export async function autoPausedOrgsTx(tx: TenantTx): Promise<AutoPausedOrgDto[]> {
  const rows = await tx.execute<{
    org_id: string;
    org_name: string;
    org_slug: string;
    created_at: string;
    complaints: number;
    sent: number;
    rate_bps: number;
  }>(sql`
    select p.org_id, o.name as org_name, o.slug as org_slug, p.created_at, p.complaints, p.sent, p.rate_bps
    from notifications.auto_pauses p
    join tenancy.organizations o on o.id = p.org_id
    where p.lifted_at is null
      and exists (select 1 from tenancy.org_suspensions s
                  where s.org_id = p.org_id and s.kind = 'pause_messaging' and s.lifted_at is null)
    order by p.created_at desc
    limit 200`);
  return rows.map((r) =>
    AutoPausedOrgDto.parse({
      orgId: r.org_id,
      orgName: r.org_name,
      orgSlug: r.org_slug,
      since: new Date(r.created_at),
      complaints: r.complaints,
      sent: r.sent,
      rateBps: r.rate_bps,
    }),
  );
}

/** Deliverability of the org's email for the alert engine (M3.2b). Counts only. */
export interface DeliverabilityFacts {
  /** Emails sent in the window (every category). */
  readonly sent: number;
  readonly bounced: number;
  readonly complained: number;
  /** Optional messaging is paused automatically (complaint rate) right now. */
  readonly autoPaused: boolean;
  /** Messages (any channel) that failed to send in the window. */
  readonly failed: number;
}

export async function deliverabilityFactsTx(
  tx: TenantTx,
  now: Date,
  windowMs: number,
): Promise<DeliverabilityFacts> {
  const since = new Date(now.getTime() - windowMs);
  const sentInWindow = and(
    eq(messages.channel, 'email'),
    eq(messages.status, 'sent'),
    gte(messages.sentAt, since),
  );
  const [sent] = await tx.select({ n: count() }).from(messages).where(sentInWindow);
  const [events] = await tx
    .select({
      bounced: sql<number>`count(distinct ${messageEvents.messageId}) filter (where ${messageEvents.type} = 'bounced')::int`,
      complained: sql<number>`count(distinct ${messageEvents.messageId}) filter (where ${messageEvents.type} = 'complained')::int`,
    })
    .from(messageEvents)
    .innerJoin(
      messages,
      and(eq(messages.orgId, messageEvents.orgId), eq(messages.id, messageEvents.messageId)),
    )
    .where(sentInWindow);
  const [paused] = await tx
    .select({ id: autoPauses.id })
    .from(autoPauses)
    .where(isNull(autoPauses.liftedAt))
    .limit(1);
  const [failed] = await tx
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.status, 'failed'), gte(messages.updatedAt, since)));
  return {
    sent: sent?.n ?? 0,
    bounced: events?.bounced ?? 0,
    complained: events?.complained ?? 0,
    autoPaused: Boolean(paused),
    failed: failed?.n ?? 0,
  };
}
