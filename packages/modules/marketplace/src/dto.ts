import { defineSerializer } from '@yayatoh/contracts';
import { z } from 'zod';
import { LISTED_STATUSES } from './schema.ts';

/** What a public listing may show (marketplace, tenant sites, organizer pages). No PII, no ids. */
export const ListingDto = z.object({
  slug: z.string(),
  name: z.string(),
  tagline: z.string().nullable(),
  profile: z.string(),
  status: z.enum(LISTED_STATUSES),
  timezone: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  venueName: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  currency: z.string(),
  minPriceMinor: z.number().int().nullable(),
  maxPriceMinor: z.number().int().nullable(),
  orgSlug: z.string(),
  orgName: z.string(),
  canonicalHost: z.string().nullable(),
  updatedAt: z.date(),
});
export type ListingDto = z.infer<typeof ListingDto>;
export const listingSerializer = defineSerializer('marketplace.listing', ListingDto);

export const ListingPageDto = z.object({
  items: z.array(ListingDto),
  total: z.number().int(),
  page: z.number().int(),
  pageCount: z.number().int(),
});
export type ListingPageDto = z.infer<typeof ListingPageDto>;

export const SiteSettingsDto = z.object({
  listOnMarketplace: z.boolean(),
  tenantSite: z.boolean(),
  embedOrigins: z.array(z.string()),
});
export type SiteSettingsDto = z.infer<typeof SiteSettingsDto>;
export const siteSettingsSerializer = defineSerializer('marketplace.siteSettings', SiteSettingsDto);

export const DEFAULT_SITE_SETTINGS: SiteSettingsDto = {
  listOnMarketplace: false,
  tenantSite: false,
  embedOrigins: [],
};

/** A sitemap entry: path-relevant fields and lastmod only. */
export const SitemapListingDto = z.object({
  slug: z.string(),
  orgSlug: z.string(),
  updatedAt: z.date(),
});
export type SitemapListingDto = z.infer<typeof SitemapListingDto>;
