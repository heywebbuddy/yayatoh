import { columnPrivacy, internal, personal } from '@yayatoh/db';

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
});
