import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  DomainError,
  executeCommand,
  executeQuery,
  requireOrg,
} from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import {
  EventSnapshot,
  insertTemplateCopyTx,
  replaceTemplateCopyTx,
  templateContentTx,
} from '@yayatoh/templates';
import { setBrandColorTx } from '@yayatoh/tenancy';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  actingAgency,
  agencyNameTx,
  liveClientsTx,
  requireAgencyV2Tx,
  userOf,
  viaGrantCtx,
} from './common.ts';
import { errorCodeOf, publicSnapshot } from './domain.ts';
import {
  brandKits,
  PRIVATE_PARTS,
  PUBLICATION_STATUSES,
  PUBLISH_KINDS,
  publications,
  receivedItems,
  templateSettings,
} from './schema.ts';

/**
 * Templates and brand kits published downward (M6.8b). The agency keeps its originals; each
 * client gets **its own copy** in its own org (a normal template, a brand kit in its library),
 * written by the agency user acting through the client's live grant, so the client's authorizer,
 * audit and row security apply. Private parts (notes, kept-back checkout questions or seating)
 * never leave the agency.
 */

const ClientIds = z.array(z.uuid()).min(1).max(50);

export const PublishResultDto = z.object({
  clientOrgId: z.uuid(),
  status: z.enum(PUBLICATION_STATUSES),
  errorCode: z.string().nullable(),
});
export type PublishResultDto = z.infer<typeof PublishResultDto>;

// ---------------------------------------------------------------- agency: private parts and kits

export const TemplateSettingsDto = z.object({
  templateId: z.uuid(),
  privateNotes: z.string().nullable(),
  privateParts: z.array(z.enum(PRIVATE_PARTS)),
});
export type TemplateSettingsDto = z.infer<typeof TemplateSettingsDto>;

/** Mark what of an agency template stays private (notes, checkout questions, seating plan). */
export const setTemplatePrivacyCommand = tenantCommand({
  name: 'agencyOps.setTemplatePrivacy',
  input: z.object({
    templateId: z.uuid(),
    privateNotes: z
      .string()
      .trim()
      .max(2000)
      .transform((s) => s || null)
      .nullable()
      .default(null),
    privateParts: z.array(z.enum(PRIVATE_PARTS)).max(PRIVATE_PARTS.length).default([]),
  }),
  output: TemplateSettingsDto,
  entitlement: 'agency',
  permission: 'agency:manage',
  handler: async ({ input, ctx, tx }) => {
    await requireAgencyV2Tx(tx);
    if (!(await templateContentTx(tx, input.templateId)))
      throw new DomainError('not_found', 'Template not found', { field: 'templateId' });
    const parts = [...new Set(input.privateParts)];
    const values = { privateNotes: input.privateNotes, privateParts: parts, updatedAt: ctx.now };
    await tx
      .insert(templateSettings)
      .values({ orgId: requireOrg(ctx), templateId: input.templateId, ...values })
      .onConflictDoUpdate({ target: [templateSettings.orgId, templateSettings.templateId], set: values });
    return { templateId: input.templateId, privateNotes: input.privateNotes, privateParts: parts };
  },
  audit: (input, r) => ({
    action: 'agencyTemplate.privacy',
    targetType: 'template',
    targetId: input.templateId,
    data: { count: r.privateParts.length },
  }),
});

export const BrandKitDto = z.object({
  id: z.uuid(),
  name: z.string(),
  brandColor: z.string(),
  privateNotes: z.string().nullable(),
  receivedFromAgencyOrgId: z.uuid().nullable(),
  appliedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type BrandKitDto = z.infer<typeof BrandKitDto>;
const kitDto = (r: typeof brandKits.$inferSelect): BrandKitDto => BrandKitDto.parse(r);

const KitName = z.string().trim().min(1).max(80);
const Color = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((c) => c.toLowerCase());

/** Create or update one of the agency's brand kits. */
export const saveBrandKitCommand = tenantCommand({
  name: 'agencyOps.saveBrandKit',
  input: z.object({
    kitId: z.uuid().nullable().default(null),
    name: KitName,
    brandColor: Color,
    privateNotes: z
      .string()
      .trim()
      .max(2000)
      .transform((s) => s || null)
      .nullable()
      .default(null),
  }),
  output: BrandKitDto,
  entitlement: 'agency',
  permission: 'agency:manage',
  handler: async ({ input, ctx, tx }) => {
    await requireAgencyV2Tx(tx);
    const values = { name: input.name, brandColor: input.brandColor, privateNotes: input.privateNotes };
    try {
      if (input.kitId) {
        const [row] = await tx
          .update(brandKits)
          .set({ ...values, updatedAt: ctx.now })
          .where(and(eq(brandKits.id, input.kitId), isNull(brandKits.receivedFromAgencyOrgId)))
          .returning();
        if (!row) throw new DomainError('not_found', 'Brand kit not found');
        return kitDto(row);
      }
      const [row] = await tx
        .insert(brandKits)
        .values({ orgId: requireOrg(ctx), ...values, createdBy: userOf(ctx) })
        .returning();
      if (!row) throw new DomainError('internal');
      return kitDto(row);
    } catch (err) {
      if (isUniqueViolation(err, 'brand_kits_org_name_key'))
        throw new DomainError('conflict', 'A brand kit with this name exists', { field: 'name' });
      throw err;
    }
  },
  audit: (input, r) => ({
    action: input.kitId ? 'agencyBrandKit.update' : 'agencyBrandKit.create',
    targetType: 'brand_kit',
    targetId: r.id,
  }),
});

// ---------------------------------------------------------------- agency: the library page

export const PublicationDto = z.object({
  kind: z.enum(PUBLISH_KINDS),
  sourceId: z.uuid(),
  clientOrgId: z.uuid(),
  status: z.enum(PUBLICATION_STATUSES),
  errorCode: z.string().nullable(),
  publishedAt: z.date(),
});

export const AgencyLibraryDto = z.object({
  templateSettings: z.array(TemplateSettingsDto),
  brandKits: z.array(BrandKitDto),
  publications: z.array(PublicationDto),
});
export type AgencyLibraryDto = z.infer<typeof AgencyLibraryDto>;

/** The agency's private template settings, its brand kits and what it published to whom. */
export const agencyLibraryQuery = tenantQuery({
  name: 'agencyOps.library',
  input: z.object({}),
  output: AgencyLibraryDto,
  entitlement: 'agency',
  permission: 'agency:read',
  handler: async ({ tx }) => {
    await requireAgencyV2Tx(tx);
    const settings = await tx.select().from(templateSettings);
    const kits = await tx
      .select()
      .from(brandKits)
      .where(isNull(brandKits.receivedFromAgencyOrgId))
      .orderBy(brandKits.name);
    const pubs = await tx.select().from(publications).orderBy(desc(publications.publishedAt)).limit(500);
    return AgencyLibraryDto.parse({
      templateSettings: settings.map((s) => ({
        templateId: s.templateId,
        privateNotes: s.privateNotes,
        privateParts: s.privateParts,
      })),
      brandKits: kits.map(kitDto),
      publications: pubs,
    });
  },
});

// ---------------------------------------------------------------- publishing

const Target = z.object({ clientOrgId: z.uuid(), grantId: z.uuid() });

const TemplatePayload = z.object({
  name: z.string(),
  description: z.string().nullable(),
  snapshot: EventSnapshot,
  suffix: z.string(),
  targets: z.array(Target),
  /** Clients asked for that hold no live grant (recorded as failed). */
  missing: z.array(z.uuid()),
});

/**
 * What a client receives of an agency template (agency side, read-only): the public snapshot (the
 * private parts removed) and the live grants of the chosen clients.
 */
export const prepareTemplatePublishQuery = tenantQuery({
  name: 'agencyOps.prepareTemplatePublish',
  input: z.object({ templateId: z.uuid(), clientOrgIds: ClientIds }),
  output: TemplatePayload,
  entitlement: 'agency',
  permission: 'agency:manage',
  handler: async ({ input, ctx, tx }) => {
    await requireAgencyV2Tx(tx);
    const content = await templateContentTx(tx, input.templateId);
    if (!content) throw new DomainError('not_found', 'Template not found', { field: 'templateId' });
    const [settings] = await tx
      .select()
      .from(templateSettings)
      .where(eq(templateSettings.templateId, input.templateId));
    const live = await liveClientsTx(tx);
    const ids = [...new Set(input.clientOrgIds)];
    return {
      name: content.name,
      description: content.description,
      snapshot: publicSnapshot(content.snapshot, (settings?.privateParts ?? []) as never),
      suffix: await agencyNameTx(tx, requireOrg(ctx)),
      targets: ids.flatMap((id) => {
        const g = live.get(id);
        return g ? [{ clientOrgId: id, grantId: g.grantId }] : [];
      }),
      missing: ids.filter((id) => !live.has(id)),
    };
  },
});

/** Find the client's live copy of an agency source (template or kit), for a re-publish. */
async function receivedTx(
  tx: TenantTx,
  agencyOrgId: string,
  kind: 'template' | 'brand_kit',
  sourceId: string,
) {
  const [row] = await tx
    .select()
    .from(receivedItems)
    .where(
      and(
        eq(receivedItems.agencyOrgId, agencyOrgId),
        eq(receivedItems.kind, kind),
        eq(receivedItems.sourceId, sourceId),
      ),
    );
  return row ?? null;
}

const Received = z.object({ localId: z.uuid(), updated: z.boolean() });

/**
 * Client side (the agency user acting through the grant; needs `events:write`, so a manager
 * grant): a copy of the agency template in the client's own templates, or the client's existing
 * copy updated. The client owns the copy; a detach keeps it.
 */
export const receiveTemplateCommand = tenantCommand({
  name: 'agencyOps.receiveTemplate',
  input: z.object({
    sourceId: z.uuid(),
    name: z.string().trim().min(2).max(120),
    description: z.string().max(500).nullable(),
    snapshot: EventSnapshot,
    suffix: z.string().trim().min(1).max(60),
  }),
  output: Received,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await requireAgencyV2Tx(tx);
    const { agencyOrgId } = actingAgency(ctx);
    const orgId = requireOrg(ctx);
    const link = await receivedTx(tx, agencyOrgId, 'template', input.sourceId);
    if (link) {
      const updated = await replaceTemplateCopyTx(tx, link.localId, input, ctx.now);
      if (updated) {
        await tx.update(receivedItems).set({ updatedAt: ctx.now }).where(eq(receivedItems.id, link.id));
        return { localId: updated.id, updated: true };
      }
    }
    const copy = await insertTemplateCopyTx(tx, ctx, input);
    if (link)
      await tx
        .update(receivedItems)
        .set({ localId: copy.id, updatedAt: ctx.now })
        .where(eq(receivedItems.id, link.id));
    else
      await tx.insert(receivedItems).values({
        orgId,
        kind: 'template',
        localId: copy.id,
        agencyOrgId,
        sourceId: input.sourceId,
      });
    return { localId: copy.id, updated: false };
  },
  audit: (input, r) => ({
    action: 'agencyTemplate.receive',
    targetType: 'template',
    targetId: r.localId,
    data: { status: r.updated ? 'updated' : 'created' },
  }),
});

/** Agency side: record each client's outcome of a publish. */
export const recordPublicationsCommand = tenantCommand({
  name: 'agencyOps.recordPublications',
  input: z.object({
    kind: z.enum(PUBLISH_KINDS),
    sourceId: z.uuid(),
    results: z.array(PublishResultDto).max(50),
  }),
  output: z.object({ published: z.int(), failed: z.int() }),
  entitlement: 'agency',
  permission: 'agency:manage',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    for (const r of input.results) {
      const values = {
        status: r.status,
        errorCode: r.errorCode,
        publishedBy: userOf(ctx),
        publishedAt: ctx.now,
        updatedAt: ctx.now,
      };
      await tx
        .insert(publications)
        .values({ orgId, kind: input.kind, sourceId: input.sourceId, clientOrgId: r.clientOrgId, ...values })
        .onConflictDoUpdate({
          target: [publications.orgId, publications.kind, publications.sourceId, publications.clientOrgId],
          set: values,
        });
    }
    return {
      published: input.results.filter((r) => r.status === 'published').length,
      failed: input.results.filter((r) => r.status === 'failed').length,
    };
  },
  audit: (input, r) => ({
    action: input.kind === 'template' ? 'agencyTemplate.publish' : 'agencyBrandKit.publish',
    targetType: input.kind,
    targetId: input.sourceId,
    data: { count: r.published, errors: r.failed },
  }),
});

async function publishEach(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  targets: readonly { clientOrgId: string; grantId: string }[],
  missing: readonly string[],
  send: (clientCtx: Ctx) => Promise<unknown>,
): Promise<PublishResultDto[]> {
  const results: PublishResultDto[] = missing.map((clientOrgId) => ({
    clientOrgId,
    status: 'failed',
    errorCode: 'not_found',
  }));
  // One client at a time, each in its own transaction: a refusal in one client never touches another.
  for (const t of targets) {
    try {
      await send(viaGrantCtx(ctx, t));
      results.push({ clientOrgId: t.clientOrgId, status: 'published', errorCode: null });
    } catch (err) {
      results.push({ clientOrgId: t.clientOrgId, status: 'failed', errorCode: errorCodeOf(err) });
    }
  }
  return results;
}

/**
 * Publish an agency template to clients: each gets its own copy without the private parts. Returns
 * one result per client (a refused client, e.g. a viewer grant, is `failed` with its code).
 */
export async function publishTemplate(
  ctx: Ctx,
  input: { templateId: string; clientOrgIds: readonly string[] },
  ports: CommandPorts<TenantTx>,
): Promise<PublishResultDto[]> {
  const p = await executeQuery(prepareTemplatePublishQuery, input, ctx, ports);
  const results = await publishEach(ctx, ports, p.targets, p.missing, (clientCtx) =>
    executeCommand(
      receiveTemplateCommand,
      {
        sourceId: input.templateId,
        name: p.name,
        description: p.description,
        snapshot: p.snapshot,
        suffix: p.suffix,
      },
      clientCtx,
      ports,
    ),
  );
  await executeCommand(
    recordPublicationsCommand,
    { kind: 'template', sourceId: input.templateId, results },
    ctx,
    ports,
  );
  return results;
}

const KitPayload = z.object({
  name: z.string(),
  brandColor: z.string(),
  suffix: z.string(),
  targets: z.array(Target),
  missing: z.array(z.uuid()),
});

/** What a client receives of an agency brand kit: its name and colour (never the private notes). */
export const prepareBrandKitPublishQuery = tenantQuery({
  name: 'agencyOps.prepareBrandKitPublish',
  input: z.object({ kitId: z.uuid(), clientOrgIds: ClientIds }),
  output: KitPayload,
  entitlement: 'agency',
  permission: 'agency:manage',
  handler: async ({ input, ctx, tx }) => {
    await requireAgencyV2Tx(tx);
    const [kit] = await tx
      .select()
      .from(brandKits)
      .where(and(eq(brandKits.id, input.kitId), isNull(brandKits.receivedFromAgencyOrgId)));
    if (!kit) throw new DomainError('not_found', 'Brand kit not found', { field: 'kitId' });
    const live = await liveClientsTx(tx);
    const ids = [...new Set(input.clientOrgIds)];
    return {
      name: kit.name,
      brandColor: kit.brandColor,
      suffix: await agencyNameTx(tx, requireOrg(ctx)),
      targets: ids.flatMap((id) => {
        const g = live.get(id);
        return g ? [{ clientOrgId: id, grantId: g.grantId }] : [];
      }),
      missing: ids.filter((id) => !live.has(id)),
    };
  },
});

/**
 * Client side (the agency acting through its grant; `marketing:write`, so a manager or marketing
 * grant): the kit lands in the client's brand-kit library. Applying it to the client's public
 * pages is the client's own decision (`agencyOps.applyBrandKit`, org settings).
 */
export const receiveBrandKitCommand = tenantCommand({
  name: 'agencyOps.receiveBrandKit',
  input: z.object({
    sourceId: z.uuid(),
    name: KitName,
    brandColor: Color,
    suffix: z.string().trim().min(1).max(60),
  }),
  output: Received,
  entitlement: 'core',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    await requireAgencyV2Tx(tx);
    const { agencyOrgId } = actingAgency(ctx);
    const orgId = requireOrg(ctx);
    const link = await receivedTx(tx, agencyOrgId, 'brand_kit', input.sourceId);
    if (link) {
      const [row] = await tx
        .update(brandKits)
        .set({ brandColor: input.brandColor, updatedAt: ctx.now })
        .where(eq(brandKits.id, link.localId))
        .returning();
      if (row) return { localId: row.id, updated: true };
    }
    let kit: typeof brandKits.$inferSelect | undefined;
    for (const name of [input.name, `${input.name} (${input.suffix})`.slice(0, 80)]) {
      try {
        [kit] = await tx.transaction((sp) =>
          sp
            .insert(brandKits)
            .values({ orgId, name, brandColor: input.brandColor, receivedFromAgencyOrgId: agencyOrgId })
            .returning(),
        );
        break;
      } catch (err) {
        if (!isUniqueViolation(err, 'brand_kits_org_name_key')) throw err;
      }
    }
    if (!kit) throw new DomainError('conflict', 'A brand kit with this name exists', { field: 'name' });
    if (link)
      await tx
        .update(receivedItems)
        .set({ localId: kit.id, updatedAt: ctx.now })
        .where(eq(receivedItems.id, link.id));
    else
      await tx
        .insert(receivedItems)
        .values({ orgId, kind: 'brand_kit', localId: kit.id, agencyOrgId, sourceId: input.sourceId });
    return { localId: kit.id, updated: false };
  },
  audit: (_input, r) => ({
    action: 'agencyBrandKit.receive',
    targetType: 'brand_kit',
    targetId: r.localId,
    data: { status: r.updated ? 'updated' : 'created' },
  }),
});

/** Publish an agency brand kit to clients (each gets its own copy in its library). */
export async function publishBrandKit(
  ctx: Ctx,
  input: { kitId: string; clientOrgIds: readonly string[] },
  ports: CommandPorts<TenantTx>,
): Promise<PublishResultDto[]> {
  const p = await executeQuery(prepareBrandKitPublishQuery, input, ctx, ports);
  const results = await publishEach(ctx, ports, p.targets, p.missing, (clientCtx) =>
    executeCommand(
      receiveBrandKitCommand,
      { sourceId: input.kitId, name: p.name, brandColor: p.brandColor, suffix: p.suffix },
      clientCtx,
      ports,
    ),
  );
  await executeCommand(
    recordPublicationsCommand,
    { kind: 'brand_kit', sourceId: input.kitId, results },
    ctx,
    ports,
  );
  return results;
}

/**
 * Client side: use a received brand kit on the client's public pages and emails (sets the org's
 * brand colour). Org settings: the client's own members only (`org:update`, never an agency role).
 */
export const applyBrandKitCommand = tenantCommand({
  name: 'agencyOps.applyBrandKit',
  input: z.object({ kitId: z.uuid() }),
  output: BrandKitDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx, emit }) => {
    const [kit] = await tx.select().from(brandKits).where(eq(brandKits.id, input.kitId));
    if (!kit) throw new DomainError('not_found', 'Brand kit not found');
    await setBrandColorTx(tx, requireOrg(ctx), kit.brandColor, ctx.now, emit);
    const [row] = await tx
      .update(brandKits)
      .set({ appliedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(brandKits.id, kit.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return kitDto(row);
  },
  audit: (input) => ({ action: 'agencyBrandKit.apply', targetType: 'brand_kit', targetId: input.kitId }),
});
