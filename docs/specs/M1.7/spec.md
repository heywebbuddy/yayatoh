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

## M1.7e — public venue map and seat finder (done)

Roadmap M1.7 ("public interactive venue map showing entrances, stage and booths; public seat finder — name/email lookup, OTP, poster"), the legacy parity row "attendee portal seat finder + printed posters — `/events/{slug}/attendee` and poster QR codes resolve", and the abuse-limit row "seat finder and code lookup: per device cookie + event, 30/min, then a Turnstile challenge instead of a block".

- **Organizer: Seating → Seat finder** (`/o/[org]/e/[event]/seating/finder`, a third view beside Plan and Assign guests when the org has the `seat_finder` module; the wedding profile's "Seat finder" menu item leads here):
  - **Show guests the venue map and seat finder** — off by default (`event_layouts.public_map`). Nothing about the plan is public until it is on.
  - **How guests look up their seat** — *with a code sent to their email (recommended, the default)* or *instantly, by full name*. The privacy trade-off is spelled out under each option ("anyone who knows a guest's full name can see where they sit").
  - The finder's stable address, **Open the seat finder** and **Print seat-finder poster**. Viewers see the settings read-only; a change sent from a stale page after losing edit rights is refused (`events:write`).
- **Venue map** (on the public event page, "Venue map" with a **Find my seat** link, and on the seat finder): the published plan drawn read-only as SVG — stage, entrances, exits, bars, dance floor and booths coloured and labelled (the organizer's label, else the type in the visitor's language), tables and rows with their seats. **Zoom in / Zoom out / Whole room** buttons, and with the map focused `+` `−` arrow keys `0`; drag to pan when zoomed. The **venue guide** is its text alternative: every landmark and table/row with where it is on the map ("Top of the map", "Left side of the map" — plans have no compass, so positions are ninths of the room as drawn; `mapArea`, `itemCenter`, `nearestObject` in `@yayatoh/floorplan`).
- **Seat finder** (`/events/{slug}/seat-finder`; `/events/{slug}/attendee` permanently redirects there, so legacy posters resolve):
  - **Code mode:** the guest enters an email → always "If you're on the guest list, we've emailed you a 6-digit code. It works for 10 minutes." → enters the code → their seats. Every request writes the same things whether or not the address is on the list (a code row, an outbox event, an audit row); only rows for listed addresses keep the address and a matchable code hash, so the mailer (`seating.finder-code-mailer`, worker) sends nothing for the others. The code is derived from the row id under `APP_TOKEN_SECRET` and **never stored**; only its HMAC is. A code works **once**, for **10 minutes**, and **locks after 5 wrong tries** (outcomes are returned, not thrown, so the count commits). At most **5 codes per address per event per hour** (after that the last live code stands). The browser keeps the pending code and, once verified, the result for 24 hours in httpOnly cookies holding signed code ids bound to the event.
  - **Name mode** (organizer opt-in): the guest types their full name; exact matches only (case and spacing aside), never partial matches or suggestions.
  - **Result:** each seat as "Table 3 · Seat 2" / "Row A · Seat 5", where it is on the map and the nearest entrance; highlighted on the map (which opens zoomed on them) and marked in the guide. A party (several attendees with the same email — e.g. one buyer's seated tickets) sees all its seats; someone on the list without a seat is told so. Seats come from organizer assignments (M1.7d) and seats bought with tickets (M1.7c). The public result (`SeatFinderResultDto`) carries seat, table/row labels and ids only — **never names or emails**.
  - **Abuse limit:** every lookup (asking for a code, checking one, a name lookup) counts against **30 a minute per device cookie and event** (`platform.rate_limits`, a fixed-window counter any module can use via `hitRateLimitTx`). The device cookie (`yy_device`, random, httpOnly) is set by the proxy on the finder's pages; requests without it share one budget per event. Past the limit the guest gets a **challenge instead of a block**: the `HumanCheck` port — Cloudflare **Turnstile** when `HUMAN_CHECK_PROVIDER=turnstile` and its keys are set (owner account, see the owner inbox), otherwise a fake checkbox in dev, preview and CI (never production; production without keys makes the device wait a minute).
- **Poster** (`/events/{slug}/seat-finder/poster`, public, print CSS for A4 or Letter): the event name, "Find your seat", a large QR code of the stable finder address, three steps (worded for the event's lookup mode) and the address in text. The QR is the same SVG path as tickets (`qrPath`).
- **Commands and queries** (entitlement `seat_finder`, all audited): `seating.setFinderSettings` (`events:write`), `seating.finderSettings` (`events:read`); public (`public:seat_finder`): `seating.publicVenueMap`, `seating.requestFinderCode`, `seating.verifyFinderCode`, `seating.finderResult`, `seating.findSeatByName`. New tenant tables: `seating.finder_codes`, `platform.rate_limits` (RLS, fixture rows for both orgs).
- **Dev/e2e:** the console mailer prints codes in the worker log, which browser tests can't read, so `/api/dev/seat-finder-code` (404 unless dev personas are enabled; never in production) returns the latest code mailed to an address.

**Later / not yet**
- A poster **PDF** through Gotenberg (the page prints well from the browser today), branded posters, and table cards/escort cards (M4.3).
- **Tablemates**, a permanent per-guest QR, PIN lookup, kiosk mode and the TV board (M4.4). Phone-number lookup (needs SMS, M1.10).
- Seat finder for **private** events (today the event must be published and public or unlisted, like its event page) and on tenant custom domains (the poster uses the app origin).
- Real email templates (SES + React Email, M1.10); a purge job for old `finder_codes` rows (today pruned per event as new codes are made).
- Rendering very large plans (thousands of seats) as SVG is not yet performance-checked (the M1.7 iPad target applies to the Konva picker); pinch-zoom on touch screens.
- Upstash token buckets for the rate limit (roadmap §6.1) once the owner account exists.

### Acceptance (M1.7e)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Positions in words: centres of objects (rotation included), tables and rows; ninths of the room; the nearest entrance | `packages/floorplan/tests/guide.test.ts` |
| AC2 | Turnstile verification posts secret/token/IP and trusts only `success: true`; the fake adapter passes only its token; fixed rate-limit windows | `packages/platform/tests/human-check.test.ts` |
| AC3 | Closed until the organizer opens it; viewers can't change it; an event without a plan can't open it; needs the `seat_finder` module; the public map carries only the document and mode | `packages/testing/tests/seat-finder.int.test.ts` |
| AC4 | **No enumeration:** listed and unlisted addresses get the same answer and leave the same rows, events and audit; only listed ones are mailed; median timings within noise | `seat-finder.int.test.ts` |
| AC5 | **OTP lifecycle:** hashed at rest (no column or event carries the code); 5 wrong tries lock it, even against the right code; single use; 10-minute expiry; an unlisted address never verifies; results only after verifying and for 24 h, allowlisted (no names) | `seat-finder.int.test.ts` |
| AC6 | A party sees all its seats; a listed guest without a seat is told so; at most 5 codes per address per hour | `seat-finder.int.test.ts` |
| AC7 | 30 lookups a minute per device and event, then `challenge`; a passed challenge goes through; other devices and the next minute are unaffected; name lookups are limited too | `seat-finder.int.test.ts` |
| AC8 | Name mode: exact full names only (case and spacing aside), partial names find no one; codes are refused in name mode and name lookups in code mode; closing the finder closes the map | `seat-finder.int.test.ts` |
| AC9 | Other orgs can't verify or read a code (RLS); fixture rows for both orgs | `seat-finder.int.test.ts`, `isolation.int.test.ts` |
| AC10 | In the browser: the organizer opens the finder (privacy trade-off shown); the event page shows the venue map with the stage and entrance labelled and the venue guide with positions; zoom by buttons and by keyboard (Tab to the map, `+` `−` arrows `0`); the poster's QR decodes to the finder address, which resolves; `/events/{slug}/attendee` resolves; Arabic renders right to left; no sideways scrolling at 375 px; axe on every screen | `apps/web/e2e/seat-finder.spec.ts` |
| AC11 | In the browser: an unknown email gets the same answer (no code works); a known guest (seated with the M1.7d form) gets a code by keyboard, sees their seat listed, described, highlighted and marked in the guide, after a reload too; bad input messages; a used code is refused; five wrong codes lock it | `seat-finder.spec.ts` |
| AC12 | In the browser: a buyer of two seats (party) sees both seats highlighted | `seat-finder.spec.ts` |
| AC13 | In the browser: name mode finds exact names only; past the limit the challenge appears, blocks until passed, then the lookup works; a viewer sees the settings read-only and a stale page's save is refused; the wedding menu item leads to the settings | `seat-finder.spec.ts` |
