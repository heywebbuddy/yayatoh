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

## Remaining M1.9 increments
- **M1.9b:** Scan PWA with camera (zxing-wasm / BarcodeDetector); the offline protocol per §5.4 (signed manifest with public keys, hashed lookups, a local queue, sync with cross-device duplicate flags); device enrollment, heartbeat and wipe; checkpoints and entrances; event-scoped door staff.
- **M1.9c:** legacy QR payloads, the scanner dashboard with live counts (Ably), fraud signals and alerts, and the 3-device offline drill.
