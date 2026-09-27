# seating (tier 3)

Floor plans and per-event seats (ADR 0012). Owns Postgres schema `seating`.

**Invariants**
- A layout document is a `@yayatoh/floorplan` v1 document in centimetres; it must parse and have no layout problems (unique ids and labels, known sections, seats inside the room, ≤ 20,000 seats).
- `seat_uuid` is stable: it is the seat's id in the document, and an event's seats are materialized from its layout once.
- An event layout moves `draft → published → locked`. It locks at the first sale; a locked layout's document and seats never change (categories and blocks of unsold seats still may).
- Seat state: `available → held` (one `UPDATE … WHERE status = 'available'` for all requested seats under a lock timeout; fewer rows than asked → the whole hold fails), `held → sold | available`, `available ⇄ blocked`, `sold → available` only when its ticket is voided. Nothing else.
- Expired holds are released by the sweeper; a hold never outlives its checkout hold.
- **Seat assignment (M1.7d):** an organizer seats an attendee in exactly one seat of a table or row (`seat_assignments`, one per attendee per event, one attendee per seat). The seat is blocked with reason `assigned`, so it is off sale; only `available` seats (and, when chosen explicitly, seats blocked for `channel` or `ada`, whose block is remembered in `prior_block`) can be assigned — never held, sold or killed ones. Unblocking never frees an `assigned` seat; deleting the assignment does (the `seat_assignment_released` trigger restores the seat's prior state, whatever deleted the row). Ticket holders who bought a seat are seated by their ticket and can't also be assigned.
- A group is seated all or nothing: if fewer seats are free than people, nothing changes (`not_enough_seats`, with how many fit). Automatic placement uses free seats in plan order, accessible seats last; a guest placed automatically may be moved within the table to make room for a chosen seat.
- Assignments follow plan edits: seats that keep their id keep their guest; guests whose seat disappeared are unseated.
- Assignments are released when the attendee stops attending: refunds and lost disputes call `releaseAttendeeSeatsTx` in their transaction; a guest taken off the list emits `attendee.cancelled@1`, handled by the `seating.release-cancelled` subscriber.
