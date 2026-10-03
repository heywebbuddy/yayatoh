import { columnPrivacy, holder, internal, personal, secret } from '@yayatoh/db';

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
    // M6.10a: the provider's fixed backup ingest address, and which one is active.
    backup_ingest_url: 'vocab',
    active_ingest: 'vocab',
  },
  // M6.10a: the provider that served a watched minute.
  watch_minutes: { provider: 'vocab' },
  // M6.9b: Zoom. The webinar id is the organizer's Zoom webinar (digits only, so the canary cannot
  // be written; it reaches registrants inside Zoom's own emails, never a Yayatoh page).
  zoom_webinars: {
    webinar_id: internal('none', {
      why: 'CHECK allows 9–12 digits only; the console shows it to event editors, nothing public reads it.',
    }),
    origin: 'vocab',
  },
  zoom_registrants: { email: personal('email'), first_name: personal(), last_name: personal() },
  zoom_attendance: {
    email: personal('email'),
    // M6.10a: sha256 of the participant's address and join second (CHECK: 64 hex digits).
    segment_key: secret('none', {
      why: 'CHECK allows 64 hex digits only; no query selects it outside the attendance upsert.',
    }),
  },
  // M6.10a: verified Zoom join/leave webhooks (dedup ids and participant keys are sha256 hashes).
  zoom_participant_events: {
    provider_event_id: secret('none', {
      why: 'CHECK allows 64 hex digits only; it is the deduplication key and no query returns it.',
    }),
    kind: 'vocab',
    participant_key: secret('none', {
      why: 'CHECK allows 64 hex digits only; it pairs a join with its leave and no query returns it.',
    }),
    email: personal('email'),
  },
});
