# seating (tier 3)

Floor plans and per-event seats (ADR 0012). Owns Postgres schema `seating`.

**Invariants**
- A layout document is a `@yayatoh/floorplan` v1 document in centimetres; it must parse and have no layout problems (unique ids and labels, known sections, seats inside the room, ≤ 20,000 seats).
- `seat_uuid` is stable: it is the seat's id in the document, and an event's seats are materialized from its layout once.
- An event layout moves `draft → published → locked`. It locks at the first sale; a locked layout's document and seats never change (categories and blocks of unsold seats still may).
- Seat state: `available → held` (one `UPDATE … WHERE status = 'available'` for all requested seats under a lock timeout; fewer rows than asked → the whole hold fails), `held → sold | available`, `available ⇄ blocked`, `sold → available` only when its ticket is voided. Nothing else.
- Expired holds are released by the sweeper; a hold never outlives its checkout hold.
