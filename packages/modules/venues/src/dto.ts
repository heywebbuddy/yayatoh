import { defineSerializer, IanaTimezone, partialNoDefaults } from '@yayatoh/contracts';
import { z } from 'zod';
import { QUOTE_STATUSES } from './schema.ts';

const text = (max: number) => z.string().trim().max(max).nullable().default(null);

/** `https://` only: map links open in a new tab from public pages. */
export const HttpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https:// link');

export const VenueDto = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  timezone: z.string(),
  capacity: z.number().int().nullable(),
  accessibilityNotes: z.string().nullable(),
  mapUrl: z.string().nullable(),
  directoryListed: z.boolean(),
  archivedAt: z.date().nullable(),
});
export type VenueDto = z.infer<typeof VenueDto>;
export const venueSerializer = defineSerializer('venues.venue', VenueDto);

const VenueFields = z.object({
  name: z.string().trim().min(2).max(160),
  addressLine1: text(200),
  addressLine2: text(200),
  city: text(120),
  region: text(120),
  postalCode: text(20),
  country: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/)),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  timezone: IanaTimezone,
  capacity: z.number().int().min(1).max(1_000_000).nullable().default(null),
  accessibilityNotes: text(2000),
  mapUrl: HttpsUrl.nullable().default(null),
  directoryListed: z.boolean().default(false),
});

const geoPaired = (v: { latitude?: number | null; longitude?: number | null }) =>
  (v.latitude === undefined || v.latitude === null) === (v.longitude === undefined || v.longitude === null);
const geoIssue = { message: 'Give both latitude and longitude, or neither', path: ['longitude'] };

export const CreateVenueInput = VenueFields.refine(geoPaired, geoIssue);
export type CreateVenueInput = z.input<typeof CreateVenueInput>;
export const UpdateVenueInput = partialNoDefaults(VenueFields)
  .extend({ venueId: z.uuid() })
  .refine(geoPaired, geoIssue);
export type UpdateVenueInput = z.input<typeof UpdateVenueInput>;

/** What the platform directory and the public venue page may show: no org internals. */
export const PublicVenueDto = z.object({
  slug: z.string(),
  name: z.string(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  timezone: z.string(),
  capacity: z.number().int().nullable(),
  accessibilityNotes: z.string().nullable(),
  mapUrl: z.string().nullable(),
  organizerName: z.string(),
});
export type PublicVenueDto = z.infer<typeof PublicVenueDto>;
export const publicVenueSerializer = defineSerializer('venues.publicVenue', PublicVenueDto);

export const DirectoryVenueDto = PublicVenueDto.pick({
  slug: true,
  name: true,
  city: true,
  region: true,
  country: true,
  capacity: true,
});
export type DirectoryVenueDto = z.infer<typeof DirectoryVenueDto>;
export const directoryVenueSerializer = defineSerializer('venues.directoryVenue', DirectoryVenueDto);

export const QuoteRequestInput = z.object({
  venueId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  email: z.email().trim().max(254),
  phone: z.string().trim().max(40).nullable().default(null),
  eventDate: z.iso.date().nullable().default(null),
  guests: z.number().int().min(1).max(1_000_000).nullable().default(null),
  message: z.string().trim().min(10).max(4000),
  /** Opaque, already hashed by the caller (never an IP address). */
  clientKey: z.string().min(16).max(128),
});
export type QuoteRequestInput = z.input<typeof QuoteRequestInput>;

export const QuoteRequestDto = z.object({
  id: z.uuid(),
  venueId: z.uuid(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  eventDate: z.string().nullable(),
  guests: z.number().int().nullable(),
  message: z.string(),
  status: z.enum(QUOTE_STATUSES),
  createdAt: z.date(),
});
export type QuoteRequestDto = z.infer<typeof QuoteRequestDto>;
