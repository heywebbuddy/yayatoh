import { randomBytes, randomUUID } from 'node:crypto';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { guestSiteAccessTx, guestSiteCodeTx } from '@yayatoh/guests';
import {
  actorId,
  type Command,
  type CommandPorts,
  type Ctx,
  createCtx,
  DomainError,
  executeCommand,
  requireOrg,
} from '@yayatoh/kernel';
import {
  MediaRejected,
  mediaStore,
  type ProcessedImage,
  processImage,
  sniff,
  variantFileName,
} from '@yayatoh/media';
import { appTokenSecret, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, count, desc, eq, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isHeic } from './domain/heic.ts';
import { clampLimit, GALLERY_LIMITS, quotaRefusal } from './domain/limits.ts';
import { signFile, signUploader, verifyUploader } from './domain/tokens.ts';
import { parseVideoLink, videoUrl } from './domain/video.ts';
import {
  AddGuestVideoInput,
  AddVideoInput,
  AddVideoResultDto,
  ChangeResultDto,
  CompleteGuestUploadInput,
  CompleteResultDto,
  CompleteUploadInput,
  type GalleryItemDto,
  GallerySettingsDto,
  HostGalleryDto,
  ModerateInput,
  PublicGalleryDto,
  type Refusal,
  RemoveItemInput,
  RemoveOwnItemInput,
  RequestGuestUploadInput,
  RequestUploadInput,
  SaveSettingsInput,
  SlidesDto,
  UploadSlotDto,
} from './dto.ts';
import { heicDecoder, uploadSlot, videoHostFromEnv } from './ports.ts';
import { publishItemTx } from './realtime.ts';
import { items, type PhotoSource, settings, uploaders, variants } from './schema.ts';

/**
 * The event gallery (M4.5b, P4-5, P4-6). Guests (past the guest site's password) and hosts upload
 * photos straight to storage through a signed slot; the bytes are then sniffed (HEIC decoded
 * through its port) and re-encoded by the media pipeline, so EXIF/GPS never survive. Guest uploads
 * wait for the host unless the host chose auto-publish; host uploads publish at once. The
 * per-event storage cap and the per-guest quota are checked under the event's lock when a slot
 * is handed out (the declared size) and again when the photo is processed (the stored size).
 * Video is links only (YouTube, Vimeo). Guests' photos are personal data: tenant rows, private
 * until published, read only through these allowlisted queries with signed, expiring file URLs.
 */

type ItemRow = typeof items.$inferSelect;
type SettingsRow = typeof settings.$inferSelect;

const SLOT_MS = GALLERY_LIMITS.uploadSlotSeconds * 1000;
const LIST_LIMIT = 500;
const SLIDES_LIMIT = 200;

/* ------------------------------------------------------------------------------ helpers ---- */

async function eventTx(tx: TenantTx, eventId: string) {
  const ev = await findEventTx(tx, eventId);
  if (!ev) throw new DomainError('not_found', 'Event not found', { field: 'eventId' });
  return ev;
}

async function settingsOfTx(tx: TenantTx, eventId: string): Promise<SettingsRow | null> {
  const [row] = await tx.select().from(settings).where(eq(settings.eventId, eventId));
  return row ?? null;
}

function settingsDto(row: SettingsRow | null): GallerySettingsDto {
  return GallerySettingsDto.parse({
    enabled: row?.enabled ?? false,
    moderation: row?.moderation ?? 'hold',
    capBytes: row?.capBytes ?? GALLERY_LIMITS.eventCapBytes,
    guestQuotaBytes: row?.guestQuotaBytes ?? GALLERY_LIMITS.guestQuotaBytes,
    guestQuotaItems: row?.guestQuotaItems ?? GALLERY_LIMITS.guestQuotaItems,
    maxCapBytes: GALLERY_LIMITS.eventCapBytes,
    maxGuestQuotaBytes: GALLERY_LIMITS.guestQuotaBytes,
    maxGuestQuotaItems: GALLERY_LIMITS.guestQuotaItems,
    maxUploadBytes: GALLERY_LIMITS.maxUploadBytes,
  });
}

/** One gallery decision at a time per event: the cap and the quotas are read and used under it. */
const lockEventTx = (tx: TenantTx, eventId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`gallery:${eventId}`}, 0))`);

/**
 * Bytes and items an event (or one uploader) holds: processed photos count their stored bytes,
 * open upload slots their declared size until they expire.
 */
async function usageTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
  opts: { uploaderId?: string; excludeItemId?: string } = {},
): Promise<{ bytes: number; items: number }> {
  const conds = [
    eq(items.eventId, eventId),
    or(ne(items.status, 'uploading'), gte(items.createdAt, new Date(now.getTime() - SLOT_MS))),
  ];
  if (opts.uploaderId) conds.push(eq(items.uploaderId, opts.uploaderId));
  if (opts.excludeItemId) conds.push(ne(items.id, opts.excludeItemId));
  const [row] = await tx
    .select({
      bytes: sql<string>`coalesce(sum(case when ${items.status} = 'uploading' then ${items.declaredBytes} else ${items.bytes} end), 0)`,
      n: count(),
    })
    .from(items)
    .where(and(...conds));
  return { bytes: Number(row?.bytes ?? 0), items: Number(row?.n ?? 0) };
}

async function factsTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
  s: GallerySettingsDto,
  guestUploaderId: string | null,
  excludeItemId?: string,
) {
  const ev = await usageTx(tx, eventId, now, excludeItemId ? { excludeItemId } : {});
  const g = guestUploaderId
    ? await usageTx(tx, eventId, now, {
        uploaderId: guestUploaderId,
        ...(excludeItemId ? { excludeItemId } : {}),
      })
    : null;
  return {
    eventBytes: ev.bytes,
    eventItems: ev.items,
    capBytes: s.capBytes,
    guest: g
      ? { bytes: g.bytes, items: g.items, quotaBytes: s.guestQuotaBytes, quotaItems: s.guestQuotaItems }
      : null,
  };
}

const overLimit = (reason: string) =>
  new DomainError('conflict', 'Over the gallery limit', { reason, field: 'file' });

/** A host's uploader row (one per member and event). */
async function hostUploaderTx(tx: TenantTx, ctx: Ctx, eventId: string): Promise<string> {
  if (ctx.actor.type !== 'user') throw new DomainError('forbidden');
  const userId = ctx.actor.userId;
  const find = () =>
    tx
      .select({ id: uploaders.id })
      .from(uploaders)
      .where(and(eq(uploaders.eventId, eventId), eq(uploaders.kind, 'host'), eq(uploaders.userId, userId)));
  const [found] = await find();
  if (found) return found.id;
  await tx
    .insert(uploaders)
    .values({ orgId: requireOrg(ctx), eventId, kind: 'host', userId })
    .onConflictDoNothing();
  const [row] = await find();
  if (!row) throw new DomainError('internal');
  return row.id;
}

/** The guest behind an uploader cookie (this event's), or null. */
async function guestUploaderTx(tx: TenantTx, eventId: string, token: string | null) {
  const id = verifyUploader(token, eventId, appTokenSecret());
  if (!id) return null;
  const [row] = await tx
    .select()
    .from(uploaders)
    .where(and(eq(uploaders.id, id), eq(uploaders.eventId, eventId), eq(uploaders.kind, 'guest')));
  return row ?? null;
}

/** The guest's uploader (made on their first upload, with the name they typed). */
async function ensureGuestUploaderTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  token: string | null,
  name: string | null,
): Promise<{ id: string; token: string }> {
  const found = await guestUploaderTx(tx, eventId, token);
  if (found) {
    if (name && name !== found.displayName)
      await tx
        .update(uploaders)
        .set({ displayName: name, updatedAt: ctx.now })
        .where(eq(uploaders.id, found.id));
    return { id: found.id, token: signUploader(eventId, found.id, appTokenSecret()) };
  }
  if (!name)
    throw new DomainError('validation_failed', 'Your name is required', {
      field: 'name',
      reason: 'required',
    });
  const [row] = await tx
    .insert(uploaders)
    .values({
      orgId: requireOrg(ctx),
      eventId,
      kind: 'guest',
      displayName: name,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning({ id: uploaders.id });
  if (!row) throw new DomainError('internal');
  return { id: row.id, token: signUploader(eventId, row.id, appTokenSecret()) };
}

/**
 * The guest gate: the guest site must be published and the visitor past its password, and the
 * host must have turned the gallery on. An unpublished site is not found (like the site itself).
 */
async function guestGateTx(tx: TenantTx, eventId: string, access: string | null) {
  const site = await guestSiteAccessTx(tx, eventId, access);
  if (site === 'unpublished') throw new DomainError('not_found', 'Not found', { reason: 'site_unpublished' });
  if (site === 'locked') return { state: 'locked' as const, settings: null };
  const s = await settingsOfTx(tx, eventId);
  if (!s?.enabled) return { state: 'closed' as const, settings: null };
  return { state: 'open' as const, settings: settingsDto(s) };
}

async function requireGuestOpenTx(tx: TenantTx, eventId: string, access: string | null) {
  const g = await guestGateTx(tx, eventId, access);
  if (g.state === 'locked')
    throw new DomainError('forbidden', 'The password is needed', { reason: 'locked' });
  if (g.state === 'closed')
    throw new DomainError('invalid_state', 'The gallery is closed', { reason: 'gallery_closed' });
  return g.settings;
}

export const galleryFileUrl = (orgId: string, itemId: string, fileName: string, now: Date) => {
  const { e, s } = signFile(orgId, itemId, fileName, now, appTokenSecret());
  return `/api/gallery/file/${orgId}/${itemId}/${fileName}?e=${e}&s=${s}`;
};

/** Rows as page DTOs: signed file URLs, the uploader's typed name (guests) or none (hosts). */
async function itemDtosTx(
  tx: TenantTx,
  orgId: string,
  rows: readonly ItemRow[],
  now: Date,
): Promise<GalleryItemDto[]> {
  if (rows.length === 0) return [];
  const photoIds = rows.filter((r) => r.kind === 'photo' && r.status !== 'uploading').map((r) => r.id);
  const vs = photoIds.length
    ? await tx.select().from(variants).where(inArray(variants.itemId, photoIds))
    : [];
  const ups = await tx
    .select({ id: uploaders.id, kind: uploaders.kind, displayName: uploaders.displayName })
    .from(uploaders)
    .where(inArray(uploaders.id, [...new Set(rows.map((r) => r.uploaderId))]));
  const upOf = new Map(ups.map((u) => [u.id, u]));
  return rows.map((r) => {
    const up = upOf.get(r.uploaderId);
    return {
      id: r.id,
      kind: r.kind as GalleryItemDto['kind'],
      status: r.status as GalleryItemDto['status'],
      caption: r.caption,
      by: up?.kind === 'guest' ? (up.displayName ?? null) : null,
      byHost: up?.kind === 'host',
      createdAt: r.createdAt,
      publishedAt: r.publishedAt,
      width: r.width,
      height: r.height,
      sourceType: (r.sourceType as PhotoSource | null) ?? null,
      bytes: r.bytes,
      files: vs
        .filter((v) => v.itemId === r.id)
        .sort((a, b) => a.width - b.width || a.format.localeCompare(b.format))
        .map((v) => ({
          format: v.format as 'avif' | 'webp' | 'jpeg' | 'png',
          width: v.width,
          height: v.height,
          fallback: v.fallback,
          url: galleryFileUrl(orgId, r.id, v.fileName, now),
        })),
      video:
        r.kind === 'video' && r.videoProvider && r.videoId
          ? {
              provider: r.videoProvider as 'youtube' | 'vimeo',
              url: videoUrl({ provider: r.videoProvider as 'youtube' | 'vimeo', videoId: r.videoId }),
            }
          : null,
    };
  });
}

const publishedRowsTx = (tx: TenantTx, eventId: string, photosOnly = false, limit = LIST_LIMIT) =>
  tx
    .select()
    .from(items)
    .where(
      and(
        eq(items.eventId, eventId),
        eq(items.status, 'published'),
        photosOnly ? eq(items.kind, 'photo') : undefined,
      ),
    )
    .orderBy(desc(items.publishedAt), desc(items.id))
    .limit(limit);

/* ---------------------------------------------------------------------- photo processing ---- */

class PhotoRefused extends Error {
  readonly reason: Refusal;
  constructor(reason: Refusal) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Sniff and re-encode a photo: JPEG, PNG, GIF (first frame), WebP and AVIF go to the media
 * pipeline as they are; HEIC is decoded through the port first. SVG is not a photo.
 */
export async function decodeGalleryPhoto(
  raw: Uint8Array,
): Promise<{ processed: ProcessedImage; source: PhotoSource }> {
  if (raw.byteLength > GALLERY_LIMITS.maxUploadBytes) throw new PhotoRefused('too_large');
  const type = sniff(raw);
  let input = raw;
  let source: PhotoSource;
  if (type && type !== 'svg') source = type;
  else if (!type && isHeic(raw)) {
    const decoded = await heicDecoder().decode(raw);
    if (!decoded || !sniff(decoded) || sniff(decoded) === 'svg') throw new PhotoRefused('heic_unsupported');
    input = decoded;
    source = 'heic';
  } else throw new PhotoRefused('unsupported_type');
  try {
    // A decoded HEIC is an uncompressed picture: the pixel limit applies, not the byte limit.
    const processed = await processImage(input, {
      maxBytes: source === 'heic' ? Number.MAX_SAFE_INTEGER : GALLERY_LIMITS.maxUploadBytes,
    });
    return { processed, source };
  } catch (err) {
    if (err instanceof MediaRejected)
      throw new PhotoRefused(
        err.reason === 'too_large' || err.reason === 'undecodable' || err.reason === 'too_many_pixels'
          ? err.reason
          : 'unsupported_type',
      );
    throw err;
  }
}

/* ---------------------------------------------------------------------------- settings ---- */

export const hostGalleryQuery = tenantQuery({
  name: 'gallery.hostGallery',
  input: z.object({ eventId: z.uuid() }),
  output: HostGalleryDto,
  entitlement: 'gallery',
  permission: 'guests:read',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await eventTx(tx, input.eventId);
    const s = settingsDto(await settingsOfTx(tx, input.eventId));
    const used = await usageTx(tx, input.eventId, ctx.now);
    const pendingRows = await tx
      .select()
      .from(items)
      .where(and(eq(items.eventId, input.eventId), eq(items.status, 'pending')))
      .orderBy(asc(items.createdAt), asc(items.id))
      .limit(LIST_LIMIT);
    const publishedRows = await publishedRowsTx(tx, input.eventId);
    const [counts] = await tx
      .select({
        pending: sql<number>`count(*) filter (where ${items.status} = 'pending')::int`,
        published: sql<number>`count(*) filter (where ${items.status} = 'published')::int`,
      })
      .from(items)
      .where(eq(items.eventId, input.eventId));
    const site = await guestSiteAccessTx(tx, input.eventId, null);
    return {
      settings: s,
      usage: {
        usedBytes: used.bytes,
        capBytes: s.capBytes,
        items: used.items,
        pending: counts?.pending ?? 0,
        published: counts?.published ?? 0,
      },
      pending: await itemDtosTx(tx, orgId, pendingRows, ctx.now),
      published: await itemDtosTx(tx, orgId, publishedRows, ctx.now),
      siteCode: await guestSiteCodeTx(tx, input.eventId),
      sitePublished: site !== 'unpublished',
      videoUploads: videoHostFromEnv(process.env).uploads,
    };
  },
});

export const saveGallerySettingsCommand = tenantCommand({
  name: 'gallery.saveSettings',
  input: SaveSettingsInput,
  output: GallerySettingsDto,
  entitlement: 'gallery',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await eventTx(tx, input.eventId);
    const values = {
      enabled: input.enabled,
      moderation: input.moderation,
      capBytes: clampLimit(input.capBytes, GALLERY_LIMITS.eventCapBytes),
      guestQuotaBytes: clampLimit(input.guestQuotaBytes, GALLERY_LIMITS.guestQuotaBytes),
      guestQuotaItems: clampLimit(input.guestQuotaItems, GALLERY_LIMITS.guestQuotaItems),
      updatedAt: ctx.now,
    };
    const [row] = await tx
      .insert(settings)
      .values({ orgId: requireOrg(ctx), eventId: input.eventId, ...values })
      .onConflictDoUpdate({ target: [settings.orgId, settings.eventId], set: values })
      .returning();
    return settingsDto(row ?? null);
  },
  audit: (input, r) => ({
    action: 'gallery.settings_saved',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      enabled: r.enabled,
      moderation: r.moderation,
      capBytes: r.capBytes,
      guestQuotaBytes: r.guestQuotaBytes,
      guestQuotaItems: r.guestQuotaItems,
    },
  }),
});

/* ------------------------------------------------------------------------------ uploads ---- */

async function requestSlotTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  uploaderId: string,
  guest: boolean,
  bytes: number,
  caption: string | null,
) {
  const orgId = requireOrg(ctx);
  if (bytes > GALLERY_LIMITS.maxUploadBytes)
    throw new DomainError('validation_failed', 'The photo is too large', {
      field: 'file',
      reason: 'too_large',
    });
  await lockEventTx(tx, eventId);
  const s = settingsDto(await settingsOfTx(tx, eventId));
  const refusal = quotaRefusal(
    await factsTx(tx, eventId, ctx.now, s, guest ? uploaderId : null),
    bytes,
    true,
  );
  if (refusal) throw overLimit(refusal);
  const uploadId = randomUUID();
  const uploadKey = `${orgId}/${uploadId}/u-${randomBytes(16).toString('hex')}`;
  const [row] = await tx
    .insert(items)
    .values({
      orgId,
      eventId,
      uploaderId,
      kind: 'photo',
      status: 'uploading',
      caption,
      uploadId,
      uploadKey,
      declaredBytes: bytes,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning({ id: items.id });
  if (!row) throw new DomainError('internal');
  return { itemId: row.id, ...uploadSlot(orgId, uploadKey, bytes, ctx.now) };
}

const slotAudit = (input: { eventId: string; bytes: number }, r: UploadSlotDto) => ({
  action: 'gallery.upload_requested',
  targetType: 'gallery_item',
  targetId: r.itemId,
  data: { eventId: input.eventId, bytes: input.bytes },
});

/** A host's upload slot (published at once when it completes). */
export const requestGalleryUploadCommand = tenantCommand({
  name: 'gallery.requestUpload',
  input: RequestUploadInput,
  output: UploadSlotDto,
  entitlement: 'gallery',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await eventTx(tx, input.eventId);
    const uploaderId = await hostUploaderTx(tx, ctx, input.eventId);
    const slot = await requestSlotTx(tx, ctx, input.eventId, uploaderId, false, input.bytes, input.caption);
    return { ...slot, uploader: null };
  },
  audit: slotAudit,
});

/** A guest's upload slot: past the site password, with the gallery on, within their quota. */
export const requestGuestGalleryUploadCommand = tenantCommand({
  name: 'gallery.requestGuestUpload',
  input: RequestGuestUploadInput,
  output: UploadSlotDto,
  entitlement: 'gallery',
  permission: 'public:gallery',
  handler: async ({ input, ctx, tx }) => {
    await requireGuestOpenTx(tx, input.eventId, input.access);
    const up = await ensureGuestUploaderTx(tx, ctx, input.eventId, input.uploader, input.name);
    const slot = await requestSlotTx(tx, ctx, input.eventId, up.id, true, input.bytes, input.caption);
    return { ...slot, uploader: up.token };
  },
  audit: slotAudit,
});

async function completeTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  itemId: string,
  uploaderId: string,
  guest: boolean,
  autoPublish: boolean,
): Promise<CompleteResultDto> {
  const orgId = requireOrg(ctx);
  const [item] = await tx
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.eventId, eventId), eq(items.uploaderId, uploaderId)))
    .for('update');
  if (item?.kind !== 'photo' || !item.uploadId || !item.uploadKey)
    throw new DomainError('not_found', 'Upload not found', { field: 'itemId' });
  // Completing twice answers the same.
  if (item.status !== 'uploading')
    return { itemId, status: item.status as 'pending' | 'published', reason: null, purge: [] };
  const uploadId = item.uploadId;
  const refuse = async (reason: Refusal): Promise<CompleteResultDto> => {
    await tx.delete(items).where(eq(items.id, item.id));
    return { itemId, status: 'refused', reason, purge: [uploadId, item.id] };
  };
  if (item.createdAt.getTime() + SLOT_MS < ctx.now.getTime()) return refuse('expired');
  const raw = await mediaStore().get(orgId, item.uploadKey);
  if (!raw)
    throw new DomainError('invalid_state', 'The photo has not arrived yet', { reason: 'upload_missing' });
  if (raw.byteLength !== item.declaredBytes) return refuse('size_mismatch');
  let decoded: Awaited<ReturnType<typeof decodeGalleryPhoto>>;
  try {
    decoded = await decodeGalleryPhoto(raw);
  } catch (err) {
    if (err instanceof PhotoRefused) return refuse(err.reason);
    throw err;
  }
  const files = decoded.processed.variants.filter((v) => v.format !== 'svg');
  const total = files.reduce((n, v) => n + v.bytes.byteLength, 0);

  // The stored size, under the lock: the cap may have been reached since the slot was handed out.
  await lockEventTx(tx, eventId);
  const s = settingsDto(await settingsOfTx(tx, eventId));
  const refusal = quotaRefusal(
    await factsTx(tx, eventId, ctx.now, s, guest ? uploaderId : null, item.id),
    total,
    false,
  );
  if (refusal) return refuse(refusal);

  const store = mediaStore();
  const rows: (typeof variants.$inferInsert)[] = [];
  for (const v of files) {
    const fileName = variantFileName({ format: v.format, width: v.width, hash: v.hash });
    if (rows.some((r) => r.fileName === fileName)) continue;
    await store.put(orgId, `${orgId}/${item.id}/${fileName}`, v.bytes, v.contentType);
    rows.push({
      orgId,
      itemId: item.id,
      format: v.format,
      width: v.width,
      height: v.height,
      bytes: v.bytes.byteLength,
      sha256: v.hash,
      fileName,
      fallback: v.fallback,
    });
  }
  await tx.insert(variants).values(rows);
  const status = autoPublish ? 'published' : 'pending';
  await tx
    .update(items)
    .set({
      status,
      bytes: total,
      sourceType: decoded.source,
      width: decoded.processed.width,
      height: decoded.processed.height,
      publishedAt: status === 'published' ? ctx.now : null,
      updatedAt: ctx.now,
    })
    .where(eq(items.id, item.id));
  if (status === 'published') await publishItemTx(tx, orgId, eventId, item.id, 'published', ctx.now);
  return { itemId, status, reason: null, purge: [uploadId] };
}

const completeAudit = (input: { eventId: string; itemId: string }, r: CompleteResultDto) => ({
  action: 'gallery.upload_completed',
  targetType: 'gallery_item',
  targetId: input.itemId,
  data: { eventId: input.eventId, status: r.status, reason: r.reason },
});

export const completeGalleryUploadCommand = tenantCommand({
  name: 'gallery.completeUpload',
  input: CompleteUploadInput,
  output: CompleteResultDto,
  entitlement: 'gallery',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await eventTx(tx, input.eventId);
    const uploaderId = await hostUploaderTx(tx, ctx, input.eventId);
    // P4-6: photos from the host are published at once.
    return completeTx(tx, ctx, input.eventId, input.itemId, uploaderId, false, true);
  },
  audit: completeAudit,
});

export const completeGuestGalleryUploadCommand = tenantCommand({
  name: 'gallery.completeGuestUpload',
  input: CompleteGuestUploadInput,
  output: CompleteResultDto,
  entitlement: 'gallery',
  permission: 'public:gallery',
  handler: async ({ input, ctx, tx }) => {
    const s = await requireGuestOpenTx(tx, input.eventId, input.access);
    const up = await guestUploaderTx(tx, input.eventId, input.uploader);
    if (!up) throw new DomainError('not_found', 'Upload not found', { field: 'itemId' });
    return completeTx(tx, ctx, input.eventId, input.itemId, up.id, true, s?.moderation === 'auto');
  },
  audit: completeAudit,
});

/* ------------------------------------------------------------------------------- videos ---- */

async function addVideoTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  uploaderId: string,
  guest: boolean,
  url: string,
  caption: string | null,
  autoPublish: boolean,
) {
  const orgId = requireOrg(ctx);
  const ref = parseVideoLink(url);
  if (!ref)
    throw new DomainError('validation_failed', 'Not a YouTube or Vimeo link', {
      field: 'url',
      reason: 'video_link',
    });
  await lockEventTx(tx, eventId);
  const s = settingsDto(await settingsOfTx(tx, eventId));
  const refusal = quotaRefusal(await factsTx(tx, eventId, ctx.now, s, guest ? uploaderId : null), 0, true);
  if (refusal) throw new DomainError('conflict', 'Over the gallery limit', { reason: refusal, field: 'url' });
  const status = autoPublish ? 'published' : 'pending';
  const [row] = await tx
    .insert(items)
    .values({
      orgId,
      eventId,
      uploaderId,
      kind: 'video',
      status,
      caption,
      videoProvider: ref.provider,
      videoId: ref.videoId,
      publishedAt: status === 'published' ? ctx.now : null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning({ id: items.id });
  if (!row) throw new DomainError('internal');
  if (status === 'published') await publishItemTx(tx, orgId, eventId, row.id, 'published', ctx.now);
  return { itemId: row.id, status };
}

const videoAudit = (input: { eventId: string }, r: { itemId: string; status: string }) => ({
  action: 'gallery.video_added',
  targetType: 'gallery_item',
  targetId: r.itemId,
  data: { eventId: input.eventId, status: r.status },
});

export const addGalleryVideoCommand = tenantCommand({
  name: 'gallery.addVideo',
  input: AddVideoInput,
  output: AddVideoResultDto,
  entitlement: 'gallery',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await eventTx(tx, input.eventId);
    const uploaderId = await hostUploaderTx(tx, ctx, input.eventId);
    const r = await addVideoTx(tx, ctx, input.eventId, uploaderId, false, input.url, input.caption, true);
    return { ...r, uploader: null };
  },
  audit: videoAudit,
});

export const addGuestGalleryVideoCommand = tenantCommand({
  name: 'gallery.addGuestVideo',
  input: AddGuestVideoInput,
  output: AddVideoResultDto,
  entitlement: 'gallery',
  permission: 'public:gallery',
  handler: async ({ input, ctx, tx }) => {
    const s = await requireGuestOpenTx(tx, input.eventId, input.access);
    const up = await ensureGuestUploaderTx(tx, ctx, input.eventId, input.uploader, input.name);
    const r = await addVideoTx(
      tx,
      ctx,
      input.eventId,
      up.id,
      true,
      input.url,
      input.caption,
      s?.moderation === 'auto',
    );
    return { ...r, uploader: up.token };
  },
  audit: videoAudit,
});

/* --------------------------------------------------------------------- moderation, removal ---- */

/** The moderation queue (P4-6): approve publishes; reject deletes the item and its files. */
export const moderateGalleryCommand = tenantCommand({
  name: 'gallery.moderate',
  input: ModerateInput,
  output: ChangeResultDto,
  entitlement: 'gallery',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await eventTx(tx, input.eventId);
    const rows = await tx
      .select({ id: items.id })
      .from(items)
      .where(
        and(eq(items.eventId, input.eventId), eq(items.status, 'pending'), inArray(items.id, input.itemIds)),
      )
      .for('update');
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return { changed: 0, purge: [] };
    if (input.decision === 'approve') {
      await tx
        .update(items)
        .set({ status: 'published', publishedAt: ctx.now, decidedBy: actorId(ctx.actor), updatedAt: ctx.now })
        .where(inArray(items.id, ids));
      for (const id of ids) await publishItemTx(tx, orgId, input.eventId, id, 'published', ctx.now);
      return { changed: ids.length, purge: [] };
    }
    await tx.delete(items).where(inArray(items.id, ids));
    return { changed: ids.length, purge: ids };
  },
  audit: (input, r) => ({
    action: `gallery.${input.decision === 'approve' ? 'approved' : 'rejected'}`,
    targetType: 'event',
    targetId: input.eventId,
    data: { count: r.changed },
  }),
});

async function removeRowTx(tx: TenantTx, ctx: Ctx, row: ItemRow) {
  await tx.delete(items).where(eq(items.id, row.id));
  if (row.status === 'published')
    await publishItemTx(tx, requireOrg(ctx), row.eventId, row.id, 'removed', ctx.now);
  return { changed: 1, purge: row.uploadId ? [row.id, row.uploadId] : [row.id] };
}

export const removeGalleryItemCommand = tenantCommand({
  name: 'gallery.removeItem',
  input: RemoveItemInput,
  output: ChangeResultDto,
  entitlement: 'gallery',
  permission: 'guests:write',
  category: 'delete',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, input.itemId), eq(items.eventId, input.eventId)))
      .for('update');
    if (!row) throw new DomainError('not_found', 'Item not found', { field: 'itemId' });
    return removeRowTx(tx, ctx, row);
  },
  audit: (input) => ({
    action: 'gallery.item_removed',
    targetType: 'gallery_item',
    targetId: input.itemId,
    data: { eventId: input.eventId },
  }),
});

/** A guest takes back one of their own photos or links (pending or published). */
export const removeOwnGalleryItemCommand = tenantCommand({
  name: 'gallery.removeOwnItem',
  input: RemoveOwnItemInput,
  output: ChangeResultDto,
  entitlement: 'gallery',
  permission: 'public:gallery',
  handler: async ({ input, ctx, tx }) => {
    await requireGuestOpenTx(tx, input.eventId, input.access);
    const up = await guestUploaderTx(tx, input.eventId, input.uploader);
    const [row] = up
      ? await tx
          .select()
          .from(items)
          .where(
            and(eq(items.id, input.itemId), eq(items.eventId, input.eventId), eq(items.uploaderId, up.id)),
          )
          .for('update')
      : [];
    if (!row) throw new DomainError('not_found', 'Item not found', { field: 'itemId' });
    return removeRowTx(tx, ctx, row);
  },
  audit: (input) => ({
    action: 'gallery.own_item_removed',
    targetType: 'gallery_item',
    targetId: input.itemId,
    data: { eventId: input.eventId },
  }),
});

/* --------------------------------------------------------------------------- guest reads ---- */

export const publicGalleryQuery = tenantQuery({
  name: 'gallery.publicGallery',
  input: z.object({
    eventId: z.uuid(),
    access: z.string().max(200).nullable(),
    uploader: z.string().max(200).nullable().default(null),
  }),
  output: PublicGalleryDto,
  entitlement: 'gallery',
  permission: 'public:gallery',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const ev = await eventTx(tx, input.eventId);
    const gate = await guestGateTx(tx, input.eventId, input.access);
    if (gate.state !== 'open') return { state: gate.state, eventName: ev.name };
    const s = gate.settings as GallerySettingsDto;
    const up = await guestUploaderTx(tx, input.eventId, input.uploader);
    const mineRows = up
      ? await tx
          .select()
          .from(items)
          .where(
            and(eq(items.eventId, input.eventId), eq(items.uploaderId, up.id), ne(items.status, 'uploading')),
          )
          .orderBy(desc(items.createdAt), desc(items.id))
          .limit(LIST_LIMIT)
      : [];
    const mine = up
      ? await usageTx(tx, input.eventId, ctx.now, { uploaderId: up.id })
      : { bytes: 0, items: 0 };
    const used = await usageTx(tx, input.eventId, ctx.now);
    return {
      state: 'open' as const,
      eventName: ev.name,
      moderation: s.moderation,
      published: await itemDtosTx(tx, orgId, await publishedRowsTx(tx, input.eventId), ctx.now),
      mine: await itemDtosTx(tx, orgId, mineRows, ctx.now),
      myName: up?.displayName ?? null,
      quota: {
        usedBytes: mine.bytes,
        quotaBytes: s.guestQuotaBytes,
        items: mine.items,
        quotaItems: s.guestQuotaItems,
      },
      eventFull: used.bytes >= s.capBytes,
      maxUploadBytes: s.maxUploadBytes,
    };
  },
});

/** The slideshow's photos, newest first (members with `guests:read`). */
export const hostSlidesQuery = tenantQuery({
  name: 'gallery.hostSlides',
  input: z.object({ eventId: z.uuid() }),
  output: SlidesDto,
  entitlement: 'gallery',
  permission: 'guests:read',
  handler: async ({ input, ctx, tx }) => {
    await eventTx(tx, input.eventId);
    const rows = await publishedRowsTx(tx, input.eventId, true, SLIDES_LIMIT);
    return { photos: await itemDtosTx(tx, requireOrg(ctx), rows, ctx.now) };
  },
});

/** The slideshow's photos for a guest past the password (the gallery must be on). */
export const publicSlidesQuery = tenantQuery({
  name: 'gallery.publicSlides',
  input: z.object({ eventId: z.uuid(), access: z.string().max(200).nullable() }),
  output: SlidesDto,
  entitlement: 'gallery',
  permission: 'public:gallery',
  handler: async ({ input, ctx, tx }) => {
    await requireGuestOpenTx(tx, input.eventId, input.access);
    const rows = await publishedRowsTx(tx, input.eventId, true, SLIDES_LIMIT);
    return { photos: await itemDtosTx(tx, requireOrg(ctx), rows, ctx.now) };
  },
});

/** May a guest holding `access` watch the event's live slideshow? (The stream route asks.) */
export async function guestSlideshowOpen(
  orgId: string,
  eventId: string,
  access: string | null,
): Promise<boolean> {
  return withTenant(createCtx({ orgId, actor: { type: 'system', name: 'gallery.stream' } }), async (tx) => {
    try {
      return (await guestGateTx(tx, eventId, access)).state === 'open';
    } catch {
      return false;
    }
  });
}

/* ------------------------------------------------------------------ storage after commit ---- */

/** Delete stored objects under each prefix (item files, staging uploads). Never throws. */
export async function purgeGalleryFiles(orgId: string, prefixes: readonly string[]): Promise<void> {
  const store = mediaStore();
  for (const id of prefixes) {
    try {
      await store.deleteAsset(orgId, id);
    } catch (err) {
      console.warn(`gallery: could not delete ${id}: ${(err as Error).message}`);
    }
  }
}

/**
 * Upload slots that expired without completing: their rows and whatever bytes arrived. Runs
 * before a new slot is handed out (and from the worker's sweep); expired slots never count.
 */
export async function purgeExpiredGalleryUploads(orgId: string, eventId: string | null, now = new Date()) {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'gallery.sweep' } });
  const gone = await withTenant(ctx, (tx) =>
    tx
      .delete(items)
      .where(
        and(
          eventId ? eq(items.eventId, eventId) : undefined,
          eq(items.status, 'uploading'),
          lt(items.createdAt, new Date(now.getTime() - SLOT_MS)),
        ),
      )
      .returning({ uploadId: items.uploadId }),
  );
  await purgeGalleryFiles(
    orgId,
    gone.map((g) => g.uploadId).filter((x): x is string => !!x),
  );
  return gone.length;
}

/** Run a gallery command whose result names storage to purge, then purge it (after commit). */
export async function runGalleryCommand<I, O extends { purge: string[] }, R>(
  command: Command<I, O, R, TenantTx>,
  input: unknown,
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
): Promise<O> {
  const out = await executeCommand(command, input, ctx, ports);
  if (out.purge.length) await purgeGalleryFiles(requireOrg(ctx), out.purge);
  return out;
}
