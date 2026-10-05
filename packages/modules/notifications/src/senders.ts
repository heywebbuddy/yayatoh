import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { normalizeHostname, reservedHostname } from '@yayatoh/tenancy';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { FALLBACK_CHAINS } from './fallback.ts';
import {
  CAMPAIGN_STATUS_VALUES,
  CATEGORIES,
  channelSenders,
  IDENTITY_CHECK_STATUSES,
  sendingDomains,
} from './schema.ts';

/**
 * Sending setup (M3.5b): the org's own email sending domain (organizers add and check it) and its
 * dedicated text senders (Yayatoh staff set them: a Twilio Messaging Service with a 10DLC
 * campaign, the org's WhatsApp route). Outputs are allowlists; sender ids are shown by their last
 * four characters only.
 */
export const SENDING_LOCAL_PART = 'notifications';

const DnsRecordDto = z.object({
  type: z.enum(['CNAME', 'MX', 'TXT']),
  name: z.string().max(300),
  value: z.string().max(500),
  purpose: z.enum(['dkim', 'spf', 'dmarc']),
});
export type DnsRecordDto = z.infer<typeof DnsRecordDto>;

const Check = z.enum(IDENTITY_CHECK_STATUSES);

export const SendingDomainDto = z.object({
  id: z.uuid(),
  domain: z.string(),
  /** The From address once verified. */
  fromAddress: z.string(),
  status: z.enum(['pending', 'verified', 'failed']),
  dkim: Check,
  spf: Check,
  dmarc: Check,
  dmarcPolicy: z.enum(['none', 'quarantine', 'reject']).nullable(),
  records: z.array(DnsRecordDto),
  lastCheckedAt: z.date().nullable(),
  verifiedAt: z.date().nullable(),
});
export type SendingDomainDto = z.infer<typeof SendingDomainDto>;

export const SenderDto = z.object({
  channel: z.enum(['sms', 'whatsapp']),
  /** False: the platform's shared sender. */
  dedicated: z.boolean(),
  provider: z.enum(['twilio', 'whatsapp_cloud', 'whatsapp_gateway']).nullable(),
  displayNumber: z.string().nullable(),
  /** The last four characters of the Messaging Service SID or phone number id. */
  refHint: z.string().nullable(),
  campaignStatus: z.enum(CAMPAIGN_STATUS_VALUES).nullable(),
  /** Messages use it (SMS: only once the 10DLC campaign is verified). */
  active: z.boolean(),
  lastCheckedAt: z.date().nullable(),
});
export type SenderDto = z.infer<typeof SenderDto>;

export const SendingSetupDto = z.object({
  domain: SendingDomainDto.nullable(),
  sms: SenderDto,
  whatsapp: SenderDto,
  fallbacks: z.array(
    z.object({ category: z.enum(CATEGORIES), chain: z.array(z.enum(['whatsapp', 'sms', 'email', 'push'])) }),
  ),
});
export type SendingSetupDto = z.infer<typeof SendingSetupDto>;

type DomainRow = typeof sendingDomains.$inferSelect;
type SenderRow = typeof channelSenders.$inferSelect;

const presentDomain = (r: DomainRow): SendingDomainDto =>
  SendingDomainDto.parse({
    id: r.id,
    domain: r.domain,
    fromAddress: `${SENDING_LOCAL_PART}@${r.domain}`,
    status: r.status,
    dkim: r.dkimStatus,
    spf: r.spfStatus,
    dmarc: r.dmarcStatus,
    dmarcPolicy: r.dmarcPolicy,
    records: Array.isArray(r.records) ? r.records : [],
    lastCheckedAt: r.lastCheckedAt,
    verifiedAt: r.verifiedAt,
  });

const presentSender = (channel: 'sms' | 'whatsapp', r: SenderRow | undefined): SenderDto =>
  SenderDto.parse(
    r
      ? {
          channel,
          dedicated: true,
          provider: r.provider,
          displayNumber: r.displayNumber,
          refHint: r.senderRef ? r.senderRef.slice(-4) : null,
          campaignStatus: channel === 'sms' ? r.campaignStatus : null,
          active: channel === 'sms' ? r.campaignStatus === 'verified' : true,
          lastCheckedAt: r.lastCheckedAt,
        }
      : {
          channel,
          dedicated: false,
          provider: null,
          displayNumber: null,
          refHint: null,
          campaignStatus: null,
          active: true,
          lastCheckedAt: null,
        },
  );

export async function sendingSetupTx(tx: TenantTx): Promise<SendingSetupDto> {
  const [domain] = await tx.select().from(sendingDomains);
  const senders = await tx.select().from(channelSenders);
  return {
    domain: domain ? presentDomain(domain) : null,
    sms: presentSender(
      'sms',
      senders.find((s) => s.channel === 'sms'),
    ),
    whatsapp: presentSender(
      'whatsapp',
      senders.find((s) => s.channel === 'whatsapp'),
    ),
    fallbacks: CATEGORIES.map((category) => ({ category, chain: [...FALLBACK_CHAINS[category]] })),
  };
}

/** The org's sending setup (members who can read the org; changes need `org:update`). */
export const sendingSetupQuery = tenantQuery({
  name: 'notifications.sendingSetup',
  input: z.object({}),
  output: SendingSetupDto,
  entitlement: 'core',
  permission: 'org:read',
  handler: ({ tx }) => sendingSetupTx(tx),
});

/** What the dispatcher uses for this org (M3.5b): verified domain, active 10DLC, WhatsApp route. */
export interface OrgSenders {
  readonly email: { readonly address: string } | null;
  readonly sms: { readonly messagingServiceSid: string } | null;
  readonly whatsapp: { readonly route: 'cloud' | 'gateway'; readonly phoneNumberId: string | null } | null;
}

export async function orgSendersTx(tx: TenantTx): Promise<OrgSenders> {
  const [domain] = await tx
    .select({ domain: sendingDomains.domain, status: sendingDomains.status })
    .from(sendingDomains);
  const senders = await tx.select().from(channelSenders);
  const sms = senders.find((s) => s.channel === 'sms');
  const wa = senders.find((s) => s.channel === 'whatsapp');
  return {
    email: domain?.status === 'verified' ? { address: `${SENDING_LOCAL_PART}@${domain.domain}` } : null,
    sms: sms?.campaignStatus === 'verified' && sms.senderRef ? { messagingServiceSid: sms.senderRef } : null,
    whatsapp: wa
      ? { route: wa.provider === 'whatsapp_gateway' ? 'gateway' : 'cloud', phoneNumberId: wa.senderRef }
      : null,
  };
}

/** A sending domain as typed: a hostname we don't own, not an IP, at most 253 characters. */
export function normalizeSendingDomain(input: string): string | null {
  const host = normalizeHostname(input);
  if (!host || reservedHostname(host) || host.endsWith('.yayatoh.events')) return null;
  return host;
}

/**
 * Add the org's sending domain (one per org; a domain belongs to one org). It starts pending;
 * the web then creates the identity at the provider and records its DNS records and checks.
 */
export const addSendingDomainCommand = tenantCommand({
  name: 'notifications.addSendingDomain',
  input: z.object({ domain: z.string().max(300), provider: z.enum(['ses', 'fake']) }),
  output: SendingDomainDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const domain = normalizeSendingDomain(input.domain);
    if (!domain)
      throw new DomainError('validation_failed', 'Not a usable domain', { reason: 'invalid_domain' });
    const [mine] = await tx.select({ id: sendingDomains.id }).from(sendingDomains);
    if (mine)
      throw new DomainError('conflict', 'The org already has a sending domain', { reason: 'already_set' });
    const rows = await tx
      .insert(sendingDomains)
      .values({
        orgId,
        domain,
        provider: input.provider,
        createdBy:
          ctx.actor.type === 'user'
            ? ctx.actor.userId
            : ctx.actor.type === 'system'
              ? ctx.actor.name
              : 'system',
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (!row)
      throw new DomainError('conflict', 'That domain is used by another organization', {
        reason: 'domain_taken',
      });
    return presentDomain(row);
  },
  audit: (_input, r) => ({
    action: 'notifications.sending_domain.add',
    targetType: 'sending_domain',
    targetId: r.id,
    data: { domain: r.domain },
  }),
});

/** Record what the provider and DNS said about the domain (after "Check DNS now" or creation). */
export const recordSendingDomainCheckCommand = tenantCommand({
  name: 'notifications.recordSendingDomainCheck',
  input: z.object({
    id: z.uuid(),
    dkim: Check,
    spf: Check,
    dmarc: Check,
    dmarcPolicy: z.enum(['none', 'quarantine', 'reject']).nullable(),
    records: z.array(DnsRecordDto).max(10),
    providerRef: z.string().max(300).nullable(),
  }),
  output: SendingDomainDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx.select().from(sendingDomains).where(eq(sendingDomains.id, input.id)).for('update');
    if (!row) throw new DomainError('not_found', 'Sending domain not found');
    const verified = input.dkim === 'verified' && input.spf === 'verified';
    const failed = input.dkim === 'failed' || input.spf === 'failed';
    const [updated] = await tx
      .update(sendingDomains)
      .set({
        dkimStatus: input.dkim,
        spfStatus: input.spf,
        dmarcStatus: input.dmarc,
        dmarcPolicy: input.dmarcPolicy,
        records: input.records,
        providerRef: input.providerRef,
        status: verified ? 'verified' : failed ? 'failed' : 'pending',
        verifiedAt: verified ? (row.verifiedAt ?? ctx.now) : row.verifiedAt,
        lastCheckedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(sendingDomains.id, row.id))
      .returning();
    if (!updated) throw new DomainError('internal');
    return presentDomain(updated);
  },
  audit: (_input, r) => ({
    action: 'notifications.sending_domain.check',
    targetType: 'sending_domain',
    targetId: r.id,
    data: { status: r.status, dkim: r.dkim, spf: r.spf, dmarc: r.dmarc },
  }),
});

/** Remove the org's sending domain: mail goes back to the platform sender at once. */
export const removeSendingDomainCommand = tenantCommand({
  name: 'notifications.removeSendingDomain',
  input: z.object({ id: z.uuid() }),
  output: z.object({ domain: z.string(), provider: z.enum(['ses', 'fake']) }),
  entitlement: 'core',
  permission: 'org:update',
  category: 'delete',
  handler: async ({ input, tx }) => {
    const [row] = await tx.delete(sendingDomains).where(eq(sendingDomains.id, input.id)).returning();
    if (!row) throw new DomainError('not_found', 'Sending domain not found');
    return { domain: row.domain, provider: row.provider as 'ses' | 'fake' };
  },
  audit: (input, r) => ({
    action: 'notifications.sending_domain.remove',
    targetType: 'sending_domain',
    targetId: input.id,
    data: { domain: r?.domain },
  }),
});

const E164 = z.string().regex(/^\+[1-9][0-9]{6,14}$/);

/**
 * Staff set (or clear) an org's dedicated sender (platform actor, audited): a Twilio Messaging
 * Service for SMS (its 10DLC campaign status as last checked), or the WhatsApp route.
 */
export const setChannelSenderCommand = tenantCommand({
  name: 'notifications.setChannelSender',
  input: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('sms'),
      messagingServiceSid: z.string().regex(/^MG[0-9a-f]{32}$/),
      displayNumber: E164.nullable(),
      campaignStatus: z.enum(CAMPAIGN_STATUS_VALUES),
    }),
    z.object({
      kind: z.literal('whatsapp'),
      route: z.enum(['cloud', 'gateway']),
      senderRef: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,64}$/)
        .nullable(),
      displayNumber: E164.nullable(),
    }),
    z.object({ kind: z.literal('clear'), channel: z.enum(['sms', 'whatsapp']) }),
  ]),
  output: SenderDto,
  entitlement: null,
  permission: 'platform:messaging.senders',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const by = ctx.actor.type === 'system' ? ctx.actor.name : 'system';
    if (input.kind === 'clear') {
      await tx.delete(channelSenders).where(eq(channelSenders.channel, input.channel));
      return presentSender(input.channel, undefined);
    }
    const channel = input.kind;
    const values =
      input.kind === 'sms'
        ? {
            provider: 'twilio',
            senderRef: input.messagingServiceSid,
            displayNumber: input.displayNumber,
            campaignStatus: input.campaignStatus,
          }
        : {
            provider: input.route === 'gateway' ? 'whatsapp_gateway' : 'whatsapp_cloud',
            senderRef: input.senderRef,
            displayNumber: input.displayNumber,
            campaignStatus: null,
          };
    if (values.provider === 'whatsapp_cloud' && !/^[0-9]{5,30}$/.test(values.senderRef ?? ''))
      throw new DomainError('validation_failed', 'A Cloud API phone number id is required', {
        reason: 'phone_number_id',
      });
    try {
      const [row] = await tx
        .insert(channelSenders)
        .values({ orgId, channel, ...values, updatedBy: by, lastCheckedAt: ctx.now })
        .onConflictDoUpdate({
          target: [channelSenders.orgId, channelSenders.channel],
          set: { ...values, updatedBy: by, lastCheckedAt: ctx.now, updatedAt: ctx.now },
        })
        .returning();
      return presentSender(channel, row);
    } catch (err) {
      if (isUniqueViolation(err, 'channel_senders_provider_ref_key'))
        throw new DomainError('conflict', 'That sender belongs to another organization', {
          reason: 'sender_taken',
        });
      throw err;
    }
  },
  audit: (input, r) => ({
    action: 'messaging.sender.set',
    targetType: 'channel_sender',
    targetId: r?.channel ?? (input.kind === 'clear' ? input.channel : input.kind),
    data: {
      kind: input.kind,
      provider: r?.provider,
      refHint: r?.refHint,
      campaignStatus: r?.campaignStatus,
    },
  }),
});
