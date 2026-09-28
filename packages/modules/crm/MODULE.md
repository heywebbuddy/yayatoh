# crm (tier 1)

Org-scoped contacts and the consent ledger. Owns Postgres schema `crm`.

**Invariants**
- A contact belongs to one org. The same person in two orgs is two contacts, and there is no global attendee record (roadmap §4.1).
- `email_norm` (trimmed, lower-case) is unique per org; `upsertContactTx` is the only way contacts are created from checkout and ticket issue.
- Consents are append-only rows with evidence; the latest row per (contact, channel, purpose) wins. No row means no consent. Consent is never inferred from a purchase.
- Transactional email (tickets, receipts) needs no marketing consent; marketing sends must check `currentConsentTx` (M3.5 adds suppressions and the policy gate).
- `event_participation` (contact × event) and `contact_stats` (contact × currency) are projections. The legacy migration backfills history (`source = 'legacy'`, rebuilt on each run); the live projector is M3.6 (`source = 'live'`). The event reference is a composite FK to `events.events` in a hand-written migration (this module never imports the events schema). DSAR exports include both.

