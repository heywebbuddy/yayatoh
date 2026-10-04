import { z } from 'zod';
import { CAPTION_MAX, NAME_MAX } from './domain/limits.ts';
import { ITEM_KINDS, ITEM_STATUSES, MODERATION_MODES, PHOTO_SOURCES, VIDEO_PROVIDERS } from './schema.ts';

/** One file of a photo, with a signed URL for a viewer the gallery already authorized. */
export const PhotoFileDto = z.object({
  format: z.enum(['avif', 'webp', 'jpeg', 'png']),
  width: z.number().int(),
  height: z.number().int(),
  fallback: z.boolean(),
  url: z.string(),
});
export type PhotoFileDto = z.infer<typeof PhotoFileDto>;

/**
 * A gallery item as a page shows it (allowlisted): never the storage key, the uploader's user id
 * or anything about other guests beyond the name an uploader typed for their own photos.
 */
export const GalleryItemDto = z.object({
  id: z.uuid(),
  kind: z.enum(ITEM_KINDS),
  status: z.enum(ITEM_STATUSES),
  caption: z.string().nullable(),
  /** The guest's typed name; null for a host's item. */
  by: z.string().nullable(),
  byHost: z.boolean(),
  createdAt: z.date(),
  publishedAt: z.date().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  sourceType: z.enum(PHOTO_SOURCES).nullable(),
  bytes: z.number().int(),
  files: z.array(PhotoFileDto),
  video: z.object({ provider: z.enum(VIDEO_PROVIDERS), url: z.string() }).nullable(),
});
export type GalleryItemDto = z.infer<typeof GalleryItemDto>;

export const GallerySettingsDto = z.object({
  enabled: z.boolean(),
  moderation: z.enum(MODERATION_MODES),
  capBytes: z.number().int(),
  guestQuotaBytes: z.number().int(),
  guestQuotaItems: z.number().int(),
  /** The platform placeholders (P4-6): a host may only lower the limits. */
  maxCapBytes: z.number().int(),
  maxGuestQuotaBytes: z.number().int(),
  maxGuestQuotaItems: z.number().int(),
  maxUploadBytes: z.number().int(),
});
export type GallerySettingsDto = z.infer<typeof GallerySettingsDto>;

export const GalleryUsageDto = z.object({
  usedBytes: z.number().int(),
  capBytes: z.number().int(),
  items: z.number().int(),
  pending: z.number().int(),
  published: z.number().int(),
});
export type GalleryUsageDto = z.infer<typeof GalleryUsageDto>;

export const HostGalleryDto = z.object({
  settings: GallerySettingsDto,
  usage: GalleryUsageDto,
  pending: z.array(GalleryItemDto),
  published: z.array(GalleryItemDto),
  /** The guest site's address and state: guests reach the gallery through it. */
  siteCode: z.string().nullable(),
  sitePublished: z.boolean(),
  videoUploads: z.boolean(),
});
export type HostGalleryDto = z.infer<typeof HostGalleryDto>;

export const GuestQuotaDto = z.object({
  usedBytes: z.number().int(),
  quotaBytes: z.number().int(),
  items: z.number().int(),
  quotaItems: z.number().int(),
});

/** The guest page: locked (password), closed (gallery off) or open. */
export const PublicGalleryDto = z.discriminatedUnion('state', [
  z.object({ state: z.literal('locked'), eventName: z.string() }),
  z.object({ state: z.literal('closed'), eventName: z.string() }),
  z.object({
    state: z.literal('open'),
    eventName: z.string(),
    moderation: z.enum(MODERATION_MODES),
    published: z.array(GalleryItemDto),
    /** The visitor's own uploads (with their state), when their uploader cookie is valid. */
    mine: z.array(GalleryItemDto),
    /** The name they gave last time (prefilled), or null. */
    myName: z.string().nullable(),
    quota: GuestQuotaDto,
    eventFull: z.boolean(),
    maxUploadBytes: z.number().int(),
  }),
]);
export type PublicGalleryDto = z.infer<typeof PublicGalleryDto>;

export const SlidesDto = z.object({ photos: z.array(GalleryItemDto) });
export type SlidesDto = z.infer<typeof SlidesDto>;

/* --------------------------------------------------------------------------------- inputs ---- */

const Caption = z
  .string()
  .max(CAPTION_MAX * 2)
  .nullable()
  .default(null)
  .transform((s) => (s?.trim() ? s.trim() : null))
  .refine((s) => s === null || s.length <= CAPTION_MAX, { message: 'too_long' });

const Name = z
  .string()
  .max(NAME_MAX * 2)
  .nullable()
  .default(null)
  .transform((s) => (s?.trim() ? s.trim().replace(/\s+/g, ' ') : null))
  .refine((s) => s === null || s.length <= NAME_MAX, { message: 'too_long' });

const GuestAuth = {
  eventId: z.uuid(),
  /** The guest-site access proof (the site's cookie). */
  access: z.string().max(200).nullable(),
  /** The guest's uploader cookie, if any. */
  uploader: z.string().max(200).nullable().default(null),
};

export const SaveSettingsInput = z.object({
  eventId: z.uuid(),
  enabled: z.boolean(),
  moderation: z.enum(MODERATION_MODES),
  capBytes: z.number().int().positive().nullable().default(null),
  guestQuotaBytes: z.number().int().positive().nullable().default(null),
  guestQuotaItems: z.number().int().positive().nullable().default(null),
});

export const RequestUploadInput = z.object({
  eventId: z.uuid(),
  bytes: z.number().int().positive(),
  caption: Caption,
});
export const RequestGuestUploadInput = z.object({
  ...GuestAuth,
  name: Name,
  bytes: z.number().int().positive(),
  caption: Caption,
});

export const UploadSlotDto = z.object({
  itemId: z.uuid(),
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.date(),
  /** A guest's uploader cookie (set by the web action; never shown). */
  uploader: z.string().nullable(),
});
export type UploadSlotDto = z.infer<typeof UploadSlotDto>;

export const CompleteUploadInput = z.object({ eventId: z.uuid(), itemId: z.uuid() });
export const CompleteGuestUploadInput = z.object({ ...GuestAuth, itemId: z.uuid() });

export const REFUSALS = [
  'event_cap',
  'event_items',
  'guest_bytes',
  'guest_items',
  'too_large',
  'size_mismatch',
  'unsupported_type',
  'undecodable',
  'too_many_pixels',
  'heic_unsupported',
  'expired',
] as const;
export type Refusal = (typeof REFUSALS)[number];

export const CompleteResultDto = z.object({
  itemId: z.uuid(),
  status: z.enum(['published', 'pending', 'refused']),
  reason: z.enum(REFUSALS).nullable(),
  /** Storage prefixes to delete after commit (the staging upload; a refused photo's files). */
  purge: z.array(z.uuid()),
});
export type CompleteResultDto = z.infer<typeof CompleteResultDto>;

export const AddVideoInput = z.object({ eventId: z.uuid(), url: z.string().max(500), caption: Caption });
export const AddGuestVideoInput = z.object({
  ...GuestAuth,
  name: Name,
  url: z.string().max(500),
  caption: Caption,
});
export const AddVideoResultDto = z.object({
  itemId: z.uuid(),
  status: z.enum(['published', 'pending']),
  uploader: z.string().nullable(),
});

export const ModerateInput = z.object({
  eventId: z.uuid(),
  itemIds: z.array(z.uuid()).min(1).max(200),
  decision: z.enum(['approve', 'reject']),
});
export const RemoveItemInput = z.object({ eventId: z.uuid(), itemId: z.uuid() });
export const RemoveOwnItemInput = z.object({ ...GuestAuth, itemId: z.uuid() });
export const ChangeResultDto = z.object({ changed: z.number().int(), purge: z.array(z.uuid()) });
export type ChangeResultDto = z.infer<typeof ChangeResultDto>;
