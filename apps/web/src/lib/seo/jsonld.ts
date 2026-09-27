import { currencyExponent } from '@yayatoh/kernel';
import { z } from 'zod';

export interface JsonLdEventInput {
  readonly name: string;
  readonly description: string | null;
  readonly status: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly venueName: string | null;
  readonly city: string | null;
  /** ISO 3166-1 alpha-2 (the legacy page emitted a numeric id; roadmap §1 known defects). */
  readonly country: string | null;
  readonly url: string;
  readonly image: string;
  readonly organizer: { readonly name: string; readonly url: string };
  readonly offers: readonly {
    readonly name: string;
    readonly priceMinor: number;
    readonly currency: string;
    readonly availability: 'available' | 'sold_out' | 'not_yet_on_sale' | 'sales_ended';
  }[];
}

const STATUS: Record<string, string> = {
  published: 'https://schema.org/EventScheduled',
  completed: 'https://schema.org/EventScheduled',
  postponed: 'https://schema.org/EventPostponed',
  cancelled: 'https://schema.org/EventCancelled',
};
const AVAILABILITY = {
  available: 'https://schema.org/InStock',
  sold_out: 'https://schema.org/SoldOut',
  not_yet_on_sale: 'https://schema.org/PreOrder',
  sales_ended: 'https://schema.org/SoldOut',
} as const;

/** Integer minor units → the decimal string schema.org expects ("25.00", "1500" for JPY). */
export function decimalPrice(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  if (exp === 0) return String(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor)
    .toString()
    .padStart(exp + 1, '0');
  return `${sign}${abs.slice(0, -exp)}.${abs.slice(-exp)}`;
}

/** schema.org `Event` for the public event page (Rich Results). Absolute URLs only. */
export function eventJsonLd(e: JsonLdEventInput) {
  const place = e.venueName ?? e.city ?? e.name;
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.name,
    ...(e.description ? { description: e.description } : {}),
    startDate: e.startsAt.toISOString(),
    endDate: e.endsAt.toISOString(),
    eventStatus: STATUS[e.status] ?? 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: place,
      address: {
        '@type': 'PostalAddress',
        ...(e.city ? { addressLocality: e.city } : {}),
        ...(e.country ? { addressCountry: e.country } : {}),
      },
    },
    image: [e.image],
    url: e.url,
    organizer: { '@type': 'Organization', name: e.organizer.name, url: e.organizer.url },
    ...(e.offers.length > 0
      ? {
          offers: e.offers.map((o) => ({
            '@type': 'Offer',
            name: o.name,
            price: decimalPrice(o.priceMinor, o.currency),
            priceCurrency: o.currency,
            availability: AVAILABILITY[o.availability],
            url: e.url,
          })),
        }
      : {}),
  };
}

/** Serialize for a `<script type="application/ld+json">`: `<` escaped so text cannot close it. */
export const jsonLdScript = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

const absolute = z.url().refine((u) => /^https?:\/\//.test(u), 'absolute http(s) URL');
/**
 * The shape the Rich Results "Event" check requires (name, startDate, location with an address,
 * absolute URLs, ISO country codes, valid offers). Tests validate every emitted block with it.
 */
export const EventJsonLdSchema = z.object({
  '@context': z.literal('https://schema.org'),
  '@type': z.literal('Event'),
  name: z.string().min(1),
  description: z.string().optional(),
  startDate: z.iso.datetime(),
  endDate: z.iso.datetime(),
  eventStatus: z.enum([
    'https://schema.org/EventScheduled',
    'https://schema.org/EventPostponed',
    'https://schema.org/EventCancelled',
  ]),
  eventAttendanceMode: z.literal('https://schema.org/OfflineEventAttendanceMode'),
  location: z.object({
    '@type': z.literal('Place'),
    name: z.string().min(1),
    address: z.object({
      '@type': z.literal('PostalAddress'),
      addressLocality: z.string().optional(),
      addressCountry: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
    }),
  }),
  image: z.array(absolute).min(1),
  url: absolute,
  organizer: z.object({ '@type': z.literal('Organization'), name: z.string().min(1), url: absolute }),
  offers: z
    .array(
      z.object({
        '@type': z.literal('Offer'),
        name: z.string(),
        price: z.string().regex(/^\d+(\.\d+)?$/),
        priceCurrency: z.string().regex(/^[A-Z]{3}$/),
        availability: z.string().startsWith('https://schema.org/'),
        url: absolute,
      }),
    )
    .optional(),
});
