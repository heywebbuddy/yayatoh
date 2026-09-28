import { type TenantTx, withoutTenant } from '@yayatoh/db';
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
import { setOrganizationLogoTx } from '@yayatoh/tenancy';
import { findVenueTx } from '@yayatoh/venues';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  MediaAssetDto,
  MediaUsageDto,
  type PublicMediaDto,
  publicMediaSerializer,
  UpdateAltInput,
  UploadLogoInput,
  UploadMediaInput,
  UploadResultDto,
} from './dto.ts';
import { variantFileName } from './pipeline/plan.ts';
import { MediaRejected, processImage } from './pipeline/process.ts';
import { assets, type OwnerType, quotas, type Slot, variants } from './schema.ts';
import { mediaStore } from './storage/config.ts';
import { storageKey } from './storage/port.ts';

/** Default per-org storage for images (all variants). Staff can override per org (`media.quotas`). */
export const DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024;
/** Images per multi-image slot (event gallery, venue photos). */
export const MAX_PER_SLOT = 20;
const SINGLE_SLOTS: readonly Slot[] = ['cover', 'logo'];
const OWNER_SLOTS: Readonly<Record<OwnerType, readonly Slot[]>> = {
  event: ['cover', 'gallery', 'floorplan'],
  venue: ['photo'],
  org: ['logo'],
};

export const mediaUrl = (orgId: string, assetId: string, fileName: string) =>
  `/media/${orgId}/${assetId}/${fileName}`;

type AssetRow = typeof assets.$inferSelect;
type VariantRow = typeof variants.$inferSelect;

function toDto(a: AssetRow, vs: readonly VariantRow[]): MediaAssetDto {
  return MediaAssetDto.parse({
    ...a,
    variants: vs
      .filter((v) => v.assetId === a.id)
      .sort((x, y) => x.width - y.width || x.format.localeCompare(y.format))
      .map((v) => ({
        format: v.format,
        width: v.width,
        height: v.height,
        fallback: v.fallback,
        url: mediaUrl(a.orgId, a.id, v.fileName),
      })),
  });
}

async function withVariants(tx: TenantTx, rows: AssetRow[]): Promise<MediaAssetDto[]> {
  if (rows.length === 0) return [];
  const vs = await tx
    .select()
    .from(variants)
    .where(
      inArray(
        variants.assetId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => toDto(r, vs));
}

async function usageTx(tx: TenantTx, excludeAssetIds: readonly string[] = []) {
  const [used] = await tx
    .select({ bytes: sql<string>`coalesce(sum(${assets.bytes}), 0)` })
    .from(assets)
    .where(excludeAssetIds.length ? sql`${assets.id} not in ${excludeAssetIds}` : undefined);
  const [q] = await tx.select({ limit: quotas.bytesLimit }).from(quotas);
  return { usedBytes: Number(used?.bytes ?? 0), limitBytes: q?.limit ?? DEFAULT_QUOTA_BYTES };
}

async function assertOwnerTx(tx: TenantTx, orgId: string, ownerType: OwnerType, ownerId: string) {
  const exists =
    ownerType === 'org'
      ? ownerId === orgId
      : ownerType === 'event'
        ? (await findEventTx(tx, ownerId)) !== null
        : (await findVenueTx(tx, ownerId)) !== null;
  if (!exists) throw new DomainError('not_found');
}

interface StoreArgs {
  readonly tx: TenantTx;
  readonly ctx: Ctx;
  readonly emit: (e: DomainEvent) => void;
  readonly ownerType: OwnerType;
  readonly ownerId: string;
  readonly slot: Slot;
  readonly input: {
    assetId: string;
    file: Uint8Array;
    alt: string | null;
    decorative: boolean;
    replaceAssetId: string | null;
  };
}

/**
 * The upload itself, inside the command's tenant transaction: check the owner and slot, run the
 * pipeline (sniff → sanitize → decode → re-encode), check the quota under a per-org lock, write
 * the files to the store and the rows, and (for a replacement) delete the old rows. The old files
 * are purged by the caller after commit (`uploadMedia`).
 */
async function storeUploadTx(
  a: StoreArgs,
): Promise<{ asset: MediaAssetDto; replacedAssetId: string | null }> {
  const orgId = requireOrg(a.ctx);
  if (!OWNER_SLOTS[a.ownerType].includes(a.slot))
    throw new DomainError('validation_failed', 'This slot does not belong to this owner', { field: 'slot' });
  await assertOwnerTx(a.tx, orgId, a.ownerType, a.ownerId);

  let processed: Awaited<ReturnType<typeof processImage>>;
  try {
    processed = await processImage(a.input.file);
  } catch (err) {
    if (err instanceof MediaRejected)
      throw new DomainError('validation_failed', 'The file is not a usable image', {
        field: 'file',
        reason: err.reason,
      });
    throw err;
  }
  const total = processed.variants.reduce((n, v) => n + v.bytes.byteLength, 0);

  // One upload at a time per org decides the quota and the slot's contents.
  await a.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`media:${orgId}`}, 0))`);
  const inSlot = await a.tx
    .select()
    .from(assets)
    .where(and(eq(assets.ownerType, a.ownerType), eq(assets.ownerId, a.ownerId), eq(assets.slot, a.slot)))
    .orderBy(asc(assets.position));
  let replaced: AssetRow | null = null;
  if (a.input.replaceAssetId) {
    replaced = inSlot.find((r) => r.id === a.input.replaceAssetId) ?? null;
    if (!replaced) throw new DomainError('not_found', 'The image to replace is not in this slot');
  } else if (SINGLE_SLOTS.includes(a.slot)) {
    replaced = inSlot[0] ?? null;
  } else if (inSlot.length >= MAX_PER_SLOT) {
    throw new DomainError('conflict', 'This slot is full', { reason: 'slot_full', field: 'file' });
  }
  const usage = await usageTx(a.tx, replaced ? [replaced.id] : []);
  if (usage.usedBytes + total > usage.limitBytes)
    throw new DomainError('conflict', 'The organization has used its image storage', {
      reason: 'quota_exceeded',
      field: 'file',
    });

  if (replaced) await a.tx.delete(assets).where(eq(assets.id, replaced.id));
  const position = replaced
    ? replaced.position
    : inSlot.length
      ? Math.max(...inSlot.map((r) => r.position)) + 1
      : 0;
  const [row] = await a.tx
    .insert(assets)
    .values({
      id: a.input.assetId,
      orgId,
      ownerType: a.ownerType,
      ownerId: a.ownerId,
      slot: a.slot,
      position,
      sourceType: processed.sourceType,
      width: processed.width,
      height: processed.height,
      alt: a.input.decorative ? null : a.input.alt?.trim() || null,
      decorative: a.input.decorative,
      bytes: total,
      createdBy: a.ctx.actor.type === 'user' ? a.ctx.actor.userId : null,
      createdAt: a.ctx.now,
      updatedAt: a.ctx.now,
    })
    .returning();
  if (!row) throw new DomainError('internal');

  const store = mediaStore();
  const rows: (typeof variants.$inferInsert)[] = [];
  for (const v of processed.variants) {
    const fileName = variantFileName({ format: v.format, width: v.width, hash: v.hash });
    if (rows.some((r) => r.fileName === fileName)) continue;
    await store.put(orgId, storageKey(orgId, row.id, fileName), v.bytes, v.contentType);
    rows.push({
      orgId,
      assetId: row.id,
      format: v.format,
      width: v.width,
      height: v.height,
      bytes: v.bytes.byteLength,
      sha256: v.hash,
      fileName,
      fallback: v.fallback,
    });
  }
  const inserted = await a.tx.insert(variants).values(rows).returning();
  const asset = toDto(row, inserted);

  if (a.ownerType === 'org') {
    const fallback = asset.variants.find((v) => v.fallback);
    if (!fallback || !row.alt) throw new DomainError('internal');
    await setOrganizationLogoTx(a.tx, orgId, { path: fallback.url, alt: row.alt });
  }
  a.emit({
    type: 'media.asset_added',
    version: 1,
    aggregateType: 'media_asset',
    aggregateId: row.id,
    payload: {
      orgId,
      assetId: row.id,
      ownerType: a.ownerType,
      ownerId: a.ownerId,
      slot: a.slot,
      replacedAssetId: replaced?.id ?? null,
    },
  });
  return { asset, replacedAssetId: replaced?.id ?? null };
}

const uploadAudit = (
  input: { assetId: string; alt: string | null; decorative: boolean },
  r: UploadResultDto,
) => ({
  action: 'media.upload',
  targetType: 'media_asset',
  targetId: input.assetId,
  data: {
    ownerType: r.asset.ownerType,
    ownerId: r.asset.ownerId,
    slot: r.asset.slot,
    sourceType: r.asset.sourceType,
    bytes: r.asset.bytes,
    replacedAssetId: r.replacedAssetId,
  },
});

/** Event cover and gallery, venue photos (people who can edit events). */
export const uploadMediaCommand = tenantCommand({
  name: 'media.uploadMedia',
  input: UploadMediaInput,
  output: UploadResultDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, ctx, tx, emit }) =>
    storeUploadTx({
      tx,
      ctx,
      emit,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      slot: input.slot,
      input,
    }),
  audit: uploadAudit,
});

/** The org's logo (people who can change the org's settings). */
export const uploadLogoCommand = tenantCommand({
  name: 'media.uploadLogo',
  input: UploadLogoInput,
  output: UploadResultDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: ({ input, ctx, tx, emit }) =>
    storeUploadTx({ tx, ctx, emit, ownerType: 'org', ownerId: requireOrg(ctx), slot: 'logo', input }),
  audit: uploadAudit,
});

async function findAssetTx(tx: TenantTx, assetId: string, family: 'content' | 'logo'): Promise<AssetRow> {
  const [row] = await tx.select().from(assets).where(eq(assets.id, assetId));
  // The logo belongs to org settings; event and venue images to the event editors.
  if (!row || (family === 'logo') !== (row.ownerType === 'org')) throw new DomainError('not_found');
  return row;
}

async function removeTx(tx: TenantTx, ctx: Ctx, emit: (e: DomainEvent) => void, row: AssetRow) {
  await tx.delete(assets).where(eq(assets.id, row.id));
  if (row.ownerType === 'org') await setOrganizationLogoTx(tx, requireOrg(ctx), null);
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
}

const RemoveInput = z.object({ assetId: z.uuid() });
const Ok = z.object({ ok: z.literal(true) });
const removeAudit = (input: { assetId: string }) => ({
  action: 'media.remove',
  targetType: 'media_asset',
  targetId: input.assetId,
});

export const removeMediaCommand = tenantCommand({
  name: 'media.removeMedia',
  category: 'delete',
  input: RemoveInput,
  output: Ok,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) =>
    removeTx(tx, ctx, emit, await findAssetTx(tx, input.assetId, 'content')),
  audit: removeAudit,
});

export const removeLogoCommand = tenantCommand({
  name: 'media.removeLogo',
  category: 'delete',
  input: RemoveInput,
  output: Ok,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx, emit }) =>
    removeTx(tx, ctx, emit, await findAssetTx(tx, input.assetId, 'logo')),
  audit: removeAudit,
});

async function updateAltTx(tx: TenantTx, ctx: Ctx, row: AssetRow, alt: string | null, decorative: boolean) {
  const [updated] = await tx
    .update(assets)
    .set({ alt: decorative ? null : alt?.trim() || null, decorative, updatedAt: ctx.now })
    .where(eq(assets.id, row.id))
    .returning();
  if (!updated) throw new DomainError('not_found');
  if (updated.ownerType === 'org' && updated.alt) {
    const [fb] = await tx
      .select()
      .from(variants)
      .where(and(eq(variants.assetId, updated.id), eq(variants.fallback, true)));
    if (fb)
      await setOrganizationLogoTx(tx, requireOrg(ctx), {
        path: mediaUrl(updated.orgId, updated.id, fb.fileName),
        alt: updated.alt,
      });
  }
  return (await withVariants(tx, [updated]))[0] as MediaAssetDto;
}

const altAudit = (input: { assetId: string; decorative: boolean }) => ({
  action: 'media.update_alt',
  targetType: 'media_asset',
  targetId: input.assetId,
  data: { decorative: input.decorative },
});

export const updateMediaAltCommand = tenantCommand({
  name: 'media.updateMediaAlt',
  input: UpdateAltInput,
  output: MediaAssetDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) =>
    updateAltTx(tx, ctx, await findAssetTx(tx, input.assetId, 'content'), input.alt, input.decorative),
  audit: altAudit,
});

export const updateLogoAltCommand = tenantCommand({
  name: 'media.updateLogoAlt',
  input: UpdateAltInput.refine((v) => !v.decorative, {
    message: 'A logo is never decorative',
    path: ['decorative'],
  }),
  output: MediaAssetDto,
  entitlement: 'core',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) =>
    updateAltTx(tx, ctx, await findAssetTx(tx, input.assetId, 'logo'), input.alt, false),
  audit: altAudit,
});

/** Images of one owner (optionally one slot), in slot order. Every member of the org may look. */
export const listMediaQuery = tenantQuery({
  name: 'media.listMedia',
  input: z.object({
    ownerType: z.enum(['event', 'venue', 'org']),
    ownerId: z.uuid(),
    slot: z.enum(['cover', 'gallery', 'photo', 'logo', 'floorplan']).optional(),
  }),
  output: z.array(MediaAssetDto),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.ownerType, input.ownerType),
          eq(assets.ownerId, input.ownerId),
          input.slot ? eq(assets.slot, input.slot) : undefined,
        ),
      )
      .orderBy(asc(assets.slot), asc(assets.position));
    return withVariants(tx, rows);
  },
});

export const mediaUsageQuery = tenantQuery({
  name: 'media.usage',
  input: z.object({}),
  output: MediaUsageDto,
  entitlement: 'core',
  permission: 'org:read',
  handler: ({ tx }) => usageTx(tx),
});

/**
 * Upload through the command, then purge files that no longer have rows: a replaced image's
 * after commit, or the new image's own when the transaction failed (a store is not
 * transactional). The asset id is always fresh here, so a purge can never hit a live image.
 */
export async function uploadMedia(
  ctx: Ctx,
  input: Omit<UploadMediaInput, 'assetId'>,
  ports: CommandPorts<TenantTx>,
): Promise<UploadResultDto> {
  return runUpload(ctx, (assetId) => executeCommand(uploadMediaCommand, { ...input, assetId }, ctx, ports));
}

export async function uploadLogo(
  ctx: Ctx,
  input: Omit<UploadLogoInput, 'assetId'>,
  ports: CommandPorts<TenantTx>,
): Promise<UploadResultDto> {
  return runUpload(ctx, (assetId) => executeCommand(uploadLogoCommand, { ...input, assetId }, ctx, ports));
}

async function runUpload(
  ctx: Ctx,
  run: (assetId: string) => Promise<UploadResultDto>,
): Promise<UploadResultDto> {
  const orgId = requireOrg(ctx);
  const assetId = crypto.randomUUID();
  let result: UploadResultDto;
  try {
    result = await run(assetId);
  } catch (err) {
    await mediaStore()
      .deleteAsset(orgId, assetId)
      .catch(() => undefined);
    throw err;
  }
  if (result.replacedAssetId) await mediaStore().deleteAsset(orgId, result.replacedAssetId);
  return result;
}

/** Remove an image (rows in the command's transaction, then its files). */
export async function removeMedia(
  ctx: Ctx,
  input: { assetId: string },
  ports: CommandPorts<TenantTx>,
  family: 'content' | 'logo' = 'content',
): Promise<void> {
  await executeCommand(family === 'logo' ? removeLogoCommand : removeMediaCommand, input, ctx, ports);
  await mediaStore().deleteAsset(requireOrg(ctx), input.assetId);
}

// ---------------------------------------------------------------------------------------------
// Public reads (SECURITY DEFINER functions with allowlisted columns).

type PublicRow = {
  org_id: string;
  asset_id: string;
  owner_id: string;
  slot: string;
  position: number;
  width: number;
  height: number;
  alt: string | null;
  decorative: boolean;
  variants: { format: string; width: number; height: number; file_name: string; fallback: boolean }[];
};

function toPublic(r: PublicRow): PublicMediaDto {
  return publicMediaSerializer.serialize({
    id: r.asset_id,
    ownerId: r.owner_id,
    slot: r.slot,
    position: r.position,
    width: r.width,
    height: r.height,
    alt: r.decorative ? '' : (r.alt ?? ''),
    decorative: r.decorative,
    variants: [...r.variants]
      .sort((x, y) => x.width - y.width || x.format.localeCompare(y.format))
      .map((v) => ({
        format: v.format,
        width: v.width,
        height: v.height,
        fallback: v.fallback,
        url: mediaUrl(r.org_id, r.asset_id, v.file_name),
      })),
  });
}

/**
 * The images of a public owner (event page, venue page, org page). Nothing for drafts, private
 * events (unless the server checked the visitor's access grant: `privateOk`), unlisted venues or
 * inactive orgs.
 */
export async function publicMedia(
  ownerType: OwnerType,
  ownerId: string,
  opts: { privateOk?: boolean } = {},
): Promise<PublicMediaDto[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<PublicRow>(
      sql`select * from media.public_media(${ownerType}, ${ownerId}::uuid, ${opts.privateOk === true})`,
    ),
  );
  // Floor plan images (M1.7g) are never page images: the seating map shows one when the
  // organizer chooses, through the media route's own check.
  return rows.filter((r) => r.slot !== 'floorplan').map(toPublic);
}

/** Cover images of public events by slug, for listing cards (any org). */
export async function publicCovers(eventSlugs: readonly string[]): Promise<Map<string, PublicMediaDto>> {
  const out = new Map<string, PublicMediaDto>();
  if (eventSlugs.length === 0) return out;
  const slugs = sql.join(
    eventSlugs.map((s) => sql`${s}`),
    sql`, `,
  );
  const rows = await withoutTenant((tx) =>
    tx.execute<PublicRow & { event_slug: string }>(
      sql`select * from media.public_covers(array[${slugs}]::text[])`,
    ),
  );
  for (const r of rows) out.set(r.event_slug, toPublic(r));
  return out;
}

export interface ServeTarget {
  readonly format: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly ownerType: OwnerType;
  readonly ownerId: string;
  /** `public`: anyone; `private_event`: a visitor with the event's access grant; `none`: members only. */
  readonly visibility: 'public' | 'private_event' | 'none';
  /** The slot (M1.7g: a `floorplan` image is public only where the organizer shows it). */
  readonly slot: Slot;
}

/** What a `/media/{org}/{asset}/{file}` request points at (no bytes), or null. */
export async function serveTarget(
  orgId: string,
  assetId: string,
  fileName: string,
): Promise<ServeTarget | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{
      format: string;
      bytes: number;
      sha256: string;
      owner_type: OwnerType;
      owner_id: string;
      visibility: ServeTarget['visibility'];
      slot: Slot;
    }>(sql`select * from media.serve_target_v2(${orgId}::uuid, ${assetId}::uuid, ${fileName})`),
  );
  const r = rows[0];
  return r
    ? {
        format: r.format,
        bytes: Number(r.bytes),
        sha256: r.sha256,
        ownerType: r.owner_type,
        ownerId: r.owner_id,
        visibility: r.visibility,
        slot: r.slot,
      }
    : null;
}

/** The bytes of a variant the caller is already allowed to see. */
export function readVariant(orgId: string, assetId: string, fileName: string): Promise<Uint8Array | null> {
  return mediaStore().get(orgId, storageKey(orgId, assetId, fileName));
}
