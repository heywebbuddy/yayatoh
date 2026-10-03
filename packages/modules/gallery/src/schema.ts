import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const gallerySchema = pgSchema('gallery');

const list = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

/** P4-6: guest uploads wait for the host (`hold`, the default) or appear at once (`auto`). */
export const MODERATION_MODES = ['hold', 'auto'] as const;
export type ModerationMode = (typeof MODERATION_MODES)[number];

export const UPLOADER_KINDS = ['guest', 'host'] as const;
export type UploaderKind = (typeof UPLOADER_KINDS)[number];

export const ITEM_KINDS = ['photo', 'video'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/**
 * `uploading`: a slot was handed out and its bytes may be on their way to storage (they count
 * against the cap until the slot expires); `pending`: waiting for the host; `published`: in the
 * gallery and the slideshow. A rejected or removed item is deleted with its files.
 */
export const ITEM_STATUSES = ['uploading', 'pending', 'published'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** What a photo's bytes were (sniffed); HEIC is decoded through the `HeicDecoder` port. */
export const PHOTO_SOURCES = ['jpeg', 'png', 'gif', 'webp', 'avif', 'heic'] as const;
export type PhotoSource = (typeof PHOTO_SOURCES)[number];

/** P4-5: video starts as links only. */
export const VIDEO_PROVIDERS = ['youtube', 'vimeo'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

/**
 * One event's gallery settings (M4.5b). Off until the host turns it on. The cap and the guest
 * quota start at the platform's placeholders (`GALLERY_LIMITS`, P4-6) and a host may only lower
 * them.
 */
export const settings = tenantTable(
  gallerySchema,
  'settings',
  {
    eventId: uuid('event_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    moderation: text('moderation').notNull().default('hold'),
    capBytes: bigint('cap_bytes', { mode: 'number' }).notNull(),
    guestQuotaBytes: bigint('guest_quota_bytes', { mode: 'number' }).notNull(),
    guestQuotaItems: integer('guest_quota_items').notNull(),
  },
  (t) => [
    uniqueIndex('settings_org_event_key').on(t.orgId, t.eventId),
    check('settings_moderation_check', list('moderation', MODERATION_MODES)),
    check('settings_cap_check', sql`cap_bytes > 0`),
    check('settings_guest_quota_check', sql`guest_quota_bytes > 0 and guest_quota_items > 0`),
  ],
);

/**
 * Who uploaded: a guest (the name they typed on the guest site, kept by a signed cookie) or a
 * host (a signed-in member). The per-guest quota counts per row.
 */
export const uploaders = tenantTable(
  gallerySchema,
  'uploaders',
  {
    eventId: uuid('event_id').notNull(),
    kind: text('kind').notNull(),
    displayName: text('display_name'),
    userId: text('user_id'),
  },
  (t) => [
    index('uploaders_org_event_idx').on(t.orgId, t.eventId),
    uniqueIndex('uploaders_org_event_host_key').on(t.orgId, t.eventId, t.userId).where(sql`kind = 'host'`),
    check('uploaders_kind_check', list('kind', UPLOADER_KINDS)),
    check(
      'uploaders_identity_check',
      sql`(kind = 'guest' and display_name is not null and length(btrim(display_name)) between 1 and 60 and user_id is null) or (kind = 'host' and user_id is not null)`,
    ),
  ],
);

/** A photo (re-encoded files in `variants`) or a video link. */
export const items = tenantTable(
  gallerySchema,
  'items',
  {
    eventId: uuid('event_id').notNull(),
    uploaderId: uuid('uploader_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    caption: text('caption'),
    /** Where the browser's bytes wait (`{org}/{upload_id}/u-{nonce}`) until they are processed. */
    uploadId: uuid('upload_id'),
    uploadKey: text('upload_key'),
    /** The size the browser declared and the presigned PUT allows (exactly). */
    declaredBytes: bigint('declared_bytes', { mode: 'number' }).notNull().default(0),
    /** Stored bytes across the variants (what counts once processed). */
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    sourceType: text('source_type'),
    width: integer('width'),
    height: integer('height'),
    videoProvider: text('video_provider'),
    videoId: text('video_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    decidedBy: text('decided_by'),
  },
  (t) => [
    index('items_org_event_status_idx').on(t.orgId, t.eventId, t.status, t.publishedAt),
    index('items_org_uploader_idx').on(t.orgId, t.uploaderId),
    foreignKey({
      name: 'items_uploader_fk',
      columns: [t.orgId, t.uploaderId],
      foreignColumns: [uploaders.orgId, uploaders.id],
    }).onDelete('cascade'),
    check('items_kind_check', list('kind', ITEM_KINDS)),
    check('items_status_check', list('status', ITEM_STATUSES)),
    check('items_caption_length', sql`caption is null or length(btrim(caption)) between 1 and 280`),
    check('items_bytes_check', sql`declared_bytes >= 0 and bytes >= 0`),
    check(
      'items_photo_check',
      sql`kind <> 'photo' or (upload_id is not null and upload_key ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/u-[0-9a-f]{32}$' and declared_bytes > 0 and video_provider is null and video_id is null and (status = 'uploading' or (source_type in ('jpeg', 'png', 'gif', 'webp', 'avif', 'heic') and width > 0 and height > 0)))`,
    ),
    check(
      'items_video_check',
      sql`kind <> 'video' or (status <> 'uploading' and upload_id is null and upload_key is null and bytes = 0 and declared_bytes = 0 and ((video_provider = 'youtube' and video_id ~ '^[A-Za-z0-9_-]{11}$') or (video_provider = 'vimeo' and video_id ~ '^[0-9]{1,12}$')))`,
    ),
    check('items_published_check', sql`(status = 'published') = (published_at is not null)`),
  ],
);

/** The files a photo became (AVIF/WebP per width and a JPEG/PNG fallback), content-hashed. */
export const variants = tenantTable(
  gallerySchema,
  'variants',
  {
    itemId: uuid('item_id').notNull(),
    format: text('format').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    fileName: text('file_name').notNull(),
    fallback: boolean('fallback').notNull().default(false),
  },
  (t) => [
    uniqueIndex('variants_org_item_file_key').on(t.orgId, t.itemId, t.fileName),
    foreignKey({
      name: 'variants_item_fk',
      columns: [t.orgId, t.itemId],
      foreignColumns: [items.orgId, items.id],
    }).onDelete('cascade'),
    check('variants_format_check', sql`format in ('avif', 'webp', 'jpeg', 'png')`),
    check('variants_dimensions_check', sql`width > 0 and height > 0`),
    check('variants_sha256_check', sql`sha256 ~ '^[0-9a-f]{64}$'`),
    check('variants_file_name_check', sql`file_name ~ '^[0-9]{1,5}-[0-9a-f]{32}\\.(avif|webp|jpg|png)$'`),
  ],
);
