# ADR 0011 — QR format (Ed25519) and offline check-in protocol

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §5.4)

## Context
- Doors must keep scanning when venue Wi-Fi fails.
- Offline devices must verify tickets without holding a secret that could forge them.
- Legacy QR codes already issued must keep scanning.

## Decision
- **QR format (yy1):** Ed25519-signed compact binary → base32 → QR V7-M, with a per-org `kid`. Tickets also carry a short code.
- Legacy payloads are stored in `ticket_barcodes`, unique on `(instance, payload)`. Issued codes are never regenerated. The scanner checks the legacy format first, then yy1.
- **Manifest** per event (optionally per checkpoint), synced by `seq` delta. Rows hold ticket id, short code, `rev`, status, type, entitlements, seat label, holder display name, phone last 4, per-event-salted hashes of normalized email and E.164 phone, and legacy payload hashes. The header carries public keys, checkpoints, rules and server time.
- **Protection:** encrypted at rest (SQLCipher on native; the PWA can only obfuscate); expires 24 h after the event; remote wipe.
- **Offline verdicts:**
  - valid signature, `rev` equal, active, not admitted locally → admit
  - already admitted on this device → duplicate
  - `rev` lower than manifest → reject (superseded)
  - valid, not in manifest, issued after last sync → org policy (D17; default provisional admit, flagged)
  - not in manifest, issued before last sync → reject
  - bad signature → reject
- **Cross-device duplicates:** online devices check the server (p95 under 300 ms). Offline devices reconcile on reconnect, first-wins by `device_ts + clock_offset`; losers become `duplicate_offline` and alert within 60 s.
- **Sync:** batches of up to 500 scans, UUIDv7 `scan_id`, `ON CONFLICT DO NOTHING`; heartbeat every 30 s.

## Alternatives
- **HMAC-signed QR.** Rejected: offline devices would need the secret.
- **LAN hub for all-offline venues.** Deferred to Phase 6.

## Consequences
- `ticket-crypto` and `checkin-engine` are universal packages shared by the Scan PWA and any future mobile app.
- `scan_events` is append-only. Transfers are void-and-reissue with a new barcode and bumped `rev`.
- Offline verify targets ≤100 ms; a 20k-ticket manifest syncs in under 30 s at 10 Mbps.
- The legacy verdict corpus must reproduce identically.

## Revisit when
- Rotating QR (Secure Ticket) is requested (D17).
- Fraud data shows provisional admit is abused.
