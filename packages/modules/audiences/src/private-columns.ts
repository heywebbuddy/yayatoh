import { columnPrivacy, internal } from '@yayatoh/db';

/**
 * Column privacy of the `audiences` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('audiences', {
  // Saved audiences are the organizer's working notes: never public or in outbound messages.
  segments: { name: internal(), definition: internal() },
});
