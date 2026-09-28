import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

const DRAFT = { where: "status <> 'published'" };

/**
 * Column privacy of the `cms` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed. Published pages
 * and posts are public; drafts and archived entries are the organizer's own.
 */
export const privateColumns = columnPrivacy('cms', {
  entries: {
    kind: 'vocab',
    // Lower-case by CHECK; frozen once first published.
    slug: 'public',
    title: internal(undefined, DRAFT),
    excerpt: internal(undefined, DRAFT),
    body: internal(undefined, DRAFT),
    status: 'vocab',
    seo_title: internal(undefined, DRAFT),
    seo_description: internal(undefined, DRAFT),
    // A member's name snapshot, shown as the byline once published.
    author_name: personal(undefined, DRAFT),
  },
  // M3.11b help center: category names show publicly once they hold a published article (the
  // console decides what to write there); articles as entries.
  help_categories: {
    audience: 'vocab',
    slug: 'public',
    title: 'public',
    description: 'public',
    translations: 'public',
  },
  help_articles: {
    locale: 'vocab',
    slug: 'public',
    title: internal(undefined, DRAFT),
    summary: internal(undefined, DRAFT),
    body: internal(undefined, DRAFT),
    keywords: internal(undefined, DRAFT),
    status: 'vocab',
    seo_title: internal(undefined, DRAFT),
    seo_description: internal(undefined, DRAFT),
  },
  // Hash of the voter's device cookie; the answer counts are console-only.
  help_feedback: { reason: 'vocab', voter_key: secret() },
  site_sections: {
    placement: 'vocab',
    locale: 'vocab',
    slug: 'public',
    eyebrow: internal(undefined, DRAFT),
    heading: internal(undefined, DRAFT),
    body: internal(undefined, DRAFT),
    cta_label: internal(undefined, DRAFT),
    // CHECKed to a site path or https URL: a canary can't be seeded; drafts never leave (tests).
    cta_href: 'public',
    status: 'vocab',
  },
  contact_requests: {
    topic: 'vocab',
    name: personal(),
    email: personal('email'),
    company: personal(),
    message: personal(),
    locale: 'vocab',
    status: 'vocab',
  },
});
