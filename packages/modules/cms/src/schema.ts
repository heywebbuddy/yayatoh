import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, index, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
