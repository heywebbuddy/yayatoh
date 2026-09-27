# events (tier 2)

Events, their lifecycle and event-scoped roles. Owns Postgres schema `events`.

**Invariants**
- Status changes only through the lifecycle (`domain/lifecycle.ts`) with a conditional `UPDATE … WHERE status = ANY(from)`; every transition is audited and emits `event.<transition>@1`.
- Slugs are global (public URL `yayatoh.com/events/{slug}`), lowercase, and frozen once the event has been published.
- Times are `timestamptz`; the event's IANA `timezone` is how they render (CLAUDE.md → Time). `ends_at > starts_at`.
- Public reads go only through `events.public_event(slug)` (SECURITY DEFINER, allowlisted columns); private events and drafts are never returned.
- Event-scoped roles (`event_role_assignments`) grant access to one event only and may expire.
- **Dates (M1.4b):** `occurrences` are the dates of a multi-date event (`scheduled` or `cancelled`, optional capacity). With any, the event's `starts_at`/`ends_at` are kept equal to the span of its scheduled dates (`syncEventSpanTx`). At most 366 scheduled dates; no two scheduled dates start at the same instant. Dates are cancelled, never deleted.
- Recurrence (`domain/recurrence.ts`) is expanded in the event's wall-clock time with `zonedTimeToUtc`, so times stay put across DST; "this and following" keeps each date's local day. Rules are not stored.
- **Series (M1.4b):** global slugs (`/series/{slug}`); an event is in at most one series (`series_events`). Public reads only through `events.public_series` / `events.public_series_events` (active orgs, public upcoming events, allowlisted columns); public dates only through `events.public_occurrences` (sold out yes/no, never capacity numbers).

