import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const mediaSchema = pgSchema('media');

export const OWNER_TYPES = ['event', 'venue', 'org'] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];
/** `floorplan`: an event's floor plan images, drawn under its seating plans (M1.7g). */
export const SLOTS = ['cover', 'gallery', 'photo', 'logo', 'floorplan'] as const;
export type Slot = (typeof SLOTS)[number];

const list = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength),
  fromDriver: (v) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength),
});

/**
 * One uploaded image, attached to an owner (an event, a venue or the org itself) in a slot.
 * `cover` and `logo` hold one image; `gallery` and `photo` hold several, ordered by `position`.
 * Alt text is required unless the organizer marks the image decorative.
 */
export const assets = tenantTable(
  mediaSchema,
  'assets',
  {
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    slot: text('slot').notNull(),
    position: integer('position').notNull().default(0),
    /** What the bytes were (sniffed), never what the upload claimed. */
    sourceType: text('source_type').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    alt: text('alt'),
    decorative: boolean('decorative').notNull().default(false),
    /** Stored bytes across all variants (counts against the org's quota). */
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    index('assets_org_owner_idx').on(t.orgId, t.ownerType, t.ownerId, t.slot, t.position),
    uniqueIndex('assets_org_single_slot_key')
      .on(t.orgId, t.ownerType, t.ownerId, t.slot)
      .where(sql`slot in ('cover', 'logo')`),
    check('assets_owner_type_check', list('owner_type', OWNER_TYPES)),
    check('assets_slot_check', list('slot', SLOTS)),
    check(
      'assets_owner_slot_check',
      sql`(owner_type = 'event' and slot in ('cover', 'gallery', 'floorplan')) or (owner_type = 'venue' and slot = 'photo') or (owner_type = 'org' and slot = 'logo' and owner_id = org_id)`,
    ),
    check('assets_source_type_check', sql`source_type in ('jpeg', 'png', 'gif', 'webp', 'avif', 'svg')`),
    check('assets_dimensions_check', sql`width > 0 and height > 0`),
    check('assets_bytes_check', sql`bytes >= 0`),
    check('assets_alt_check', sql`decorative or (alt is not null and length(btrim(alt)) between 1 and 300)`),
    check('assets_position_check', sql`position >= 0`),
  ],
);

/** The files an asset became (AVIF/WebP per width, a PNG/JPEG fallback, the sanitized SVG). */
export const variants = tenantTable(
  mediaSchema,
  'variants',
  {
    assetId: uuid('asset_id').notNull(),
    format: text('format').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    bytes: integer('bytes').notNull(),
    /** SHA-256 of the file (hex); its first 32 characters are in the file name. */
    sha256: text('sha256').notNull(),
    fileName: text('file_name').notNull(),
    fallback: boolean('fallback').notNull().default(false),
  },
  (t) => [
    uniqueIndex('variants_org_asset_file_key').on(t.orgId, t.assetId, t.fileName),
    foreignKey({
      name: 'variants_asset_fk',
      columns: [t.orgId, t.assetId],
      foreignColumns: [assets.orgId, assets.id],
    }).onDelete('cascade'),
    check('variants_format_check', sql`format in ('avif', 'webp', 'jpeg', 'png', 'svg')`),
    check('variants_dimensions_check', sql`width > 0 and height > 0`),
    check('variants_sha256_check', sql`sha256 ~ '^[0-9a-f]{64}$'`),
    check('variants_file_name_check', sql`file_name ~ '^[0-9]{1,5}-[0-9a-f]{32}\\.(avif|webp|jpg|png|svg)$'`),
  ],
);

/**
 * The development / CI storage adapter's objects (the `postgres` media store). Production uses
 * R2 and leaves this table empty. Keys always start with the org id.
 */
export const blobs = tenantTable(
  mediaSchema,
  'blobs',
  {
    key: text('key').notNull(),
    contentType: text('content_type').notNull(),
    data: bytea('data').notNull(),
  },
  (t) => [
    uniqueIndex('blobs_org_key_key').on(t.orgId, t.key),
    check('blobs_key_prefix_check', sql`starts_with(key, org_id::text || '/')`),
  ],
);

/** A per-org storage quota override (staff); orgs without a row get `DEFAULT_QUOTA_BYTES`. */
export const quotas = tenantTable(
  mediaSchema,
  'quotas',
  {
    bytesLimit: bigint('bytes_limit', { mode: 'number' }).notNull(),
  },
  (t) => [
    uniqueIndex('quotas_org_key').on(t.orgId),
    check('quotas_bytes_limit_check', sql`bytes_limit >= 0`),
  ],
);
