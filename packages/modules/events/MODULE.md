# events (tier 2)

Events, their lifecycle and event-scoped roles. Owns Postgres schema `events`.

**Invariants**
- Status changes only through the lifecycle (`domain/lifecycle.ts`) with a conditional `UPDATE … WHERE status = ANY(from)`; every transition is audited and emits `event.<transition>@1`.
- Slugs are global (public URL `yayatoh.com/events/{slug}`), lowercase, and frozen once the event has been published.
- Times are `timestamptz`; the event's IANA `timezone` is how they render (CLAUDE.md → Time). `ends_at > starts_at`.
- Public reads go only through `events.public_event(slug)` (SECURITY DEFINER, allowlisted columns); private events and drafts are never returned.
- Event-scoped roles (`event_role_assignments`) grant access to one event only and may expire.

**M1.4c/d content and access**
- Venues belong to the `venues` module (tier 1); an event points at one with `venue_id` (composite FK). Picking a venue copies its name, city and country into the free-text fields, which stay what pages show (expand step; the free-text fields keep working without a venue).
- Categories are the platform taxonomy `EVENT_CATEGORIES` (a CHECK on `events.category`); tags are per org (`event_tags`, unique per event case-insensitively via `tag_key`, at most 10 per event).
- Content sections (`event_sections`) are typed per kind (Zod `SectionBody`), kept in dense `position` order; reorder takes either the full order (drag) or one step (keyboard), and a stale order is a `conflict`.
- Organizer text is a small Markdown subset parsed to a tree (`domain/markdown.ts`) and rendered as React elements: raw HTML stays text; only http(s)/mailto links survive.
- Announcements publish/unpublish; each publish emits `event.announcement_published@1` for notifications (M1.10). No email is sent here. `holders` announcements never reach public reads.
- `event_private_info` (private info and the online join link) is never read by a public function or serializer. Holders get it through `holderEventContent`, called only after a manage/holder link was verified and the holder has a live ticket. The join link shows from `join_opens_minutes` before the start until the end, for online/hybrid events only. Reading it in the console needs `events:write`.
- Access codes are stored upper-case and matched case-insensitively; wrong, expired, inactive and used-up codes get one answer and count as a failed attempt; `ACCESS_ATTEMPTS_PER_WINDOW` failures per client key and event in `ACCESS_ATTEMPT_WINDOW_MS` → `rate_limited`. A success counts one use atomically; a visitor who already unlocked keeps access until expiry or deactivation. Listing codes needs `events:write`.
- Short links (`short_links`) are global (unique `code`), lower-case, one automatic code per event (created with the event) and at most one vanity code; `/e/{code}` resolves only for events with a public page (`events.short_link_target`).
- Public reads for this content: `events.public_event_v2`, `events.page_target`, `events.access_target`, `events.short_link_target`, `events.public_events_at_venue` (SECURITY DEFINER, allowlisted columns).
