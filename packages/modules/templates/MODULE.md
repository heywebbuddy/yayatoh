# templates (tier 5)

Event templates and "duplicate event" (M1.4b). Owns Postgres schema `templates`.

**Invariants**
- A copy (duplicate, or an event created from a template) is a new **draft** event with a new slug. It takes the event settings, the live ticket types (nothing sold, valid for every date), the checkout questions and the seating plan document (seat categories remapped, organizer blocks kept, not on sale). It **never** copies orders, tickets, attendees, check-ins, payouts, holds, guest seat assignments, dates (occurrences) or promo codes.
- Instants in a snapshot are stored relative to the event's start and re-anchored on the copy's start; access days as day offsets.
- Templates are org-owned (RLS) and named uniquely per org; the snapshot is versioned (`version: 1`).
- Writes compose the lower tiers inside one tenant transaction (`events`, `ticketing`, `forms`, `seating` copy helpers); this module never touches their schemas.
