# program (tier 3)

The lightweight event program (M1.4f): tracks, rooms, sessions, speakers, exhibitors and sponsors. Owns Postgres schema `program`. The roadmap's tier-3 contexts `sessions`, `speakers`, `exhibitors` and `sponsors` start here as one package; M5.2 (enrollment) and M5.4 (portals, leads) may split it.

**Invariants**
- Every row belongs to one event of the org: a composite `(org_id, event_id)` foreign key to `events.events` (hand-written in the migration, cascade on event delete). Rooms, tracks, speakers and sponsor tiers referenced by a session or sponsor must belong to the **same event** (checked by the commands).
- Session times are stored as instants (`timestamptz`); organizers enter wall-clock times in the **event's** timezone and the public agenda groups by day in that timezone.
- A session may belong to one date of a multi-date event (`occurrence_id` → `events.occurrences`, composite FK). It must fall within that date and the date must be scheduled.
- Conflicts (same room at overlapping times, a speaker in two overlapping sessions, a session outside the event) are **warnings**, never errors: the write happens and the console shows them. Intervals are half-open.
- A room or track in use can be deleted: its sessions keep their place and lose the room/track. A sponsor tier with sponsors can't be deleted (`tier_in_use`).
- Markdown fields (session description, speaker bio, exhibitor/sponsor description) are sanitized with the events module's Markdown subset. Links are http(s) only.
- Public reads (`publicProgram`, `publicSpeaker`) go through allowlist serializers: no capacities, no org internals.
- Entitlements: `sessions` (tracks, rooms, sessions), `speakers`, `exhibitors`, `sponsors`. Reading the program needs `events:read`; every write `events:write`.
