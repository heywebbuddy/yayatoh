import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

const HIDDEN = { where: "status <> 'visible'" };

/**
 * Column privacy of the `reviews` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed. A visible
 * review's "First L." name and text are public; a hidden one's are not.
 */
export const privateColumns = columnPrivacy('reviews', {
  reviews: {
    // sha256(org:email): the one-review-per-holder key.
    author_key: secret(),
    author_display: personal(undefined, HIDDEN),
    body: personal(undefined, HIDDEN),
    status: 'vocab',
    // Set exactly when hidden (CHECK); visible rows hold none.
    hidden_reason: internal(undefined, { where: "status = 'hidden'" }),
    moderated_by: internal(),
  },
  review_reports: { reason: 'vocab', note: internal(), reporter_key: secret(), status: 'vocab' },
});
