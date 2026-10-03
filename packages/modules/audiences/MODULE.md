# audiences (tier 5)

Audiences (M3.6a): the live participation projector, the segment builder's saved definitions, the
vision's three audience templates and the audience export. Owns Postgres schema `audiences`
(`segments`); the projections it keeps current (`event_participation`, `contact_profile`) and the
segment DSL and its SQL compiler belong to `crm`, which it calls down the tiers.

**Invariants**
- **Projector (`audiences.participation`).** Fed by the outbox: `order.paid`, `order.refunded`,
  `tickets.cancelled`, `ticket.admitted`, `ticket.admission_undone`, `attendee.cancelled`,
  `attendees.changed`, `seating.assignments_changed`, `guests.rsvp_responded` (M4.1d; it sets the
  row's `rsvp` on rows that exist for other reasons only, P4-3) (all v1). Each names an event and people (or,
  for a floor-plan edit, the whole event); their rows are recomputed from the sources (attendees,
  tickets, seat assignments, admissions, paid orders) and replaced, then their profiles are
  rebuilt. Exactly once per event (`processed_events`), idempotent besides, order-independent. It
  opts in to `replayed` legacy events, so migrated history is projected like live sales.
- **Definitions are data, never SQL.** A saved definition is re-validated with the DSL schema on
  every read; scopes (event, series, previous edition, date range) are resolved to event ids through
  the events module under the tenant's RLS, then crm compiles with bound parameters only.
- **Permissions.** Viewing and previewing need `messages:read`; saving and deleting need
  `messages:send`. A preview with `eventId` is event-scoped: event roles apply, the audience is that
  event's people, and any scope beyond that event (or an org-wide profile condition) is refused.
- **Preview output is an allowlist** (`AudienceRowDto`: contact id, name, email, event counts, last
  seen). Counts are computed on read and never stored.
- **Export** is the platform bulk-export path (`audiences.contactsCsv`): step-up, `bulk.start` audit,
  impersonation category `export`, allowlisted CSV columns; permission `attendees:export`.
- Templates are pure (`./client`): they fill the builder with ordinary definitions.
- **M6.1a.** `personTimelineQuery` (`contacts:read`) pages the crm timeline projection and names its
  events through the events module (a lookup, not a join). `participationContactOwner` is the
  `projections`-phase contact reference owner: after every module moved its rows in a merge (or an
  undo), it recomputes both records' participation at every event either took part in, in the same
  transaction.

- **Contact stats (M6.1b).** The participation projector refreshes the stats of every contact it
  touches in the same transaction; `audiences.contact-signals` records `session.attended@1` and
  `campaign.opened@1` (v1 contracts; replayed history included) and refreshes that contact.
  Everything is recomputed from the sources: replaying never double-counts. `rescoreOrgContacts`
  is the backfill and the daily rescore (worker job `audiences.contact-stats`), so registrations
  whose events have ended become attended or no-shows.
- **Money conditions** (`ltv`, `rfmMonetary`) need the member's org role to hold `finance:read`
  for preview, save and export (`assertMoneyConditionsAllowedTx`; the export checks the
  transaction's actor). System actors (campaign sends) are not members and pass.
- **Engagement (M5.7b).** The DSL's `engagement` condition reads `crm.event_engagement` (kept by
  the `engagement` module): the sum of a contact's scores over the events in scope, compared with a
  whole number. Its scope is resolved like every other condition's.
