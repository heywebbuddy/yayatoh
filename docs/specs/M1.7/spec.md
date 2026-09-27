# M1.7 — Seating and tables

Roadmap: M1.7; ADR 0012 (layout document + `event_seats`, Postgres holds, lock after first sale); open decision D18 (ADA enforce/warn; seat ceiling — recommended: warn; Konva to 20k). Delivered in increments:

| # | Increment | Scope |
|---|---|---|
| a | Layout model and seat inventory | `@yayatoh/floorplan` (document v1, builders, validation, placement); `seating` module: floor plans, event layouts, event seats, categories, blocks, Postgres holds, lock after first sale, sweeper functions |
| b | Organizer editor | Konva editor (snap, rotate, multi-select, undo, autosave, templates, image underlay) with an accessible list/form alternative |
| c | Seated checkout | buyer seat picker with an accessible list mode, holds tied to the checkout hold, seat printed on the ticket and PDF, seats freed on refund/void |
| d | Organizer assignment | drag a guest, party or attendee onto a table or seat, with a keyboard/list alternative and an unseated queue |
| e | Public venue map and seat finder | entrances, stage and booths; name/email lookup with OTP; poster |
| f | Live availability | SSE (Ably later), per-date charts, `seating_rules` schema, legacy chart import (Phase 2 migration) |

## M1.7a — layout model and seat inventory (done)

- **`@yayatoh/floorplan`** (universal): document v1 in centimetres — sections (VIP flag), rows and round/rect tables with seats (stable UUIDs, labels, accessible flag), objects (stage, booth, entrance, exit, dance floor, bar, custom), optional legacy underlay. `buildRow` / `buildRoundTable`; `placedSeats` (absolute positions after rotation, printable labels such as "Row A · 5", "Table 3 · 2"); `layoutProblems` (duplicate ids or labels, unknown sections, seats outside the room, over 20,000 seats); `canonicalJson` for checksums.
- **`seating` module (tier 3)**, schema `seating` (RLS on every table):
  - `layouts` — the org's reusable floor plans (validated; checksum; seat count).
  - `event_layouts` — the event's own copy, `draft → published → locked`.
  - `event_seats` — per-event seat state with its category (ticket type), hold, ticket and block reason; CHECKs tie each status to its fields.
- **Commands:** save/list/get floor plans; set an event's floor plan (from a saved one or a document; refused once locked or while any seat is held or sold); publish; assign categories by section, row/table or seat (never sold seats); block/unblock (`channel`, `ada`, `kill`); the event's seating (document, per-seat state and counts).
- **Holds** (`holdSeatsTx`): one `UPDATE … WHERE status = 'available'` for all requested seats under a 2 s lock timeout; fewer rows than asked → `conflict` / `seats_taken` and the caller's transaction rolls back, so it is all or nothing. `sellSeatsTx` sells a hold's seats to their tickets and **locks the layout**; `releaseSeatHoldTx`, `voidSeatTx` (a voided ticket frees its seat) and `releaseExpiredSeatHoldsTx` (the sweeper) complete the state machine, which is property-tested.
- **Not yet:** checkout validating a seat's ticket type belongs to the event (M1.7c), the worker sweeper wiring (with M1.7c, when checkout creates seat holds).

### Acceptance (M1.7a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Documents: builders, labels, rotation, every problem found, schema rejects malformed input, checksums stable | `packages/floorplan/tests/floorplan.test.ts` |
| AC2 | The seat state machine allows exactly the ADR's transitions; random walks never sell an unheld seat | `packages/modules/seating/tests/seat-state.test.ts` |
| AC3 | **A seat race produces one winner** (8 concurrent holds); holds are all-or-nothing | `packages/testing/tests/seating.int.test.ts` |
| AC4 | Draft seats are not on sale; selling locks the layout; a locked layout can't be replaced; void frees the seat; holds release explicitly and by the sweeper | `seating.int.test.ts` |
| AC5 | Categories and blocks by table/seat never touch sold or held seats; viewers read only; other orgs see nothing; fixture rows for isolation | `seating.int.test.ts`, `isolation.int.test.ts` |
