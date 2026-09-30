import { contactIdByEmailTx, normalizeEmail, recordConsentTx } from '@yayatoh/crm';
import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, verifyLinkToken } from '@yayatoh/platform';
import { organizationNameTx } from '@yayatoh/tenancy';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { UNSUBSCRIBE_PURPOSE } from './dispatch.ts';
import { OPTIONAL_CATEGORIES } from './kinds.ts';
import { preferencesPathForEmailTx } from './preference-center.ts';
import { messages, preferences, suppressions } from './schema.ts';

/**
 * One-click unsubscribe (RFC 8058) and the unsubscribe page. The link token is an HMAC of the
 * message id, so nothing secret is stored; the message says which org, address and category.
 * Transactional mail has no unsubscribe link and is never suppressed.
 */
export async function unsubscribeRef(token: string): Promise<{ orgId: string; messageId: string } | null> {
  if (token.length > 200) return null;
  const messageId = verifyLinkToken(UNSUBSCRIBE_PURPOSE, token);
  if (!messageId) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from notifications.message_org(${messageId}::uuid)`),
  );
  return rows[0] ? { orgId: rows[0].org_id, messageId } : null;
}

export const maskEmail = (email: string) => {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(user.length - 1, 6)))}@${domain}`;
};

type Target = { kind: 'email'; emailNorm: string } | { kind: 'member'; userId: string };

async function targetOf(tx: TenantTx, messageId: string) {
  const [m] = await tx
    .select({
      category: messages.category,
      email: messages.recipientEmail,
      userId: messages.recipientUserId,
    })
    .from(messages)
    .where(eq(messages.id, messageId));
  if (!m || m.category === 'transactional') return null;
  const target: Target = m.email
    ? { kind: 'email', emailNorm: normalizeEmail(m.email) }
    : { kind: 'member', userId: m.userId ?? '' };
  return { category: m.category as (typeof OPTIONAL_CATEGORIES)[number], target, email: m.email };
}

async function isUnsubscribedTx(tx: TenantTx, category: string, target: Target): Promise<boolean> {
  if (target.kind === 'email') {
    const [s] = await tx
      .select({ id: suppressions.id })
      .from(suppressions)
      .where(and(eq(suppressions.emailNorm, target.emailNorm), eq(suppressions.category, category)));
    return Boolean(s);
  }
  const [p] = await tx
    .select({ enabled: preferences.enabled })
    .from(preferences)
    .where(
      and(
        eq(preferences.userId, target.userId),
        eq(preferences.category, category),
        eq(preferences.channel, 'email'),
      ),
    );
  return p?.enabled === false;
}

export const UnsubscribeInfoDto = z.object({
  orgName: z.string(),
  category: z.enum(OPTIONAL_CATEGORIES),
  email: z.string().nullable(),
  unsubscribed: z.boolean(),
  /** The recipient's preference center (M3.5a), when the address is one of the org's contacts. */
  preferencesPath: z.string().nullable().default(null),
});
export type UnsubscribeInfoDto = z.infer<typeof UnsubscribeInfoDto>;

/** What the unsubscribe page shows: whose list, which kind of mail, the masked address. */
export async function unsubscribeInfo(token: string): Promise<UnsubscribeInfoDto | null> {
  const ref = await unsubscribeRef(token);
  if (!ref) return null;
  const ctx = createCtx({ orgId: ref.orgId, actor: { type: 'system', name: 'notifications.unsubscribe' } });
  return withTenant(ctx, async (tx) => {
    const t = await targetOf(tx, ref.messageId);
    if (!t) return null;
    return UnsubscribeInfoDto.parse({
      orgName: (await organizationNameTx(tx, ref.orgId)) ?? '',
      category: t.category,
      email: t.email ? maskEmail(t.email) : null,
      unsubscribed: await isUnsubscribedTx(tx, t.category, t.target),
      preferencesPath: t.email ? await preferencesPathForEmailTx(tx, ref.orgId, t.email) : null,
    });
  });
}

const TokenInput = z.object({ token: z.string().min(10).max(200) });

async function messageIdFromToken(tx: TenantTx, token: string) {
  const messageId = verifyLinkToken(UNSUBSCRIBE_PURPOSE, token);
  if (!messageId) throw new DomainError('not_found', 'Unknown link');
  const t = await targetOf(tx, messageId);
  if (!t) throw new DomainError('not_found', 'Unknown link');
  return { messageId, ...t };
}

/**
 * Unsubscribe the message's recipient from that category of this org's mail. Open to anyone
 * holding the link (that is the point of one-click); idempotent. Members' own notifications
 * turn the email toggle off instead. Marketing also records a withdrawn consent (crm ledger).
 */
export const unsubscribeCommand = tenantCommand({
  name: 'notifications.unsubscribe',
  input: TokenInput.extend({ source: z.enum(['one_click', 'page']) }),
  output: z.object({ category: z.enum(OPTIONAL_CATEGORIES), changed: z.boolean() }),
  entitlement: null,
  permission: 'public:unsubscribe',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const t = await messageIdFromToken(tx, input.token);
    let changed = false;
    if (t.target.kind === 'email') {
      const rows = await tx
        .insert(suppressions)
        .values({
          orgId,
          emailNorm: t.target.emailNorm,
          category: t.category,
          source: input.source,
          messageId: t.messageId,
        })
        .onConflictDoNothing()
        .returning({ id: suppressions.id });
      changed = rows.length > 0;
      if (changed && t.category === 'marketing') {
        const contactId = await contactIdByEmailTx(tx, t.target.emailNorm);
        if (contactId)
          await recordConsentTx(tx, ctx, {
            contactId,
            channel: 'email',
            purpose: 'marketing',
            status: 'withdrawn',
            evidence: `unsubscribe:${input.source}:${t.messageId}`,
          });
      }
    } else {
      changed = !(await isUnsubscribedTx(tx, t.category, t.target));
      await tx
        .insert(preferences)
        .values({ orgId, userId: t.target.userId, category: t.category, channel: 'email', enabled: false })
        .onConflictDoUpdate({
          target: [preferences.orgId, preferences.userId, preferences.category, preferences.channel],
          set: { enabled: false, updatedAt: ctx.now },
        });
    }
    return { category: t.category, changed, messageId: t.messageId };
  },
  present: (r) => ({ category: r.category, changed: r.changed }),
  audit: (input, r) => ({
    action: 'notifications.unsubscribe',
    targetType: 'message',
    targetId: r.messageId,
    data: { category: r.category, source: input.source, changed: r.changed },
  }),
});

/** Undo from the confirmation page ("Subscribe again"). */
export const resubscribeCommand = tenantCommand({
  name: 'notifications.resubscribe',
  input: TokenInput,
  output: z.object({ category: z.enum(OPTIONAL_CATEGORIES) }),
  entitlement: null,
  permission: 'public:unsubscribe',
  handler: async ({ input, ctx, tx }) => {
    const t = await messageIdFromToken(tx, input.token);
    if (t.target.kind === 'email')
      await tx
        .delete(suppressions)
        .where(and(eq(suppressions.emailNorm, t.target.emailNorm), eq(suppressions.category, t.category)));
    else
      await tx
        .update(preferences)
        .set({ enabled: true, updatedAt: ctx.now })
        .where(
          and(
            eq(preferences.userId, t.target.userId),
            eq(preferences.category, t.category),
            eq(preferences.channel, 'email'),
          ),
        );
    return { category: t.category, messageId: t.messageId };
  },
  present: (r) => ({ category: r.category }),
  audit: (_input, r) => ({
    action: 'notifications.resubscribe',
    targetType: 'message',
    targetId: r.messageId,
    data: { category: r.category },
  }),
});

/**
 * Stop optional mail of one category to an address (a contact blocking the organizer, imports).
 * Idempotent; transactional mail is unaffected.
 */
export async function suppressEmailTx(
  tx: TenantTx,
  orgId: string,
  email: string,
  category: (typeof OPTIONAL_CATEGORIES)[number],
  source: 'page' | 'one_click' | 'legacy' | 'block',
): Promise<boolean> {
  const rows = await tx
    .insert(suppressions)
    .values({ orgId, emailNorm: normalizeEmail(email), category, source })
    .onConflictDoNothing()
    .returning({ id: suppressions.id });
  return rows.length > 0;
}

/** Lift a suppression (the contact unblocks the organizer). */
export async function unsuppressEmailTx(
  tx: TenantTx,
  email: string,
  category: (typeof OPTIONAL_CATEGORIES)[number],
): Promise<void> {
  await tx
    .delete(suppressions)
    .where(and(eq(suppressions.emailNorm, normalizeEmail(email)), eq(suppressions.category, category)));
}
