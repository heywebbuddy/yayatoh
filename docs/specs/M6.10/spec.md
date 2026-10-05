# Spec: M6.10 — Virtual and hybrid v2

- **Milestone:** M6.10 (roadmap §10 Phase 6; Phase 6 plan `docs/plans/phase-6.md`, decisions P6-1, P6-9, P6-13; D24)
- **Status:** M6.10a built (2026-10-03), behind the `virtual` module key, the `VideoProvider` port (Mux and Cloudflare Stream fakes in dev/CI) and the `IntegrationAuth` port (the Zoom fake). Stacks on M6.9a (virtual v1) and M6.9b (Zoom and CE credits). Gate results are in the M6.10a commit report.
- **Risk tags:** `db-migration`, `tenancy`
- **Related ADRs:** 0001 (modular monolith), 0008 (outbox), 0023 (Phase 6 module layout: `virtual` tier 4, `integrations` tier 6)

## M6.10a — virtual v2 (done)

### 1. Goal and users
Organizers of online and hybrid events pick the video provider per session (Mux or Cloudflare
Stream) and can move a live session to the other provider without anyone losing access or minutes.
When the primary ingest fails, they point the encoder at the provider's backup ingest. Sessions run
as Zoom webinars are created from Yayatoh, and Zoom's join/leave webhooks count attendance as it
happens, once.

### 2. References
- **Decision P6-9:** Zoom for live webinars (registrant sync, reports, join/leave webhooks);
  Cloudflare Stream as a second provider in v2; RTMP overflow in v2. **D24:** streaming metered and
  resold at a markup. **P6-13:** entitlement key `virtual`. **P6-1:** behind flags, fakes only.
- **Plan row M6.10A** acceptance: switching provider keeps grants and watch-time history. **Brief**
  (`docs/agent-briefs/m6.10a.md`): join/leave webhooks replayed twice count once; signatures verified
  before any processing; e2e (create a webinar, switch a session's provider, the attendee keeps
  access; keyboard only, axe both themes, RTL).

### 3. Scope
**In (built):**
- **Cloudflare Stream adapter** (`provider/cloudflare.ts`): RS256 playback tokens signed locally
  (no network), the signed manifest URL; the Stream API (live inputs, keys) is a stub until the
  owner's account exists. **Fake Cloudflare Stream** (`fakeVideoProvider({ kind: 'cloudflare' })`,
  name `fake_cloudflare`) with its own ids, ingest, backup ingest and signing key: neither fake CDN
  plays the other's tokens.
- **Provider registry v2** (`provider/registry.ts`): `configureVirtual({ provider, providers })`,
  `videoProviders()`, `videoProvider(name)` (`provider_unavailable` for an unregistered one),
  `verifyPlaybackAny` (heartbeats and the heartbeat route accept a token from whichever registered
  provider signed it), `videoProvidersFromEnv` (both fakes outside production; Mux and/or Cloudflare
  with their keys). Web and API register every provider.
- **Per-session provider choice**: `createStreamCommand` takes an optional `provider`; the setup
  page offers a U1 Select (“Video provider for {session}”) when more than one is registered.
- **Switching provider keeps grants and history** (`switchStreamProviderCommand`, `events:write`,
  audited): the stream is created at the new provider (keyed by session and provider, so switching
  back reuses it) and the same `virtual.streams` row is updated (id, on/off state, viewings, watch
  minutes and every ticket's access stay; ingest back to primary). A player holding the old
  provider's token is told `provider_changed` on its next heartbeat and starts a new viewing at the
  new provider immediately (“The stream moved to another provider. You're still watching.”).
  `watch_minutes.provider` records which provider served each minute; `streamingUsageQuery`
  returns `byProvider` (the D24 meter priced per provider).
- **RTMP overflow** (`setActiveIngestCommand`, `events:write`, audited): the provider's backup
  ingest for the same stream (`streams.backup_ingest_url`, `active_ingest`); the reveal returns the
  active ingest (“Server (backup ingest)”), the key is unchanged and playback is not interrupted.
  `no_backup_ingest` when the provider has none.
- **Create Zoom webinars from Yayatoh** (`integrations`: `zoomWebinarPlanQuery` →
  `POST /users/me/webinars` through the org's Zoom connection with an `Idempotency-Key` per
  session → `recordCreatedZoomWebinarCommand`, which links it with `origin = 'created'` and
  registers the holders with online access). The network call sits between two transactions. The
  fake Zoom API creates webinars (idempotent per key). `zoom_not_connected`, `integrations_off`,
  `zoom_failed`. `zoomConnectedQuery` (`events:read`) tells the page whether to offer it.
- **Zoom join/leave webhooks** (`/api/webhooks/zoom`, `processZoomWebhook`): Zoom's `v0` signature
  (HMAC-SHA256 of `v0:{x-zm-request-timestamp}:{raw body}` with the app's secret token, five-minute
  window) is checked **before the body is parsed** (401 otherwise, rate-limited); the URL check
  (`endpoint.url_validation`) is answered only when signed. The org comes from the webinar id in the
  verified body (`virtual.org_for_zoom_webinar`, SECURITY DEFINER: a created webinar wins; an id
  linked by several orgs resolves to none). Each delivery is **deduplicated by its provider event**
  in `virtual.zoom_participant_events` (unique hashed id built from the event name, `event_ts`, the
  meeting instance, the participant and the join/leave time — Zoom sends no event id); joins and
  leaves of a participant pair into `zoom_attendance` stays keyed like the report pull
  (`segment_key`), so one stay counts once for CE whichever arrives first; a registered ticket's
  first join emits `virtual.attended@1`. `recordZoomParticipantCommand` runs as the webhook's
  system actor only (`platform:virtual.zoom_webhook`).
- **Stream setup page** (`/o/{org}/e/{event}/virtual`): the stream column shows the provider and a
  “Backup ingest” pill; editors get the provider Select with Set up / Switch provider and “Use
  backup ingest” / “Use primary ingest”. The Zoom section (M6.9b's) gains “Create Zoom webinar” per
  session without a webinar and a “Created here” pill. Viewers see it read-only.
- **Data subjects:** `zoom_participant_events` is exported (joins and leaves per session) and
  redacted on erasure (address and ticket removed, times kept as the deduplication record).
- **Migration** `0142_demonic_boomerang.sql` (renumbered at merge): new table
  `virtual.zoom_participant_events` (FORCE RLS, org-leading indexes, composite FKs), new columns
  `streams.backup_ingest_url`, `streams.active_ingest`, `watch_minutes.provider`,
  `zoom_webinars.origin`, `zoom_attendance.segment_key` (+ unique index); hand edits listed in the
  commit report.
- **Dev/CI:** `/api/dev/zoom` gains `action=webhook` (a join/leave body signed with the fake
  secret, delivered by the test to the real endpoint); `/api/dev/virtual` returns each person's
  address. `.env.example`: `CLOUDFLARE_STREAM_*`, `ZOOM_WEBHOOK_SECRET_TOKEN` (names only).

**Later / not yet:**
- Real Stream and Mux Video API calls (stubs until the owner's accounts), real Zoom app review and
  webhook subscription (owner inbox).
- Automatic failover to the backup ingest (health checks from the provider's webhooks) and a second
  provider running in parallel; today the organizer switches by hand.
- Live presence from Zoom joins on the Command Center (the checkpoint event is emitted; no widget
  reads the open stays yet).

### 4. Acceptance
| Criterion | Test |
|---|---|
| Switching provider keeps grants and watch-time history | `packages/testing/tests/virtual-v2.int.test.ts` › keeps the stream, the grant and the watch-time history; old tokens are told to restart; `apps/web/e2e/virtual-v2.spec.ts` › create a Zoom webinar, switch a session's provider while Ana watches (she keeps access)… |
| Join/leave webhooks replayed twice count once | `virtual-v2.int.test.ts` › a join and a leave replayed twice record once, make one segment and check in once; › a leave that arrives before its join…; e2e › …join/leave webhooks count once (delivered twice to `/api/webhooks/zoom`) |
| Webhook signatures are verified before any processing | `virtual-v2.int.test.ts` › verifies the signature before reading anything (forged, missing, tampered, stale, garbage → 401, no rows); › answers Zoom's URL validation only when signed; `packages/modules/virtual/tests/virtual-v2.test.ts` › Zoom webhook signatures; e2e › the Zoom webhook refuses an unsigned or forged request |
| Create Zoom webinars from Yayatoh (once; refused without a connection, for a viewer, without the port) | `virtual-v2.int.test.ts` › creates the session's webinar through the Zoom connection, once; › refuses without a Zoom connection…; e2e (main story, keyboard, RTL) |
| Cloudflare Stream as a second provider; per-session choice | `virtual-v2.test.ts` › the fake Cloudflare Stream, the Cloudflare Stream adapter, the provider registry; `virtual-v2.int.test.ts` › a new stream may start at the chosen provider; › refuses an unregistered provider, a viewer, another org… |
| RTMP overflow: a backup ingest the organizer can switch to | `virtual-v2.int.test.ts` › RTMP overflow: … switches the encoder to the backup ingest and back; playback goes on; › refuses a provider without a backup…; e2e (main story, keyboard, RTL) |
| Webhook org resolution (created wins, ambiguous ignored), tenant isolation | `virtual-v2.int.test.ts` › ignores an unknown webinar and an ambiguous linked one…; `isolation.int.test.ts` (fixture rows for both orgs) |
| Only the webhook records attendance | `virtual-v2.int.test.ts` › the command runs only as the webhook |
| Data subjects | `dsar-coverage.test.ts`, `dsar-canary.int.test.ts` |
| Viewer read-only; no Zoom connection says what to do | e2e › without a Zoom connection the card says what to do; a viewer sees everything read-only |
| Keyboard only | e2e › keyboard only: choose the provider, switch it, backup ingest, create the webinar |
| axe in both themes; Arabic RTL | e2e (every new state) › Arabic (RTL): providers, backup ingest and the Zoom card |
