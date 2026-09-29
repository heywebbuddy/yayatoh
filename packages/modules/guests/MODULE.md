# guests (tier 3)

Wedding and gala guest data (Phase 4, M4.1a): parties (households), the guests in them, placeholder plus-ones and the change history. Owns Postgres schema `guests`. Later Phase 4 increments add sub-events, invitations, RSVP, guest sites, gallery items and hosted tables here (roadmap §5.1).

**Tier.** Tier 3, as roadmap §3.5 lists it (with ticketing and seating). It reads down only: `events` (tier 2) to check the event, `attendees` (tier 2) to link a guest to a guest-list entry and its CRM contact. Seating (same tier) will reach guests through a port (`OccupantDirectory`, M4.3a), never an import.

**Invariants**
- Every row belongs to one event of the org: composite `(org_id, event_id)` foreign keys to `events.events` (hand-written in the migration, cascade on event delete). Every command takes the `eventId` and only touches parties and guests of that event, so event-scoped roles (co-host, planner in M4.2a) authorize against the right event.
- A party holds 0–20 guests. A guest is `guest` (has a first name) or `plus_one` ("Guest of <host>": same party, at most one per host, may stay unnamed until named; never the primary contact). A plus-one moves and is removed with their host; moving a plus-one alone is refused.
- One primary contact per party (partial unique index): the first guest added, or the one the host picks; when the primary leaves, the first named adult takes over.
- **Private data (P4-3):** dietary and accessibility answers and the home address are sealed together in `guests.private_ciphertext` with the org's key vault (AES-GCM bound to the org). They are opened only for the console's `GuestDto` (organizer roles with `guests:read`) and never written to the history, audit data, logs or any public payload.
- **Never marketing (P4-3):** nothing in this module creates CRM contacts, consents, audience members or campaign recipients, emits events that marketing consumes, or feeds a segment. A link to an attendee (and its contact) is a reference for RSVP and day-of messages only. Guests get RSVP, reminders and day-of messages; never campaigns.
- **History:** every change to a party or guest writes `guests.rsvp_history` in the same transaction (action, source, actor, changed field names, structural detail such as `fromPartyId`). The table is append-only for `app_user` (UPDATE/DELETE/TRUNCATE revoked) and has no foreign key to parties or guests, so it outlives them. Sources: `manual` and `paper` (entered on a guest's behalf) from the console; `import`, `collector` and `rsvp` are reserved for M4.1b/f/d.
- Permissions: reads need `guests:read`, writes `guests:write` (batch 3c merge: every org role with `attendees:read`/`attendees:write` holds them; co-hosts and planners get them on their events through the M4.2a `guests:*` event-role wildcard). Entitlement: the `guests` module. Removals are `delete` commands (refused while staff impersonate).
- Limits: 1,000 parties and 3,000 guests per event, 20 tags per party.
