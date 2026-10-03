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
import {
  catchUpSubscriber,
  defineSubscriber,
  type Subscriber,
  tenantCommand,
  tenantQuery,
} from '@yayatoh/platform';
import { type ProgramOwnerKind, programOwnerTx } from '@yayatoh/program';
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
  UpdateProgramAltInput,
  UploadLogoInput,
  UploadMediaInput,
  UploadProgramImageInput,
  UploadResultDto,
} from './dto.ts';
import { variantFileName } from './pipeline/plan.ts';
import { MediaRejected, processImage } from './pipeline/process.ts';
import { assets, OWNER_TYPES, type OwnerType, quotas, SLOTS, type Slot, variants } from './schema.ts';
import { mediaStore } from './storage/config.ts';
import { storageKey } from './storage/port.ts';

/** Default per-org storage for images (all variants). Staff can override per org (`media.quotas`). */
export const DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024;
/** Images per multi-image slot (event gallery, venue photos). */
export const MAX_PER_SLOT = 20;
/** U10: images uploaded straight to the media library (reuses don't count; they hold no files). */
export const MAX_LIBRARY_IMAGES = 1000;
const maxFor = (ownerType: OwnerType) => (ownerType === 'library' ? MAX_LIBRARY_IMAGES : MAX_PER_SLOT);
const SINGLE_SLOTS: readonly Slot[] = ['cover', 'logo'];
const OWNER_SLOTS: Readonly<Record<OwnerType, readonly Slot[]>> = {
  event: ['cover', 'gallery', 'floorplan'],
  venue: ['photo'],
  org: ['logo'],
  speaker: ['photo'],
  exhibitor: ['logo'],
  sponsor: ['logo'],
  library: ['library'],
};
/** One image per owner slot (cover, logos, a speaker's photo); galleries and venue photos hold more. */
const isSingle = (ownerType: OwnerType, slot: Slot) => SINGLE_SLOTS.includes(slot) || ownerType === 'speaker';

/**
 * M1.4h: program rows that own one image each. The media command family of each kind needs the
 * program module's entitlement for that kind and `events:write` (like the program's own writes).
 */
export const PROGRAM_IMAGES = {
  speaker: { slot: 'photo', entitlement: 'speakers', command: 'SpeakerPhoto' },
  exhibitor: { slot: 'logo', entitlement: 'exhibitors', command: 'ExhibitorLogo' },
  sponsor: { slot: 'logo', entitlement: 'sponsors', command: 'SponsorLogo' },
} as const satisfies Record<ProgramOwnerKind, { slot: Slot; entitlement: string; command: string }>;
export type ProgramImageOwner = keyof typeof PROGRAM_IMAGES;
export const isProgramOwner = (t: string): t is ProgramImageOwner => Object.hasOwn(PROGRAM_IMAGES, t);

/** Which command family may touch an asset: event/venue images, the org logo, or one program kind. */
export type MediaFamily = 'content' | 'logo' | ProgramImageOwner;
export const familyOf = (ownerType: OwnerType): MediaFamily =>
  ownerType === 'org' ? 'logo' : isProgramOwner(ownerType) ? ownerType : 'content';

export const mediaUrl = (orgId: string, assetId: string, fileName: string) =>
  `/media/${orgId}/${assetId}/${fileName}`;

export type AssetRow = typeof assets.$inferSelect;
type VariantRow = typeof variants.$inferSelect;

export function toDto(a: AssetRow, vs: readonly VariantRow[]): MediaAssetDto {
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

export async function withVariants(tx: TenantTx, rows: AssetRow[]): Promise<MediaAssetDto[]> {
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

export async function usageTx(tx: TenantTx, excludeAssetIds: readonly string[] = []) {
  const [used] = await tx
    .select({ bytes: sql<string>`coalesce(sum(${assets.bytes}), 0)` })
    .from(assets)
    .where(excludeAssetIds.length ? sql`${assets.id} not in ${excludeAssetIds}` : undefined);
  const [q] = await tx.select({ limit: quotas.bytesLimit }).from(quotas);
  return { usedBytes: Number(used?.bytes ?? 0), limitBytes: q?.limit ?? DEFAULT_QUOTA_BYTES };
}

export async function assertOwnerTx(tx: TenantTx, orgId: string, ownerType: OwnerType, ownerId: string) {
  const exists =
    ownerType === 'org' || ownerType === 'library'
      ? ownerId === orgId
      : ownerType === 'event'
        ? (await findEventTx(tx, ownerId)) !== null
        : ownerType === 'venue'
          ? (await findVenueTx(tx, ownerId)) !== null
          : (await programOwnerTx(tx, ownerType, ownerId)) !== null;
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
export async function storeUploadTx(a: StoreArgs): Promise<UploadResultDto> {
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

  const { inSlot, replaced } = await slotTx(
    a.tx,
    orgId,
    a.ownerType,
    a.ownerId,
    a.slot,
    a.input.replaceAssetId,
  );
  // A replaced original that is reused elsewhere moves to the library (its files stay).
  const usage = await usageTx(a.tx, replaced && !(await reusedTx(a.tx, replaced.id)) ? [replaced.id] : []);
  if (usage.usedBytes + total > usage.limitBytes)
    throw new DomainError('conflict', 'The organization has used its image storage', {
      reason: 'quota_exceeded',
      field: 'file',
    });

  const released = replaced ? await releaseTx(a.tx, orgId, replaced) : null;
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
  return { asset, replacedAssetId: replaced?.id ?? null, filesKept: released ? !released.purge : false };
}

/**
 * The slot an image goes into, under the org's media lock (one placement at a time per org
 * decides the quota and the slot's contents): its current images, and the one the new image
 * replaces (the named one, or a single slot's current image). A full multi-image slot refuses.
 */
export async function slotTx(
  tx: TenantTx,
  orgId: string,
  ownerType: OwnerType,
  ownerId: string,
  slot: Slot,
  replaceAssetId: string | null,
): Promise<{ inSlot: AssetRow[]; replaced: AssetRow | null }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`media:${orgId}`}, 0))`);
  const inSlot = await tx
    .select()
    .from(assets)
    .where(and(eq(assets.ownerType, ownerType), eq(assets.ownerId, ownerId), eq(assets.slot, slot)))
    .orderBy(asc(assets.position));
  let replaced: AssetRow | null = null;
  if (replaceAssetId) {
    replaced = inSlot.find((r) => r.id === replaceAssetId) ?? null;
    if (!replaced) throw new DomainError('not_found', 'The image to replace is not in this slot');
  } else if (isSingle(ownerType, slot)) {
    replaced = inSlot[0] ?? null;
  } else if (inSlot.length >= maxFor(ownerType)) {
    throw new DomainError('conflict', 'This slot is full', { reason: 'slot_full', field: 'file' });
  }
  return { inSlot, replaced };
}

/** U10: whether an original is reused somewhere (a reuse row points at it). */
export async function reusedTx(tx: TenantTx, assetId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.sourceAssetId, assetId))
    .limit(1);
  return row !== undefined;
}

/**
 * Take an image out of its place. An original that is reused elsewhere moves to the org's media
 * library instead (rows and files stay, the reuses keep working); anything else is deleted.
 * `purge`: its files must be deleted after commit (a reuse has none of its own).
 */
export async function releaseTx(
  tx: TenantTx,
  orgId: string,
  row: AssetRow,
): Promise<{ purge: boolean; movedToLibrary: boolean }> {
  if (!row.sourceAssetId && (await reusedTx(tx, row.id))) {
    const [last] = await tx
      .select({ p: sql<number | null>`max(${assets.position})` })
      .from(assets)
      .where(eq(assets.ownerType, 'library'));
    await tx
      .update(assets)
      .set({
        ownerType: 'library',
        ownerId: orgId,
        slot: 'library',
        position: (last?.p ?? -1) + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(assets.id, row.id));
    return { purge: false, movedToLibrary: true };
  }
  await tx.delete(assets).where(eq(assets.id, row.id));
  return { purge: !row.sourceAssetId, movedToLibrary: false };
}

const uploadAudit = (
  input: { assetId: string; alt: string | null; decorative?: boolean },
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

export async function findAssetTx(tx: TenantTx, assetId: string, family: MediaFamily): Promise<AssetRow> {
  const [row] = await tx.select().from(assets).where(eq(assets.id, assetId));
  // The logo belongs to org settings, event and venue images to the event editors, and each
  // program kind to its own commands (their entitlements differ).
  if (!row || familyOf(row.ownerType as OwnerType) !== family) throw new DomainError('not_found');
  return row;
}

async function removeTx(tx: TenantTx, ctx: Ctx, emit: (e: DomainEvent) => void, row: AssetRow) {
  const released = await releaseTx(tx, requireOrg(ctx), row);
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
  return { ok: true as const, purged: released.purge };
}

const RemoveInput = z.object({ assetId: z.uuid() });
/** `purged`: the image's files go after commit (false for a reuse, or an original moved to the library). */
const Ok = z.object({ ok: z.literal(true), purged: z.boolean() });
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

const altAudit = (input: { assetId: string; decorative?: boolean }) => ({
  action: 'media.update_alt',
  targetType: 'media_asset',
  targetId: input.assetId,
  data: { decorative: input.decorative ?? false },
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

/* ------------------------------------------------ program images (M1.4h) ---- */

function programImageCommands<K extends ProgramImageOwner>(kind: K) {
  const spec = PROGRAM_IMAGES[kind];
  const upload = tenantCommand({
    name: `media.upload${spec.command}`,
    input: UploadProgramImageInput,
    output: UploadResultDto,
    entitlement: spec.entitlement,
    permission: 'events:write',
    handler: ({ input, ctx, tx, emit }) =>
      storeUploadTx({
        tx,
        ctx,
        emit,
        ownerType: kind,
        ownerId: input.ownerId,
        slot: spec.slot,
        input: { ...input, decorative: false },
      }),
    audit: uploadAudit,
  });
  const remove = tenantCommand({
    name: `media.remove${spec.command}`,
    // Removing an image deletes its files (impersonating staff may not, M1.2e).
    category: 'delete',
    input: RemoveInput,
    output: Ok,
    entitlement: spec.entitlement,
    permission: 'events:write',
    handler: async ({ input, ctx, tx, emit }) =>
      removeTx(tx, ctx, emit, await findAssetTx(tx, input.assetId, kind)),
    audit: removeAudit,
  });
  const updateAlt = tenantCommand({
    name: `media.update${spec.command}Alt`,
    input: UpdateProgramAltInput,
    output: MediaAssetDto,
    entitlement: spec.entitlement,
    permission: 'events:write',
    handler: async ({ input, ctx, tx }) =>
      updateAltTx(tx, ctx, await findAssetTx(tx, input.assetId, kind), input.alt, false),
    audit: altAudit,
  });
  return { upload, remove, updateAlt };
}

/**
 * M5.3a: store an approved portal photo as a program image (the speaker-photo subscriber), in
 * the subscriber's transaction and with the same pipeline and checks as an organizer upload.
 */
export function storeProgramImageTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
  a: { kind: ProgramImageOwner; ownerId: string; assetId: string; file: Uint8Array; alt: string },
): Promise<UploadResultDto> {
  return storeUploadTx({
    tx,
    ctx,
    emit,
    ownerType: a.kind,
    ownerId: a.ownerId,
    slot: PROGRAM_IMAGES[a.kind].slot,
    input: { assetId: a.assetId, file: a.file, alt: a.alt, decorative: false, replaceAssetId: null },
  });
}

/** Upload, remove and alt-text commands per program kind (speaker photo, exhibitor/sponsor logo). */
export const programImageCommand = {
  speaker: programImageCommands('speaker'),
  exhibitor: programImageCommands('exhibitor'),
  sponsor: programImageCommands('sponsor'),
} as const;

/** Change a program image's alt text (never decorative). */
export function updateProgramImageAlt(
  kind: ProgramImageOwner,
  input: UpdateProgramAltInput,
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
) {
  return executeCommand(programImageCommand[kind].updateAlt, input, ctx, ports);
}

/** Images of one owner (optionally one slot), in slot order. Every member of the org may look. */
export const listMediaQuery = tenantQuery({
  name: 'media.listMedia',
  input: z.object({
    ownerType: z.enum(OWNER_TYPES),
    ownerId: z.uuid(),
    slot: z.enum(SLOTS).optional(),
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

/**
 * The images of many owners of one type at once (console lists: speaker, exhibitor and sponsor
 * thumbnails), by owner id. Every member of the org may look.
 */
export const listOwnersMediaQuery = tenantQuery({
  name: 'media.listOwnersMedia',
  input: z.object({ ownerType: z.enum(OWNER_TYPES), ownerIds: z.array(z.uuid()).max(500) }),
  output: z.array(MediaAssetDto),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, tx }) => {
    if (input.ownerIds.length === 0) return [];
    const rows = await tx
      .select()
      .from(assets)
      .where(and(eq(assets.ownerType, input.ownerType), inArray(assets.ownerId, input.ownerIds)))
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

/** A speaker photo or an exhibitor/sponsor logo (replaces the current one; old files purged). */
export async function uploadProgramImage(
  ctx: Ctx,
  kind: ProgramImageOwner,
  input: Omit<UploadProgramImageInput, 'assetId'>,
  ports: CommandPorts<TenantTx>,
): Promise<UploadResultDto> {
  return runUpload(ctx, (assetId) =>
    executeCommand(programImageCommand[kind].upload, { ...input, assetId }, ctx, ports),
  );
}

export async function runUpload(
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
  if (result.replacedAssetId && !result.filesKept)
    await mediaStore().deleteAsset(orgId, result.replacedAssetId);
  return result;
}

/** Remove an image (rows in the command's transaction, then its files). */
export async function removeMedia(
  ctx: Ctx,
  input: { assetId: string },
  ports: CommandPorts<TenantTx>,
  family: MediaFamily = 'content',
): Promise<void> {
  const command =
    family === 'logo'
      ? removeLogoCommand
      : family === 'content'
        ? removeMediaCommand
        : programImageCommand[family].remove;
  const r = await executeCommand(command, input, ctx, ports);
  if (r.purged) await mediaStore().deleteAsset(requireOrg(ctx), input.assetId);
}

/**
 * M1.4h: a deleted speaker, exhibitor or sponsor takes its images along. The program module (a
 * lower tier) emits `program.{kind}_deleted@1`; this subscriber deletes the rows and then the
 * files (the store is idempotent, so a replay after a failed commit only repeats the purge).
 * Until it runs, the image is already private: its owner no longer exists, so
 * `media.owner_visibility` says `none`.
 */
export function programMediaCleaner(): Subscriber {
  return defineSubscriber({
    name: 'media.program-owner-cleanup',
    events: ['program.speaker_deleted@1', 'program.exhibitor_deleted@1', 'program.sponsor_deleted@1'],
    handle: async (tx, event) => {
      const p = z
        .object({ kind: z.enum(['speaker', 'exhibitor', 'sponsor']), id: z.uuid() })
        .parse(event.payload);
      const rows = await tx
        .select()
        .from(assets)
        .where(and(eq(assets.ownerType, p.kind), eq(assets.ownerId, p.id)));
      // U10: a photo reused elsewhere stays in the media library.
      const purge: string[] = [];
      for (const row of rows) if ((await releaseTx(tx, event.orgId, row)).purge) purge.push(row.id);
      for (const id of purge) await mediaStore().deleteAsset(event.orgId, id);
    },
  });
}

/** Apply the org's pending program deletions now (the web right after a delete; e2e and seeds). */
export function catchUpProgramMedia(orgId: string): Promise<number> {
  return catchUpSubscriber(programMediaCleaner(), orgId);
}

/** The images of an event's program (speakers, exhibitors, sponsors), by owner id. */
export async function publicProgramMedia(
  orgId: string,
  eventId: string,
  opts: { privateOk?: boolean } = {},
): Promise<Map<string, PublicMediaDto>> {
  const rows = await withoutTenant((tx) =>
    tx.execute<PublicRow>(
      sql`select * from media.public_program_media(${orgId}::uuid, ${eventId}::uuid, ${opts.privateOk === true})`,
    ),
  );
  return new Map(rows.map((r) => [r.owner_id, toPublic(r)]));
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
  /** The event whose access grant opens a private image (the event itself, or a program row's event). */
  readonly eventId: string | null;
  /** `public`: anyone; `private_event`: a visitor with the event's access grant; `none`: members only. */
  readonly visibility: 'public' | 'private_event' | 'none';
  /** The slot (M1.7g: a `floorplan` image is public only where the organizer shows it). */
  readonly slot: Slot;
  /** U10: the asset whose files hold the bytes (a library reuse names its original's files). */
  readonly storageAssetId: string;
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
      event_id: string | null;
      visibility: ServeTarget['visibility'];
      slot: Slot;
      storage_asset_id: string;
    }>(sql`select * from media.serve_target_v3(${orgId}::uuid, ${assetId}::uuid, ${fileName})`),
  );
  const r = rows[0];
  return r
    ? {
        format: r.format,
        bytes: Number(r.bytes),
        sha256: r.sha256,
        ownerType: r.owner_type,
        ownerId: r.owner_id,
        eventId: r.event_id,
        visibility: r.visibility,
        slot: r.slot,
        storageAssetId: r.storage_asset_id,
      }
    : null;
}

/**
 * The bytes of a variant the caller is already allowed to see. Pass `ServeTarget.storageAssetId`
 * (a library reuse's bytes live under its original).
 */
export function readVariant(orgId: string, assetId: string, fileName: string): Promise<Uint8Array | null> {
  return mediaStore().get(orgId, storageKey(orgId, assetId, fileName));
}
