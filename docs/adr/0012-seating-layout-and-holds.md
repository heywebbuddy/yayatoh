# ADR 0012 — Seating: layout document + `event_seats`, Postgres holds, lock after first sale

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §5.2)

## Context
- Galas, weddings and concerts need seated sales, table assignment and a seat finder.
- Two buyers must never get the same seat.
- Legacy seat charts are images with seat points and must migrate.

## Decision
- **Layout document** (`seating.layouts`) in centimetres, with a checksum and stable `seat_uuid`. Event layouts move `draft → published → locked`.
- **`event_seats`** holds per-event seat state: category, status, `hold_id`, `hold_expires_at`, `ticket_id`, channel, accessibility.
- **Holds live in Postgres.** `available → held` is one statement:
  `UPDATE event_seats SET status='held', hold_id=$h, hold_expires_at=$t WHERE event_id=$e AND seat_uuid = ANY($ids) AND status='available' RETURNING seat_uuid`, under a `lock_timeout`. If the row count is not n, roll back.
- Other transitions: `held → sold | available`; `available ⇄ blocked{channel|ada|kill}`; `sold → available` on void.
- A sweeper releases expired holds every 30 s.
- **The layout locks after the first sale.** `seat_uuid` is immutable.
- Editor and picker: Konva + react-konva; SVG for print; an accessible list mode always.
- Availability is pushed over Ably with SSE fallback (ADR 0009).
- Legacy charts become `layout_v1`: the image as underlay plus one seat point per legacy seat, `seat_uuid = uuidv5(ns, "{inst}:seat:{id}")`.

## Alternatives
- **Redis holds.** Rejected: Postgres is the system of record for inventory and holds.
- **PixiJS renderer.** Runner-up for layouts over 50k seats.

## Consequences
- State machines are property-tested in the module's `domain/`.
- M1.7 acceptance: every migrated seat exists; a seat race produces one winner; a 5,000-seat map runs at ≥50 fps on an iPad profile; keyboard-only assignment works.
- Drag assignment always has a list/keyboard alternative.
- ADA enforce/warn and seat ceiling are open decision D18 (recommended: warn; Konva to 20k).

## Revisit when
- Layouts exceed about 20k seats (consider PixiJS).
- Hold contention exceeds the checkout budget.
