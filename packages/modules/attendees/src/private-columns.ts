import { columnPrivacy, internal, personal } from '@yayatoh/db';

/**
 * Column privacy of the `attendees` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('attendees', {
  attendees: {
    source: 'vocab',
    name: personal(),
    email: personal('email'),
    status: 'vocab',
    labels: internal(),
  },
  import_batches: {
    file_name: internal(),
    headers: internal(),
    mapping: internal(),
    extra_labels: internal(),
  },
  import_rows: { cells: personal(), error_code: 'vocab' },
});
