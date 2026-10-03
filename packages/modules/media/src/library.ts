import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import {
  type CommandPorts,
  type Ctx,
  DomainError,
  type DomainEvent,
  executeCommand,
  requireOrg,
} from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { programOwnerTx } from '@yayatoh/program';
import { setOrganizationLogoTx } from '@yayatoh/tenancy';
import { findVenueTx } from '@yayatoh/venues';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MediaAssetDto, UploadResultDto } from './dto.ts';
import {
  type AssetRow,
  assertOwnerTx,
  DEFAULT_QUOTA_BYTES,
  type MediaFamily,
  PROGRAM_IMAGES,
  releaseTx,
  reusedTx,
  slotTx,
  toDto,
  usageTx,
  withVariants,
} from './media.ts';
import { assets, OWNER_TYPES, type OwnerType, quotas, SLOTS, variants } from './schema.ts';
import { portalFiles } from './schema-files.ts';
import { mediaStore } from './storage/config.ts';

/**
 * U10 media library: every image the org has uploaded (its originals), reusable in other places
 * without uploading again. A reuse is a placement of its own (owner, slot, alt text, position)
 * whose variant rows name the original's files: nothing is stored twice, a reuse counts 0 bytes
 * against the quota, and an original can't be deleted while it is reused (FK `assets_source_fk`
 * plus `releaseTx`, which moves a reused original to the library instead of deleting it).
 */

/** Where an image appears: its own place, or a reuse's. Labels are resolved for the console. */
export const PlacementDto = z.object({
  assetId: z.uuid(),
  ownerType: z.enum(OWNER_TYPES),
  ownerId: z.uuid(),
  slot: z.enum(SLOTS),
  /** The event, venue, speaker, exhibitor or sponsor name (empty for the org logo). */
  label: z.string(),
  /** The event's slug, for events and program rows (console links). */
  eventSlug: z.string().nullable(),
});
export type PlacementDto = z.infer<typeof PlacementDto>;

export const LibraryItemDto = z.object({
  asset: MediaAssetDto,
  /** Every place the image is shown (empty: unused, only in the library). */
  usedIn: z.array(PlacementDto),
});
export type LibraryItemDto = z.infer<typeof LibraryItemDto>;

export const LibraryDto = z.object({ items: z.array(LibraryItemDto), total: z.number().int() });
export type LibraryDto = z.infer<typeof LibraryDto>;

/** The places a reuse can go (a floor plan stays an upload: it is drawn under a seating plan). */
const ReuseTarget = z.discriminatedUnion('ownerType', [
  z.object({ ownerType: z.literal('event'), ownerId: z.uuid(), slot: z.enum(['cover', 'gallery']) }),
  z.object({ ownerType: z.literal('venue'), ownerId: z.uuid(), slot: z.literal('photo') }),
  z.object({ ownerType: z.literal('org'), ownerId: z.uuid(), slot: z.literal('logo') }),
  z.object({ ownerType: z.literal('speaker'), ownerId: z.uuid(), slot: z.literal('photo') }),
  z.object({ ownerType: z.literal('exhibitor'), ownerId: z.uuid(), slot: z.literal('logo') }),
  z.object({ ownerType: z.literal('sponsor'), ownerId: z.uuid(), slot: z.literal('logo') }),
]);

const altRequired = (v: { alt?: string | null; decorative?: boolean }) =>
  v.decorative === true || (typeof v.alt === 'string' && v.alt.trim().length > 0);

export const ReuseMediaInput = z
  .object({
    /** Chosen by the server wrapper (never by a client). */
    assetId: z.uuid(),
    sourceAssetId: z.uuid(),
    target: ReuseTarget,
    /** Alt text for this place (prefilled with the library's; required unless decorative). */
    alt: z.string().trim().max(300).nullable().default(null),
    decorative: z.boolean().default(false),
    replaceAssetId: z.uuid().nullable().default(null),
  })
  .refine(altRequired, { message: 'Describe the image, or mark it decorative', path: ['alt'] })
  .refine((v) => !v.decorative || v.target.ownerType === 'event' || v.target.ownerType === 'venue', {
    message: 'Logos and program photos are always described',
    path: ['decorative'],
  });
export type ReuseMediaInput = z.input<typeof ReuseMediaInput>;

/** Which command family a target belongs to (the same split as uploads: permissions differ). */
export const familyOfTarget = (ownerType: OwnerType): MediaFamily =>
  ownerType === 'org'
    ? 'logo'
    : ownerType === 'speaker' || ownerType === 'exhibitor' || ownerType === 'sponsor'
      ? ownerType
      : 'content';

async function reuseTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
  input: z.output<typeof ReuseMediaInput>,
): Promise<UploadResultDto> {
  const orgId = requireOrg(ctx);
  const { ownerType, ownerId, slot } = input.target;
  await assertOwnerTx(tx, orgId, ownerType, ownerId);
  const [picked] = await tx.select().from(assets).where(eq(assets.id, input.sourceAssetId));
  if (!picked) throw new DomainError('not_found', 'That image is not in the library');
  // Always point at the original, never at another reuse.
  const original = picked.sourceAssetId
    ? (await tx.select().from(assets).where(eq(assets.id, picked.sourceAssetId)))[0]
    : picked;
  if (!original) throw new DomainError('not_found', 'That image is not in the library');

  const { inSlot, replaced } = await slotTx(tx, orgId, ownerType, ownerId, slot, input.replaceAssetId);
  const already = inSlot.some(
    (r) => r.id !== replaced?.id && (r.id === original.id || r.sourceAssetId === original.id),
  );
  if (already)
    throw new DomainError('conflict', 'This image is already here', {
      reason: 'already_here',
      field: 'sourceAssetId',
    });
  // Re-placing an image onto its own original's place is a no-op the organizer didn't mean.
  if (replaced && (replaced.id === original.id || replaced.sourceAssetId === original.id))
    throw new DomainError('conflict', 'This image is already here', {
      reason: 'already_here',
      field: 'sourceAssetId',
    });
  const released = replaced ? await releaseTx(tx, orgId, replaced) : null;
  const position = replaced
    ? replaced.position
    : inSlot.length
      ? Math.max(...inSlot.map((r) => r.position)) + 1
      : 0;
  const [row] = await tx
    .insert(assets)
    .values({
      id: input.assetId,
      orgId,
      ownerType,
      ownerId,
      slot,
      position,
      sourceType: original.sourceType,
      width: original.width,
      height: original.height,
      alt: input.decorative ? null : input.alt?.trim() || null,
      decorative: input.decorative,
      bytes: 0,
      sourceAssetId: original.id,
      createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning();
  if (!row) throw new DomainError('internal');
  // The reuse's variant rows name the original's files (same names, hashes and sizes).
  const files = await tx.select().from(variants).where(eq(variants.assetId, original.id));
  const inserted = files.length
    ? await tx
        .insert(variants)
        .values(
          files.map((v) => ({
            orgId,
            assetId: row.id,
            format: v.format,
            width: v.width,
            height: v.height,
            bytes: v.bytes,
            sha256: v.sha256,
            fileName: v.fileName,
            fallback: v.fallback,
          })),
        )
        .returning()
    : [];
  const asset = toDto(row, inserted);
  if (ownerType === 'org') {
    const fallback = asset.variants.find((v) => v.fallback);
    if (!fallback || !row.alt) throw new DomainError('internal');
    await setOrganizationLogoTx(tx, orgId, { path: fallback.url, alt: row.alt });
  }
  emit({
    type: 'media.asset_added',
    version: 1,
    aggregateType: 'media_asset',
    aggregateId: row.id,
    payload: {
      orgId,
      assetId: row.id,
      ownerType,
      ownerId,
      slot,
      replacedAssetId: replaced?.id ?? null,
    },
  });
  return { asset, replacedAssetId: replaced?.id ?? null, filesKept: released ? !released.purge : false };
}

const reuseAudit = (input: { assetId: string; sourceAssetId: string }, r: UploadResultDto) => ({
  action: 'media.reuse',
  targetType: 'media_asset',
  targetId: input.assetId,
  data: {
    sourceAssetId: input.sourceAssetId,
    ownerType: r.asset.ownerType,
    ownerId: r.asset.ownerId,
    slot: r.asset.slot,
    replacedAssetId: r.replacedAssetId,
  },
});

function reuseCommand(family: MediaFamily) {
  const program = family !== 'content' && family !== 'logo' ? PROGRAM_IMAGES[family] : null;
  return tenantCommand({
    name: `media.reuse${family === 'content' ? 'Media' : family === 'logo' ? 'Logo' : program?.command}`,
    input: ReuseMediaInput.refine((v) => familyOfTarget(v.target.ownerType) === family, {
      message: 'Not a place this command fills',
      path: ['target'],
    }),
    output: UploadResultDto,
    entitlement: program ? program.entitlement : 'core',
    permission: family === 'logo' ? 'org:update' : 'events:write',
    handler: ({ input, ctx, tx, emit }) => reuseTx(tx, ctx, emit, input),
    audit: reuseAudit,
  });
}

/** Reuse a library image in a place, per family (event/venue images, the logo, each program kind). */
export const reuseMediaCommand = {
  content: reuseCommand('content'),
  logo: reuseCommand('logo'),
  speaker: reuseCommand('speaker'),
  exhibitor: reuseCommand('exhibitor'),
  sponsor: reuseCommand('sponsor'),
} as const satisfies Record<MediaFamily, unknown>;

/**
 * Put a library image in a place (the new placement's id is fresh). A replaced image's files are
 * purged after commit unless it was an original reused elsewhere (then it moved to the library).
 */
export async function reuseMedia(
  ctx: Ctx,
  input: Omit<ReuseMediaInput, 'assetId'>,
  ports: CommandPorts<TenantTx>,
): Promise<UploadResultDto> {
  const family = familyOfTarget(input.target.ownerType);
  const r = await executeCommand(
    reuseMediaCommand[family],
    { ...input, assetId: crypto.randomUUID() },
    ctx,
    ports,
  );
  if (r.replacedAssetId && !r.filesKept) await mediaStore().deleteAsset(requireOrg(ctx), r.replacedAssetId);
  return r;
}

/* ------------------------------------------------------------------- library list ---- */

type LabelCache = Map<string, { label: string; eventSlug: string | null }>;

async function labelOf(tx: TenantTx, cache: LabelCache, ownerType: OwnerType, ownerId: string) {
  const key = `${ownerType}:${ownerId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out = { label: '', eventSlug: null as string | null };
  if (ownerType === 'event') {
    const ev = await findEventTx(tx, ownerId);
    out = { label: ev?.name ?? '', eventSlug: ev?.slug ?? null };
  } else if (ownerType === 'venue') {
    out = { label: (await findVenueTx(tx, ownerId))?.name ?? '', eventSlug: null };
  } else if (ownerType === 'speaker' || ownerType === 'exhibitor' || ownerType === 'sponsor') {
    const p = await programOwnerTx(tx, ownerType, ownerId);
    const ev = p ? await findEventTx(tx, p.eventId) : null;
    out = { label: p?.name ?? '', eventSlug: ev?.slug ?? null };
  }
  cache.set(key, out);
  return out;
}

async function placementsTx(
  tx: TenantTx,
  originals: readonly AssetRow[],
): Promise<Map<string, PlacementDto[]>> {
  const out = new Map<string, PlacementDto[]>(originals.map((o) => [o.id, []]));
  if (originals.length === 0) return out;
  const reuses = await tx
    .select()
    .from(assets)
    .where(
      inArray(
        assets.sourceAssetId,
        originals.map((o) => o.id),
      ),
    );
  const cache: LabelCache = new Map();
  for (const row of [...originals, ...reuses]) {
    if (row.ownerType === 'library') continue;
    const root = row.sourceAssetId ?? row.id;
    const { label, eventSlug } = await labelOf(tx, cache, row.ownerType as OwnerType, row.ownerId);
    out.get(root)?.push(
      PlacementDto.parse({
        assetId: row.id,
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        slot: row.slot,
        label,
        eventSlug,
      }),
    );
  }
  return out;
}

/** The org's library: its originals, newest first, each with where it is used. Every member may look. */
export const libraryQuery = tenantQuery({
  name: 'media.library',
  input: z.object({
    limit: z.number().int().min(1).max(200).default(60),
    offset: z.number().int().min(0).max(100_000).default(0),
    /** Only images not used anywhere. */
    unusedOnly: z.boolean().default(false),
  }),
  output: LibraryDto,
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, tx }) => {
    // Floor plan images belong to seating plans; they are not offered for reuse.
    const where = and(isNull(assets.sourceAssetId), sql`${assets.slot} <> 'floorplan'`);
    const all = await tx.select().from(assets).where(where).orderBy(desc(assets.createdAt), desc(assets.id));
    const used = await placementsTx(tx, all);
    const filtered = input.unusedOnly ? all.filter((r) => (used.get(r.id) ?? []).length === 0) : all;
    const page = filtered.slice(input.offset, input.offset + input.limit);
    const withFiles = await withVariants(tx, page);
    return {
      total: filtered.length,
      items: withFiles.map((asset) => ({ asset, usedIn: used.get(asset.id) ?? [] })),
    };
  },
});

/**
 * Delete an image from the library: only an image that is used nowhere (an original in the
 * library with no reuse). Anything in use says where; remove it there first.
 */
export const deleteLibraryImageCommand = tenantCommand({
  name: 'media.deleteLibraryImage',
  category: 'delete',
  input: z.object({ assetId: z.uuid() }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, tx, emit }) => {
    const [row] = await tx.select().from(assets).where(eq(assets.id, input.assetId));
    if (!row || row.sourceAssetId) throw new DomainError('not_found');
    if (row.ownerType !== 'library' || (await reusedTx(tx, row.id)))
      throw new DomainError('conflict', 'This image is in use; remove it where it is used first', {
        reason: 'in_use',
      });
    await tx.delete(assets).where(eq(assets.id, row.id));
    emit({
      type: 'media.asset_removed',
      version: 1,
      aggregateType: 'media_asset',
      aggregateId: row.id,
      payload: {
        orgId: row.orgId,
        assetId: row.id,
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        slot: row.slot,
      },
    });
    return { ok: true as const };
  },
  audit: (input) => ({ action: 'media.library.delete', targetType: 'media_asset', targetId: input.assetId }),
});

/** Delete an unused library image: its rows in the command, then its files. */
export async function deleteLibraryImage(
  ctx: Ctx,
  input: { assetId: string },
  ports: CommandPorts<TenantTx>,
): Promise<void> {
  await executeCommand(deleteLibraryImageCommand, input, ctx, ports);
  await mediaStore().deleteAsset(requireOrg(ctx), input.assetId);
}

/* ------------------------------------------------------------------- storage usage ---- */

export const STORAGE_KINDS = ['events', 'venues', 'program', 'logo', 'library'] as const;
export type StorageKind = (typeof STORAGE_KINDS)[number];

const kindOf = (ownerType: string): StorageKind =>
  ownerType === 'event'
    ? 'events'
    : ownerType === 'venue'
      ? 'venues'
      : ownerType === 'org'
        ? 'logo'
        : ownerType === 'library'
          ? 'library'
          : 'program';

export const StorageUsageDto = z.object({
  /** Stored bytes of every original's files (what the quota counts). */
  usedBytes: z.number().int(),
  limitBytes: z.number().int(),
  /** Whether staff set this org's quota (else the platform default). */
  customLimit: z.boolean(),
  /** Originals (images with files of their own) and the files they became. */
  images: z.number().int(),
  files: z.number().int(),
  /** Placements that reuse a library image (no files, 0 bytes). */
  reuses: z.number().int(),
  byKind: z.array(
    z.object({ kind: z.enum(STORAGE_KINDS), bytes: z.number().int(), images: z.number().int() }),
  ),
  /** The biggest originals, largest first. */
  largest: z.array(LibraryItemDto),
  /** Speaker portal uploads (slides, documents): stored apart from the image quota. */
  portalFiles: z.object({ bytes: z.number().int(), files: z.number().int() }),
});
export type StorageUsageDto = z.infer<typeof StorageUsageDto>;

/** The org's storage: quota, usage by kind, the largest images. Every member may look. */
export const storageUsageQuery = tenantQuery({
  name: 'media.storageUsage',
  input: z.object({ largest: z.number().int().min(0).max(50).default(10) }),
  output: StorageUsageDto,
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, tx }) => {
    const usage = await usageTx(tx);
    const [q] = await tx.select({ id: quotas.id }).from(quotas);
    const groups = await tx
      .select({
        ownerType: assets.ownerType,
        bytes: sql<string>`coalesce(sum(${assets.bytes}), 0)`,
        n: sql<number>`count(*)::int`,
      })
      .from(assets)
      .where(isNull(assets.sourceAssetId))
      .groupBy(assets.ownerType);
    const byKind = new Map<StorageKind, { bytes: number; images: number }>();
    for (const g of groups) {
      const k = kindOf(g.ownerType);
      const cur = byKind.get(k) ?? { bytes: 0, images: 0 };
      byKind.set(k, { bytes: cur.bytes + Number(g.bytes), images: cur.images + g.n });
    }
    const [counts] = await tx
      .select({ files: sql<number>`count(*)::int` })
      .from(variants)
      .innerJoin(assets, and(eq(assets.orgId, variants.orgId), eq(assets.id, variants.assetId)))
      .where(isNull(assets.sourceAssetId));
    const [reuseCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assets)
      .where(sql`${assets.sourceAssetId} is not null`);
    const [portal] = await tx
      .select({ bytes: sql<string>`coalesce(sum(${portalFiles.bytes}), 0)`, n: sql<number>`count(*)::int` })
      .from(portalFiles);
    const top = input.largest
      ? await tx
          .select()
          .from(assets)
          .where(isNull(assets.sourceAssetId))
          .orderBy(desc(assets.bytes), desc(assets.createdAt))
          .limit(input.largest)
      : [];
    const used = await placementsTx(tx, top);
    const largest = (await withVariants(tx, top)).map((asset) => ({
      asset,
      usedIn: used.get(asset.id) ?? [],
    }));
    return {
      usedBytes: usage.usedBytes,
      limitBytes: usage.limitBytes ?? DEFAULT_QUOTA_BYTES,
      customLimit: q !== undefined,
      images: [...byKind.values()].reduce((n, k) => n + k.images, 0),
      files: counts?.files ?? 0,
      reuses: reuseCount?.n ?? 0,
      byKind: STORAGE_KINDS.map((kind) => ({ kind, ...(byKind.get(kind) ?? { bytes: 0, images: 0 }) })),
      largest,
      portalFiles: { bytes: Number(portal?.bytes ?? 0), files: portal?.n ?? 0 },
    };
  },
});
