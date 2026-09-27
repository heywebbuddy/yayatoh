# checkin (tier 4)

Admissions and the scan log. Owns Postgres schema `checkin`.

**Invariants**
- A code is either a yy1 code (Ed25519-verified with the org's public keys; the ticket's current `rev` must match) or a ticket short code. Anything else is `invalid`.
- Rules, in order: known ticket → this event (`wrong_event`, and nothing about the other event's ticket is returned) → not void → inside the event window (6 h before start to 6 h after end) → today (event timezone) is one of the pass's access dates, if it has any.
- One live admission per ticket per event day (partial unique index). A second scan is `duplicate`, with the first admission time. Undo marks the admission undone (never deletes it), which allows a fresh admission.
- Every attempt is appended to `scans`. `client_scan_id` makes a scanner's retries idempotent: a retried scan returns its first outcome, not a duplicate.
- Offline scanning (manifest + sync, roadmap §5.4) builds on these tables in M1.9b.
