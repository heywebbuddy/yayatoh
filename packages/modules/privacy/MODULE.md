# privacy (tier 5)

Data-subject requests and retention (M1.14c). Owns Postgres schema `privacy`
(`dsar_requests`, the accountability record). Reads and redacts other modules only through
their exported `*DsarTx` / retention functions, inside the caller's tenant transaction.

**Invariants**
- Only owners and admins (`privacy:manage`) find, export or erase a person. Every request is
  recorded in `privacy.dsar_requests` and audited; neither keeps the address (SHA-256 of the
  normalized email plus a masked hint).
- Erasure redacts in place; it never deletes rows other data depends on. Paid orders and the
  ledger are kept for 7 years (legal hold) with the buyer's name, email, account link, payment
  reference and manage link removed. Tickets stay valid (holder redacted, devices resync).
  Consent rows and check-in admissions are kept; they hold no personal data.
- Export files that mention an erased address are deleted; the access-request file itself expires
  after 7 days and the email in the export operation's params is cleared after a day.
- The access document is an allowlist (`yayatoh.dsar/1` JSON): no tokens, hashes, signing keys,
  provider ids or internal contact ids.
- Retention (`retentionCommand`) is idempotent, runs per org as a system actor, and uses the
  defaults in `src/retention.ts` (pending the owner's confirmation).

**Public surface:** `.` only.
