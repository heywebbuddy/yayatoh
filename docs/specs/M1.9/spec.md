# M1.9 — Check-in and onsite v1

Roadmap: M1.9 (Scan PWA). ADR 0011 (QR format and offline check-in). This milestone is delivered in increments.

## M1.9a — online check-in engine and door screen (done)
- **`checkin` module (tier 4):**
  - `admissions`: one live admission per ticket per event day (partial unique index); undo marks it undone and never deletes it.
  - `scans`: an append-only log of every attempt. `client_scan_id` makes retries idempotent.
- **Codes:**
  - yy1 codes are verified with the org's Ed25519 public keys, and the ticket's current `rev` must match (a reissued ticket's old codes fail).
  - Ticket short codes are accepted in any case.
  - Anything else is `invalid`. Another org's codes fail signature verification.
- **Rules**, in order:
  - The ticket is known → `invalid` otherwise.
  - It belongs to this event → `wrong_event` otherwise; nothing about the other event's ticket is returned.
  - It isn't void → `void` otherwise.
  - Now is inside the event window (6 h before start to 6 h after end) → `outside_window` otherwise.
  - Today, in the event timezone, is one of the pass's access dates, if it has any → `not_today` otherwise.
  - Then it's `admitted`, or `duplicate` with the first admission time.
- **Permissions:** `checkin:scan` (owner, admin, manager, box office, scanner); viewers can't scan. Event-scoped `door_staff` assignments apply once device enrollment lands (M1.9b).
- **Door screen** (`/o/{org}/e/{event}/onsite`):
  - The code field stays focused for USB/Bluetooth scanners and typed short codes.
  - A large result panel is announced politely.
  - Shows today's progress (checked in of issued) and recent scans with undo.
  - Strings are in 13 locales.
- **Migration 0017:** the `checkin` schema; hand-written FKs down to `ticketing.tickets` and `events.events`.

### Acceptance (M1.9a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | A signed code is admitted once per event day; the second scan is a duplicate with the first time; a new day admits again | `packages/testing/tests/checkin.int.test.ts` |
| AC2 | Short codes work in any case; tampered, foreign-org and unknown codes are invalid | `checkin.int.test.ts` |
| AC3 | Another event of the same org is refused without describing the ticket | `checkin.int.test.ts` |
| AC4 | The event window and access dates are enforced in the event timezone | `checkin.int.test.ts` |
| AC5 | A retried scan (same client id) returns its first outcome; undo reopens the ticket; status counts live admissions | `checkin.int.test.ts` |
| AC6 | Scanners can scan, viewers can't, another org can't scan into these events; the fixture covers both tables | `checkin.int.test.ts`, `isolation.int.test.ts` |
| AC7 | End to end: door staff admit a guest's ticket by typed code, see the duplicate, undo, and reject a bad code | `e2e/checkin.spec.ts` |

## M1.9b1 — offline engine, devices, manifest and sync (done)
- **`@yayatoh/checkin-engine` (universal):**
  - The shared rules (event window, access dates, void, wrong event) moved here from the `checkin` module, so server and devices decide the same way.
  - `offlineVerdict` implements the ADR 0011 table: admit, duplicate on this device, superseded (lower `rev`), unknown ticket → provisional only if **issued after the last sync** (the UUIDv7 ticket id carries its issue time; otherwise invalid), and bad signature → invalid.
  - `lookupHash`: per-event salted SHA-256 of the normalized email.
- **Devices (`checkin.devices`):**
  - Enrolled from the door screen; the `yyd_…` token is shown once and stored only as SHA-256.
  - `checkin.device_by_token` (SECURITY DEFINER) resolves the token to (org, device), so the org always comes from the token. Revoked devices and suspended orgs resolve to nothing.
  - Heartbeats record battery, queue depth and clock offset, and deliver a pending wipe. Device commands use the `checkin:device` permission, which no user role has.
- **Manifest:**
  - Paged by an `(updated_at, id)` cursor compared at millisecond precision (Postgres keeps microseconds).
  - `overlap=true` on a sync's first page re-sends the last minute, so a change committed out of timestamp order isn't missed.
  - Rows carry id, short code, rev, status, pass, access dates, holder name and the email hash, never the email. The header carries public keys, the event window, the salt and the unknown-ticket policy.
  - Deviation from roadmap §5.4: a timestamp cursor instead of a `ticket_changes` seq feed (M1.8 adds the feed with transfers).
- **Sync (`POST /v1/scans/batch`):**
  - Up to 500 scans, idempotent by `scanId`, processed in corrected-time order (`device_ts + clock_offset`).
  - Server truth decides each scan. Admissions are first-wins by corrected time: an earlier scan arriving later takes over and flips the previous winner to `duplicate_offline`.
  - Every offline duplicate emits `checkin.duplicate_offline@1` in the sync transaction (the alert source).
- **`/v1` endpoints** (bearer device token): `GET /events/{id}/manifest`, `POST /scans/batch`, `POST /devices/heartbeat`. OpenAPI is updated (additive).
- **Door screen:** a scanner devices section (add, key shown once, last seen/battery/queue, wipe, revoke). Strings are in 13 locales.
- **Fixes found on the way:**
  - Event creation is idempotent per form (a request key), so a double submit no longer shows "name already taken".
  - The PDF adapter retries once on a timeout or 5xx, and the PDF route answers 503 with `Retry-After` instead of 500.
- **Migrations:**
  - 0018: devices; widened scan results via add NOT VALID → validate → drop old; device FKs.
  - 0019: the manifest paging index. It's a plain `CREATE INDEX`, fine before launch; after launch, indexes on existing tables must be built `CONCURRENTLY`.

### Acceptance (M1.9b1)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Every row of the ADR 0011 offline verdict table, plus the shared rules and short codes | `packages/checkin-engine/tests/offline.test.ts` |
| AC2 | Drill (scaled): 3 offline devices with skewed clocks, 33 scans including same-device repeats, 4 cross-device duplicates and 2 bad codes → one live admission per ticket at the earliest corrected time, all 4 flagged `duplicate_offline` with alert events, and re-sync is idempotent | `packages/testing/tests/devices.int.test.ts` |
| AC3 | Tokens are stored hashed; revoked tokens stop resolving; wipe is delivered by heartbeat; users can't call device commands | `devices.int.test.ts` |
| AC4 | The manifest pages completely and holds no emails; another org's device gets 404 | `devices.int.test.ts`, `apps/api/tests/scanner.int.test.ts` |
| AC5 | `/v1` needs a device token (problem+json 401, whatever org header is sent); batch sync is idempotent over HTTP | `apps/api/tests/scanner.int.test.ts` |
| AC6 | End to end: add a device (key shown once) and revoke it from the door screen | `e2e/checkin.spec.ts` |

## Remaining M1.9 increments
- **M1.9b2:** the Scan PWA: service worker, IndexedDB manifest and queue (obfuscated at rest; 24 h expiry), camera (BarcodeDetector / zxing-wasm), online-first with offline fallback, heartbeat loop, wipe handling. Event-scoped door staff and checkpoints.
- **M1.9c:** legacy QR payloads, the scanner dashboard with live counts (Ably), fraud signals and alerts, and the full 3-device / 300-scan offline drill on real devices.
