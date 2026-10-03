import { columnPrivacy, internal, personal } from '@yayatoh/db';

/**
 * Column privacy of the `badges` schema (roadmap §9 canary leak test). Templates are organizer
 * configuration (never public); batches hold no personal data themselves (ticket ids only), and
 * their storage key is internal.
 */
export const privateColumns = columnPrivacy('badges', {
  templates: { name: internal(), size: 'vocab' },
  template_versions: { design: internal() },
  batch_parts: {
    pdf: personal('none', {
      why: 'rendered badge PDF bytes (names), never text; merged and deleted by the job, never in a response',
    }),
  },
  batches: {
    request_key: internal(),
    status: 'vocab',
    sort: 'vocab',
    locale: 'vocab',
    version_map: internal(),
    file_key: internal('none', { why: 'a media-store key checked by its format; never in a response' }),
    error_code: 'vocab',
  },
  printers: {
    name: internal(),
    adapter: 'vocab',
    status: 'vocab',
  },
  print_jobs: {
    adapter: 'vocab',
    kind: 'vocab',
    reason: 'vocab',
    note: internal(),
    status: 'vocab',
    source: 'vocab',
    locale: 'vocab',
    request_key: internal(),
    provider_job_id: internal(),
    error_code: 'vocab',
  },
});
