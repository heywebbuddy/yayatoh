import { columnPrivacy, holder, internal } from '@yayatoh/db';

/**
 * Column privacy of the `events` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('events', {
  access_code_attempts: { client_key: internal() },
  access_codes: { code: holder('code'), label: internal() },
  // Published announcements are public; the holders-only ones are not.
  event_announcements: {
    title: holder(undefined, { where: "audience <> 'public'" }),
    body: holder(undefined, { where: "audience <> 'public'" }),
    audience: 'vocab',
  },
  event_private_info: { body: holder(), join_url: holder('url') },
  event_role_assignments: { role: 'vocab' },
  event_sections: { kind: 'vocab', title: 'public', content: 'public' },
  event_tags: { tag: 'public', tag_key: 'public' },
  events: {
    slug: 'public',
    name: 'public',
    tagline: 'public',
    profile: 'vocab',
    status: 'vocab',
    visibility: 'vocab',
    timezone: 'vocab',
    venue_name: 'public',
    city: 'public',
    country: 'vocab',
    currency: 'vocab',
    category: 'vocab',
    attendance_mode: 'vocab',
  },
  occurrences: { status: 'vocab' },
  series: { slug: 'public', name: 'public', description: 'public' },
  // Short links are public URLs (`/e/{code}`).
  short_links: { code: 'public', kind: 'vocab' },
});
