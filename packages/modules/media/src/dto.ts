import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { VARIANT_FORMATS } from './pipeline/plan.ts';
import { SOURCE_TYPES } from './pipeline/sniff.ts';
import { OWNER_TYPES, SLOTS } from './schema.ts';

export const VariantDto = z.object({
  format: z.enum(VARIANT_FORMATS),
  width: z.number().int(),
  height: z.number().int(),
  /** App-origin path: `/media/{org}/{asset}/{width}-{hash}.{ext}` (immutable). */
  url: z.string(),
  fallback: z.boolean(),
});
export type VariantDto = z.infer<typeof VariantDto>;

/** The console's view of an image (members of the org). */
export const MediaAssetDto = z.object({
  id: z.uuid(),
  ownerType: z.enum(OWNER_TYPES),
  ownerId: z.uuid(),
  slot: z.enum(SLOTS),
  position: z.number().int(),
  sourceType: z.enum(SOURCE_TYPES),
  width: z.number().int(),
  height: z.number().int(),
  alt: z.string().nullable(),
  decorative: z.boolean(),
  bytes: z.number().int(),
  createdAt: z.date(),
  variants: z.array(VariantDto),
});
export type MediaAssetDto = z.infer<typeof MediaAssetDto>;
export const mediaAssetSerializer = defineSerializer('media.asset', MediaAssetDto);

/** What public pages get: no sizes in bytes, no uploader, no source type. */
export const PublicMediaDto = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  slot: z.enum(SLOTS),
  position: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  /** Empty for decorative images (rendered with `alt=""`). */
  alt: z.string(),
  decorative: z.boolean(),
  variants: z.array(VariantDto),
});
export type PublicMediaDto = z.infer<typeof PublicMediaDto>;
export const publicMediaSerializer = defineSerializer('media.public', PublicMediaDto);

export const MediaUsageDto = z.object({ usedBytes: z.number().int(), limitBytes: z.number().int() });
export type MediaUsageDto = z.infer<typeof MediaUsageDto>;

/** Upload result: the new image, and the one it replaced (its files are purged after commit). */
export const UploadResultDto = z.object({ asset: MediaAssetDto, replacedAssetId: z.uuid().nullable() });
export type UploadResultDto = z.infer<typeof UploadResultDto>;

const Alt = z.string().trim().max(300).nullable().default(null);
const altRequired = (v: { alt?: string | null; decorative?: boolean }) =>
  v.decorative === true || (typeof v.alt === 'string' && v.alt.trim().length > 0);
const altIssue = { message: 'Describe the image, or mark it decorative', path: ['alt'] };

const UploadFields = z.object({
  /** Chosen by the server wrapper (never by a client), so a failed upload's files can be purged. */
  assetId: z.uuid(),
  file: z.custom<Uint8Array>((v) => v instanceof Uint8Array, 'must be the file bytes'),
  alt: Alt,
  decorative: z.boolean().default(false),
  /** Replace this image (same owner and slot): the new one takes its place. */
  replaceAssetId: z.uuid().nullable().default(null),
});

export const UploadMediaInput = UploadFields.extend({
  ownerType: z.enum(['event', 'venue']),
  ownerId: z.uuid(),
  slot: z.enum(['cover', 'gallery', 'photo']),
}).refine(altRequired, altIssue);
export type UploadMediaInput = z.input<typeof UploadMediaInput>;

/** The org logo is never decorative: it names the organizer. */
export const UploadLogoInput = UploadFields.extend({ decorative: z.literal(false).default(false) }).refine(
  altRequired,
  altIssue,
);
export type UploadLogoInput = z.input<typeof UploadLogoInput>;

export const UpdateAltInput = z
  .object({ assetId: z.uuid(), alt: Alt, decorative: z.boolean().default(false) })
  .refine(altRequired, altIssue);
export type UpdateAltInput = z.input<typeof UpdateAltInput>;

/**
 * M1.4h: a speaker photo or an exhibitor/sponsor logo. Always described (never decorative): the
 * console suggests "Photo of {name}" or the company name, which the organizer can edit.
 */
export const UploadProgramImageInput = UploadFields.omit({ decorative: true })
  .extend({ ownerId: z.uuid() })
  .refine(altRequired, altIssue);
export type UploadProgramImageInput = z.input<typeof UploadProgramImageInput>;

export const UpdateProgramAltInput = z.object({ assetId: z.uuid(), alt: Alt }).refine(altRequired, altIssue);
export type UpdateProgramAltInput = z.input<typeof UpdateProgramAltInput>;
