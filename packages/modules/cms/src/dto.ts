import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { ENTRY_KINDS, ENTRY_STATUSES } from './domain/kinds.ts';
import { SLUG_MAX } from './domain/slug.ts';

/** Body length after sanitizing (the M1.4d Markdown subset). */
export const BODY_MAX = 20_000;

export const EntryKind = z.enum(ENTRY_KINDS);
export type EntryKind = z.infer<typeof EntryKind>;

/** The console's view of an entry (organizer eyes only). */
export const EntryDto = z.object({
  id: z.uuid(),
  kind: EntryKind,
  slug: z.string(),
  title: z.string(),
  excerpt: z.string().nullable(),
  body: z.string(),
  status: z.enum(ENTRY_STATUSES),
  publishedAt: z.date().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  authorName: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type EntryDto = z.infer<typeof EntryDto>;
export const entrySerializer = defineSerializer('cms.entry', EntryDto);

/** A published page or post as the public sees it: no ids, no author account, no drafts. */
export const PublicEntryDto = z.object({
  kind: EntryKind,
  slug: z.string(),
  title: z.string(),
  excerpt: z.string().nullable(),
  body: z.string(),
  publishedAt: z.date(),
  updatedAt: z.date(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  authorName: z.string().nullable(),
});
export type PublicEntryDto = z.infer<typeof PublicEntryDto>;
export const publicEntrySerializer = defineSerializer('cms.publicEntry', PublicEntryDto);

export const PublicEntrySummaryDto = PublicEntryDto.pick({
  slug: true,
  title: true,
  excerpt: true,
  publishedAt: true,
  updatedAt: true,
  authorName: true,
});
export type PublicEntrySummaryDto = z.infer<typeof PublicEntrySummaryDto>;
export const publicEntrySummarySerializer = defineSerializer('cms.publicEntrySummary', PublicEntrySummaryDto);

export const PublicEntryPageDto = z.object({
  items: z.array(PublicEntrySummaryDto),
  page: z.number().int(),
  pageCount: z.number().int(),
});
export type PublicEntryPageDto = z.infer<typeof PublicEntryPageDto>;

/** A page linked from the tenant site's navigation. */
export const NavPageDto = z.object({ slug: z.string(), title: z.string() });
export type NavPageDto = z.infer<typeof NavPageDto>;
export const navPageSerializer = defineSerializer('cms.navPage', NavPageDto);

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

const EntryFields = z.object({
  title: z.string().trim().min(1).max(160),
  /** Empty or absent: derived from the title. */
  slug: z.string().trim().toLowerCase().max(SLUG_MAX).optional(),
  excerpt: optText(300).default(null),
  body: z
    .string()
    .max(BODY_MAX * 2)
    .default(''),
  seoTitle: optText(70).default(null),
  seoDescription: optText(160).default(null),
});

export const CreateEntryInput = EntryFields.extend({
  kind: EntryKind,
  /** The signed-in member's display name (shown as the author). */
  authorName: z.string().trim().max(120).nullable().default(null),
});
export type CreateEntryInput = z.input<typeof CreateEntryInput>;

export const UpdateEntryInput = z.object({
  entryId: z.uuid(),
  title: EntryFields.shape.title.optional(),
  slug: EntryFields.shape.slug,
  excerpt: optText(300).optional(),
  body: z
    .string()
    .max(BODY_MAX * 2)
    .optional(),
  seoTitle: optText(70).optional(),
  seoDescription: optText(160).optional(),
});
export type UpdateEntryInput = z.input<typeof UpdateEntryInput>;
