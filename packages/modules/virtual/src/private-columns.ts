import { columnPrivacy, holder, secret } from '@yayatoh/db';

/**
 * Column privacy of the `virtual` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text column of a tenant table is listed. No stream key is stored (the
 * `VideoProvider` port hands it out on request).
 */
export const privateColumns = columnPrivacy('virtual', {
  ticket_access: { access: 'vocab' },
  streams: {
    provider: 'vocab',
    // The provider-side stream id: an id in the provider account.
    provider_stream_id: secret('code'),
    // Signed-only playback ids reach ticket holders inside their playback URL, never the public.
    playback_id: holder('code'),
    // The provider's fixed ingest address (one per provider), not org data.
    ingest_url: 'vocab',
  },
});
