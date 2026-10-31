import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** The same `cms` schema as ./schema.ts (declared here so the module checker sees the tables' schema). */
const cmsSchema = pgSchema('cms');

/**
 * Platform content managed by Yayatoh staff in the admin console: blog posts, testimonials and
 * the home hero. These are global tables (no tenant), so the main site no longer depends on a
 * "content org". `app_user` can only read the `public_*` views (published rows); staff write
 * through the SECURITY DEFINER `cms.platform_*` functions (platform_reader, audited).
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength),
  fromDriver: (v) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength),
});

/** An uploaded image or video (served at `/api/platform-assets/{id}`). */
export const platformAssets = cmsSchema.table(
  'platform_assets',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    kind: text('kind').notNull(),
    contentType: text('content_type').notNull(),
    bytes: bytea('bytes').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  () => [
    check('platform_assets_kind_check', sql`kind in ('image', 'video')`),
    check(
      'platform_assets_type_check',
      sql`content_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm')`,
    ),
    check('platform_assets_size_check', sql`size between 1 and 31457280`),
  ],
);

export const platformPosts = cmsSchema.table(
  'platform_posts',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    excerpt: text('excerpt').notNull().default(''),
    /** The M1.4d Markdown subset (sanitized on write by the admin server). */
    body: text('body').notNull().default(''),
    coverAssetId: uuid('cover_asset_id'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    status: text('status').notNull().default('draft'),
    publishedAt: ts('published_at'),
    authorName: text('author_name'),
    category: text('category'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    coverAlt: text('cover_alt'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    uniqueIndex('platform_posts_slug_key').on(t.slug),
    check(
      'platform_posts_slug_check',
      sql`slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' and char_length(slug) <= 80`,
    ),
    check('platform_posts_title_check', sql`char_length(title) between 1 and 160`),
    check('platform_posts_category_check', sql`category is null or char_length(category) between 1 and 40`),
    check('platform_posts_tags_check', sql`cardinality(tags) <= 6`),
    check('platform_posts_excerpt_check', sql`char_length(excerpt) <= 400`),
    check('platform_posts_body_check', sql`char_length(body) <= 50000`),
    check(
      'platform_posts_seo_check',
      sql`(seo_title is null or char_length(seo_title) <= 70) and (seo_description is null or char_length(seo_description) <= 200)`,
    ),
    check('platform_posts_status_check', sql`status in ('draft', 'published')`),
    check('platform_posts_published_check', sql`(status = 'published') = (published_at is not null)`),
  ],
);

export const platformTestimonials = cmsSchema.table(
  'platform_testimonials',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    quote: text('quote').notNull(),
    name: text('name').notNull(),
    role: text('role'),
    photoAssetId: uuid('photo_asset_id'),
    rating: integer('rating'),
    position: integer('position').notNull().default(0),
    published: boolean('published').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: text('updated_by').notNull(),
  },
  () => [
    check('platform_testimonials_quote_check', sql`char_length(quote) between 1 and 600`),
    check('platform_testimonials_name_check', sql`char_length(name) between 1 and 120`),
    check('platform_testimonials_role_check', sql`role is null or char_length(role) <= 160`),
    check('platform_testimonials_rating_check', sql`rating is null or rating between 1 and 5`),
  ],
);

/** The home hero: at most one row (`singleton`). Empty fields fall back to the built-in copy. */
export const platformHero = cmsSchema.table(
  'platform_hero',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    headline: text('headline'),
    subtitle: text('subtitle'),
    imageAssetId: uuid('image_asset_id'),
    videoAssetId: uuid('video_asset_id'),
    /** A YouTube or Vimeo link, used when no video file is uploaded. */
    videoUrl: text('video_url'),
    ctaLabel: text('cta_label'),
    ctaHref: text('cta_href'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: text('updated_by').notNull(),
  },
  () => [
    check('platform_hero_singleton_check', sql`singleton`),
    check('platform_hero_headline_check', sql`headline is null or char_length(headline) <= 120`),
    check('platform_hero_subtitle_check', sql`subtitle is null or char_length(subtitle) <= 300`),
    check('platform_hero_cta_check', sql`(cta_label is null) = (cta_href is null)`),
    check('platform_hero_cta_href_check', sql`cta_href is null or cta_href ~ '^(/|https://)'`),
  ],
);

/** Small site settings as JSON, by key: `contact` (address, phone, emails) and `about` (the About page). */
export const platformSettings = cmsSchema.table(
  'platform_settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: text('updated_by').notNull(),
  },
  () => [check('platform_settings_key_check', sql`key in ('contact', 'about')`)],
);

/** Legal and static pages (privacy, terms, cookies, sub-processors, …) in Markdown, with versions. */
export const platformPages = cmsSchema.table(
  'platform_pages',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    slug: text('slug').notNull(),
    /** The language of this version of the page; `en` is the fallback for every other. */
    locale: text('locale').notNull().default('en'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** The "last updated" date shown to readers. */
    effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    publishedAt: ts('published_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    uniqueIndex('platform_pages_slug_locale_key').on(t.slug, t.locale),
    check('platform_pages_locale_check', sql`locale ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
    check(
      'platform_pages_slug_check',
      sql`slug ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' and char_length(slug) <= 60`,
    ),
    check('platform_pages_title_check', sql`char_length(title) between 1 and 160`),
    check('platform_pages_body_check', sql`char_length(body) <= 120000`),
    check('platform_pages_status_check', sql`status in ('draft', 'published')`),
    check('platform_pages_published_check', sql`(status = 'published') = (published_at is not null)`),
  ],
);

/** Every save of a page, newest version last. */
export const platformPageVersions = cmsSchema.table(
  'platform_page_versions',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    pageId: uuid('page_id')
      .notNull()
      .references(() => platformPages.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
    status: text('status').notNull(),
    savedBy: text('saved_by').notNull(),
    savedAt: ts('saved_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('platform_page_versions_key').on(t.pageId, t.version)],
);

/** Messages from the public Contact page: the staff inbox (status new / replied / closed). */
export const platformContactMessages = cmsSchema.table(
  'platform_contact_messages',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    name: text('name').notNull(),
    email: text('email').notNull(),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    locale: text('locale').notNull().default('en'),
    status: text('status').notNull().default('new'),
    notes: text('notes').notNull().default(''),
    lastReply: text('last_reply'),
    repliedAt: ts('replied_at'),
    repliedBy: text('replied_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    updatedBy: text('updated_by'),
  },
  (t) => [
    index('platform_contact_messages_status_idx').on(t.status, t.createdAt),
    check('platform_contact_messages_name_check', sql`char_length(name) between 1 and 120`),
    check(
      'platform_contact_messages_email_check',
      sql`email = lower(email) and email like '%@%' and char_length(email) <= 254`,
    ),
    check('platform_contact_messages_subject_check', sql`char_length(subject) between 1 and 160`),
    check('platform_contact_messages_message_check', sql`char_length(message) between 1 and 4000`),
    check('platform_contact_messages_status_check', sql`status in ('new', 'replied', 'closed')`),
    check('platform_contact_messages_notes_check', sql`char_length(notes) <= 4000`),
  ],
);
