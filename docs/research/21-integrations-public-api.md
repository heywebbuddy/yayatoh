# Integrations Public Api

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

Public API, mobile API, webhooks and third-party integrations (Yayatoh 2.0 — Event Operating System)

# Yayatoh 2.0 — Public API, Mobile API, Webhooks and Integrations

Grounding: the vision document (section 4 "Keep and Improve Our Mobile Apps", section 13 "Modular and Future-Ready", section 14 "Improve APIs and Integrations") requires a clean, documented, stable API for the existing iOS/Android apps, a migration path off the Laravel contracts, webhooks, and first-class integrations with Stripe, WhatsApp/SMS/email providers, Salesforce, HubSpot, Google Sheets, Zoom and "other marketing and CRM systems". Everything below is scoped to a multi-tenant, white-label platform where every API object belongs to an organization.

What exists today (verified 2026-09-26 from yayatoh.com and the App Store): iOS app "Yayatoh" id6755224885, v1.0.3, iOS 15.1+, 41.8 MB, English only, seller Pani Digital Services LLC; Android package `com.yayatoh.yayatohapp` (Play listing details UNVERIFIED — page truncated). The app's listed features are event discovery, ticket booking, digital tickets, "Join Event Via Code" and attendee chat. Nothing on yayatoh.com mentions an API, webhooks, embeds or integrations, so the public API is greenfield; only the mobile contract is legacy.

---

## 1. API design guidelines

### 1.1 Shape and versioning
- **Style:** REST + JSON, described in **OpenAPI 3.1** (author in the 3.1 subset even though OAS **3.2.1 was published 10 Sep 2026**; 3.2's QUERY method / `additionalOperations` are unnecessary and codegen tools lag). 3.1 gives full JSON Schema 2020-12 and the top-level `webhooks` object, which we use to document outbound events in the same file.
- **Hosts:** `api.yayatoh.com/v1/...` for the platform; white-label tenants get `api.<tenant-domain>` only as a CNAME alias resolved to the same service (tenant resolved from key, never from Host).
- **Versioning:** major version in the URL (`/v1`). Within a major, changes are additive only (new optional fields, new enum values are announced 90 days ahead). Breaking changes → `/v2` with 12-month overlap; retiring endpoints send `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers plus `Link rel="successor-version"`. Runner-up: date-pinned header versioning (Stripe/Klaviyo style: Klaviyo's `revision: YYYY-MM-DD` with a 2-year retirement window). Lost because mobile SDKs, Zapier and white-label partners are far easier to reason about with a path version, and we have no need for per-key pinning yet.
- **Resource model:** org-scoped, e.g. `/v1/events`, `/v1/events/{id}/ticket-types`, `/v1/orders`, `/v1/attendees`, `/v1/guests`, `/v1/seating/maps`, `/v1/checkins`, `/v1/sessions`, `/v1/exhibitors`, `/v1/campaigns`, `/v1/webhooks`. IDs are prefixed KSUIDs/ULIDs (`evt_`, `ord_`, `tkt_`, `att_`) — human-diagnosable, sortable, never sequential (prevents enumeration across tenants).

### 1.2 Authentication and authorization
- **Org API keys** (server-to-server, tenants and their agencies): format `yy_live_<32 random bytes base62>` / `yy_test_…`; stored as SHA-256 hash with a 8-char lookup prefix; each key carries `org_id`, optional `event_ids[]` restriction, scopes (`events:read`, `events:write`, `orders:read`, `attendees:read`, `attendees:write`, `checkin:write`, `seating:write`, `marketing:write`, `webhooks:manage`, `reports:read`), expiry, last-used, and creator. Keys are shown once; rotation creates a new key and gives the old one a grace `expires_at`.
- **OAuth 2.0 client credentials** (RFC 6749 §4.4) for partners/integrators who act on many tenants: a `client_id/secret` issued to the partner; the tenant admin "installs" the partner app, producing a grant with scopes; tokens are JWTs (RS256/EdDSA, 1 h) carrying `org_id` + scopes. **Authorization code + PKCE** for user-context apps (Zapier, mobile, third-party dashboards).
- **Runner-up for key management:** Unkey (AGPL, self-hostable; hosted Free 150K verifications/mo, Pro $25–$1,000/mo). Lost because API keys are core tenant data; Postgres + Redis cache is enough and avoids another vendor in the auth path. Revisit if we open a partner marketplace with per-key analytics needs.

### 1.3 Rate limiting
- Token bucket per key in Redis (Upstash `@upstash/ratelimit` or a small Lua script). Defaults: 600 req/min per key, 60 req/min for search/lookup endpoints, 3,000 req/min for scanner batch endpoints (per device session), 10 req/min on unauthenticated seat-finder lookups per IP.
- Emit the IETF draft headers (draft-ietf-httpapi-ratelimit-headers-11, May 2026): `RateLimit-Policy: "default";q=600;w=60` and `RateLimit: "default";r=412;t=17`, plus `Retry-After` on 429. Also expose per-org daily quota by plan.

### 1.4 Pagination, filtering, expansion
- **Cursor pagination only** on collections: `?limit=50&cursor=<opaque base64url(json({k:[created_at,id]}))>` → `{ "data": [...], "next_cursor": "...", "has_more": true }`. Offset pagination is not offered (unstable under concurrent writes, expensive on large tenants). Reports use async export jobs instead.
- **Filtering:** bracket syntax `?filter[status]=paid&filter[created_at][gte]=2026-01-01T00:00:00Z&filter[ticket_type_id][in]=tt_a,tt_b`; `?sort=-created_at,id`; `?q=` for search endpoints; `?expand=attendee,ticket_type` for embedded relations (max depth 1); `?fields=` sparse fieldsets.
- Every list endpoint documents which fields are filterable/sortable; unknown filters return 400 problem+json rather than being silently ignored.

### 1.5 Idempotency
- Header `Idempotency-Key: <UUIDv4>` on all POST/PATCH that create money or attendance side effects (`/orders`, `/checkins`, `/guests/import`, `/campaigns/send`). Scope is (org, key). Store SHA-256 fingerprint of method+path+body and the first response for 24 h. Same key + same fingerprint → replay stored response with `Idempotent-Replayed: true`; same key + different fingerprint → 422 `idempotency-key-mismatch`; key still in flight → 409. The IETF draft (draft-ietf-httpapi-idempotency-key-header-07, Oct 2025) is **expired**, but the header name and semantics are the de facto standard (Stripe, Adyen, Svix).

### 1.6 Errors
- `application/problem+json` per **RFC 9457** (obsoletes 7807): `type` = `https://docs.yayatoh.com/errors/<code>`, `title`, `status`, `detail`, `instance` = request id URI, plus extensions `code`, `request_id`, and `errors[]` (`{field, code, message}`) for validation. Codes are stable strings (`ticket_sold_out`, `seat_already_assigned`, `duplicate_checkin`, `client_upgrade_required`).

### 1.7 SDK generation and documentation
- **TypeScript SDK:** `@hey-api/openapi-ts` (MIT; fetch/axios/Next.js clients, Zod schemas, TanStack Query plugin) generated in CI from the spec and published as `@yayatoh/sdk`. Used internally by the dashboard too, which keeps the spec honest.
- **Swift / Kotlin (mobile):** `openapi-generator` v7.25.0 (Aug 2026) with `swift6` (stable; `swift5` is deprecated) and `kotlin` generators. Microsoft Kiota lost because it has no Swift/Kotlin target (C#, Go, Java, PHP, Python, Ruby, TypeScript only).
- **Runner-up (later, partner-grade SDKs):** Stainless (Free: ≤25 endpoints, 5 generators; higher tiers UNVERIFIED), Fern (TS, Python, Go, Java, C#, PHP, Ruby, Swift, Rust; pricing UNVERIFIED), Speakeasy (pricing UNVERIFIED). Defer until there are external SDK consumers.
- **Docs portal:** **Scalar** API reference (MIT; `@scalar/nextjs-api-reference` self-hosted at `docs.yayatoh.com/api`, free) — modern UI, built-in "try it", OpenAPI 3.1. Hosted Scalar if we want their registry (Free: 3 APIs; Pro $150/mo adds custom domain). Runner-ups: Redocly (Pro $10/seat/mo, Reunite hosting with custom domain; Redoc CE is MIT), Mintlify (Starter free with custom domain and API playground, Pro $450/mo). Mintlify becomes attractive when we need long-form guides + API reference in one site; Redocly lost on UI and seat-based pricing for a small team.
- **Spec quality gates:** Spectral lint + `oasdiff` breaking-change check in CI; contract tests generated from examples; every endpoint has `x-scopes` and `x-rate-limit` extensions so docs, gateway and SDKs read the same source.

---

## 2. Mobile API specifics

**First action item:** the legacy Laravel↔app contract must be captured (proxy traffic from a debug build, or read the Laravel `routes/api.php`) before any endpoint is designed. The public listing implies the app is attendee-facing (discovery, purchase, digital tickets, join-by-code, chat); whether scanning/check-in lives in the same app or an "organizer" build is UNVERIFIED and changes the auth model (organizer devices need org-scoped roles, not consumer sessions).

### 2.1 Endpoints the apps need
| Need | Design |
|---|---|
| Auth | `POST /v1/auth/token` (password/OTP/social → access JWT 15 min + rotating refresh token 60 days, reuse detection revokes the family); `POST /v1/auth/refresh`; `POST /v1/auth/logout`. Organizer/scanner logins additionally select an org (`X-Yayatoh-Org`). |
| Device registration | `PUT /v1/me/devices/{installation_id}` `{platform, push_token, app_version, os_version, locale, timezone}`; server dedupes by push token; tokens feed FCM/APNs (marketing researcher owns delivery). |
| Event feed | `GET /v1/feed?cursor=&lat=&lng=&category=` returns cards with **pre-sized image variants** (`{thumb, card, hero}` URLs from the image CDN) and `ETag`; clients send `If-None-Match`. |
| Ticket wallet | `GET /v1/me/tickets` returns tickets with `qr_payload` (see below), seat/table, wallet pass links (`apple_pass_url`, `google_save_url`), transfer state. `GET /v1/me/tickets/{id}/pass.pkpass`. |
| QR rendering | `qr_payload` is a compact signed token: `yy1.<base64url(ticket_id, event_id, issued_at, v)>.<ed25519 signature>` (~120 chars → fits QR v6). Rendering is client-side; the payload is stable for the ticket's life, revocation is server-side (and in the offline manifest). |
| Scanner | `POST /v1/checkin/sessions` (device, entrance, event) → session id; `GET /v1/checkin/manifest?event_id=&since=<version>` delta download of `{ticket_id, status, holder, seat, version}` for offline validation (Ed25519 public key ships in the manifest); `POST /v1/checkin/scan` for online scans; `POST /v1/checkin/batch` for **offline sync** with client-generated `scan_id`s (idempotent), server returns per-scan results `accepted | duplicate(first_scan_at, entrance) | invalid | revoked | wrong_event`; `GET /v1/checkin/events/{id}/stream` (SSE) for live counts and device status feeding the Command Center. |
| Seat finder | `GET /v1/events/{id}/seat-finder?q=<name|email|phone|code>` returns only `{display_name, table, seat, section}`; throttled 10/min/IP, requires event's `seat_finder_public` flag; QR seat-finder links are signed per guest. |
| Join by code | `POST /v1/events/join` `{code}` → event membership; chat stays on the existing realtime provider behind `/v1/events/{id}/chat/*` (realtime researcher owns transport). |

### 2.2 Minimum-version handshake
Every request carries `X-Yayatoh-Client: ios/1.0.3 (42)`. The server compares against a `client_versions` table; below `min_supported` → **426 Upgrade Required** with problem type `client-upgrade-required` and `min_version`, `store_url`; between `min_supported` and `min_recommended` → response header `X-Yayatoh-Upgrade: recommended`. `GET /v1/mobile/config` (unauthenticated, cached) returns min versions, feature flags per platform, base URLs and the QR signing public key, so the app can switch hosts without a release.

### 2.3 Compatibility layer for Laravel contracts
Strangler-fig: the Next.js platform exposes a **`/legacy/*` adapter** that reproduces the Laravel JSON shapes (field names, snake_case, pagination envelope, error codes) by mapping to the new domain services; the reverse proxy routes `api.yayatoh.com/api/*` → adapter and everything else to Laravel until each route is migrated. Rules: (1) adapter is generated from a recorded contract test suite (golden JSON from production responses); (2) legacy auth tokens are honored by verifying against a copied `personal_access_tokens` table until forced upgrade; (3) app release N+1 targets `/v1` natively; after ≥90 days and ≥95% adoption, `min_supported` is raised and `/legacy` is removed. Given the app is at v1.0.3 and recently published, the install base is likely small — a short dual-run window is realistic.

---

## 3. Webhook specification

### 3.1 Event catalog (initial `type` values, dot-delimited, past tense)
- **Orders/payments:** `order.created`, `order.paid`, `order.failed`, `order.refunded`, `order.partially_refunded`, `payout.created`
- **Tickets:** `ticket.issued`, `ticket.transferred`, `ticket.claimed`, `ticket.cancelled`, `ticket.distributed`
- **Attendees/registration:** `attendee.registered`, `attendee.updated`, `attendee.cancelled`, `registration.form_submitted`, `session.registered`, `session.unregistered`
- **Guests/RSVP (weddings/galas):** `guest.created`, `guest.imported`, `rsvp.updated`, `seat.assigned`, `seat.unassigned`
- **Check-in:** `ticket.checked_in`, `ticket.checkin_rejected` (with `reason: duplicate|invalid|revoked`), `session.checked_in`, `device.online`, `device.offline`
- **Events/ops:** `event.published`, `event.updated`, `event.cancelled`, `ticket_type.sold_out`, `session.capacity_threshold` (e.g., 95%)
- **Marketing:** `campaign.sent`, `message.delivered`, `message.opened`, `message.clicked`, `survey.completed`
- **Exhibitors:** `lead.captured`, `exhibitor.registered`
- **Meta:** `webhook.test`, `integration.connection_error`

### 3.2 Envelope and signing (Standard Webhooks compatible)
```
POST <endpoint>
webhook-id: msg_2xK...            # unique per message; retries reuse it
webhook-timestamp: 1790000000      # unix seconds
webhook-signature: v1,<base64 HMAC-SHA256(secret, "<id>.<timestamp>.<raw body>")>
content-type: application/json

{ "id": "msg_2xK...", "type": "ticket.checked_in", "timestamp": "2026-09-26T18:04:11Z",
  "api_version": "v1", "org_id": "org_...", "event_id": "evt_...",
  "data": { "ticket": {...}, "checkin": {...} } }
```
Secrets are `whsec_` base64 strings; rotation puts two space-separated signatures in `webhook-signature` for 24 h. Receivers reject if `|now - timestamp| > 300 s` and dedupe on `webhook-id` (replay protection). Payloads carry full objects by default; tenants can choose "thin" payloads (ids only) for PII-sensitive endpoints. Standard Webhooks is adopted by OpenAI, Twilio, Kong, Svix and others, and verification libraries exist for TS, Swift, Kotlin/Java, PHP, Python, Go, Ruby, C#.

### 3.3 Delivery semantics
- Source of truth is a **transactional outbox** table (`outbox_events`) written in the same DB transaction as the domain change; a relay publishes to the webhook service — no lost or phantom events.
- Retries: exponential backoff following Svix's schedule (immediate, 5 s, 5 m, 30 m, 2 h, 5 h, 10 h, 10 h → ~28 h total), jittered; 2xx = success; 410 Gone = auto-disable endpoint; endpoints with sustained failures across 5 days are disabled and the org is emailed/in-app alerted (`integration.connection_error`).
- Dead-letter: exhausted messages are retained for 30 days and can be replayed individually or in bulk ("recover failed since <date>").
- Per-tenant endpoints: unlimited per org, each with its own secret, event-type filter, optional `event_ids[]` filter, description, and rate limit; endpoints must be HTTPS (private-IP/SSRF blocked, DNS re-resolved at send time).
- Ordering is not guaranteed; consumers use `timestamp` + object `version`.

### 3.4 Svix vs build
- **Svix Cloud** (verified 2026-09-26): Free 50K msgs/mo, 7-day retention, 50 msg/s; **Basic from $20/mo** (50K included, $0.0001/msg overage, 30-day retention, 99.9% SLA); Pro from $490/mo (90-day retention, unbranded portal, static IPs, SOC 2); Enterprise custom. The **server is MIT-licensed and self-hostable** (Rust; Postgres + optional Redis) with SDKs in 9 languages. Its data model (Application = tenant, Endpoint, Event Type, Message) maps 1:1 onto our multi-tenant model, and the **embeddable App Portal** gives every tenant an endpoint manager + delivery log + replay UI, white-labelable.
- **Build:** BullMQ + Postgres tables (`webhook_endpoints`, `webhook_deliveries`, `webhook_attempts`) plus our own logs UI. Roughly 3–4 engineer-weeks initially and ongoing (rotation, replay, portal, SSRF hardening, per-endpoint throttling).
- **Recommendation:** Svix Cloud Basic at launch ($20/mo covers far more than early volume; a 20,000-attendee event with ~10 events/ticket emits ~200K messages ≈ $15 overage). Keep an internal `WebhookPublisher` interface so we can move to self-hosted Svix (same API) if volume or data-residency demands it. Hookdeck lost: it is inbound-gateway oriented (Developer $0 / Team from $39 / Growth from $499 per 10K events), not outbound fan-out.
- **Inbound webhooks** (Stripe, Zoom, HubSpot, Salesforce CDC, Twilio) use a single `/v1/inbound/{provider}/{connection_id}` gateway: verify signature, persist raw body, ack 200 in <1 s, process asynchronously with idempotency on the provider's event id.

---

## 4. Integrations catalog

| Integration | Auth / connection | What syncs (direction) | Key API facts (verified unless marked) | Phase |
|---|---|---|---|---|
| **Stripe** | Covered by payments researcher (Connect per tenant) | Payments, refunds, payouts; inbound webhooks | — | 1 |
| **Apple Wallet** | Apple Developer Program, Pass Type ID cert; per-tenant branding via pass template | Ticket → `.pkpass` (eventTicket style, `PKBarcodeFormatQR`), updates via PassKit web service (`/v1/devices/{deviceID}/registrations/{passTypeID}/{serial}`, `/v1/passes/...`, `/v1/log`) + APNs push | PKCS#7-signed manifest; semantic tags for event tickets; NFC optional | 1 |
| **Google Wallet** | Google Wallet Issuer account + GCP service account (RS256 JWT) | `EventTicketClass` per event, `EventTicketObject` per ticket (seat/row/section/gate/barcode); save link `https://pay.google.com/gp/v/save/{jwt}`; pre-create objects via REST so JWTs stay short | Issuer approval required before production; updates/expiry via API; free | 1 |
| **Calendar / ICS** | Tokenized feed URL per attendee/org | RFC 5545 `.ics` per ticket/session and subscribable feed `/v1/me/calendar.ics`; optional Google Calendar `events.insert` via OAuth | Calendar API quota 10,000 req/min/project, 600/min/user; 1M/day threshold | 1 (ICS), 3 (Google) |
| **Embeddable ticket widget** | Public `event_id` + tenant domain allowlist | `<script src="https://embed.yayatoh.com/v1.js" data-event="evt_…">` injects an iframe served from the tenant's white-label domain; `postMessage` events `yayatoh:ready`, `yayatoh:resize`, `yayatoh:order.completed` with origin checks; CSP `frame-ancestors` built from `embed_domains`; Stripe elements need the iframe origin, so checkout stays inside the iframe | — | 1–2 |
| **Zapier** | API key or OAuth (PKCE) | Triggers via **REST Hooks**: subscribe `POST /v1/webhooks` (`source: zapier`), unsubscribe `DELETE`, `performList` → `GET /v1/<resource>?limit=3` with identical schema; actions: create attendee/guest, update RSVP, check in, add tag | Zapier Platform CLI; honor 410 to drop dead subscriptions | 2 |
| **Slack** | OAuth with `incoming-webhook` scope (returns `incoming_webhook.url` + channel) | Outbound alerts: sales milestones, sold-out, device offline, RSVP digests (`text` + Block Kit `blocks`) | No delete/override via webhooks; use `chat.postMessage` if threading needed | 2 |
| **Google Sheets** | Per-user OAuth with `drive.file` (least privilege) — not service account (would require sharing sheets with a robot address) | Append orders/attendees/check-ins rows (`values.append`, `INSERT_ROWS`), batched every 5–10 s | Quota 300 writes/min/project and 60/min/user → batching mandatory; 180 s request timeout; no daily cap | 2 |
| **HubSpot** | Public OAuth app (Marketplace) | Contacts batch upsert (100/batch); **Marketing Events object**: `POST /marketing/v3/marketing-events/events/upsert` keyed by `externalEventId`+`externalAccountId`; attendance `…/{objectId}/attendance/{REGISTERED|ATTENDED|CANCELLED}/email-create` with `joinedAt/leftAt`; scopes `crm.objects.marketing_events.read/write` | Public apps: 110 req/10 s per installed account; daily 250K/625K/1M by tier; externalId-addressed events readable only by the creating app | 2 |
| **Mailchimp** | OAuth2 (data-center-prefixed base URL) | Audience sync: `PUT /lists/{id}/members/{md5(email)}`, tags per event/ticket type, `/batches` for bulk | 10 concurrent connections, 120 s timeout | 2 |
| **Klaviyo** | OAuth (required for partner apps) | Profiles bulk import, lists, custom metrics via `/api/events/` ("Registered", "Attended", "Purchased Ticket") | `revision` header (ISO date), 2-year deprecation window; rate tiers XS 1/s–15/min … M 10/s–150/min … XL 350/s–3,500/min; `Retry-After` on 429 | 2 |
| **Salesforce** | OAuth 2.0 web-server flow via Connected App / External Client App (UNVERIFIED — docs blocked) | Contact/Lead upsert on external ID field `Yayatoh_Person_Id__c`; Campaign per event, `CampaignMember` status Registered/Attended; Composite API for <200 records, **Bulk API 2.0** for imports; inbound via Change Data Capture/Pub-Sub API | UNVERIFIED (403 on developer.salesforce.com): Bulk API 2.0 ~150M records/24 h rolling, 100 MB per job; REST daily calls scale with licenses | 3 |
| **Zoom** | General OAuth Marketplace app (**Server-to-Server OAuth is same-account/internal only**; 1 h tokens, no refresh) | Create meeting/webinar per virtual session; push registrants (`POST /meetings/{id}/registrants`, `/webinars/{id}/registrants`); pull participant reports for session attendance/check-in | Webinar endpoints require a Zoom Webinar license on the tenant account; rate-limit tiers UNVERIFIED (docs 404) | 3 |
| **Make** | API key/OAuth | Instant triggers via **dedicated webhooks** (attach/detach = our subscribe/unsubscribe) with verification directive; modules for the same actions as Zapier | Shared webhooks route by `uid` — not needed | 3 |
| **n8n** | API key | Day 1: tenants point a Yayatoh webhook at n8n's built-in Webhook node; later a community node (`n8n-nodes-yayatoh`) with trigger `webhookMethods` create/checkExists/delete (UNVERIFIED — docs 404) | — | 3 |
| **SSO (SAML/OIDC)** | Per enterprise tenant | Org member login via IdP (Okta, Entra ID, Google Workspace); JIT provisioning to org roles | **WorkOS**: $125/connection/mo (1–15), $100 (16–30), $80 (31–50), $65 (51–100); **Ory Polis** (ex-BoxyHQ Jackson): Apache-2.0, SAML+OIDC exposed as an OAuth 2.0 flow, npm library or standalone Next.js service, BYO DB | 3 |
| **SCIM** | Per enterprise tenant | `/scim/v2/Users`, `/Groups` → org members/roles, deprovisioning | WorkOS Directory Sync same price ladder as SSO; Ory Polis includes SCIM 2.0 | 3 |
| **QuickBooks Online / Xero** | OAuth2 per tenant | Post payout summaries (SalesReceipt/JournalEntry + Deposit; Xero Invoice/BankTransaction), fees as expenses, refunds as credit notes | UNVERIFIED (pages truncated): QBO ~500 req/min/realm, access token 1 h, refresh 100 days; Xero 60/min, 5,000/day, 5 concurrent, uncertified apps limited to 25 tenants | 4 |
| **WhatsApp/SMS/Email providers** | Owned by marketing researcher | — | — | — |

SSO recommendation: start with **Ory Polis self-hosted** behind an `IdentityProviderBridge` interface (per-tenant SSO at $125/mo/connection makes WorkOS hard to price into mid-market plans), and switch to WorkOS for tenants that demand its Admin Portal/SLAs once enterprise revenue justifies it. Both present SSO as OAuth to our app, so swapping is contained.

---

## 5. Integration platform pattern

- **Connections:** `integration_connections {id, org_id, provider, external_account_id, status (connected|error|revoked), scopes, credentials_ciphertext, dek_id, expires_at, last_success_at, last_error, settings_json}`. Credentials are envelope-encrypted: per-org data-encryption key wrapped by KMS (AWS KMS/GCP KMS); plaintext only inside the worker.
- **Field mapping:** `integration_field_mappings {connection_id, object (attendee|order|guest), source_path, target_field, transform (none|lowercase|phone_e164|date|constant), direction}` rendered in a two-column mapping UI seeded from provider metadata (HubSpot properties, Salesforce `describe`, Sheet header row).
- **Sync engine:** domain events from the outbox fan out to per-connection **BullMQ** queues (Redis) with per-connection concurrency (1 for Sheets, 3 for HubSpot) and provider-aware rate limiters; `integration_sync_runs` (kind: backfill|incremental|manual, cursor, counts) and `external_id_map {connection_id, object, internal_id, external_id, external_updated_at, hash}` make every upsert idempotent and enable two-way sync later. Backfills are chunked jobs resumable from cursors.
- **Health:** each connection exposes `health` (token expiring <7 days, consecutive failures, quota near limit, last run age) surfaced as Command Center "Integration" alerts and `integration.connection_error` webhooks; a per-connection log viewer shows request/response summaries (payloads redacted).
- **Build vs platform:** **Nango** (Elastic License 2.0; 1,000+ pre-built API auth configs; managed OAuth + token refresh + authenticated proxy + syncs/actions in TypeScript; Free 10 connections; PAYG $50/mo base incl. $50 credit, then $0.29/connection/mo, $0.72/compute-hour, $0.50/GB; self-host free with limited features). **Merge** (unified API: 3 free linked accounts, then $650/mo up to 10, $65/account; categories CRM/Accounting/Ticketing/HRIS/ATS/File storage) — lost: its unified CRM model does not expose HubSpot Marketing Events or Salesforce CampaignMember, which are the whole point for us. **Paragon** — quote-only, per connected tenant; lost on opaque pricing for a platform selling to small organizers.
- **Recommendation:** use **Nango for OAuth, token refresh, and the authenticated proxy** (the undifferentiated, security-sensitive part), and **own the sync logic and mapping UI** in our workers so provider-specific objects (Marketing Events, CampaignMember, Sheets rows) stay first-class. At $0.29/connection a tenant with HubSpot + Sheets + Slack costs under $1/mo. Keep Nango behind a `ConnectionProvider` interface so a self-hosted Nango or a hand-rolled OAuth module can replace it; Slack, Google and Stripe OAuth are simple enough to also keep native fallbacks.

---

## 6. Phased roadmap

| Phase | Window | Deliverables | Exit criteria |
|---|---|---|---|
| **0 — Foundations** | Months 0–2 | OpenAPI 3.1 spec + Spectral/oasdiff CI; auth (keys, OAuth client credentials, PKCE); problem+json, cursor pagination, idempotency, rate-limit headers; Scalar docs; outbox table; Svix account + `WebhookPublisher`; recorded Laravel contract suite; `/legacy` adapter skeleton; `X-Yayatoh-Client` handshake + `/v1/mobile/config` | Existing apps run end-to-end against the adapter in staging; spec lint clean |
| **1 — Launch parity** | Months 2–5 | Mobile `/v1` (auth/refresh, devices, feed, wallet, QR token, scanner manifest/batch/SSE, seat finder); webhooks GA (orders, tickets, attendees, check-in, RSVP) with tenant portal; Apple/Google Wallet passes; ICS feeds; embed widget v1; inbound webhook gateway (Stripe) | New app build on `/v1`; ≥95% of scans succeed offline→sync; webhook delivery success ≥99% |
| **2 — Ecosystem** | Months 5–8 | Integration framework (Nango, connections, mapping UI, health); Zapier app (public listing), Slack, Google Sheets, HubSpot (contacts + Marketing Events), Mailchimp, Klaviyo; `@yayatoh/sdk` TypeScript; `/legacy` retirement once min version raised | 5 integrations live; Zapier app approved; legacy routes removed |
| **3 — Enterprise** | Months 8–12 | Salesforce (Contacts/Leads/Campaigns, Bulk API 2.0), Zoom (sessions, registrants, attendance), SSO (Ory Polis) + SCIM, Make + n8n nodes, Google Calendar, Swift/Kotlin SDKs, partner OAuth apps with tenant "install" consent | First enterprise tenant on SSO/SCIM; Salesforce backfill of 100K contacts within quota |
| **4 — Scale** | 12+ months | QuickBooks/Xero payouts, integration marketplace, `/v2` planning (only if needed), self-hosted Svix/Nango evaluation on volume, data residency | Partner-built integrations exist without Yayatoh code changes |

---

## 7. Verification notes
Verified 2026-09-26 by fetching primary pages: Svix pricing/retries/quickstart/GitHub, Nango pricing/GitHub, Paragon, Merge, WorkOS, Scalar, Redocly, Mintlify, Unkey, Stainless, Hey API, Kiota, openapi-generator releases, OpenAPI 3.2.1, RFC 9457, Standard Webhooks spec, IETF idempotency-key (expired draft-07) and ratelimit-headers (draft-11), HubSpot Marketing Events + usage limits, Google Sheets/Calendar quotas, Google Wallet JWT flow, Apple Wallet passes, Klaviyo rate limits/versioning, Mailchimp fundamentals, Slack incoming webhooks, Zapier REST hooks, Make webhooks, Zoom S2S OAuth, Ory Polis, yayatoh.com and the iOS App Store listing. **UNVERIFIED:** Salesforce Bulk/REST limits and External Client Apps (403), Zoom rate-limit tiers and registrant endpoint details (404), Xero and QuickBooks throttles (pages empty), Google Play listing details (truncated), Speakeasy and Fern pricing, n8n community-node mechanics (404), whether the Yayatoh app contains scanner functionality.


## Key recommendations

- Author the API as OpenAPI 3.1 (not 3.2.1) with URL major versioning (/v1), additive-only changes inside a major, and Deprecation/Sunset headers for retirements; gate CI with Spectral + oasdiff.
- Use org-scoped hashed API keys with granular scopes (yy_live_/yy_test_ prefixes) for tenants, OAuth 2.0 client credentials for partners, and authorization-code + PKCE for user-context apps (mobile, Zapier).
- Standardize on cursor pagination, bracket-style filtering, Idempotency-Key (24 h, fingerprinted) on side-effecting POSTs, RFC 9457 problem+json errors with stable codes, and IETF RateLimit/RateLimit-Policy headers backed by a Redis token bucket per key.
- Treat the mobile API as a product: capture the Laravel contract first, ship a /legacy adapter (strangler fig) so current apps keep working, add an X-Yayatoh-Client min-version handshake with 426 responses and /v1/mobile/config, then retire legacy routes after >=95% adoption.
- Design check-in for offline: signed Ed25519 QR payloads, a delta manifest download per event/device, and an idempotent batch scan-sync endpoint that returns per-scan duplicate/invalid/revoked results; stream live counts via SSE to the Command Center.
- Adopt the Standard Webhooks envelope (webhook-id / webhook-timestamp / webhook-signature HMAC-SHA256, whsec_ secrets, 5-minute tolerance) driven by a transactional outbox; use Svix Cloud Basic ($20/mo, 50K msgs, MIT self-host fallback) for retries, dead-letter, replay and the embeddable per-tenant portal instead of building.
- Generate the TypeScript SDK with @hey-api/openapi-ts and Swift/Kotlin SDKs with openapi-generator 7.25 (swift6, kotlin); self-host Scalar's MIT API reference for docs; defer Stainless/Fern until external SDK demand exists.
- Ship Apple/Google Wallet passes, ICS feeds and the embeddable ticket widget (iframe + postMessage + CSP frame-ancestors allowlist) in Phase 1 because they need no third-party tenant accounts and directly improve the attendee experience.
- Build the integration framework on Nango for OAuth/token refresh/proxy ($0.29 per connection) but own sync workers, external-id maps and the field-mapping UI so provider-specific objects (HubSpot Marketing Events, Salesforce CampaignMember, Sheets rows) are first-class; reject Merge and Paragon.
- Prioritize integrations by tenant value and API simplicity: Zapier, Slack, Google Sheets, HubSpot, Mailchimp/Klaviyo in Phase 2; Salesforce, Zoom, SSO/SCIM, Make/n8n in Phase 3; QuickBooks/Xero in Phase 4.
- For enterprise SSO/SCIM, self-host Ory Polis (Apache-2.0, SAML/OIDC + SCIM 2.0) behind an interface and reserve WorkOS ($125/connection/mo) for tenants whose contracts justify it.
- Run all inbound provider webhooks (Stripe, Zoom, HubSpot, Salesforce CDC) through one verifying gateway that persists raw events, acks fast and processes asynchronously with provider-event-id idempotency.


## Data model implications

- api_keys: id, org_id, prefix, key_hash, name, scopes[], event_ids[] (optional restriction), expires_at, last_used_at, created_by, revoked_at
- oauth_clients / oauth_grants / oauth_tokens: partner apps (client_id, secret_hash, redirect_uris, allowed_grant_types) and per-org installs with scopes; refresh-token families with reuse detection for mobile
- client_versions: platform, min_supported, min_recommended, store_url, message; mobile_devices: installation_id, user_id, platform, push_token, app_version, locale, timezone, last_seen_at
- checkin_sessions (device, entrance, event, operator) and checkin_scans with client-generated scan_id (idempotency), result enum (accepted|duplicate|invalid|revoked|wrong_event), scanned_at vs synced_at, entrance; ticket.version for manifest deltas; ticket.qr_token signed payload and signing key rotation table
- outbox_events: id, org_id, aggregate_type, aggregate_id, type, payload, created_at, published_at — written in the same transaction as domain changes; source for webhooks and integration syncs
- webhook endpoints are held in Svix (application uid = org_id) but mirrored locally: webhook_endpoints {org_id, svix_endpoint_id, url, event_types[], event_ids[], source (manual|zapier|make), status}; plus inbound_webhook_events {provider, connection_id, provider_event_id (unique), raw_body, received_at, processed_at, status}
- idempotency_keys: org_id, key, fingerprint_sha256, status (in_flight|completed), response_status, response_body, expires_at (24 h)
- integration_connections: org_id, provider, external_account_id, status, scopes, credentials_ciphertext, dek_id, expires_at, last_success_at, last_error, settings_json; integration_field_mappings; integration_sync_runs; external_id_map {connection_id, object, internal_id, external_id, external_updated_at, hash}; integration_logs (redacted)
- wallet_passes: ticket_id, platform (apple|google), serial/object_id, class_id, last_pushed_at; apple_pass_registrations {device_library_id, push_token, pass_type_id, serial}
- sso_connections (org_id, protocol saml|oidc, idp metadata, default_role, jit_enabled) and scim_tokens (org_id, token_hash, last_used_at); org_members must support externally-managed users and groups→roles mapping
- embed_domains: org_id, domain, verified_at — drives CSP frame-ancestors and postMessage origin checks
- person (cross-event attendee/customer record) needs a stable external-facing id used as the external ID field in Salesforce/HubSpot/Klaviyo so upserts are idempotent across events
- sessions (conference) need external refs for Zoom meeting/webinar ids and a per-session attendance source (scan vs zoom_report)


## Risks

- The legacy Laravel-to-mobile contract is undocumented; if the apps use non-JSON quirks (session cookies, HTML fragments, Laravel-specific error shapes), the /legacy adapter cost grows and forced-upgrade may be the only viable path.
- Unknown whether scanner/check-in lives in the consumer app or a separate organizer app; this changes the mobile auth and role model and the offline manifest scope.
- Salesforce, Zoom, Xero and QuickBooks limits and OAuth app requirements could not be verified (bot-blocked or truncated docs); Zoom Marketplace review and Salesforce security review can each add weeks to Phase 3.
- Webhook payloads carry attendee PII to tenant-controlled URLs; without thin-payload options, SSRF protection and endpoint HTTPS enforcement, a misconfigured tenant endpoint becomes a data-leak vector.
- Seat-finder and join-by-code endpoints are enumeration targets (guest names, seat positions); they need per-IP throttling, per-event opt-in flags and signed links.
- Per-connection SSO/SCIM pricing (WorkOS $125/mo each) can exceed what mid-market tenants pay; a self-hosted Ory Polis path must be maintained to keep enterprise features sellable.
- Vendor lock-in on Svix and Nango is mitigated by interfaces and self-host options, but their licenses differ (Svix MIT vs Nango Elastic License 2.0 which restricts offering it as a managed service).
- The Idempotency-Key IETF draft has expired; semantics must be defined and documented by us, and clients that omit the header on retries will create duplicate orders/check-ins.
- HubSpot Marketing Events addressed by externalEventId are visible only to the creating app; if tenants also use another integration, duplicates or invisible events can occur.
- Apple Pass Type ID certificates and Google Wallet issuer approval are operational dependencies with expiry and review timelines; white-label tenants may expect passes branded with their identity, which Apple certificates tie to one team.
- Google Sheets per-user write quota (60/min) makes real-time row appends impossible during on-sale spikes without batching; tenants may perceive lag.
- OpenAPI 3.2.1 is very new; mixing 3.2 features in would break openapi-generator/Hey API pipelines used for mobile SDKs.


## Open questions

- Can you share the current Laravel API routes (routes/api.php) and the mobile app source or a network capture, so the legacy contract can be recorded before design?
- Does the current mobile app include organizer scanning/check-in, or is scanning done in a separate app or the web dashboard? How many active installs do the iOS and Android apps have today?
- Who controls the Apple Developer account (Pani Digital Services LLC) and Google Play/Google Cloud accounts, and should white-label tenants get passes/apps under their own brand or under Yayatoh's certificates?
- Should the public API be launched to tenants at v1 (Phase 1) or kept private for the mobile apps until the ecosystem phase?
- Which integrations do current customers actually ask for first (HubSpot vs Salesforce vs Mailchimp vs Sheets), and how many tenants would need enterprise SSO/SCIM in the first year?
- Do tenants bring their own Stripe accounts (Connect) and their own HubSpot/Salesforce credentials, or will some agencies manage integrations for multiple client organizations (affects connection ownership model)?
- Is a Zapier public listing and Zoom Marketplace listing acceptable from a branding standpoint (they list Yayatoh, not the white-label tenant brand)?
- What is the tolerance for third-party vendors in the data path (Svix, Nango) versus self-hosting, and are there data-residency requirements for any target customers?
- What is the acceptable forced-upgrade window for existing mobile users (30, 60, 90 days) once the new API is live?
- Should webhooks default to full-object payloads or thin (id-only) payloads for PII-sensitive events like attendee.registered?


## Sources

- https://www.svix.com/pricing/
- https://docs.svix.com/retries
- https://docs.svix.com/quickstart
- https://github.com/svix/svix-webhooks
- https://raw.githubusercontent.com/standard-webhooks/standard-webhooks/main/spec/standard-webhooks.md
- https://www.standardwebhooks.com/
- https://nango.dev/pricing
- https://github.com/NangoHQ/nango
- https://www.useparagon.com/pricing
- https://www.merge.dev/pricing
- https://workos.com/pricing
- https://github.com/ory/polis
- https://www.ory.com/docs/polis
- https://scalar.com/pricing
- https://github.com/scalar/scalar
- https://redocly.com/pricing
- https://mintlify.com/pricing
- https://www.unkey.com/pricing
- https://github.com/unkeyed/unkey
- https://www.stainless.com/pricing
- https://buildwithfern.com/learn/sdks/overview/introduction
- https://github.com/hey-api/openapi-ts
- https://learn.microsoft.com/en-us/openapi/kiota/overview
- https://openapi-generator.tech/docs/generators
- https://github.com/OpenAPITools/openapi-generator/releases/latest
- https://spec.openapis.org/oas/latest.html
- https://www.rfc-editor.org/rfc/rfc9457.html
- https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
- https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
- https://developers.hubspot.com/docs/api/marketing/marketing-events
- https://developers.hubspot.com/docs/api/usage-details
- https://developers.google.com/workspace/sheets/api/limits
- https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/append
- https://developers.google.com/workspace/calendar/api/guides/quota
- https://developers.google.com/wallet/tickets/events
- https://developers.google.com/wallet/tickets/events/use-cases/jwt
- https://developer.apple.com/documentation/walletpasses
- https://developers.klaviyo.com/en/reference/api_overview
- https://developers.klaviyo.com/en/docs/rate_limits_and_error_handling
- https://developers.klaviyo.com/en/docs/api_versioning_and_deprecation_policy
- https://mailchimp.com/developer/marketing/api/list-members/
- https://mailchimp.com/developer/marketing/docs/fundamentals/
- https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks
- https://docs.zapier.com/platform/build/hook-trigger
- https://developers.make.com/custom-apps-documentation/app-components/webhooks.md
- https://developers.zoom.us/docs/internal-apps/s2s-oauth/
- https://developers.zoom.us/docs/api/using-zoom-apis/
- https://hookdeck.com/pricing
- https://yayatoh.com
- https://apps.apple.com/us/app/yayatoh/id6755224885
- https://play.google.com/store/apps/details?id=com.yayatoh.yayatohapp
- /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx
