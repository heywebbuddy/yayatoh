import { columnPrivacy, internal, personal } from '@yayatoh/db';

const HASH_NAMED =
  'content-addressed by CHECK (hex SHA-256 / `{width}-{hash}.{ext}`); files are served only with a signed URL the gallery queries issue';

/**
 * Column privacy of the `gallery` schema (roadmap §9 canary leak test). Guests' photos, names and
 * captions are personal data (P4-3): shown only to people past the guest site's password (or the
 * hosts), never public.
 */
export const privateColumns = columnPrivacy('gallery', {
  settings: { moderation: 'vocab' },
  uploaders: {
    kind: 'vocab',
    display_name: personal(undefined, { where: "kind = 'guest'" }),
    user_id: internal(undefined, { where: "kind = 'host'" }),
  },
  items: {
    kind: 'vocab',
    status: 'vocab',
    caption: personal(),
    upload_key: internal('none', {
      why: 'an `{org}/{upload}/u-{nonce}` staging key held to its format by a CHECK; no DTO has a field for it',
    }),
    source_type: 'vocab',
    video_provider: 'vocab',
    video_id: personal('none', {
      why: 'a YouTube/Vimeo id held to its format by a CHECK; read only by the gallery queries behind the password',
    }),
    decided_by: internal(),
  },
  variants: {
    format: 'vocab',
    sha256: internal('none', { why: HASH_NAMED }),
    file_name: internal('none', { why: HASH_NAMED }),
  },
});
