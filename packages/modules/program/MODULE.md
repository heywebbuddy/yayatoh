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

**Agenda model v2 (M5.2a)** — `src/agenda.ts`, pure rules in `src/domain/agenda.ts`:
- **Session types** (`session_types`, per event, org-editable; a "standard set" command in the organizer's language). Deleting a type keeps its sessions.
- **`session_details`**: one row per session, created and kept in step by the trigger `program.sync_session_details` (insert, and `capacity` updates on `sessions`). Holds the type, **included vs optional** (P5-9; default included), the pick-one group, `enrollment_open`, the CSV `import_key` and the **capacity counter** (`capacity` mirrors `sessions.capacity`; `enrolled` with the CHECK `enrolled >= 0 and (capacity is null or enrolled <= capacity)`). `enrolled` moves only through `claimSessionPlaceTx` / `releaseSessionPlaceTx` (a conditional UPDATE like ticketing's holds: optional, open, not full); M5.2b calls them. Lowering a session's capacity below `enrolled` fails the CHECK (M5.2b should map it to a friendly error in `updateSession`).
- **Pick-one groups** (`session_groups`): only optional sessions join (CHECK). `groupPickDecision` is the rule (exactly one pick per registrant and group); `session_group_picks` is the DB guard M5.2b writes through `recordGroupPickTx` (unique per registrant and group; a composite key into `session_details (org_id, session_id, group_id)` keeps the pick inside its group). A group with picks can't be deleted and its sessions can't leave it.
- **Warnings** (never errors): `room_too_small` (session capacity above the room's) and `group_not_overlapping`, next to the M1.4f overlaps (`agendaQuery.warnings`).
- **Publishing** (`agenda_publications`): no row = **live** (M1.4f: public at once); `draft` = no public sessions; `published` = the public agenda (`publicProgram`, `publicSpeaker`, `/v1` agenda) serves the stored allowlisted snapshot; `changed` is derived (current hash ≠ snapshot hash). Publishing emits `program.agenda.published@1` (`{ eventId, version, sessions, publishedAt }`); an unchanged re-publish is a no-op.
- **CSV import** on `@yayatoh/csv` (`agendaImportPreviewQuery` = dry run, `importAgendaCommand` = apply): times are wall-clock in the event's zone; speakers by email (`speaker_contacts`); matching by `key`, else title + start; idempotent; formula-like cells refused.
- Entitlement `sessions` for every write; `events:write` (the dry run too); reads `events:read`.


**Enrollment reads (M5.2b)** — `src/enrollment.ts`: `enrollableSessionsTx` / `enrollableSessionsByIdTx` (a session's
times, room, admission, group and counter) and `lockEnrollableSessionTx` (the counter row lock every enrollment decision
takes) for registration's enrollment, which never touches the `program` schema. `updateSession` refuses a capacity below
the places held (`invalid_state`, reason `capacity_below_enrolled`).
