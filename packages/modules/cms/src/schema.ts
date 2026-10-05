import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const cmsSchema = pgSchema('cms');

export { ENTRY_KINDS, ENTRY_STATUSES } from './domain/kinds.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * An org's CMS entry (M1.4g): a page (`/pages/{slug}`) or a blog post (`/blogs/{slug}`) on its
 * tenant site and organizer page. `slug` is unique per org and kind and frozen once published.
 * `body` is the M1.4d Markdown subset, sanitized on write and parsed (never injected) on render.
 *
 * Cover images wait for the media pipeline (M1.4e): a `cover_media_id` column is added then.
 */
export const entries = tenantTable(
  cmsSchema,
  'entries',
  {
    kind: text('kind').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    excerpt: text('excerpt'),
    body: text('body').notNull().default(''),
    status: text('status').notNull().default('draft'),
    publishedAt: ts('published_at'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    /** The member who created it; `author_name` is the name shown publicly (a snapshot). */
    authorUserId: uuid('author_user_id'),
    authorName: text('author_name'),
  },
  (t) => [
    uniqueIndex('entries_org_kind_slug_key').on(t.orgId, t.kind, t.slug),
    index('entries_org_kind_status_published_idx').on(t.orgId, t.kind, t.status, t.publishedAt),
    check('entries_kind_check', sql`kind in ('page', 'post')`),
    check('entries_status_check', sql`status in ('draft', 'published', 'archived')`),
    check('entries_slug_check', sql`slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'`),
    check('entries_title_check', sql`char_length(title) between 1 and 160`),
    check('entries_excerpt_check', sql`excerpt is null or char_length(excerpt) <= 300`),
    check('entries_body_check', sql`char_length(body) <= 20000`),
    check('entries_seo_title_check', sql`seo_title is null or char_length(seo_title) <= 70`),
    check(
      'entries_seo_description_check',
      sql`seo_description is null or char_length(seo_description) <= 160`,
    ),
    check('entries_published_at_check', sql`status <> 'published' or published_at is not null`),
  ],
);

const LOCALE_CHECK = (col: string) => sql.raw(`${col} ~ '^[a-z]{2}(-[A-Z]{2})?$'`);
const SLUG_CHECK = (col: string) => sql.raw(`${col} ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'`);

/**
 * Help center categories (M3.11b), on the platform content org's CMS. A category belongs to one
 * audience (organizers or buyers); `title`/`description` are English, `translations` holds the
 * other locales (`{ "ar": { "title": …, "description": … } }`). A category is shown publicly only
 * while it has published articles.
 */
export const helpCategories = tenantTable(
  cmsSchema,
  'help_categories',
  {
    audience: text('audience').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    translations: jsonb('translations').notNull().default({}),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    uniqueIndex('help_categories_org_slug_key').on(t.orgId, t.slug),
    index('help_categories_org_audience_position_idx').on(t.orgId, t.audience, t.position),
    check('help_categories_audience_check', sql`audience in ('organizers', 'buyers')`),
    check('help_categories_slug_check', SLUG_CHECK('slug')),
    check('help_categories_title_check', sql`char_length(title) between 1 and 80`),
    check('help_categories_description_check', sql`description is null or char_length(description) <= 300`),
    check('help_categories_translations_check', sql`jsonb_typeof(translations) = 'object'`),
    check('help_categories_position_check', sql`position between 0 and 10000`),
  ],
);

/**
 * A help article in one locale (M3.11b). Translations are rows with the same `slug` in another
 * `locale`; the public pages show the reader's locale and fall back to English. Same lifecycle and
 * Markdown subset as `entries`; the slug is frozen once first published.
 */
export const helpArticles = tenantTable(
  cmsSchema,
  'help_articles',
  {
    categoryId: uuid('category_id').notNull(),
    locale: text('locale').notNull().default('en'),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    body: text('body').notNull().default(''),
    /** Extra search terms (comma separated), weighted between the title and the summary. */
    keywords: text('keywords'),
    position: integer('position').notNull().default(0),
    status: text('status').notNull().default('draft'),
    publishedAt: ts('published_at'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
  },
  (t) => [
    uniqueIndex('help_articles_org_locale_slug_key').on(t.orgId, t.locale, t.slug),
    index('help_articles_org_category_status_idx').on(t.orgId, t.categoryId, t.status, t.position),
    index('help_articles_org_locale_status_idx').on(t.orgId, t.locale, t.status),
    foreignKey({
      name: 'help_articles_category_fk',
      columns: [t.orgId, t.categoryId],
      foreignColumns: [helpCategories.orgId, helpCategories.id],
    }).onDelete('no action'),
    check('help_articles_locale_check', LOCALE_CHECK('locale')),
    check('help_articles_slug_check', SLUG_CHECK('slug')),
    check('help_articles_status_check', sql`status in ('draft', 'published', 'archived')`),
    check('help_articles_title_check', sql`char_length(title) between 1 and 160`),
    check('help_articles_summary_check', sql`summary is null or char_length(summary) <= 300`),
    check('help_articles_body_check', sql`char_length(body) <= 20000`),
    check('help_articles_keywords_check', sql`keywords is null or char_length(keywords) <= 300`),
    check('help_articles_position_check', sql`position between 0 and 10000`),
    check('help_articles_seo_title_check', sql`seo_title is null or char_length(seo_title) <= 70`),
    check(
      'help_articles_seo_description_check',
      sql`seo_description is null or char_length(seo_description) <= 160`,
    ),
    check('help_articles_published_at_check', sql`status <> 'published' or published_at is not null`),
  ],
);

/**
 * "Was this helpful?" answers (M3.11b): one per browser per article (a re-vote replaces it).
 * `voter_key` is a hash of the device cookie; no person, IP or free text is stored.
 */
export const helpFeedback = tenantTable(
  cmsSchema,
  'help_feedback',
  {
    articleId: uuid('article_id').notNull(),
    helpful: boolean('helpful').notNull(),
    reason: text('reason'),
    voterKey: text('voter_key').notNull(),
  },
  (t) => [
    uniqueIndex('help_feedback_org_article_voter_key').on(t.orgId, t.articleId, t.voterKey),
    foreignKey({
      name: 'help_feedback_article_fk',
      columns: [t.orgId, t.articleId],
      foreignColumns: [helpArticles.orgId, helpArticles.id],
    }).onDelete('cascade'),
    check(
      'help_feedback_reason_check',
      sql`reason is null or (not helpful and reason in ('unclear', 'incomplete', 'outdated', 'other'))`,
    ),
  ],
);

/**
 * Marketing site sections (M3.11b): the blocks of the marketplace's organizer pages (`home`: "Why
 * Yayatoh", `features`, `contact`), edited in the content org's console. Only the layout is code.
 * A section is keyed by `slug` per placement; translations are rows in another `locale` (English
 * is the fallback).
 */
export const siteSections = tenantTable(
  cmsSchema,
  'site_sections',
  {
    placement: text('placement').notNull(),
    locale: text('locale').notNull().default('en'),
    slug: text('slug').notNull(),
    position: integer('position').notNull().default(0),
    eyebrow: text('eyebrow'),
    heading: text('heading').notNull(),
    body: text('body').notNull().default(''),
    ctaLabel: text('cta_label'),
    ctaHref: text('cta_href'),
    status: text('status').notNull().default('draft'),
    publishedAt: ts('published_at'),
  },
  (t) => [
    uniqueIndex('site_sections_org_placement_locale_slug_key').on(t.orgId, t.placement, t.locale, t.slug),
    index('site_sections_org_placement_status_idx').on(t.orgId, t.placement, t.status, t.position),
    check('site_sections_placement_check', sql`placement in ('home', 'features', 'contact')`),
    check('site_sections_locale_check', LOCALE_CHECK('locale')),
    check('site_sections_slug_check', SLUG_CHECK('slug')),
    check('site_sections_status_check', sql`status in ('draft', 'published', 'archived')`),
    check('site_sections_eyebrow_check', sql`eyebrow is null or char_length(eyebrow) <= 60`),
    check('site_sections_heading_check', sql`char_length(heading) between 1 and 120`),
    check('site_sections_body_check', sql`char_length(body) <= 4000`),
    check('site_sections_cta_label_check', sql`cta_label is null or char_length(cta_label) <= 40`),
    check(
      'site_sections_cta_check',
      sql`(cta_label is null) = (cta_href is null) and (cta_href is null or (char_length(cta_href) <= 300 and cta_href ~ '^(/[^/]|/$|https://)'))`,
    ),
    check('site_sections_position_check', sql`position between 0 and 10000`),
    check('site_sections_published_at_check', sql`status <> 'published' or published_at is not null`),
  ],
);

/**
 * Contact / sales requests from the marketplace's contact page (M3.11b), kept in the content
 * org for its team. Personal data: never public, listed only in that org's console.
 */
export const contactRequests = tenantTable(
  cmsSchema,
  'contact_requests',
  {
    topic: text('topic').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    company: text('company'),
    message: text('message').notNull(),
    locale: text('locale').notNull().default('en'),
    status: text('status').notNull().default('new'),
    handledAt: ts('handled_at'),
    /** U10: where it came from — the marketplace's contact page, or an org's own contact page. */
    source: text('source').notNull().default('marketplace'),
    /** U10: the form's one-time key, so a resubmitted form never delivers twice. */
    submissionKey: uuid('submission_key'),
  },
  (t) => [
    check('contact_requests_source_check', sql`source in ('marketplace', 'org_site')`),
    uniqueIndex('contact_requests_org_submission_key')
      .on(t.orgId, t.submissionKey)
      .where(sql`submission_key is not null`),
    index('contact_requests_org_status_created_idx').on(t.orgId, t.status, t.createdAt),
    check('contact_requests_topic_check', sql`topic in ('sales', 'support', 'partnership', 'other')`),
    check('contact_requests_status_check', sql`status in ('new', 'handled')`),
    check('contact_requests_name_check', sql`char_length(name) between 1 and 120`),
    check('contact_requests_email_check', sql`char_length(email) between 3 and 254`),
    check('contact_requests_company_check', sql`company is null or char_length(company) <= 160`),
    check('contact_requests_message_check', sql`char_length(message) between 1 and 4000`),
    check('contact_requests_locale_check', LOCALE_CHECK('locale')),
  ],
);

/**
 * U10: the org's contact page block (`/contact` on its tenant site, `/o/{slug}/contact` on the
 * marketplace). Off until the organizer turns it on. Messages go to the org's members as
 * notifications; the org's own addresses are never on the page.
 */
export const contactPages = tenantTable(
  cmsSchema,
  'contact_pages',
  {
    enabled: boolean('enabled').notNull().default(false),
    /** A short line above the form (plain text). */
    intro: text('intro'),
  },
  (t) => [
    uniqueIndex('contact_pages_org_key').on(t.orgId),
    check('contact_pages_intro_check', sql`intro is null or char_length(intro) between 1 and 500`),
  ],
);
