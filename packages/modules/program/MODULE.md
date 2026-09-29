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
- Events emitted (M1.4h): `program.speaker_deleted@1`, `program.exhibitor_deleted@1`, `program.sponsor_deleted@1` (`{ kind, eventId, id }`); media removes the row's photo/logo. `programOwnerTx` lets media check an image owner under RLS.

**M5.4a — exhibitor portal and booths**
- Exhibitor people (`exhibitor_members`) are admins or staff of one exhibitor at one event, bound to an event-role assignment (`exhibitor_admin`/`exhibitor_staff`) that expires with the event + 90 days. They are never org members. Links and sessions are stored as HMACs only; a link is spent on use; revoking ends links, sessions and the event role.
- Portal commands (`public:exhibitor_portal`) re-check the portal principal in their transaction (`portalMemberTx`: same org, active unexpired member, the named assignment live, admin where needed) and act only on the principal's own exhibitor.
- Staff invites stop at the allowance (the exhibitor's own, else the event default, else 5): pending and active staff hold places, revoked free them; the exhibitor row is locked before counting.
- With approval on, an admin's edit is the exhibitor's single pending change until the organizer approves (applied) or rejects it.
- Booths: numbers unique per event (case-insensitive); at most one primary per booth (the first by default; removing the primary promotes the longest-standing co-exhibitor). Overlaps, shared booths, several booths and category mismatches are warnings.
- Public reads (`publicExhibitorMap`, `publicProgram`) leave out unlisted exhibitors and go through allowlist serializers.
- Events: `program.exhibitor.staff_invited@1`, `program.booth.assigned@1`.
