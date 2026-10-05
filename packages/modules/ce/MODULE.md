# ce (tier 5)

CE (continuing education) credits and certificates (M6.9b, decision P6-9). Owns Postgres schema
`ce`: `settings`, `session_rules`, `certificates` and `awards`. Attendance comes from lower tiers
through their exports: session door visits from `checkin` (tier 4), heartbeat watch minutes and
Zoom attendance from `virtual` (tier 4), holders from `ticketing`, order languages from `orders`.
The composite FKs to `events.events`, `program.sessions` and `ticketing.tickets` are hand-written
in the migration (cascade on delete). Entitlement `virtual` (P6-13).

**Invariants**
- **A rule per session**: credits in hundredths (1–10 000), a minimum of 1–1440 minutes, and which
  attendance counts (in person, online, or both; at least one). Reads `events:read`, changes
  `events:write`.
- **Minutes are minute buckets** (`domain/credits.ts`, pure): a visit (scan in → out; never scanned
  out: until the session ends) and a Zoom segment count every UTC minute they overlap; a watched
  minute is its own bucket; everything is clipped to the session's window; a bucket counts once
  whatever covers it. A session qualifies at its minimum; a certificate totals its qualifying
  sessions. Only ended sessions count.
- **Exactly reproducible**: the awards store the minutes and credits each certificate was computed
  from; the document (`certificate-document.ts`) is built only from them, the settings and the
  `legal-copy` file (`legal/certificate-copy.ts`, placeholder wording pending counsel).
- **Idempotent calculation** (`ce.calculate`, the settings row is the lock): the same inputs change
  nothing (content hash) and send nothing; a different result is a new revision; a ticket with no
  qualifying session left (or voided) has its certificate withdrawn (`revoked`, verifiable as
  such). One certificate per ticket; codes are unique per org (`XXXXX-XXXXX`, Crockford, 50 bits).
- **Below the threshold, no certificate.** Events: `ce.certificate_issued@1`,
  `ce.certificate_revoked@1` (ids and the revision). `ce.certificate-mailer` emails the holder
  once per revision (`ce.certificate`), with the signed PDF link (`ce.certificate` token).
- **Public verification** (`public:ce`) by org and code: status, a masked name (first name and an
  initial), event, organizer, credits and dates. Never the address, the ticket or the full name.
- Certificates speak the order's language (13 locales, Arabic right to left); dates in the event's
  timezone.
