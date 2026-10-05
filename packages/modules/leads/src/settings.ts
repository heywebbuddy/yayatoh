import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { z } from 'zod';
import { leadContextTx } from './capture.ts';
import { LEAD_TERMS_VERSION, MAX_QUALIFIERS, normalizeQualifiers, QUALIFIER_MAX } from './domain/rules.ts';
import { exhibitorLeadSettings } from './schema.ts';

/**
 * The exhibitor admin's lead settings (M5.6b): the qualifiers their people tick, whether staff
 * see the whole team's leads (default: own only), and the P5-8 lead terms click-through.
 */
export const saveLeadSettingsCommand = tenantCommand({
  name: 'leads.saveSettings',
  input: z.object({
    qualifiers: z.array(z.string().max(QUALIFIER_MAX)).max(MAX_QUALIFIERS * 2),
    teamVisibility: z.boolean(),
  }),
  output: z.object({ qualifiers: z.array(z.string()), exhibitorId: z.uuid() }),
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor_admin',
  handler: async ({ input, ctx, tx }) => {
    const c = await leadContextTx(tx, ctx, 'admin');
    const qualifiers = normalizeQualifiers(input.qualifiers);
    if (qualifiers.length > MAX_QUALIFIERS)
      throw new DomainError('validation_failed', 'Too many qualifiers', {
        field: 'qualifiers',
        reason: 'too_many_qualifiers',
        max: MAX_QUALIFIERS,
      });
    await tx
      .insert(exhibitorLeadSettings)
      .values({
        orgId: requireOrg(ctx),
        eventId: c.event.id,
        exhibitorId: c.exhibitor.id,
        qualifiers,
        teamVisibility: input.teamVisibility,
      })
      .onConflictDoUpdate({
        target: [exhibitorLeadSettings.orgId, exhibitorLeadSettings.exhibitorId],
        set: { qualifiers, teamVisibility: input.teamVisibility, updatedAt: ctx.now },
      });
    return { qualifiers, exhibitorId: c.exhibitor.id };
  },
  audit: (input, r) => ({
    action: 'leads.settings.save',
    targetType: 'program_exhibitor',
    targetId: r?.exhibitorId ?? null,
    data: { qualifiers: r?.qualifiers.length ?? 0, teamVisibility: input.teamVisibility },
  }),
});

/** The exhibitor admin accepts the lead terms (the version shown); capture opens for the team. */
export const acceptLeadTermsCommand = tenantCommand({
  name: 'leads.acceptTerms',
  input: z.object({ version: z.int() }),
  output: z.object({ version: z.int(), exhibitorId: z.uuid() }),
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor_admin',
  handler: async ({ input, ctx, tx }) => {
    const c = await leadContextTx(tx, ctx, 'admin');
    if (input.version !== LEAD_TERMS_VERSION)
      throw new DomainError('validation_failed', 'These terms are out of date', {
        field: 'version',
        reason: 'terms_version',
      });
    const set = {
      termsVersion: input.version,
      termsAcceptedAt: ctx.now,
      termsAcceptedBy: c.principal.accountId,
    };
    await tx
      .insert(exhibitorLeadSettings)
      .values({ orgId: requireOrg(ctx), eventId: c.event.id, exhibitorId: c.exhibitor.id, ...set })
      .onConflictDoUpdate({
        target: [exhibitorLeadSettings.orgId, exhibitorLeadSettings.exhibitorId],
        set: { ...set, updatedAt: ctx.now },
      });
    return { version: input.version, exhibitorId: c.exhibitor.id };
  },
  audit: (input, r) => ({
    action: 'leads.terms.accept',
    targetType: 'program_exhibitor',
    targetId: r?.exhibitorId ?? null,
    data: { version: input.version },
  }),
});
