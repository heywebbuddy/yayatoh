import { MAX_NAV_PAGES, pageIdsTx } from '@yayatoh/cms';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { z } from 'zod';
import { MAX_EMBED_ORIGINS, normalizeOrigin } from '../domain/embed.ts';
import { SiteSettingsDto } from '../dto.ts';
import { refreshOrgListingsTx, settingsTx } from '../projector.ts';
import { siteSettings } from '../schema.ts';

export const siteSettingsQuery = tenantQuery({
  name: 'marketplace.siteSettings',
  input: z.object({}),
  output: SiteSettingsDto,
  entitlement: 'core',
  permission: 'org:read',
  handler: ({ tx }) => settingsTx(tx),
});

/**
 * Change the org's public site settings. Enrollment and the tenant-site switch change the org's
 * own listings in the same transaction (the marketplace owns the projection); the event lets
 * other consumers (cache revalidation) follow.
 */
export const updateSiteSettingsCommand = tenantCommand({
  name: 'marketplace.updateSiteSettings',
  input: z.object({
    listOnMarketplace: z.boolean().optional(),
    tenantSite: z.boolean().optional(),
    embedOrigins: z.array(z.string().max(300)).max(MAX_EMBED_ORIGINS).optional(),
    navPageIds: z.array(z.uuid()).max(MAX_NAV_PAGES).optional(),
  }),
  output: SiteSettingsDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx, emit, requireStepUp }) => {
    const orgId = requireOrg(ctx);
    let embedOrigins: string[] | undefined;
    if (input.embedOrigins) {
      embedOrigins = [];
      for (const raw of input.embedOrigins) {
        if (!raw.trim()) continue;
        const o = normalizeOrigin(raw);
        if (!o)
          throw new DomainError('validation_failed', 'Not a website address', {
            field: 'embedOrigins',
            value: raw.slice(0, 100),
          });
        if (!embedOrigins.includes(o)) embedOrigins.push(o);
      }
    }
    let navPageIds: string[] | undefined;
    if (input.navPageIds) {
      navPageIds = [...new Set(input.navPageIds)];
      // Only this org's CMS pages (RLS scopes the lookup); drafts may be linked and show once published.
      const known = new Set(await pageIdsTx(tx, navPageIds));
      if (navPageIds.some((id) => !known.has(id)))
        throw new DomainError('validation_failed', 'Not a page of this organization', {
          field: 'navPageIds',
        });
    }
    const current = await settingsTx(tx);
    // Letting a new website embed checkout grants it access (roadmap §10): a step-up, M1.2c.
    // Removing websites never needs one.
    if (embedOrigins?.some((o) => !current.embedOrigins.includes(o))) await requireStepUp();
    const next = {
      listOnMarketplace: input.listOnMarketplace ?? current.listOnMarketplace,
      tenantSite: input.tenantSite ?? current.tenantSite,
      embedOrigins: embedOrigins ?? current.embedOrigins,
      navPageIds: navPageIds ?? current.navPageIds,
    };
    await tx
      .insert(siteSettings)
      .values({ orgId, ...next })
      .onConflictDoUpdate({ target: [siteSettings.orgId], set: { ...next, updatedAt: ctx.now } });
    if (next.listOnMarketplace !== current.listOnMarketplace || next.tenantSite !== current.tenantSite) {
      await refreshOrgListingsTx(tx, orgId, ctx.now);
    }
    emit({
      type: 'marketplace.site_settings_changed',
      version: 1,
      aggregateType: 'organization',
      aggregateId: orgId,
      payload: { orgId, fields: Object.keys(input) },
    });
    return next;
  },
  audit: (input, out) => ({
    action: 'marketplace.site_settings.update',
    targetType: 'organization',
    targetId: null,
    data: {
      fields: Object.keys(input),
      listOnMarketplace: out.listOnMarketplace,
      tenantSite: out.tenantSite,
    },
  }),
});
