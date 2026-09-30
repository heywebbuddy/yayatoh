import { columnPrivacy, holder } from '@yayatoh/db';

/**
 * Column privacy of the `surveys` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed. A survey's title
 * and intro are shown only to the people invited (signed links and their emails), never on a
 * public page. The questions and answers live in `forms` (declared there).
 */
export const privateColumns = columnPrivacy('surveys', {
  surveys: { kind: 'vocab', title: holder(), intro: holder() },
  sends: { source: 'vocab', audience: 'vocab' },
});
