# events (tier 2)

Events, their lifecycle and event-scoped roles. Owns Postgres schema `events`.

**Invariants**
- Status changes only through the lifecycle (`domain/lifecycle.ts`) with a conditional `UPDATE … WHERE status = ANY(from)`; every transition is audited and emits `event.<transition>@1`.
- Slugs are global (public URL `yayatoh.com/events/{slug}`), lowercase, and frozen once the event has been published.
- Times are `timestamptz`; the event's IANA `timezone` is how they render (CLAUDE.md → Time). `ends_at > starts_at`.
- Public reads go only through `events.public_event(slug)` (SECURITY DEFINER, allowlisted columns); private events and drafts are never returned.
- Event-scoped roles (`event_role_assignments`) grant access to one event only and may expire.
