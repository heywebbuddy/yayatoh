import { columnPrivacy, internal, personal } from '@yayatoh/db';

const HASH_NAMED =
  'content-addressed by CHECK (hex SHA-256 / `{width}-{hash}.{ext}`); no plaintext. Files are served only through media.serve_target (media visibility tests)';

/**
 * Column privacy of the `media` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('media', {
  // Alt text goes with the image wherever it is shown (public pages for public events and venues).
  assets: { owner_type: 'vocab', slot: 'vocab', source_type: 'vocab', alt: 'public' },
  variants: {
    format: 'vocab',
    sha256: internal('none', { why: HASH_NAMED }),
    file_name: internal('none', { why: HASH_NAMED }),
  },
  // M5.3a portal files: a task answer or proposed photo; organizers only (media.portalFile).
  portal_files: {
    purpose: 'vocab',
    file_type: 'vocab',
    file_name: personal(),
    storage_key: internal('none', {
      why: 'an `{org}/{file}/f-{hash}.{ext}` key; read only through media.portalFile',
    }),
    sha256: internal('none', { why: HASH_NAMED }),
    created_by: internal(),
  },
  // The dev/CI media store (production uses R2 and leaves it empty).
  blobs: {
    key: internal('none', {
      why: 'an `{org}/{asset}/{file}` storage key (CHECK: starts with the org id); served only through media.serve_target',
    }),
    content_type: 'vocab',
    data: internal('none', {
      why: 're-encoded image bytes, never text; served only through media.serve_target (media visibility tests)',
    }),
  },
});
