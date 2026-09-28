# attendees (tier 2)

The per-event participant record. Owns Postgres schema `attendees`.

**Invariants**
- Every attendee belongs to one event and one org contact (`crm.contacts`); the contact is the person, the attendee is their participation.
- Ticketed attendees are created in the same transaction that issues the ticket, one per ticket (`unique (org_id, ticket_id)`).
- Organizer reads go through `listAttendeesQuery` and the `AttendeeDto` allowlist.
- Taking a guest off the list (`removeGuestCommand`) emits `attendee.cancelled@1` `{ orgId, eventId, attendeeId }` so higher tiers can react (seating frees their seat).
- **Filter extensions (M1.8f):** filters on data higher tiers own (ticket type, check-in) arrive as ticket-id subqueries built by those modules (`TicketFilterExtension`); this module applies them to `ticket_id` and never reads their schemas.
- **Search (M1.8f):** name/email search runs through `attendees.search_ids(pattern)` (SECURITY DEFINER, own org only via `app.org_id`, ids only) so the trigram indexes serve it under RLS (Postgres can't use them for `ILIKE` behind a policy); the rest of the query stays under RLS and results equal a plain `ILIKE`.
