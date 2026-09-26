# Offline Checkin Realtime

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

Offline-capable check-in and real-time event operations (Yayatoh 2.0)

# Offline-capable check-in and real-time event operations — research and recommended design

Grounded in the vision document (sections 7 "Event Command Center", 9 "Improve Check-In and Onsite Operations", 5 session check-in, 6 seat finder / kiosk mode, 4 mobile apps). Date of research: 2026-09-26.

Important baseline fact found during research: the current Yayatoh iOS app (App Store id 6755224885, v1.0.3, seller Pani Digital Services LLC, iOS 15.1+, 41.8 MB) is an **attendee** app (discover, book, in-app tickets, "Join Event Via Code", attendee chat). Its listing mentions no scanning, check-in, or organizer tooling. So "the existing native apps" are not today's scanner client; the organizer check-in client is a new build decision, not a migration constraint. (Play listing could not be fetched; assumed to mirror iOS — UNVERIFIED.)

## 1. QR ticket payload

### 1.1 Capacity constraints (drive every choice below)
QR byte-mode capacity (ISO 18004 table, via thonky.com): V5-M 84 B, V6-M 106 B, V7-M 122 B, V8-M 152 B, V10-M 213 B. Alphanumeric mode (0-9, A-Z, space $%*+-./:) holds more characters: V6-M 154, V7-M 178, V8-M 221. Uppercase base32 and base45 (RFC 9285, used by EU DCC) fit alphanumeric mode, so they encode denser than base64 in byte mode. Keep phone-displayed tickets at or below V8 (49x49 modules) with ECC M: larger versions shrink modules on a 6-inch screen and slow decode in dim/glare conditions; ECC H only helps printed codes with damage or a logo overlay, and costs ~30% capacity.

### 1.2 Recommended token: compact binary, Ed25519-signed, base32 in alphanumeric mode
Payload (binary, then base32-uppercase):
`ver(1) | kid(1) | org_id(4) | event_id(8) | ticket_id(16, UUID) | issued_at(4, unix) | ticket_rev(1) | sig(64, Ed25519)` = 99 B → 159 base32 chars → **QR V7-M** (178 alnum) or V6-Q. Compare HMAC-SHA256 truncated to 128 bits: 51 B → 82 chars → V4-M. Both comfortably scannable.

Why Ed25519 over HMAC: offline scanners verify with a **public** key shipped in the manifest; a stolen or rooted scanner cannot mint tickets. HMAC would require distributing the secret to every offline device or trusting the manifest alone. Ed25519 verify is native WebCrypto in Safari 17+, Chrome/Edge 137+ (May 2025), Firefox 130+; ship `@noble/ed25519` as fallback for older Android WebViews. Why not JWT/PASETO: JWT's base64url JSON header+claims pushes a signed token to ~250-350 chars (V12+); PASETO v4.public is cleaner (no `alg` confusion, 64-byte Ed25519 sig) but still carries a JSON payload and `v4.public.` prefix; neither adds value when the verifier is your own code. Keep `ticket_rev` so re-issuing a ticket (transfer, seat change) invalidates the old QR without changing the ticket id. Keys: one Ed25519 keypair per organization (`kid` allows rotation); private keys in KMS/`vault`; the per-org public key is part of the tenant's manifest header.

Fallback human code: 8-char Crockford base32 short code printed under the QR for manual entry.

### 1.3 Static vs rotating (dynamic) QR
What the incumbents do:
- **Ticketmaster SafeTix**: PDF417, payload `base64(48-byte bearer token)::TOTP(customer key)::TOTP(event key)::unix_ts`, both TOTPs SHA-1/6 digits/15 s step, secrets fetched from an API (refresh "20 hours prior to event" and whenever the ticket is viewed). The "moving" barcode is CSS; validation is server-side. Reverse-engineering (conduition.io, 2024) showed the secrets are extractable, so it is **anti-screenshot, not anti-clone**.
- **AXS Mobile ID**: one rotating QR for all tickets in the account, changes every 59 s; cannot be placed in Apple Wallet in dynamic form.
- **Google Wallet** has a first-class `RotatingBarcode` object: `totpDetails { algorithm: TOTP_SHA1, periodMillis, parameters: [{ key: hex, valueLength }] }` and `valuePattern` like `"...-{totp_timestamp_seconds}-{totp_value_0}"`. **Apple Wallet has no rotating-barcode support** (NeatPass, Sept 2026); rotating tickets must stay in the issuer's live view.

Recommendation: **static signed QR as the default** (works in email/PDF, Apple Wallet, print-at-home, and offline), plus an optional per-ticket-type **"Secure Ticket" mode** for high-fraud events: the ticket page/app renders `signed_payload | totp(event_key, 30 s) | ts`, scanners verify the TOTP with the per-event key delivered inside the encrypted manifest (so it still works offline, accept +/-1 step), Google Wallet passes use `RotatingBarcode`, Apple Wallet passes for that ticket type carry a static fallback that is only accepted when the org enables "Wallet fallback". Combine with the controls that actually stop cloning: first-scan-wins with immediate cross-device propagation, delayed delivery (QR revealed N hours before doors), transfers only through the platform (new `ticket_rev`), ID match prompts for VIP/named tickets, and duplicate-attempt alerts on the dashboard.

## 2. Offline mode

### 2.1 Manifest
Per-event (optionally per-entrance/zone scoped) manifest, versioned by a monotonically increasing `change_seq`:
- Header: `event_id`, `manifest_seq`, `server_time`, org Ed25519 public key(s), TOTP event key (Secure Ticket mode only), checkpoint definitions and rules, ticket type table, session table.
- Rows: `ticket_id, short_code, holder_name, ticket_type_id, seat/table label, status (valid|checked_in|void|refunded|transferred), checked_in_at, checked_in_checkpoint, entitlements (session bitmap), flags (vip|minor|note), phone_last4, email_hash?`.
Size: ~200-300 B/row as JSON → 20k tickets ≈ 4-6 MB raw, ~1-1.5 MB gzipped over the wire, ~10-20 MB in IndexedDB with indexes. That is trivial against iOS quotas (Safari 17+: up to 60% of disk per origin; Home Screen web apps get the same quota as the browser; WebKit blog 14403). Download in pages of 2,000 rows to stay under Vercel's 4.5 MB response limit and to survive flaky Wi-Fi with resumable page cursors.

Delta sync: `GET /v1/events/{id}/manifest?since={seq}` returns only rows with `change_seq > since` (a `ticket_changes(event_id, seq, ticket_id, op)` outbox table populated by the same transaction that changes a ticket). Devices poll every 15-30 s while online and also subscribe to a realtime "manifest changed" nudge.

Encryption at rest: in the native app, SQLite (expo-sqlite / op-sqlite with SQLCipher) keyed from Keychain/Keystore. In the PWA, the key has to live in IndexedDB too, so encryption there is mostly obfuscation; compensate by minimising PII (name + phone_last4, no full email), by expiring the manifest 24 h after event end, and by "remote wipe" commands over the device channel. Use `navigator.storage.persist()` (granted for Home Screen web apps) and require installation to Home Screen to avoid Safari's 7-day script-storage eviction for uninstalled sites.

### 2.2 Local validation and duplicate detection
Scan → decode → parse → verify signature (and TOTP if present) → lookup `tickets[ticket_id]` → apply checkpoint rules (ticket type allowed, time window, session entitlement, re-entry policy) → check local `checkin_state` → write append-only `scan_events` row with a client-generated **UUIDv7 `scan_id`** (the idempotency key) and `device_ts` → update local state → enqueue. Result classes: `admitted`, `duplicate` (show time + checkpoint + device of first scan), `invalid_signature`, `unknown_ticket` (valid signature but not in manifest, e.g. sold after last sync → admit with `provisional=true` if org policy allows, else hold), `void/refunded`, `wrong_checkpoint`, `outside_window`, `capacity_soft_limit`.

### 2.3 Sync-back and conflict resolution
Batch POST `/v1/scans:batch` (up to 500 events, `Idempotency-Key: <batch uuid>`), each event carrying `scan_id, ticket_id, checkpoint_id, device_id, result, device_ts, device_clock_offset_ms` (offset measured against `server_time` at last manifest sync, giving Hybrid-Logical-Clock-style ordering). Server: `INSERT ... ON CONFLICT (scan_id) DO NOTHING`, then for each `admitted` event runs `INSERT INTO checkin_state ... ON CONFLICT (ticket_id, checkpoint_id) DO UPDATE WHERE excluded.effective_ts < checkin_state.effective_ts`, where `effective_ts = device_ts + offset`. Outcome: **first-wins by corrected device timestamp**; the loser's event is re-labelled `duplicate_offline`, both devices receive the reconciled state via delta sync, the dashboard's "duplicate scan attempts" counter increments, and an `ops_alert` is raised if duplicates for one ticket exceed a threshold. Nothing is ever deleted; reversals are new `checkin_reverted` events. iOS has no Background Sync API (still true in 2026), so the PWA flushes on `online`, `visibilitychange`, a 10 s timer, and app load, guarded by the Web Locks API to prevent two tabs flushing the same queue; the native app uses expo-background-task for true background flush.

## 3. Client platform

Verified status (2026): iOS Safari still lacks `BarcodeDetector` (feature flag on iOS 17 that "does not work on iOS 18"; iOS 26 UNVERIFIED — assume absent). `getUserMedia` works in Safari and Home Screen web apps (historic WebKit bug 185448 is fixed; intermittent stream-loss reports persist). Android Chrome's `BarcodeDetector` depends on Google Play Services. Practical PWA stack: `getUserMedia` + `barcode-detector` (Sec-ant, ZXing-C++ WebAssembly, 30+ formats) with the `.wasm` **self-hosted and precached** via `prepareZXingModule({ overrides: { locateFile } })` — the default jsDelivr path breaks offline and CSP.

Native option: Expo SDK 57 `expo-camera` `CameraView onBarcodeScanned` (Vision on iOS, ML Kit on Android; note SDK 55 had a regression where `barcodeScannerEnabled` did not include ZXingObjC on iOS) or `react-native-vision-camera` v5 with the ML Kit code-scanner plugin for 30 fps, torch, autofocus and frame-processor control. Margelo/Scanbot comparisons favour Vision Camera for scanner-centric apps.

Recommendation: **both, staged, sharing one TypeScript core**.
1. Phase 1: `scan.<white-label-domain>` **PWA** ("Yayatoh Scan"): installable, works on any phone/tablet, on Zebra/Honeywell Android rugged devices via Chrome + DataWedge keystroke output, and as the kiosk UI. It reuses the Next.js monorepo (`packages/checkin-core`: token parsing, Ed25519/TOTP verify, manifest store adapter, sync queue, rule engine; adapters for IndexedDB and SQLite).
2. Phase 2: **native "Yayatoh Organizer" app (Expo + Vision Camera)** for high-throughput gates (faster continuous decode, hardware torch, Keychain-protected keys, background sync, App Store presence), consuming the same `/v1` API. The existing attendee app stays consumer-facing and gets the Secure Ticket live view.
Runner-up "native only" lost because it blocks white-label customers (they cannot ship their own App Store app) and rugged Android devices that run kiosk-locked Chrome.

## 4. Hardware scanners and kiosks

- **Bluetooth HID scanners** (keyboard emulation) work with the PWA unchanged: focus a hidden `<input>`, configure prefix/suffix + Enter, parse on Enter. Socket Mobile SocketScan S740 (~$383, 2D imager reads phone screens, 15 h battery) is the de-facto iPad choice; Honeywell Voyager 1602g for budget. HID mode is slower than Socket's App Mode (CaptureSDK, native only) and hides the iOS on-screen keyboard while paired — document the workaround. 
- **Rugged Android computers**: Zebra TC22/TC27 (street ~$1,000-1,600 UNVERIFIED single retail quote $1,623) with DataWedge (keystroke output to Chrome for the PWA, Intent output for the native app; see Zebra's TC22 DataWedge docs), Honeywell CT30 XP (~$1,550) with the Data Collection Intent API (`ACTION_CLAIM_SCANNER`). Ticketing vendors such as Spektrix and Tixly publish TC22/27 setup guides (details UNVERIFIED, pages blocked). Enable only QR/PDF417/Code128 symbologies and "picklist"/screen-reading illumination.
- **Kiosk / self check-in**: iPad in Guided Access or MDM Single App Mode; Android in Lock Task Mode via Android Management API. Badge printing: Brother QL-820NWB (AirPrint on the same Wi-Fi from iPad, Bluetooth, Ethernet — used by Envoy, HID Visitor Manager) or Zebra ZD421 (Zebra Browser Print: USB/network on desktop, Bluetooth on Android; requires classic BT). v1: kiosk PWA prints via `window.print()` + `@page` label size over AirPrint; v2: printer-agent sidecar for ZPL.

## 5. Real-time transport

Constraints verified on primary sources (Vercel docs updated Aug 2026):
- Vercel Functions **WebSockets are Public Beta** (changelog 2026-06-22), require Fluid compute, connection pinned to one instance and **closed at max duration** (Hobby 300 s; Pro/Enterprise 800 s, 1,800 s beta); no shared memory across instances (use Redis); Next.js needs `experimental_upgradeWebSocket` from `@vercel/functions`. SSE has the same duration ceiling. Vercel's own realtime guide points to Ably, Pusher, Supabase Realtime, PubNub, Liveblocks for fan-out.
- **Postgres LISTEN/NOTIFY**: 8,000-byte payload limit; a global lock at commit serializes notifying transactions (~2.9k/s ceiling; Recall.ai outages Mar 2025); unavailable through PgBouncer transaction pooling, Neon's pooled URL, and Neon's serverless driver; PG19 (beta) only reduces wakeups. Use only inside a single relay process on a direct connection, never as the fan-out layer.
- **Redis pub/sub**: fire-and-forget, no replay; good as the bus between API and relay (Upstash $0.20/100k commands, free 500k; Redis Streams if you need replay).
- Managed: **Ably** Free 200 connections/6M msgs; Standard $29/mo + usage (10k connections), $2.50/M messages, $1/M connection-minutes, presence + rewind + token auth with per-channel capabilities. **Pusher Channels** Sandbox 100 connections/200k msgs/day; Startup $49 (500 conns, 1M/day); Pro $99 (2k). **Supabase Realtime** Free 200 conns/100 msg/s; Pro 500 conns/500 msg/s then $10 per 1,000 peak connections; `realtime.broadcast_changes()` from DB triggers on private channels with RLS.
- Self-hosted Socket.IO + `@socket.io/redis-adapter`: Fly.io shared-cpu-1x 256 MB $1.94/mo; Railway Hobby $5 / Pro $20 + $20 per vCPU-month, WebSockets "can stay open indefinitely". Ops cost: you build presence, auth, resume, and multi-region yourself.

Recommended topology: Postgres remains the source of truth; API route handlers write scans; a transactional outbox row → Redis Stream → a small **fan-out worker** (can be a Vercel cron/queue consumer or a $2-5 Fly machine) publishes to **Ably** channels: `org:{orgId}:event:{eventId}:ops` (counters, alerts), `event:{eventId}:scans` (cross-device dedupe hints, first-scan broadcast), `device:{deviceId}` (commands: resync, wipe, lock). Dashboards get 1-hour Ably tokens whose capabilities are scoped to their org's channels (tenant isolation by construction). Counters are aggregated in SQL every 2-3 s (or Redis `INCR` snapshots) rather than per-scan pushes. Cost sanity check for a 20k-ticket day with 30 scanners and 10 dashboards for 6 h: ~14k connection-minutes and <1M messages → cents on top of the $29 base. Keep an **SSE fallback** route in Next.js (800 s, auto-reconnect via `Last-Event-ID`) for networks that block WebSockets. Runner-ups: Supabase Realtime (wins only if Supabase is the chosen Postgres — it removes the worker) and self-hosted Socket.IO (wins only if Ably usage exceeds ~$300/mo). Abstract behind a `RealtimePublisher` interface so the provider is swappable.

## 6. Entrances, device registry, health

Model: `entrances` (physical doors, belong to venue+event) and `checkpoints` (logical: `entrance | session | table | zone`, with rules). A device is **enrolled** by scanning a short-lived enrollment QR (or entering a 6-digit code) from the event's Devices page: server issues a `device_id` + refresh token (PWA: IndexedDB; native: SecureStore) bound to org, event, default checkpoint, and role (scanner/kiosk/supervisor). Heartbeat every 30 s (`POST /v1/devices/{id}/heartbeat`: battery, app version, `manifest_seq`, `pending_scans`, `clock_offset_ms`, camera OK, network type) plus Ably presence for instant online/offline. Server marks `offline` after 2 missed heartbeats; alert rules (evaluated by a 30-s scheduler during event windows) produce `ops_alerts` such as "3 check-in devices offline", "Gate B pending sync > 100 scans", "device clock skew > 60 s", "manifest lag > 5 min", "duplicate attempts > 10 in 5 min". Supervisors can reassign a device's checkpoint, force resync, or wipe it remotely.

## 7. Lookup check-in (name/phone/email)

Online: Postgres `pg_trgm` GIN index on a normalized `attendees.search_text` (unaccented lower name + email + E.164 phone digits + order code), `similarity > 0.3`, boosted by prefix match; phone normalized with `libphonenumber-js`; results scoped to event + org (RLS). Dedicated engines (Meilisearch/Typesense) are unnecessary below ~10M rows. Offline: the manifest is indexed on device with MiniSearch (fuzzy + prefix) over name/short_code/phone_last4 — 20k rows index in well under a second. Manual check-in requires selecting the exact ticket, records `source=lookup` and the query string in the audit row, and shows a "possible duplicate person" warning when two tickets share a name.

## 8. Check-in history and audit

`scan_events` is append-only and partitioned by event: every attempt of every result type, with `actor_user_id, device_id, checkpoint_id, source (qr|hid|lookup|kiosk|api|manual_override), offline (bool), device_ts, server_ts, sync_batch_id, raw_payload_hash, decision_reason`. Reversals, overrides and "undo" are new events referencing the original `scan_id`. Timeline per ticket, per device, per checkpoint; CSV export; tenant-defined retention (default 24 months). Fraud detection feeds off this table (same QR scanned at two entrances within N minutes, one device scanning > X/min, invalid signature bursts).

## 9. Session and seat/table check-in

Sessions: each session is a `checkpoint(type=session)` with `capacity`, `window`, `allowed_ticket_types`, and per-ticket `entitlements` (bitmap in the manifest for offline). Session scan results add `not_registered_for_session`, `session_full` (soft: warn and allow override; capacity offline is device-local count + last synced count, so it is approximate — the dashboard alert "session at 95%" comes from the server truth). Galas: door scan shows table/seat and "Find My Seat" deep link; hosts can additionally "seat" guests at `checkpoint(type=table)` to track table occupancy, which powers "37 attendees do not have seats" and "table 12 has 2 no-shows" alerts. Kiosk mode: attendee scans or types name → seat shown, optional badge print, no check-in by default (configurable).

## 10. Sequences (condensed)

A. **Issue**: order paid → `tickets` row → sign payload (Ed25519, org key) → store `qr_payload`, `short_code` → outbox `ticket_changes(seq)` → email/wallet render.
B. **Enroll device**: supervisor opens Devices → enrollment QR (5 min TTL) → device posts code → receives `device_id`, tokens, default checkpoint → downloads full manifest (paged) → records `server_time` offset.
C. **Online scan**: decode → local verify + local state → immediate UI (< 100 ms) → POST scan (idempotent) → server verdict may upgrade result (e.g. duplicate detected by another device seconds earlier) → Ably broadcasts first-scan to `event:{id}:scans` → other devices mark ticket used locally.
D. **Offline scan**: same local path → queue → on reconnect flush batches → server first-wins merge → device pulls delta (`since=seq`) → UI reconciles; dashboard gets duplicate counters.
E. **Dashboard**: subscribe to `org:{o}:event:{e}:ops` with scoped token → receive counters (checked-in %, per-entrance rate/min, duplicates, invalids, devices online, session occupancy) every 2-3 s and alerts on change; SSE fallback.
F. **Lookup**: type name/phone → pg_trgm results (or local MiniSearch offline) → select ticket → check-in with `source=lookup`.

## 11. Data model (core tables)

`organizations(id, ed25519_pub, kid…)` · `signing_keys(org_id, kid, pub, priv_ref, active)` · `events(id, org_id, tz, doors_open, ends_at)` · `venues/entrances(id, event_id, name)` · `checkpoints(id, event_id, type, entrance_id?, session_id?, table_id?, capacity, window_start, window_end, reentry_policy, allowed_ticket_type_ids[])` · `tickets(id, org_id, event_id, ticket_type_id, attendee_id, status, rev, short_code, seat_id?, qr_payload, totp_key?, entitlements bitmask)` · `ticket_changes(event_id, seq bigserial, ticket_id, op)` · `devices(id, org_id, event_id, name, role, platform, app_version, default_checkpoint_id, last_seen_at, battery, manifest_seq, pending_scans, clock_offset_ms, status)` · `device_tokens(device_id, refresh_hash, expires_at)` · `scan_events(scan_id uuidv7 PK, event_id, ticket_id?, checkpoint_id, device_id, actor_user_id?, source, result, reason, offline, device_ts, server_ts, sync_batch_id, payload_hash)` partitioned by event · `checkin_state(ticket_id, checkpoint_id, status, first_scan_id, effective_ts, device_id, PK(ticket_id, checkpoint_id))` · `sync_batches(id, device_id, received_at, count, idempotency_key)` · `ops_alerts(id, org_id, event_id, rule, severity, payload, opened_at, resolved_at)` · `alert_rules(org_id, event_id?, type, threshold, window)`. All tables carry `org_id` for RLS-based tenant isolation.


## Key recommendations

- Use a static, compact, Ed25519-signed binary QR payload (ver|kid|org|event|ticket UUID|issued_at|rev|64-byte sig ≈ 99 B → base32 → QR V7-M); per-org keys with kid rotation; 8-char short code under the QR. Runner-up: HMAC-SHA256/128-bit tag (smaller) lost because offline devices would need the secret.
- Offer an optional per-ticket-type 'Secure Ticket' rotating mode (30 s TOTP with a per-event key, verifiable offline from the manifest, Google Wallet RotatingBarcode, Apple Wallet static fallback) rather than making rotation the default; pair it with first-scan-wins, delayed QR reveal, platform-only transfers and duplicate alerts, which stop cloning better than rotation does.
- Offline mode: per-event manifest with monotonic change_seq, paged download (<4.5 MB pages), delta sync every 15-30 s plus realtime nudge, append-only local scan log with UUIDv7 scan_id as idempotency key, batch upload with ON CONFLICT DO NOTHING, and first-wins-by-corrected-device-timestamp reconciliation that relabels losers as duplicate_offline.
- Client platform: ship a PWA scanner first (getUserMedia + self-hosted zxing-wasm barcode-detector polyfill, IndexedDB, Web Locks, installed to Home Screen with navigator.storage.persist), then a native Expo + react-native-vision-camera Organizer app for high-throughput gates; both share a TypeScript checkin-core package. The existing attendee app stays consumer-facing and gains the Secure Ticket live view.
- Support Bluetooth HID scanners (Socket Mobile S740, Honeywell Voyager 1602g) via keyboard-wedge input in the PWA, Zebra TC22/TC27 and Honeywell CT30 XP via DataWedge/Data Collection intents, and kiosks on iPad Guided Access/Single App Mode or Android Lock Task Mode with Brother QL-820NWB (AirPrint) badge printing in v1.
- Real-time: Postgres is source of truth; transactional outbox → Redis Stream → fan-out worker → Ably channels scoped per org/event/device with capability-scoped tokens; aggregate counters every 2-3 s; SSE fallback route. Do not host long-lived sockets on Vercel Functions (WS is beta, 800 s max, no shared state) and never use Postgres LISTEN/NOTIFY as the fan-out layer.
- Model entrances and logical checkpoints (entrance | session | table | zone) with rules, so the same scan engine handles door entry, conference session check-in and gala table seating; store check-in state per (ticket, checkpoint).
- Device registry with enrollment QR, 30 s heartbeats plus Ably presence, and a rules engine that raises ops_alerts ('3 devices offline', pending sync backlog, clock skew, manifest lag, duplicate bursts) with remote resync/wipe commands.
- Lookup check-in with pg_trgm (GIN, similarity > 0.3) over normalized name/email/E.164 phone/order code online and MiniSearch over the manifest offline; log the query string and source=lookup in the audit row.
- Append-only, event-partitioned scan_events audit for every attempt and reversal; expose per-ticket/device/checkpoint timelines and feed fraud detection from it.
- Minimise PII in device manifests (name + phone last-4), expire manifests 24 h after the event, and use SQLCipher + Keychain in the native app; treat PWA encryption as obfuscation only.


## Data model implications

- organizations.signing_keys (kid, Ed25519 public/private refs) and tickets.rev — token format needs key rotation and re-issuance without changing ticket id
- tickets.qr_payload, tickets.short_code, tickets.totp_key (nullable, Secure Ticket mode), tickets.entitlements (session bitmap)
- ticket_changes outbox (event_id, seq bigserial, ticket_id, op) to drive delta manifests and realtime nudges
- checkpoints (type entrance|session|table|zone, capacity, time window, reentry_policy, allowed ticket types) linked to entrances, sessions, tables
- checkin_state keyed by (ticket_id, checkpoint_id) with effective_ts, first_scan_id, device_id — check-in is per checkpoint, not a boolean on the ticket
- scan_events append-only, partitioned by event, scan_id UUIDv7 primary key as idempotency key, with device_ts/server_ts/offline/source/result/reason
- devices, device_tokens, sync_batches — device identity, enrollment, heartbeat state (battery, manifest_seq, pending_scans, clock_offset_ms)
- ops_alerts and alert_rules per org/event for the Command Center
- attendees.search_text normalized column with pg_trgm GIN index; phone stored in E.164
- org_id on every table for RLS tenant isolation; realtime channel names derived from org/event ids


## Risks

- iOS Safari still has no BarcodeDetector and Home Screen web app camera streams occasionally drop; the PWA must bundle and precache the zxing-wasm binary and handle stream restarts. iOS 26 behaviour UNVERIFIED.
- Vercel WebSocket support is Public Beta with 800 s max duration and instance pinning; building the ops feed on it directly would produce reconnect storms during peak entry.
- Postgres LISTEN/NOTIFY misuse (global commit lock, 8 KB payload, unavailable via poolers) could cause outages under scan load if a developer uses it for fan-out.
- Offline manifests contain attendee PII on unmanaged devices; loss/theft exposes names unless minimised, expired and remotely wipeable.
- Device clock skew corrupts first-wins conflict resolution unless offsets are measured at sync time and skew alerts are raised.
- Rotating (TOTP) tickets add complexity, cannot live in Apple Wallet, and, as SafeTix reverse-engineering showed, only prevent screenshots, not secret extraction; over-promising 'unforgeable' tickets is a reputational risk.
- Session capacity enforcement offline is approximate; oversubscription is possible when several devices are offline simultaneously.
- Vendor lock-in and cost growth with Ably/Pusher if channel design fans out per-scan messages to many subscribers; mitigate with aggregated counters and a provider-agnostic publisher interface.
- HID keyboard-wedge scanners inject keystrokes into whatever field has focus; the PWA needs a robust capture input and prefix/suffix parsing.
- Unknown current Laravel QR format and existing mobile-app stack may force a dual-verification period (legacy QR + new token) during migration.


## Open questions

- What is the exact QR payload format the Laravel platform issues today (plain id? URL? signed?), and must already-issued tickets remain scannable in the new system (dual-verification window)?
- How do organizers scan today — via the web app, the consumer mobile app, or a separate tool — and what devices do current customers use (iPhones, Android phones, rugged scanners)?
- What technology are the existing iOS/Android apps built with (React Native/Expo, Flutter, native), and does the team intend to add organizer scanning to that app or ship a separate Organizer app?
- Which hosting and database targets are decided (Vercel? Supabase vs Neon vs RDS)? This determines whether Supabase Realtime or Ably is the better fan-out choice and whether LISTEN/NOTIFY is even available.
- Is a rotating 'Secure Ticket' mode a launch requirement for any customer segment, or can it be a later module?
- What PII is acceptable on offline devices (names only? phone last-4? full email?) and what retention period for check-in audit logs do customers or regulators require?
- Should sold-after-sync tickets (valid signature but not in the manifest) be admitted provisionally when a device is offline, or held for supervisor review?
- Do customers need badge printing at launch, and if so which printers do they already own (Brother QL vs Zebra ZD)?
- What is the expected peak scan rate and largest event size in the next 24 months (drives realtime plan sizing and manifest paging)?


## Sources

- https://vercel.com/docs/functions/websockets (last_updated 2026-08-10)
- https://vercel.com/docs/functions/limitations (last_updated 2026-08-24)
- https://vercel.com/changelog/websocket-support-is-now-in-public-beta (2026-06-22)
- https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel (updated 2026-09-10)
- https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections
- https://conduition.io/coding/ticketmaster/ (SafeTix reverse engineering)
- https://developer.ticketmaster.com/products-and-docs/apis/partner/safetix/
- https://www.axs.com/faq (AXS Mobile ID rotating barcode)
- https://developers.google.com/wallet/retail/offers/resources/rotating-barcodes
- https://neatpass.app/learn/event-ticket-rotating-qr-apple-wallet (updated 2026-09-14)
- https://www.thonky.com/qr-code-tutorial/character-capacities
- https://webkit.org/blog/14403/updates-to-storage-policy/
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- https://whatpwacando.today/barcode/
- https://developer.chrome.com/docs/capabilities/shape-detection
- https://github.com/Sec-ant/barcode-detector (README)
- https://www.npmjs.com/package/zxing-wasm
- https://caniuse.com/background-sync
- https://blogs.igalia.com/jfernandez/2025/08/25/ed25519-support-lands-in-chrome-what-it-means-for-developers-and-the-web/
- https://docs.expo.dev/versions/latest/sdk/camera/ (SDK 57)
- https://github.com/expo/expo/issues/44491
- https://margelo.com/blog/react-native-barcode-scanner
- https://scanbot.io/blog/react-native-vision-camera-vs-expo-camera/
- https://ably.com/docs/platform/pricing
- https://ably.com/docs/platform/pricing/free
- https://pusher.com/channels/pricing/
- https://supabase.com/docs/guides/realtime/limits
- https://supabase.com/docs/guides/realtime/pricing
- https://supabase.com/docs/guides/realtime/subscribing-to-database-changes
- https://supabase.com/docs/guides/realtime/authorization
- https://www.recall.ai/blog/postgres-listen-notify-does-not-scale
- https://www.dbos.dev/blog/postgres-listen-notify-scalability
- https://www.postgresql.org/docs/current/sql-notify.html
- https://neon.com/docs/connect/choose-connection
- https://github.com/neondatabase/serverless
- https://upstash.com/pricing/redis
- https://fly.io/pricing
- https://railway.com/pricing
- https://docs.railway.com/guides/socketio
- https://socket.io/docs/v4/redis-adapter/
- https://www.socketmobile.com/knowledge-center/technology-guides/hid-vs-app-mode
- https://www.socketmobile.com/products/s740
- https://www.barcodesinc.com/compare/best-bluetooth-barcode-scanners-2026
- https://docs.zebra.com/us/en/mobile-computers/handheld/tc2-series/tc22-tc27-prg/c-applications/c-datawedge.html
- https://techdocs.zebra.com/datawedge/latest/guide/output/intent/
- https://sps-support.honeywell.com/s/article/How-to-use-the-Barcode-Data-Intent
- https://www.zebra.com/us/en/support-downloads/software/printer-software/browser-print.html
- https://www.brother-usa.com/p/thermal-printers-labelers/QL820NWB
- https://envoy.help/en/articles/3449543-printer-setup-brother-ql-820nwb
- https://support.eventfarm.com/hc/en-us/articles/16765615951261-Using-Kiosk-Mode-iPad-only
- https://www.eventbrite.com/features/check-in-app/
- https://danlevy.net/postgres-text-search-guide/
- https://www.runxbuild.com/blog/postgresql-pg-trgm-extension/
- https://apps.apple.com/us/app/yayatoh/id6755224885
- https://yayatoh.com/pages/about
- /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx
