import { contactIdsByPhoneTx, currentConsentTx, recordConsentTx } from '@yayatoh/crm';
import { withoutTenant } from '@yayatoh/db';
import { requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { organizationBrandTx } from '@yayatoh/tenancy';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recipientKey } from './policy/gate.ts';
import { KEYWORDS } from './providers/types.ts';
import { addressSuppressions, inboundKeywords } from './schema.ts';

/**
 * Inbound STOP / START / HELP (M3.5b), from a verified provider webhook (a platform actor):
 * - STOP withdraws the org's text consent on that channel (marketing and informational) for every
 *   contact with the number, in the crm ledger with evidence, and suppresses the number on that
 *   channel (`opt_out`: every text, transactional included, as the carrier blocks them anyway);
 * - START lifts that suppression and records informational consent again (marketing needs a new
 *   express written consent);
 * - HELP changes nothing (the endpoint answers with the help text).
 * Each provider message is applied once per org (`inbound_keywords`).
 */
export const recordInboundKeywordCommand = tenantCommand({
  name: 'notifications.recordInboundKeyword',
  input: z.object({
    provider: z.string().regex(/^[a-z0-9_-]{1,32}$/),
    id: z.string().min(1).max(255),
    channel: z.enum(['sms', 'whatsapp']),
    keyword: z.enum(KEYWORDS),
    from: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
    receivedAt: z.coerce.date(),
  }),
  output: z.object({
    recorded: z.boolean(),
    contacts: z.int(),
    orgName: z.string(),
  }),
  entitlement: null,
  permission: 'platform:notifications.inbound',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const orgName = (await organizationBrandTx(tx, orgId))?.name ?? '';
    const key = recipientKey(input.channel, input.from);
    if (!key) throw new Error('APP_TOKEN_SECRET is required for inbound keywords');
    const contacts = await contactIdsByPhoneTx(tx, input.from);
    const inserted = await tx
      .insert(inboundKeywords)
      .values({
        orgId,
        channel: input.channel,
        provider: input.provider,
        providerEventId: input.id,
        keyword: input.keyword,
        recipientKey: key,
        contacts: contacts.length,
        receivedAt: input.receivedAt,
      })
      .onConflictDoNothing()
      .returning({ id: inboundKeywords.id });
    if (inserted.length === 0) return { recorded: false, contacts: contacts.length, orgName };
    const evidence = `keyword:${input.keyword.toUpperCase()}:${input.provider}:${input.id}`.slice(0, 500);
    if (input.keyword === 'stop') {
      for (const contactId of contacts)
        for (const purpose of ['marketing', 'informational'] as const)
          if ((await currentConsentTx(tx, contactId, input.channel, purpose)) !== 'withdrawn')
            await recordConsentTx(tx, ctx, {
              contactId,
              channel: input.channel,
              purpose,
              status: 'withdrawn',
              evidence,
            });
      await tx
        .insert(addressSuppressions)
        .values({ orgId, channel: input.channel, addressNorm: input.from, reason: 'opt_out' })
        .onConflictDoUpdate({
          target: [addressSuppressions.orgId, addressSuppressions.channel, addressSuppressions.addressNorm],
          set: { reason: 'opt_out', updatedAt: ctx.now },
        });
    } else if (input.keyword === 'start') {
      await tx
        .delete(addressSuppressions)
        .where(
          and(
            eq(addressSuppressions.channel, input.channel),
            eq(addressSuppressions.addressNorm, input.from),
            eq(addressSuppressions.reason, 'opt_out'),
          ),
        );
      for (const contactId of contacts)
        if ((await currentConsentTx(tx, contactId, input.channel, 'informational')) !== 'granted')
          await recordConsentTx(tx, ctx, {
            contactId,
            channel: input.channel,
            purpose: 'informational',
            status: 'granted',
            evidence,
          });
    }
    return { recorded: true, contacts: contacts.length, orgName };
  },
  // Never the number: the keyword, the channel and how many contacts it touched.
  audit: (input, r) => ({
    action: 'notifications.inbound_keyword',
    targetType: 'inbound_keyword',
    targetId: `${input.provider}:${input.id}`.slice(0, 200),
    data: { keyword: input.keyword, channel: input.channel, contacts: r?.contacts, recorded: r?.recorded },
  }),
});

/** Which orgs an inbound keyword applies to (SECURITY DEFINER `notifications.inbound_orgs`). */
export async function inboundOrgs(input: {
  readonly channel: 'sms' | 'whatsapp';
  readonly provider: string;
  readonly senderRef: string | null;
  readonly from: string;
}): Promise<Array<{ orgId: string; dedicated: boolean }>> {
  const key = recipientKey(input.channel, input.from);
  if (!key) return [];
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; dedicated: boolean }>(
      sql`select org_id, dedicated from notifications.inbound_orgs(${input.channel}, ${input.provider}, ${input.senderRef}, ${key})`,
    ),
  );
  return [...rows].map((r) => ({ orgId: r.org_id, dedicated: r.dedicated }));
}
