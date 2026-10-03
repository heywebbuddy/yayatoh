import {
  CONSENT_TERMS,
  contactIdByEmailTx,
  currentConsentEntryTx,
  currentTermVersion,
  recordConsentTx,
  upsertContactTx,
} from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { exhibitorNamesTx } from '@yayatoh/program';
import { holderLinkTicketsTx } from '@yayatoh/ticketing';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { WhoScannedMeDto, whoScannedMeSerializer } from './dto.ts';
import { leads } from './schema.ts';

/**
 * The attendee's side of lead retrieval (P5-8), on their ticket holder link: which exhibitors
 * scanned their badge, whether each got their email, and two controls: stop sharing the email
 * with one exhibitor (the email is removed from that lead; the stamp of what was shared stays),
 * and the consent itself for future scans (the consent ledger, `exhibitor_email_sharing`).
 */

const TERM = CONSENT_TERMS.exhibitor_email_sharing;

async function sharingTx(tx: TenantTx, email: string): Promise<boolean> {
  const contactId = await contactIdByEmailTx(tx, email);
  if (!contactId) return false;
  const c = await currentConsentEntryTx(tx, contactId, TERM.channel, TERM.purpose);
  return c?.status === 'granted' && c.version !== null;
}

async function myLeadsTx(tx: TenantTx, ctx: Ctx, linkId: string) {
  const link = await holderLinkTicketsTx(tx, ctx, linkId);
  const rows = link.ticketIds.length
    ? await tx
        .select()
        .from(leads)
        .where(and(eq(leads.eventId, link.eventId), inArray(leads.ticketId, link.ticketIds)))
        .orderBy(desc(leads.capturedAt), desc(leads.id))
    : [];
  return { link, rows };
}

export const whoScannedMeQuery = tenantQuery({
  name: 'leads.whoScannedMe',
  input: z.object({ linkId: z.uuid() }),
  output: WhoScannedMeDto,
  entitlement: 'exhibitors',
  permission: 'public:holder',
  handler: async ({ input, ctx, tx }) => {
    const { link, rows } = await myLeadsTx(tx, ctx, input.linkId);
    const names = await exhibitorNamesTx(tx, [...new Set(rows.map((r) => r.exhibitorId))]);
    return whoScannedMeSerializer.serialize({
      emailSharing: await sharingTx(tx, link.email),
      scans: rows.map((r) => ({
        leadId: r.id,
        exhibitorName: names.get(r.exhibitorId) ?? '',
        capturedAt: r.capturedAt,
        emailShared: r.email !== null && r.emailWithdrawnAt === null,
        emailWithdrawn: r.emailWithdrawnAt !== null,
      })),
    });
  },
});

/** Stop sharing my email with one exhibitor: the lead loses the email, keeps the stamp. */
export const withdrawLeadEmailCommand = tenantCommand({
  name: 'leads.withdrawEmail',
  input: z.object({ linkId: z.uuid(), leadId: z.uuid() }),
  output: z.object({ leadId: z.uuid(), withdrawn: z.boolean() }),
  entitlement: 'exhibitors',
  permission: 'public:holder',
  handler: async ({ input, ctx, tx, emit }) => {
    const { rows } = await myLeadsTx(tx, ctx, input.linkId);
    const lead = rows.find((r) => r.id === input.leadId);
    // Someone else's lead, or none: the same answer.
    if (!lead) throw new DomainError('not_found');
    if (lead.email === null || lead.emailWithdrawnAt) return { leadId: lead.id, withdrawn: false };
    await tx
      .update(leads)
      .set({ email: null, emailWithdrawnAt: ctx.now, updatedAt: ctx.now })
      .where(eq(leads.id, lead.id));
    emit({
      type: 'leads.email_withdrawn',
      version: 1,
      aggregateType: 'lead',
      aggregateId: lead.id,
      payload: {
        orgId: requireOrg(ctx),
        eventId: lead.eventId,
        exhibitorId: lead.exhibitorId,
        leadId: lead.id,
      },
    });
    return { leadId: lead.id, withdrawn: true };
  },
  audit: (input, r) => ({
    action: 'leads.email.withdraw',
    targetType: 'lead',
    targetId: input.leadId,
    data: { withdrawn: r?.withdrawn ?? false, by: 'holder_link' },
  }),
});

/**
 * Exhibitors may (or may no longer) receive my email when they scan my badge: a row in the
 * consent ledger at the current wording version, with the holder link as evidence. It applies
 * to scans from now on.
 */
export const setExhibitorEmailSharingCommand = tenantCommand({
  name: 'leads.setEmailSharing',
  input: z.object({ linkId: z.uuid(), share: z.boolean() }),
  output: z.object({ share: z.boolean() }),
  entitlement: 'exhibitors',
  permission: 'public:holder',
  handler: async ({ input, ctx, tx }) => {
    const link = await holderLinkTicketsTx(tx, ctx, input.linkId);
    if ((await sharingTx(tx, link.email)) === input.share) return { share: input.share };
    const contact = await upsertContactTx(tx, ctx, { email: link.email, name: null, source: 'registration' });
    await recordConsentTx(tx, ctx, {
      contactId: contact.id,
      channel: TERM.channel,
      purpose: TERM.purpose,
      status: input.share ? 'granted' : 'withdrawn',
      evidence: `holder_link:${input.linkId}`,
      version: currentTermVersion('exhibitor_email_sharing'),
    });
    return { share: input.share };
  },
  audit: (input) => ({
    action: input.share ? 'leads.email_sharing.grant' : 'leads.email_sharing.withdraw',
    targetType: 'holder_link',
    targetId: input.linkId,
    data: {},
  }),
});
