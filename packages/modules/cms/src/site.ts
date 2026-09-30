import { sanitizeMarkdown } from '@yayatoh/contracts';
import { isUniqueViolation, type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CMS_READ, CMS_WRITE } from './cms.ts';
import { ctaHrefProblem, FALLBACK_LOCALE, pickLocale, type SitePlacement } from './domain/help.ts';
import { cmsSlug, nextFreeSlug, slugProblem } from './domain/slug.ts';
import {
  ContactRequestDto,
  ContactRequestInput,
  CreateSiteSectionInput,
  contactRequestSerializer,
  type PublicSiteSectionDto,
  publicSiteSectionSerializer,
  SECTION_BODY_MAX,
  SitePlacement as SitePlacementSchema,
  SiteSectionDto,
  UpdateSiteSectionInput,
} from './dto-help.ts';
import { contactRequests, siteSections } from './schema.ts';

const cleanBody = (body: string) => sanitizeMarkdown(body, SECTION_BODY_MAX);

const invalid = (path: string, code: string) =>
  new DomainError('validation_failed', 'Invalid field', { issues: [{ path, code }], reason: code });

function checkCta(label: string | null | undefined, href: string | null | undefined) {
  if ((label ?? null) === null && (href ?? null) === null) return;
  if (!label) throw invalid('ctaLabel', 'required');
  if (!href) throw invalid('ctaHref', 'required');
  if (ctaHrefProblem(href)) throw invalid('ctaHref', 'format');
}

async function findSection(tx: TenantTx, id: string) {
  const [row] = await tx.select().from(siteSections).where(eq(siteSections.id, id));
  if (!row) throw new DomainError('not_found');
  return row;
}

const slugTaken = () =>
  new DomainError('conflict', 'Another section already uses this key', {
    issues: [{ path: 'slug', code: 'taken' }],
    reason: 'taken',
  });

export const createSiteSectionCommand = tenantCommand({
  name: 'cms.createSiteSection',
  input: CreateSiteSectionInput,
  output: SiteSectionDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    checkCta(input.ctaLabel, input.ctaHref);
    let slug: string;
    if (input.slug) {
      const problem = slugProblem(input.slug);
      if (problem) throw invalid('slug', problem);
      slug = input.slug;
    } else {
      const base = cmsSlug(input.heading);
      const taken = await tx
        .select({ slug: siteSections.slug })
        .from(siteSections)
        .where(and(eq(siteSections.placement, input.placement), eq(siteSections.locale, input.locale)));
      slug = nextFreeSlug(base, new Set(taken.map((r) => r.slug)));
    }
    try {
      const [row] = await tx.transaction((sp) =>
        sp
          .insert(siteSections)
          .values({
            orgId,
            placement: input.placement,
            locale: input.locale,
            slug,
            position: input.position,
            eyebrow: input.eyebrow,
            heading: input.heading,
            body: cleanBody(input.body),
            ctaLabel: input.ctaLabel,
            ctaHref: input.ctaHref,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })
          .returning(),
      );
      if (!row) throw new DomainError('internal');
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'site_sections_org_placement_locale_slug_key')) throw slugTaken();
      throw err;
    }
  },
  audit: (input, row) => ({
    action: 'cms.site_section.create',
    targetType: 'site_section',
    targetId: row.id,
    data: { placement: input.placement },
  }),
});

export const updateSiteSectionCommand = tenantCommand({
  name: 'cms.updateSiteSection',
  input: UpdateSiteSectionInput,
  output: SiteSectionDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx }) => {
    const { sectionId, slug: rawSlug, body, ...fields } = input;
    const current = await findSection(tx, sectionId);
    checkCta(
      fields.ctaLabel !== undefined ? fields.ctaLabel : current.ctaLabel,
      fields.ctaHref !== undefined ? fields.ctaHref : current.ctaHref,
    );
    let slug: string | undefined;
    if (rawSlug && rawSlug !== current.slug) {
      const problem = slugProblem(rawSlug);
      if (problem) throw invalid('slug', problem);
      slug = rawSlug;
    }
    try {
      const [row] = await tx.transaction((sp) =>
        sp
          .update(siteSections)
          .set({
            ...fields,
            ...(slug ? { slug } : {}),
            ...(body !== undefined ? { body: cleanBody(body) } : {}),
            updatedAt: ctx.now,
          })
          .where(eq(siteSections.id, sectionId))
          .returning(),
      );
      if (!row) throw new DomainError('not_found');
      return row;
    } catch (err) {
      if (isUniqueViolation(err, 'site_sections_org_placement_locale_slug_key')) throw slugTaken();
      throw err;
    }
  },
  audit: (input) => ({
    action: 'cms.site_section.update',
    targetType: 'site_section',
    targetId: input.sectionId,
    data: { fields: Object.keys(input).filter((k) => k !== 'sectionId') },
  }),
});

const FROM = {
  publish: ['draft', 'archived'],
  unpublish: ['published'],
  archive: ['draft', 'published'],
} as const;
const TO = { publish: 'published', unpublish: 'draft', archive: 'archived' } as const;

export const setSiteSectionStatusCommand = tenantCommand({
  name: 'cms.setSiteSectionStatus',
  input: z.object({ sectionId: z.uuid(), action: z.enum(['publish', 'unpublish', 'archive']) }),
  output: SiteSectionDto,
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx, emit }) => {
    const current = await findSection(tx, input.sectionId);
    const [row] = await tx
      .update(siteSections)
      .set({
        status: TO[input.action],
        ...(input.action === 'publish' && !current.publishedAt ? { publishedAt: ctx.now } : {}),
        updatedAt: ctx.now,
      })
      .where(and(eq(siteSections.id, input.sectionId), inArray(siteSections.status, [...FROM[input.action]])))
      .returning();
    if (!row) throw new DomainError('invalid_state', `Cannot ${input.action} from ${current.status}`);
    emit({
      type: 'cms.site_section_changed',
      version: 1,
      aggregateType: 'site_section',
      aggregateId: row.id,
      payload: { orgId: row.orgId, sectionId: row.id, placement: row.placement, status: row.status },
    });
    return row;
  },
  audit: (input) => ({
    action: `cms.site_section.${input.action}`,
    targetType: 'site_section',
    targetId: input.sectionId,
  }),
});

export const deleteSiteSectionCommand = tenantCommand({
  name: 'cms.deleteSiteSection',
  category: 'delete',
  input: z.object({ sectionId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, tx }) => {
    const [row] = await tx.delete(siteSections).where(eq(siteSections.id, input.sectionId)).returning();
    if (!row) throw new DomainError('not_found');
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'cms.site_section.delete',
    targetType: 'site_section',
    targetId: input.sectionId,
  }),
});

export const listSiteSectionsQuery = tenantQuery({
  name: 'cms.listSiteSections',
  input: z.object({ placement: SitePlacementSchema.optional() }),
  output: z.array(SiteSectionDto),
  entitlement: 'core',
  permission: CMS_READ,
  handler: ({ input, tx }) =>
    tx
      .select()
      .from(siteSections)
      .where(input.placement ? eq(siteSections.placement, input.placement) : undefined)
      .orderBy(asc(siteSections.placement), asc(siteSections.position), asc(siteSections.locale))
      .limit(500),
});

export const getSiteSectionQuery = tenantQuery({
  name: 'cms.getSiteSection',
  input: z.object({ sectionId: z.uuid() }),
  output: SiteSectionDto,
  entitlement: 'core',
  permission: CMS_READ,
  handler: ({ input, tx }) => findSection(tx, input.sectionId),
});

const publicCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'cms.site' } });

/**
 * The published sections of one placement in the reader's locale (English where a section is not
 * translated), in the editor's order. Drafts and archived sections never leave.
 */
export async function publicSiteSections(
  orgId: string,
  placement: SitePlacement,
  locale: string,
): Promise<PublicSiteSectionDto[]> {
  const rows = await withTenant(publicCtx(orgId), (tx) =>
    tx
      .select()
      .from(siteSections)
      .where(
        and(
          eq(siteSections.placement, placement),
          eq(siteSections.status, 'published'),
          inArray(siteSections.locale, locale === FALLBACK_LOCALE ? [locale] : [locale, FALLBACK_LOCALE]),
        ),
      )
      .orderBy(asc(siteSections.position), asc(siteSections.slug)),
  );
  return publicSiteSectionSerializer.serializeMany(pickLocale(rows, locale));
}

// ── Contact requests ───────────────────────────────────────────────────────────────────────────

/**
 * A contact / sales request from the marketplace (rate-limited and human-checked by the web).
 * Stored for the content org's team; the event carries no personal data.
 */
export const submitContactRequestCommand = tenantCommand({
  name: 'cms.submitContactRequest',
  input: ContactRequestInput,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: 'public:contact_request',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [row] = await tx
      .insert(contactRequests)
      .values({
        orgId,
        topic: input.topic,
        name: input.name,
        email: input.email,
        company: input.company,
        message: sanitizeMarkdown(input.message, 4000),
        locale: input.locale,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning({ id: contactRequests.id });
    if (!row) throw new DomainError('internal');
    emit({
      type: 'cms.contact_requested',
      version: 1,
      aggregateType: 'contact_request',
      aggregateId: row.id,
      payload: { orgId, requestId: row.id, topic: input.topic },
    });
    return { ok: true as const };
  },
});

/** Contact requests hold personal data: the roles that write the site read them (not viewers). */
export const listContactRequestsQuery = tenantQuery({
  name: 'cms.listContactRequests',
  input: z.object({ status: z.enum(['new', 'handled']).optional() }),
  output: z.array(ContactRequestDto),
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, tx }) =>
    contactRequestSerializer.serializeMany(
      await tx
        .select()
        .from(contactRequests)
        .where(input.status ? eq(contactRequests.status, input.status) : undefined)
        .orderBy(desc(contactRequests.createdAt))
        .limit(200),
    ),
});

export const markContactHandledCommand = tenantCommand({
  name: 'cms.markContactHandled',
  input: z.object({ requestId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: CMS_WRITE,
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(contactRequests)
      .set({ status: 'handled', handledAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(contactRequests.id, input.requestId), eq(contactRequests.status, 'new')))
      .returning({ id: contactRequests.id });
    if (!row) {
      const [exists] = await tx
        .select({ n: sql<number>`1` })
        .from(contactRequests)
        .where(eq(contactRequests.id, input.requestId));
      if (!exists) throw new DomainError('not_found');
    }
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'cms.contact_request.handled',
    targetType: 'contact_request',
    targetId: input.requestId,
  }),
});
