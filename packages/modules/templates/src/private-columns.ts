import { columnPrivacy, internal } from '@yayatoh/db';

/**
 * Column privacy of the `templates` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('templates', {
  event_templates: {
    name: internal(),
    description: internal(),
    profile: 'vocab',
    snapshot: internal(),
  },
});
