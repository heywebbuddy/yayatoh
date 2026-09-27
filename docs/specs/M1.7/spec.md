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
- **Since M1.7c:** checkout validates each chosen seat against the event and its ticket type, and seat holds are released with their order (the worker's order sweeper).

### Acceptance (M1.7a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Documents: builders, labels, rotation, every problem found, schema rejects malformed input, checksums stable | `packages/floorplan/tests/floorplan.test.ts` |
| AC2 | The seat state machine allows exactly the ADR's transitions; random walks never sell an unheld seat | `packages/modules/seating/tests/seat-state.test.ts` |
| AC3 | **A seat race produces one winner** (8 concurrent holds); holds are all-or-nothing | `packages/testing/tests/seating.int.test.ts` |
| AC4 | Draft seats are not on sale; selling locks the layout; a locked layout can't be replaced; void frees the seat; holds release explicitly and by the sweeper | `seating.int.test.ts` |
| AC5 | Categories and blocks by table/seat never touch sold or held seats; viewers read only; other orgs see nothing; fixture rows for isolation | `seating.int.test.ts`, `isolation.int.test.ts` |

## M1.7b — organizer editor (done)

- **Seating page** (`/o/[org]/e/[event]/seating`, where the event's profile shows Seating):
  - **No plan yet:** "Start a seating plan" from numbers (a stage, rows × seats, round tables × seats) — `quickLayout` in `@yayatoh/floorplan` — or "Use a saved plan".
  - **With a plan:** status (draft / on sale / locked), seat counts, how many seats have a price, "Put seats on sale".
- **Editor** (Konva, client-only): the room at scale; rows, tables and objects are dragged and **snap to 10 cm**; click selects, **Shift-click multi-selects**; toolbar adds rows (n seats), round tables (n seats) and objects (stage, booth, entrance, exit, dance floor, bar, other), rotates the selection by 15°, deletes, **undoes and redoes** (100 steps). Changes **autosave** after 1.2 s ("All changes saved"; layout problems are reported). Seats are coloured by state (available, held, sold, blocked; accessible seats outlined).
- **Accessible alternative** (roadmap: every canvas interaction has one): a list of everything on the plan with selection boxes and label / x / y / rotation fields; with the plan focused, arrow keys move the selection by 10 cm (Shift: 1 m), R rotates, Delete removes, Ctrl+Z / Ctrl+Shift+Z undo and redo. The plan region is a focusable `role="application"` with its keys described.
- **Prices:** choose rows or tables and the ticket type their seats sell as (or "Not on sale"). **Save as a reusable plan** for other events.
- **Editing is safe:** seats that keep their id keep their price and blocks, a plan on sale stays on sale, and nothing can change while seats are held or once any are sold (locked, read-only editor).
- **Later in M1.7:** image underlay upload (needs file storage), section drawing and VIP sections in the editor, per-seat selection on the canvas, templates beyond the quick builder, performance check at 5,000 seats (iPad profile) with the picker in M1.7c.

### Acceptance (M1.7b)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Quick layouts are valid rooms (stage, rows, tables) | `packages/floorplan/tests/floorplan.test.ts` |
| AC2 | Editing keeps prices and blocks; a plan with held seats can't be replaced | `packages/testing/tests/seating.int.test.ts` |
| AC3 | In the browser: an organizer creates a plan from numbers, moves a row with the keyboard (arrow), sees it autosave, undoes it, prices a table and puts seats on sale; axe passes | `apps/web/e2e/seating.spec.ts` |

## M1.7c — seated checkout (done)

- **Public event page:** when an event's seat plan is on sale, seated passes say "Choose your seats below" instead of a quantity; standing passes keep their quantity. **Choose your seats** lists every row and table as a group of seat checkboxes with the seat's all-in price (accessible seats marked, taken seats disabled), which is the default and works by keyboard and screen reader; "Show seat map" adds the plan (Konva, client-only) where a tap chooses a free seat. Both share one selection (at most 20 seats).
- **Public seat map** (`publicSeatMap`): the published document plus, per priced seat, only its id, label, ticket type, `available` and `accessible` — never who holds or bought it.
- **Checkout** (`startCheckoutCommand`, new `seats` input, at most 50): the order id is minted first and the chosen seats are held **under the order's id** in the same transaction (all or nothing, `seats_taken` on a race). Seats decide the quantities of their ticket types; posting a quantity for a seated ticket type is refused (`choose_seats`); a seat with no ticket type is refused (`seat_not_on_sale`). Attaching a payment extends the seat hold with the order's hold.
- **On payment** each ticket is paired with a held seat: seats are sold to their tickets (which **locks the layout**) and the ticket keeps the seat label (`tickets.seat_label`). If the order had expired and someone else bought the seat meanwhile, the order is flagged `orphaned` (as with stock) and gives its stock back.
- **Freed seats:** an expired order releases its seats; refunds and lost disputes void the ticket and free its seat for sale again. The box office refuses seated ticket types for now (seat choice at the box office comes with M1.7d).
- **The seat everywhere:** the buyer's order page ("Seat: Row A · 5"), the tickets PDF, and the organizer's order page.
- **A seat taken at checkout:** the buyer is told, keeps what they typed, and gets a refreshed map with that seat dropped from their choice. The checkout form no longer clears itself on any error.
- **Dev seed:** "Lakeside Jazz Night" (`/events/lakeside-jazz-night`): three rows of Stalls, two tables, and standing room.

### Acceptance (M1.7c)
| ID | Criterion | Test |
|---|---|---|
| AC1 | The public seat map carries only allowlisted fields | `packages/testing/tests/seated-checkout.int.test.ts` |
| AC2 | Seated passes need seats; seats set quantities; standing passes sell by quantity; seats print on tickets | `seated-checkout.int.test.ts` |
| AC3 | A seat race at checkout has one winner; the other buyer gets `seats_taken` | `seated-checkout.int.test.ts` |
| AC4 | Expired checkouts and refunded tickets free their seats; a paid-late order whose seat was resold is flagged and releases its stock | `seated-checkout.int.test.ts` |
| AC5 | The seat shows on the tickets PDF (escaped) | `packages/pdf/tests/tickets.test.ts` |
| AC6 | In the browser: a guest picks seats from the list, opens the map, pays, sees "Seat: …" on each ticket, and the sold seats are disabled; in a race the loser keeps their details and sees the seat taken; axe passes | `apps/web/e2e/seated-checkout.spec.ts` |

## M1.7d — organizer seat assignment (done)

- **Assign guests** (`/o/[org]/e/[event]/seating/assign`, a second view beside the Plan on the Seating page, "Plan · Assign guests"):
  - **Still to seat** — the unseated queue: active attendees (guests, imports, ticket holders) with no assigned seat and no seat bought with their ticket, by name; search by name or email; tick people ("Select all shown", "Clear selection"). Shows 200 at a time (search finds the rest).
  - **Seat the selected people** — choose a table or row ("Table 1 — 3 of 8 free") and optionally one seat ("Any free seat", or a free seat; seats kept back for a channel or accessibility are listed as "(kept back)"), then **Seat them**. Several people at once is the party path; a specific seat takes one person.
  - **Plan** (Konva, drawing only) — seats coloured by who has them (free, guest, sold, in checkout, kept back, blocked) and "taken/capacity" on each table. **Drag a name** (or all ticked names) from the queue onto a table or row (first free seats) or onto one seat (that seat); the drop point is mapped to room centimetres and hit-tested (`hitTest` in `@yayatoh/floorplan`), and the table or seat under the pointer is highlighted. Everything the drag does, the queue and form do by keyboard (roadmap: every canvas interaction has an accessible alternative).
  - **Tables and rows** — each with "n of m seats taken · k free" and who sits where (seat label; buyers show "· by ticket"), with **Remove** per person (they go back to the queue).
  - Success and errors are announced (`aria-live`); "can't fit" says how many seats are free for how many people; viewers see everything read-only (no boxes, form or Remove buttons), and a change sent from a stale page after losing edit rights is refused by the server.
- **`seating.seat_assignments`** (tenant table, RLS): event, attendee (composite FK to `attendees.attendees (org_id, id)`, hand-written, `ON DELETE CASCADE`), table/row, seat, `pinned` (the organizer chose this seat), `prior_block`. Unique per (org, event, attendee) and per (org, event, seat).
  - **Every assignment holds a real seat**, blocked with the new block reason **`assigned`** (the `event_seats_block_check` widened with `NOT VALID` + `VALIDATE`), so a guest's seat is off sale and holds can never take it. Only available seats are placed automatically (in plan order, accessible seats last); a chosen seat may also be one kept back for a channel or accessibility (its block comes back when the guest is unseated). Held, sold and killed seats are refused (`seat_taken`, `seat_blocked`).
  - A delete trigger (`seating.seat_assignment_released`) restores the seat's previous state however an assignment goes (unseated, refunded, an imported guest removed by import undo, the seat deleted from the plan). Unblocking seats by hand never frees an assigned seat.
- **Commands** (`events:write`, audited, entitlement `seating`): `seating.assign` — `{ eventId, attendeeIds (≤ 50), itemId, seatUuid? }`, all or nothing under a row lock on the table's seats and the one-statement seat update (a seat taken meanwhile → `seats_taken`); people already seated elsewhere move; a guest placed automatically moves to another free seat at the table when their seat is chosen for someone else; a group that doesn't fit → `conflict` / `not_enough_seats` with `fits` and `asked`; ticket holders with a bought seat → `seated_by_ticket`; cancelled attendees → `attendee_cancelled`. `seating.unassign` — `{ eventId, attendeeIds }`.
- **Query** `seating.assignments` (`attendees:read`): tables and rows with capacity, free seats and per-seat state and occupant, the unseated queue (`id`, `name`, `email`, `labels` only) and the seated count — `SeatAssignmentsDto` allowlist.
- **Releases:** refunds and lost disputes void tickets and call `releaseAttendeeSeatsTx` in the same transaction (`voidTicketsTx` now returns each ticket's attendee). Taking a guest off the list emits `attendee.cancelled@1` (attendees, tier 2); the worker's `seating.release-cancelled` subscriber frees their seat.
- **Plan edits:** guests keep seats whose id survives an edit (and follow them to their table); guests whose seat is deleted are unseated.

**Later / not yet**
- **Parties and households** (M4 weddings): today a party is "tick several people, seat them together"; dragging a party chip and keeping households together come with the M4 guest model.
- Dragging people already seated from one table to another (today: Remove, then seat again — both by keyboard), and drag on touch screens (the list and form work on touch).
- Seat choice at the **box office** (it still refuses seated ticket types, M1.7c).
- The Plan view's counts still show assigned seats under "blocked", and the editor colours them as blocked.
- Suggested seating ("intelligent seating", M6.11/M6.12), place cards and the public seat finder (M1.7e).

### Acceptance (M1.7d)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Seat states for assignment; automatic placement in plan order, accessible seats last; "fits" when a group doesn't | `packages/modules/seating/tests/assign.test.ts` |
| AC2 | A drop point hits the seat under it, else the table or row around it (rotations included), never objects | `packages/floorplan/tests/floorplan.test.ts` |
| AC3 | A party is seated at a table in one go; seats go off sale; a group that doesn't fit is refused with how many fit, all or nothing; moving and re-seating; one person per chosen seat; an automatically placed guest makes room | `packages/testing/tests/seat-assignments.int.test.ts` |
| AC4 | No collision with sales: an assigned seat can't be held and shows taken on the public map; unseating puts it back on sale; held, sold and killed seats can't be assigned; seats kept back for a channel get their block back; buyers are seated by their ticket | `seat-assignments.int.test.ts` |
| AC5 | A refund releases the assignment; a guest taken off the list releases it through `attendee.cancelled@1` (idempotent); plan edits keep or unseat guests | `seat-assignments.int.test.ts` |
| AC6 | Viewers read but can't assign or unassign; other orgs see nothing; fixture rows for both orgs | `seat-assignments.int.test.ts`, `isolation.int.test.ts` |
| AC7 | **Keyboard-only assignment works end to end** (ADR 0012): tab to the queue, tick people, choose a table, seat them, see them listed and gone from the queue, remove one and they return; persisted; empty states; axe on each state | `apps/web/e2e/seat-assignment.spec.ts` |
| AC8 | Drag and drop onto a table and onto one seat of the plan | `seat-assignment.spec.ts` |
| AC9 | Form errors and the can't-fit error; a seat given to a guest is disabled on the public event page and free again after Remove | `seat-assignment.spec.ts` |
| AC10 | A viewer sees who sits where with no controls, and a stale page's actions are refused; Arabic renders right to left | `seat-assignment.spec.ts` |
