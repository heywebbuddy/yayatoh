# Virtual Hybrid Events

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

virtual-hybrid-events

# Virtual & Hybrid Events for Yayatoh 2.0 (gap-fill research)

Date: 2026-09-26. Grounded in the vision document (sections 5 "Enterprise Event Management", 7 "Event Command Center", 13 "Modular", 14 "Integrations: Zoom"). Yayatoh today has only an `is_online` flag; the vision calls for RainFocus-style conferences with sessions, session check-in, session capacity and analytics. Any conference module that has sessions will immediately be asked "can this session be streamed?", so virtual/hybrid must be a first-class delivery mode of the Sessions module rather than a bolt-on.

## 1. How the market handles it (2026)

| Vendor | Model | What matters for Yayatoh |
|---|---|---|
| **Cvent Attendee Hub** | Unified web + app; live/simulive streaming, on-demand library, polls/Q&A; remote attendees get the same agenda/exhibitor surfaces as onsite ones. Capacity and CE mechanics are not on the public page (UNVERIFIED: Cvent tracks per-session watch minutes and issues credits against a minimum-duration threshold; quote-based pricing). | Pattern to copy: one agenda, two audiences; virtual replay library is part of the event, not a separate product. |
| **RainFocus** | Positions "Virtual" and "Hybrid" as platform modes with "nearly limitless integrations"; streaming provider is pluggable rather than native. Enterprise quote-only pricing. | Confirms the provider-agnostic `stream_source` abstraction below. |
| **Bizzabo** | Lists Webinars / Hybrid / Virtual formats and "Event Live Streaming"; pricing and mechanics are behind sales. UNVERIFIED beyond that. | Not a differentiator to chase. |
| **RingCentral Events (ex-Hopin)** | Pricing pages returned 404 in every variant tried; treat as quote-only. UNVERIFIED. Historically: stages (broadcast), sessions (interactive rooms), expo, onsite check-in, attendee join/leave analytics. | The "stage vs. session" split (broadcast vs. interactive) is the right UX distinction. |
| **Zoom Webinars / Webinars Plus / Events** | Verified from zoom.us/pricing/events: Webinars $89/mo monthly or $66.67/mo annual; Webinars Plus $99 / $82.50; Events $149 / $124.17. All listed prices are the 500-attendee capacity; "all subscriptions are priced based on attendee capacity" and capacity tiers go to 100,000, but the larger-tier prices are not exposed on the page. Events adds multi-track/multi-day, ticket types, sponsor expo, networking and hybrid check-in/badge printing. All tiers include cloud recording, live transcription, CRM integrations. | Zoom is the interactive-room engine organizers already own; Zoom Events overlaps Yayatoh's own event layer and should not be integrated. |
| **Vimeo** | Advanced plan $65/mo (webinar page) vs $75/mo (livestreaming page), annual billing; includes webinars, registration landing pages, reminder emails, simulive, multi-destination streaming, engagement analytics, HubSpot/Marketo/Bizzabo sync. Enterprise: custom, breakout rooms, backup streams, SSO. Attendee caps not published. UNVERIFIED cap. | Competes with Yayatoh's own registration layer; only useful as an RTMP source. |
| **Mux** (verified pricing page) | Live input 1080p Plus $0.03125/min; storage $0.003/min/month; delivery $0.001/min after 100,000 free min/month; $20/mo usage credit on pay-as-you-go; Launch $20/mo ($100 credit), Scale $500/mo ($1,000 credit). Signed URLs, domain restrictions, Mux Player, Mux Data QoE analytics and auto-captions included. Latency modes: standard 25–30 s, reduced 12–20 s, low ~5 s (LL-HLS). RTMP(S)/SRT ingest, auto-record to on-demand asset, 12 h max session, webhooks (`video.live_stream.active/idle`, `video.asset.live_stream_completed`). 2048-bit RSA signing keys; JWT claims `sub` (playback ID), `aud`, `exp`, `kid`; tokens generated server-side; expiry ends playback even mid-stream. Mux Data supports `viewer_user_id`, `video_id`, `sub_property_id`, `custom_1..10` for per-viewer breakdowns. | Best developer ergonomics; first-tier prices are a ceiling with published volume discounts. |
| **Cloudflare Stream** (verified docs) | $5 per 1,000 min stored, $1 per 1,000 min delivered; ingest/encoding free; RTMPS + SRT ingest; LL-HLS in beta via `preferLowLatency`; WebRTC WHIP/WHEP gives <500 ms but cannot be recorded and cannot mix with HLS; recordings ready ~60 s after stream ends; simulcast to up to 50 destinations; `requireSignedURLs` + local JWT signing (RSA JWK), `exp` capped at 24 h, `nbf`, `accessRules` (IP/country, max 5). Analytics via GraphQL (per-video, geography), per-viewer watch time not exposed. | Cheapest ingest, simplest billing, but no 100k free minutes and per-viewer analytics are absent, so Yayatoh must do its own heartbeat tracking regardless. |

**Zoom API facts.** Verified: the `add registrant` family is LIGHT-labelled and returns a per-registrant `join_url`; list registrants is MEDIUM with `next_page_token`; the "create meeting" API is capped at 100 requests/user/day (raisable to 10,000 on request); limits are per-account and shared across apps. UNVERIFIED (docs are JS-rendered and returned 404 to fetches; from memory of the 2025 table): Light ~30 req/s, Medium ~20–40 req/s, Heavy ~10–20 req/s with a 30,000–60,000/day cap by plan; `GET /report/webinars/{id}/participants` and `GET /past_webinars/{id}/participants` are HEAVY, `page_size` max 300, and return `join_time`, `leave_time`, `duration`, `email`, `registrant_id`. Webhooks `webinar.participant_joined/left`, `webinar.registration_created`, `webinar.started/ended` exist (UNVERIFIED payload details). Important non-API constraint: a Zoom Marketplace app that other organizations (Yayatoh tenants) install must go through Zoom's app review and be published; an unpublished app only works on the developer's own account. Budget 4–8 weeks for that review.

## 2. Recommended approach for Yayatoh 2.0

### 2.1 Two virtual delivery patterns, not one

- **Broadcast sessions** (keynotes, galas streamed to remote family, worship services, concerts): one-to-many, no audience audio. Deliver via **embedded HLS in Yayatoh's own branded page** using a provider-agnostic stream source. Yayatoh owns the viewer, the paywall, the chat/Q&A overlay and the analytics.
- **Interactive sessions** (workshops, breakouts, trainings with two-way audio, CE seminars requiring participation): deliver via **redirect to a Zoom Meeting/Webinar** with a per-registrant `join_url`. Yayatoh owns registration and entitlement; Zoom owns the room.

Do not build a WebRTC meeting product. Do not integrate Zoom Events (it duplicates Yayatoh's ticketing, hubs and expo). Hybrid = an in-person session that also has a broadcast or interactive virtual room.

### 2.2 Data model additions (Sessions module)

- `sessions.delivery_mode` enum `in_person | virtual | hybrid`.
- `sessions.capacity_in_person` (nullable) and `sessions.capacity_virtual` (nullable = unlimited). Two independent counters; a virtual registration never decrements a physical seat.
- `ticket_types.access_mode` enum `in_person | virtual | hybrid` (hybrid = both). Prices differ; a virtual ticket type is excluded from seating, badges and physical checkpoints.
- `virtual_rooms` (tenant-scoped): `id, session_id, kind (broadcast|interactive), provider (mux|cloudflare|zoom|external_url), status (scheduled|live|ended|replay_ready), opens_at, closes_at, replay_available_until, replay_policy (none|ticket_holders|public)`.
- `stream_sources`: `id, virtual_room_id, provider, external_id (Mux live_stream_id / CF live_input_id / Zoom webinar_id), ingest_url, stream_key_secret_ref (KMS/Vault), playback_id, latency_mode (standard|reduced|low), recording_asset_id, join_url_template`.
- `playback_grants`: `id, ticket_id, virtual_room_id, attendee_id, token_jti, issued_at, expires_at, ip, user_agent, revoked_at`. One row per issued token; used for audit, concurrency limits (default 2 concurrent streams per ticket) and revocation on refund/chargeback.
- `virtual_attendance` (append-only): `id, virtual_room_id, ticket_id, attendee_id, source (player_heartbeat|zoom_report|zoom_webhook), joined_at, left_at, watch_seconds, device, quality_summary`. Rolled up into `session_attendance` (`attendee_id, session_id, first_join, last_leave, total_watch_seconds, in_person_scanned bool, virtual_joined bool, attended_pct`).
- `checkpoints.type` gains `virtual`; the first heartbeat (or first Zoom join) inserts a `check_ins` row with `checkpoint_type='virtual'`, so duplicate-scan logic, session attendance %, and Command Center tiles need no special casing.
- CE credits: `sessions.ce_credit_value`, `sessions.ce_min_attendance_pct` (default 80%), `ce_awards (attendee_id, session_id, credits, basis json, certificate_pdf_url, issued_at)`; the basis JSON stores the segments used so awards are auditable.
- `org_integrations.zoom` (OAuth tokens, refresh, account_id, webhook secret) and `org_integrations.streaming` (provider, environment, signing key id).

### 2.3 Signed access tied to entitlements

Flow: attendee opens the session page → `POST /v1/rooms/{id}/grant` → server verifies ticket is paid, not refunded, `access_mode` allows virtual, session window open (opens_at − 15 min to replay_available_until) → issues a Mux/Cloudflare JWT signed locally with the tenant's RSA key (no per-token API call, so no rate-limit exposure) with `exp = min(session.closes_at + 2h, now + 24h)` → records `playback_grants` → returns `{playback_url, token, heartbeat_token}`. Refund or chargeback sets `revoked_at`; live tokens cannot be recalled provider-side, so the player also stops when heartbeats are rejected. Yayatoh never exposes raw `playback_id` or stream keys; stream keys live in the secrets store and are shown once to the organizer's OBS/vMix operator.

### 2.4 Embedded HLS player vs. Zoom redirect

Embed **Mux Player (`@mux/mux-player-react`)** for broadcast rooms: LL-HLS support, DVR mode, signed `playback-token`, automatic Mux Data with `viewer_user_id = attendee_id`, `video_id = session_id`, `sub_property_id = org_id`, `custom_1 = ticket_type`. Use latency mode *reduced* by default (low needs a controlled encoder/network); switch to *low* only when the organizer runs a hard-wired encoder. iOS/Android apps use AVPlayer/ExoPlayer against the same signed URL through the `/v1` API, so the mobile apps get virtual sessions without web views. Overlay Yayatoh's own chat/Q&A/polls (Engage module) beside the player. For interactive rooms: show a "Join on Zoom" button that reveals the registrant-specific `join_url` only after the entitlement check; never list `join_url` in emails for paid sessions (it is a bearer credential).

Attendance tracking: the player posts a heartbeat every 30 s (`room_id, jti, position, playing`) to a Redis-backed collector; segments are closed after 90 s of silence; watch time is server-computed, not client-reported. Mux Data is used for QoE (rebuffering, start-up failures) and is not the audit source for CE.

### 2.5 Zoom integration scope by phase

- **Phase A (ships with Conference/Sessions MVP):** org-level OAuth connect; link a session to an existing Zoom Meeting/Webinar by ID (registration must be enabled with automatic approval); on order paid, enqueue `add registrant` (LIGHT) with retry/backoff and idempotency on `ticket_id`; store `join_url`; on refund call cancel/deny status. After `webinar.ended` webhook (fallback: poll 15 min after `closes_at`), pull the participants report (HEAVY; paginate at 300; count ~ceil(attendees/300) calls per session against the daily HEAVY cap) and write `virtual_attendance` rows with `source=zoom_report`. Submit the Marketplace app for review at the start of this phase.
- **Phase B:** create/update Zoom webinars from Yayatoh (respect the 100/user/day create cap by batching agenda publishes); subscribe to `participant_joined/left` for live Command Center counts; support Zoom's "custom live streaming service" RTMP-out so a Zoom room can be re-broadcast into Mux/Cloudflare for ticket-gated overflow viewing.
- **Defer:** Zoom Events, Zoom breakout/networking APIs, Salesforce/HubSpot syncing of Zoom data (covered by the CRM module), native WebRTC rooms, DRM.

### 2.6 Provider order and costs

Integrate **Mux first**, **Cloudflare Stream second** (behind the same `StreamProvider` interface), Zoom in parallel as the interactive path. Mux wins on player, signed-token ergonomics, latency modes and per-viewer analytics metadata; Cloudflare wins on ingest cost and simplicity but lacks per-viewer analytics and LL-HLS is still beta.

Cost model: one-day hybrid conference, two stages × 8 h = 960 live minutes; each virtual attendee watches 5 h live + 1 h replay (360 min); first-tier list prices.

| Scenario | Mux | Cloudflare Stream | Zoom Webinars (org's own licence) |
|---|---|---|---|
| 500 virtual attendees (180k min delivered) | live input $30 + delivery (180k − 100k free) $80 + storage ~$3 ≈ **$113/event**, minus the $20 monthly credit | delivery $180 + storage $5 ≈ **$185/event** | 500-capacity plan $89/mo or ~$800/yr (verified) |
| 5,000 virtual attendees (1.8M min) | $30 + $1,700 + $3 ≈ **$1,733/event ceiling** (volume discounts apply; committed pricing above ~$3k/mo) | $1,800 + $5 ≈ **$1,805/event** | 5,000-capacity webinar plan: UNVERIFIED, historically ~$2,490/mo list; Zoom Events 5,000: UNVERIFIED |

Implication for pricing: charge streaming as metered usage (delivered minutes × markup) or include an allowance per plan; never bundle it flat. Zoom licences remain the tenant's own cost; Yayatoh only needs one developer account plus a published Marketplace app.

### 2.7 Command Center integration

Virtual joins are check-ins at a `virtual` checkpoint, so existing tiles (checked-in, attendance %, session capacity, duplicates) work unchanged. Add: live viewers now (heartbeat count), stream health (from `video.live_stream.*` webhooks and rebuffer rate), virtual join rate vs. registrations, replay views. Alerts: "Stage 1 stream went idle during a scheduled session", "Virtual capacity 95% reached", "Zoom registrant sync failed for N tickets", "Zoom report not yet available 30 min after session end".

### 2.8 What to defer

Native video rooms, virtual expo booths with video, simulive scheduling, multi-language audio tracks, DRM, Zoom Events, and per-second engagement scoring. All fit the `virtual_rooms.kind`/`provider` abstraction later without schema churn.


## Key recommendations

- Make virtual/hybrid a delivery mode of Sessions (session.delivery_mode in_person|virtual|hybrid) with separate in-person and virtual capacity counters; a virtual registration must never consume a physical seat.
- Support two room kinds: broadcast (embedded HLS in Yayatoh's branded page) and interactive (redirect to a per-registrant Zoom join_url). Do not build WebRTC rooms and do not integrate Zoom Events.
- Integrate Mux first behind a StreamProvider interface (live input $0.03125/min, delivery $0.001/min after 100k free, signed JWTs, LL-HLS, Mux Data viewer_user_id); add Cloudflare Stream ($1/1k min delivered, $5/1k min stored, free ingest) as the second provider.
- Issue provider JWTs locally with per-tenant RSA signing keys only after an entitlement check (paid, unrefunded ticket with virtual access_mode, inside the session window); record every grant in playback_grants for audit, concurrency limits (default 2) and revocation.
- Compute watch time server-side from 30-second player heartbeats, not from client or Mux Data; use it for CE credit awards (session.ce_min_attendance_pct, auditable basis JSON) and treat Mux Data as QoE only.
- Model the first virtual join as a check-in at a checkpoint of type 'virtual' so Command Center attendance, session capacity and duplicate logic work unchanged; add stream-health, live-viewer and Zoom-sync-failure alerts.
- Zoom Phase A: org OAuth, link existing meeting/webinar, add registrant on paid order (LIGHT, idempotent, queued), pull participants report after webinar.ended (HEAVY, paginate 300). Phase B: create webinars from Yayatoh, participant_joined/left webhooks, Zoom RTMP-out into Mux for gated overflow. Start Zoom Marketplace app review immediately; unpublished apps only work on the developer's own account.
- Price streaming as metered usage or a per-plan minute allowance: 500 attendees costs roughly $113 (Mux) to $185 (Cloudflare) per event day; 5,000 attendees roughly $1.7k to $1.8k at list before volume discounts.
- Expose playback grants and virtual rooms in the mobile /v1 API so iOS/Android use native AVPlayer/ExoPlayer against the same signed HLS URLs.
- Defer native video rooms, virtual expo video, simulive scheduling, DRM, multi-language audio and Zoom Events; the virtual_rooms.kind/provider abstraction absorbs them later.


## Data model implications

- sessions.delivery_mode enum (in_person|virtual|hybrid); sessions.capacity_in_person and sessions.capacity_virtual (nullable = unlimited), tracked as independent counters
- ticket_types.access_mode enum (in_person|virtual|hybrid) controlling seating, badges, physical checkpoints and virtual room eligibility
- virtual_rooms (tenant-scoped): session_id, kind (broadcast|interactive), provider (mux|cloudflare|zoom|external_url), status, opens_at, closes_at, replay_available_until, replay_policy
- stream_sources: virtual_room_id, provider, external_id, ingest_url, stream_key_secret_ref (secrets store), playback_id, latency_mode, recording_asset_id, join_url_template
- playback_grants: ticket_id, virtual_room_id, attendee_id, token_jti, issued_at, expires_at, ip, user_agent, revoked_at (audit, concurrency cap, refund revocation)
- virtual_attendance (append-only segments): virtual_room_id, ticket_id, attendee_id, source (player_heartbeat|zoom_report|zoom_webhook), joined_at, left_at, watch_seconds, device; rolled up into session_attendance with in_person_scanned, virtual_joined, total_watch_seconds, attended_pct
- checkpoints.type gains 'virtual'; check_ins rows created on first virtual join with checkpoint_type='virtual' so Command Center metrics are unified
- CE credits: sessions.ce_credit_value, sessions.ce_min_attendance_pct; ce_awards (attendee_id, session_id, credits, basis json, certificate_pdf_url, issued_at)
- org_integrations.zoom (OAuth tokens, account_id, webhook secret) and org_integrations.streaming (provider, signing key id); zoom_registrant_links (ticket_id, zoom_object_id, registrant_id, join_url, sync_status)
- Per-tenant RSA signing keys for Mux/Cloudflare JWTs stored in KMS; stream keys never persisted in plaintext


## Risks

- Zoom Marketplace app review is required before any tenant other than the developer's own account can connect Zoom; review can take weeks and may demand security documentation.
- Zoom HEAVY report endpoints have a shared per-account daily cap (UNVERIFIED exact numbers); many large sessions ending simultaneously could exhaust it, delaying attendance data.
- Live signed tokens cannot be revoked provider-side; refund or chargeback enforcement depends on Yayatoh's heartbeat rejection, and shared join_urls/tokens remain a fraud vector.
- Streaming cost scales linearly with delivered minutes (roughly $1 per 1,000 minutes); a flat-price plan could lose money on a single large virtual event.
- Client-reported watch time is not audit-grade for CE credits; if accrediting bodies require stronger proof (attention checks), additional engagement prompts must be built.
- Low-latency HLS requires a controlled encoder and network; organizers streaming from consumer connections will experience instability, generating support load.
- Cloudflare Stream LL-HLS is still beta and its analytics lack per-viewer data, so it cannot be the only provider if CE tracking matters.
- Vendor pricing for RingCentral Events, Cvent, RainFocus, Bizzabo and Zoom capacity tiers above 500 could not be verified from public pages.


## Open questions

- Which customer segments actually need virtual sessions first: associations/CE seminars (interactive Zoom), churches and galas (broadcast to remote viewers), or corporate conferences (both)?
- Should Yayatoh resell streaming minutes with a markup, include an allowance per plan tier, or require tenants to bring their own Mux/Cloudflare account?
- Do target customers hold their own Zoom Webinar licences today, and at what capacity tiers?
- Is CE credit issuance (certificates, accreditation body formats) a launch requirement for the conference module or a later add-on?
- Should replays be included in ticket price by default, sold as an add-on ticket type, or left to organizer configuration?
- Does the existing Laravel 'online event' flag carry any data (external links, Zoom URLs) that must be migrated into virtual_rooms?
- Is the Yayatoh mobile app expected to play streams natively in Phase A, or is web-only acceptable initially?


## Sources

- Vision document: /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx
- https://www.mux.com/pricing
- https://www.mux.com/pricing/video
- https://www.mux.com/docs/guides/reduce-live-stream-latency
- https://www.mux.com/docs/guides/secure-video-playback
- https://www.mux.com/docs/guides/start-live-streaming
- https://www.mux.com/docs/guides/make-your-data-actionable-with-metadata
- https://www.mux.com/docs/guides/mux-player-web
- https://developers.cloudflare.com/stream/pricing/
- https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
- https://developers.cloudflare.com/stream/stream-live/
- https://developers.cloudflare.com/stream/stream-live/start-stream-live/
- https://developers.cloudflare.com/stream/stream-live/watch-live-stream/
- https://developers.cloudflare.com/stream/webrtc-beta/
- https://developers.cloudflare.com/stream/stream-live/simulcasting/
- https://developers.cloudflare.com/stream/getting-analytics/
- https://developers.cloudflare.com/stream/faq/
- https://zoom.us/pricing/events
- https://www.zoom.com/en/products/webinars/
- https://www.zoom.com/en/products/event-platform/
- https://developers.zoom.us/docs/api/meetings/ (rate-limit labels for registrant endpoints)
- https://developers.zoom.us/docs/api/using-zoom-apis/
- https://devforum.zoom.us/t/api-rate-limits/ (100 create-meeting requests/user/day, per-account limits)
- https://vimeo.com/features/livestreaming
- https://vimeo.com/features/webinar
- https://www.cvent.com/en/event-marketing-management/attendee-hub
- https://www.rainfocus.com/platform/
- https://www.bizzabo.com/pricing
- https://www.ringcentral.com/events.html
- UNVERIFIED (fetch failed): Zoom REST rate-limit table, Zoom report/webinar participants endpoint spec, Zoom capacity-tier pricing above 500, RingCentral Events pricing, Cvent CE credit help articles
