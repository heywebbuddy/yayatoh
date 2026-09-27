# checkin (tier 4)

Admissions and the scan log. Owns Postgres schema `checkin`.

**Invariants**
- A code is either a yy1 code (Ed25519-verified with the org's public keys; the ticket's current `rev` must match) or a ticket short code. Anything else is `invalid`.
- Rules, in order: known ticket → this event (`wrong_event`, and nothing about the other event's ticket is returned) → not void → inside the event window (6 h before start to 6 h after end) → today (event timezone) is one of the pass's access dates, if it has any.
- One live admission per ticket per event day (partial unique index). A second scan is `duplicate`, with the first admission time. Undo marks the admission undone (never deletes it), which allows a fresh admission.
- Every attempt is appended to `scans`. `client_scan_id` makes a scanner's retries idempotent: a retried scan returns its first outcome, not a duplicate.
- Offline scanning (manifest + sync, roadmap §5.4): first-wins by corrected device time; losers become `duplicate_offline`.
- Checkpoints belong to one event. An entrance admits (the per-day admission rule is unchanged, and the entrance is recorded). A zone never admits: it returns `granted`/`no_access` from its ticket-type list (empty = all), after the event rules.
- Fraud signals are append-only rows plus a `checkin.fraud_signal@1` event, raised in the scan transaction: `two_entrances` (another entrance within 5 min of admission), `invalid_burst` (the 5th invalid code from one scanner within 60 s, once per burst).
- **Dates (M1.4b):** a ticket for one date of a multi-date event is admitted only from 6 h before to 6 h after that date, never on a cancelled date (`wrong_date`, online and offline; the manifest header lists the dates).
