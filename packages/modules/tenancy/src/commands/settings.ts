import { type TenantTx, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AGREEMENT_DOCUMENTS, type AgreementDocument, PLATFORM_AGREEMENTS } from '../domain/agreements.ts';
import { resolveOrgSlug } from '../queries.ts';
import {
  agreementAcceptances,
  LEGAL_PAGE_KINDS,
  type LegalPageKind,
  legalPages,
  organizations,
} from '../schema.ts';

export const LegalPageDto = z.object({
  kind: z.enum(LEGAL_PAGE_KINDS),
  body: z.string(),
  updatedAt: z.date(),
});

/** The organizer's terms, privacy notice or refund policy (plain text, shown on public pages). */
export const setLegalPageCommand = tenantCommand({
  name: 'tenancy.setLegalPage',
  input: z.object({ kind: z.enum(LEGAL_PAGE_KINDS), body: z.string().trim().max(50_000) }),
  output: z.object({ kind: z.enum(LEGAL_PAGE_KINDS), removed: z.boolean() }),
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    if (!input.body) {
      await tx.delete(legalPages).where(eq(legalPages.kind, input.kind));
      return { kind: input.kind, removed: true };
    }
    await tx
      .insert(legalPages)
      .values({
        orgId,
        kind: input.kind,
        body: input.body,
        updatedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .onConflictDoUpdate({
        target: [legalPages.orgId, legalPages.kind],
        set: {
          body: input.body,
          updatedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
          updatedAt: ctx.now,
        },
      });
    return { kind: input.kind, removed: false };
  },
  audit: (input) => ({ action: 'legal_page.set', targetType: 'legal_page', targetId: input.kind }),
});

export const legalPagesQuery = tenantQuery({
  name: 'tenancy.legalPages',
  input: z.object({}),
  output: z.array(LegalPageDto),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ tx }) =>
    (await tx.select().from(legalPages)).map((p) => ({
      kind: p.kind as LegalPageKind,
      body: p.body,
      updatedAt: p.updatedAt,
    })),
});

/** A public legal page by org slug (active orgs only); null when the org has not written one. */
export async function publicLegalPage(
  orgSlug: string,
  kind: LegalPageKind,
): Promise<{ orgName: string; body: string; updatedAt: Date } | null> {
  const org = await resolveOrgSlug(orgSlug);
  if (!org || (org.status !== 'active' && org.status !== 'limited')) return null;
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'tenancy.public-legal' } });
  return withTenant(ctx, async (tx) => {
    const [page] = await tx.select().from(legalPages).where(eq(legalPages.kind, kind));
    const [o] = await tx.select({ name: organizations.name }).from(organizations);
    return page && o ? { orgName: o.name, body: page.body, updatedAt: page.updatedAt } : null;
  });
}

/** What public pages show about an organizer: brand colour and which legal pages exist. */
export async function publicOrgProfile(
  orgId: string,
): Promise<{ slug: string; brandColor: string | null; legalPages: LegalPageKind[] } | null> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'tenancy.public-profile' } });
  return withTenant(ctx, async (tx) => {
    const [o] = await tx
      .select({
        slug: organizations.slug,
        brandColor: organizations.brandColor,
        status: organizations.status,
      })
      .from(organizations);
    if (!o || (o.status !== 'active' && o.status !== 'limited')) return null;
    const pages = await tx.select({ kind: legalPages.kind }).from(legalPages);
    return {
      slug: o.slug,
      brandColor: o.brandColor,
      legalPages: LEGAL_PAGE_KINDS.filter((k) => pages.some((p) => p.kind === k)),
    };
  });
}

export const AgreementStatusDto = z.object({
  document: z.enum(AGREEMENT_DOCUMENTS as [AgreementDocument, ...AgreementDocument[]]),
  currentVersion: z.string(),
  /** The acceptance of the current version, if any. */
  acceptedAt: z.date().nullable(),
  acceptedBy: z.uuid().nullable(),
});

export const agreementsQuery = tenantQuery({
  name: 'tenancy.agreements',
  input: z.object({}),
  output: z.array(AgreementStatusDto),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ tx }) => {
    const rows = await tx.select().from(agreementAcceptances);
    return AGREEMENT_DOCUMENTS.map((document) => {
      const current = PLATFORM_AGREEMENTS[document].version;
      const a = rows.find((r) => r.document === document && r.version === current);
      return {
        document,
        currentVersion: current,
        acceptedAt: a?.acceptedAt ?? null,
        acceptedBy: a?.acceptedBy ?? null,
      };
    });
  },
});

/**
 * Click-wrap acceptance of the platform's current terms or DPA, by a signed-in owner or admin.
 * Only the current version can be accepted; accepting twice is harmless.
 */
export const acceptAgreementCommand = tenantCommand({
  name: 'tenancy.acceptAgreement',
  input: z.object({
    document: z.enum(AGREEMENT_DOCUMENTS as [AgreementDocument, ...AgreementDocument[]]),
    version: z.string().min(1).max(40),
  }),
  output: z.object({ accepted: z.boolean() }),
  entitlement: 'core',
  permission: 'members:manage',
  handler: async ({ input, ctx, tx }) => {
    if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'A person must accept the terms');
    if (input.version !== PLATFORM_AGREEMENTS[input.document].version)
      throw new DomainError('conflict', 'These terms have been updated; please review the new version', {
        field: 'version',
      });
    await tx
      .insert(agreementAcceptances)
      .values({
        orgId: requireOrg(ctx),
        document: input.document,
        version: input.version,
        acceptedBy: ctx.actor.userId,
        acceptedAt: ctx.now,
      })
      .onConflictDoNothing();
    return { accepted: true };
  },
  audit: (input) => ({
    action: 'agreement.accept',
    targetType: 'agreement',
    targetId: `${input.document}@${input.version}`,
  }),
});

/** Publishing needs the current platform terms accepted (events module gate). */
export async function hasAcceptedTermsTx(tx: TenantTx): Promise<boolean> {
  const [row] = await tx
    .select({ id: agreementAcceptances.id })
    .from(agreementAcceptances)
    .where(
      and(
        eq(agreementAcceptances.document, 'platform_tos'),
        eq(agreementAcceptances.version, PLATFORM_AGREEMENTS.platform_tos.version),
      ),
    )
    .limit(1);
  return Boolean(row);
}
