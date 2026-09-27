# attendees (tier 2)

The per-event participant record. Owns Postgres schema `attendees`.

**Invariants**
- Every attendee belongs to one event and one org contact (`crm.contacts`); the contact is the person, the attendee is their participation.
- Ticketed attendees are created in the same transaction that issues the ticket, one per ticket (`unique (org_id, ticket_id)`).
- Organizer reads go through `listAttendeesQuery` and the `AttendeeDto` allowlist.
