import { withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

/**
 * Public reads of the site pages and settings staff manage in the admin console: legal and static
 * pages (Markdown, versioned) and the `contact` / `about` settings. They read only the
 * `cms.public_platform_*` views (published rows). The Contact form writes through the SECURITY
 * DEFINER `cms.contact_submit` (app_user has no privileges on the inbox table).
 */
type Row = Record<string, unknown>;

export interface PlatformPage {
  readonly slug: string;
  readonly title: string;
  readonly body: string;
  /** `YYYY-MM-DD`, shown as "last updated". */
  readonly effectiveDate: string;
  readonly version: number;
}

/** The page in the visitor's language, or the English one when there is no translation yet. */
export async function platformPage(slug: string, locale = 'en'): Promise<PlatformPage | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<Row>(
      sql`select slug, title, body, to_char(effective_date, 'YYYY-MM-DD') as effective_date, version from cms.public_platform_pages
          where slug = ${slug} and locale in (${locale}, 'en') order by (locale = ${locale}) desc limit 1`,
    ),
  );
  const r = rows[0];
  return r
    ? {
        slug: String(r.slug),
        title: String(r.title),
        body: String(r.body),
        effectiveDate: String(r.effective_date),
        version: Number(r.version),
      }
    : null;
}

/** Pages shown in the footer's legal column, in a fixed order. */
export const LEGAL_SLUGS = ['privacy', 'terms', 'refund-policy', 'cookies', 'sub-processors'] as const;

export const ContactSettings = z.object({
  address: z.string().max(400).default(''),
  phone: z.string().max(60).default(''),
  email: z.string().max(254).default(''),
  /** Where contact messages are emailed (the platform's support address). */
  supportEmail: z.string().max(254).default(''),
  hours: z.string().max(200).default(''),
});
export type ContactSettings = z.infer<typeof ContactSettings>;

const text = (max: number) => z.string().max(max).default('');
export const AboutSettings = z.object({
  lede: text(400),
  mission: text(800),
  story: text(4000),
  values: z
    .array(z.object({ title: text(80), text: text(300) }))
    .max(8)
    .default([]),
  attendees: text(800),
  organizers: text(800),
  team: z
    .array(z.object({ name: text(80), role: text(80), bio: text(300) }))
    .max(12)
    .default([]),
  stats: z
    .array(z.object({ value: text(20), label: text(60) }))
    .max(6)
    .default([]),
  ctaTitle: text(120),
  ctaLabel: text(60),
  ctaHref: text(300),
});
export type AboutSettings = z.infer<typeof AboutSettings>;

async function setting(key: 'contact' | 'about'): Promise<unknown> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ value: unknown }>(sql`select value from cms.public_platform_settings where key = ${key}`),
  );
  return rows[0]?.value ?? {};
}

export async function platformContactSettings(): Promise<ContactSettings> {
  return ContactSettings.parse(await setting('contact'));
}

export async function platformAboutSettings(): Promise<AboutSettings> {
  return AboutSettings.parse(await setting('about'));
}

export const ContactMessageInput = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  subject: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(4000),
  locale: z.string().max(10).default('en'),
});
export type ContactMessageInput = z.infer<typeof ContactMessageInput>;

/** Store a message from the public Contact page (the caller has rate-limited and human-checked it). */
export async function submitPlatformContactMessage(value: unknown): Promise<string> {
  const input = ContactMessageInput.parse(value);
  const [row] = await withoutTenant((tx) =>
    tx.execute<{ id: string }>(sql`select cms.contact_submit(${JSON.stringify(input)}::jsonb) as id`),
  );
  if (!row) throw new Error('contact message not stored');
  return String(row.id);
}
