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

**M6.1a — duplicates, merge and the person timeline** (ADR 0022)
- **Duplicates** (`duplicate_candidates`, `duplicate_scans`): a pair per row (`a < b`) with a score 0–99 and its reasons (`email`: same canonical mailbox, plus-tags and Gmail dots ignored; `phone`: same E.164; `name_company`: pg_trgm name and company similarity ≥ 0.6 through the SECURITY DEFINER `crm.similar_contact_pairs`). `scanDuplicatesTx` is incremental (contacts changed since the scan cursor, compared with everyone) unless `full`; the worker's `crm.duplicate-scan` job runs it per org (`crm.orgs_needing_duplicate_scan`). Dismissed pairs are never raised again; merged and erased contacts never match.
- **Merge** (`mergeContactsTx`, commands `crm.mergeContacts` / `crm.mergeDuplicatesBulk` (step-up) / `crm.undoMerge`, permission `contacts:merge`): both records locked; refused while any `contact_id`-named column in the database has no registered `ContactReferenceOwner`. The target takes the chosen fields (an email chosen from the duplicate is swapped, so both addresses resolve to the person); the duplicate gets `merged_into`. Consent: the strictest current status per (channel, purpose), an opt-out winning, appended as ledger rows on the target (evidence `merge:<id>`). Timeline entries and every owner's rows move in the same transaction and are recorded once in `contact_merge_moves`. Emits `crm.contacts_merged@1`.
- **Undo** within 30 days restores the split exactly: owners move back the recorded rows, timeline entries go back with their subjects, the merge's consent rows are removed, both records get their snapshot fields (and `updated_at`) back; emits `crm.contacts_unmerged@1`. Refused once expired, after erasure (the snapshot is scrubbed by `eraseContactDsarTx`) or while the target has been merged again.
- `upsertContactTx`, `upsertContactsTx` and `contactIdByEmailTx` follow `merged_into` (a merged-away address finds the record that stays).
- **Timeline** (`timeline_entries`): a projection written only by owners' outbox subscribers through `recordTimelineTx`, exactly once per `(kind, source_ref)`; a fact about a merged contact lands on the active record. Never PII beyond a short label (a campaign or survey name). Read by keyset (`timelinePageTx`).
