import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { organizationBrandTx } from '@yayatoh/tenancy';
import { z } from 'zod';
import { emailSettings } from './schema.ts';
import { orgSendersTx } from './senders.ts';
import { PLATFORM_SENDER } from './transports.ts';

/**
 * U10 "Email sending": the From name and Reply-To address on every email the org sends (orders,
 * reminders, campaigns, journeys, guest codes…). The From **address** never changes here: it is the
 * org's verified sending domain, else the platform sender, so mail never claims a domain the org
 * hasn't proven. The name can't carry an address or a domain (it would read as one in inboxes),
 * and Reply-To can't be a platform address.
 */
export const FROM_NAME_MAX = 80;

/** Domains only Yayatoh sends from or answers at: a Reply-To there would impersonate the platform. */
const PLATFORM_DOMAINS = ['yayatoh.com', 'yayatoh.events', 'yayatoh.test'];

/** Something that reads as a web or email address ("paypal.com", "support@bank"). */
const LOOKS_LIKE_DOMAIN = /[a-z0-9-]\.(?:[a-z]{2,24})(?:\b|$)|www\.|https?:/i;

const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/;

export type FromNameProblem = 'too_long' | 'has_address' | 'has_domain';
export type ReplyToProblem = 'invalid_email' | 'platform_address';

/** A From name as typed: trimmed, inner whitespace collapsed; null when empty (use the org name). */
export function checkFromName(input: string | null | undefined): {
  value: string | null;
  problem: FromNameProblem | null;
} {
  const value = (input ?? '').replace(/[\s\p{Cc}]+/gu, ' ').trim();
  if (!value) return { value: null, problem: null };
  if ([...value].length > FROM_NAME_MAX) return { value, problem: 'too_long' };
  if (/[@<>"]/.test(value)) return { value, problem: 'has_address' };
  if (LOOKS_LIKE_DOMAIN.test(value)) return { value, problem: 'has_domain' };
  return { value, problem: null };
}

/** A Reply-To address as typed: lower-cased; null when empty (no Reply-To header). */
export function checkReplyTo(input: string | null | undefined): {
  value: string | null;
  problem: ReplyToProblem | null;
} {
  const value = (input ?? '').trim().toLowerCase();
  if (!value) return { value: null, problem: null };
  const m = EMAIL.exec(value);
  if (!m || value.length > 254 || value.includes('..')) return { value, problem: 'invalid_email' };
  const domain = m[1] ?? '';
  if (PLATFORM_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`)))
    return { value, problem: 'platform_address' };
  return { value, problem: null };
}

export const EmailIdentityDto = z.object({
  /** What the org set (null: not set). */
  fromName: z.string().nullable(),
  replyTo: z.string().nullable(),
  /** What recipients see: the From name in use (the org's name when not set) and the address. */
  effectiveFromName: z.string(),
  fromAddress: z.string(),
  /** The address is the org's own verified sending domain (else the platform sender). */
  ownDomain: z.boolean(),
});
export type EmailIdentityDto = z.infer<typeof EmailIdentityDto>;

/** The From name and Reply-To the dispatcher puts on the org's email. */
export interface EmailIdentity {
  readonly fromName: string | null;
  readonly replyTo: string | null;
}

export async function emailIdentityTx(tx: TenantTx): Promise<EmailIdentity> {
  const [row] = await tx
    .select({ fromName: emailSettings.fromName, replyTo: emailSettings.replyTo })
    .from(emailSettings);
  return { fromName: row?.fromName ?? null, replyTo: row?.replyTo ?? null };
}

async function presentTx(tx: TenantTx, orgId: string): Promise<EmailIdentityDto> {
  const id = await emailIdentityTx(tx);
  const brand = await organizationBrandTx(tx, orgId);
  const senders = await orgSendersTx(tx);
  return EmailIdentityDto.parse({
    fromName: id.fromName,
    replyTo: id.replyTo,
    effectiveFromName: id.fromName ?? brand?.name ?? '',
    fromAddress: senders.email?.address ?? PLATFORM_SENDER,
    ownDomain: senders.email !== null,
  });
}

/** The org's email identity (members who can read the org; changes need `org:update`). */
export const emailIdentityQuery = tenantQuery({
  name: 'notifications.emailIdentity',
  input: z.object({}),
  output: EmailIdentityDto,
  entitlement: 'core',
  permission: 'org:read',
  handler: ({ tx, ctx }) => presentTx(tx, requireOrg(ctx)),
});

/** Set (or clear, with empty values) the From name and Reply-To of every email the org sends. */
export const setEmailIdentityCommand = tenantCommand({
  name: 'notifications.setEmailIdentity',
  input: z.object({
    fromName: z.string().max(400).nullable().default(null),
    replyTo: z.string().max(400).nullable().default(null),
  }),
  output: EmailIdentityDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const name = checkFromName(input.fromName);
    const reply = checkReplyTo(input.replyTo);
    if (name.problem || reply.problem)
      throw new DomainError('validation_failed', 'Check the From name and Reply-To address', {
        fields: [...(name.problem ? ['fromName'] : []), ...(reply.problem ? ['replyTo'] : [])],
        reasons: {
          ...(name.problem ? { fromName: name.problem } : {}),
          ...(reply.problem ? { replyTo: reply.problem } : {}),
        },
      });
    const values = {
      fromName: name.value,
      replyTo: reply.value,
      updatedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
    };
    await tx
      .insert(emailSettings)
      .values({ orgId, ...values })
      .onConflictDoUpdate({ target: emailSettings.orgId, set: { ...values, updatedAt: ctx.now } });
    return presentTx(tx, orgId);
  },
  audit: (_input, r) => ({
    action: 'notifications.email_identity.set',
    targetType: 'email_settings',
    targetId: 'email',
    data: { fromName: r.fromName, replyToSet: r.replyTo !== null },
  }),
});
