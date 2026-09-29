# crm (tier 1)

Org-scoped contacts and the consent ledger. Owns Postgres schema `crm`.

**Invariants**
- A contact belongs to one org. The same person in two orgs is two contacts, and there is no global attendee record (roadmap §4.1).
- `email_norm` (trimmed, lower-case) is unique per org; `upsertContactTx` is the only way contacts are created from checkout and ticket issue.
- Consents are append-only rows with evidence; the latest row per (contact, channel, purpose) wins. No row means no consent. Consent is never inferred from a purchase.
- Transactional email (tickets, receipts) needs no marketing consent; marketing sends must check `currentConsentTx` (M3.5 adds suppressions and the policy gate).
- Consent channels are email, SMS and WhatsApp; purposes are `marketing` (express written consent
  for texts) and `informational` (reminders and updates by text, M3.5a). The preference center
  writes rows only when a choice changes, with evidence naming the disclosure version.
- `event_participation` (contact × event) and `contact_stats` (contact × currency) are projections. The legacy migration backfills history (`source = 'legacy'`, rebuilt on each run); the live projector is `audiences.participation` (M3.6a, `source = 'live'`), which writes only through `replaceParticipationTx` and `refreshContactProfilesTx`. The event reference is a composite FK to `events.events` in a hand-written migration (this module never imports the events schema). DSAR exports include both.

- `contact_profile` (M3.6) is a projection of `event_participation` and the consent ledger, rebuilt by the SQL function `crm.refresh_contact_profiles` (shared by the projector, `recordConsentTx` and the migration backfill). Consent is summarized in the same transaction that records it.
- **Segment DSL (M3.6a):** `SegmentDefinition` (zod, browser-safe via `./client`) is compiled by `compileSegment` to a WHERE clause with bound parameters only; operators and columns come from fixed tables keyed by enum values. Scopes arrive resolved to event ids (crm never reads the events schema). Merged and erased contacts never match.
