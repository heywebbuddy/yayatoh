# M1.7 — Seating and tables

Roadmap: M1.7; ADR 0012 (layout document + `event_seats`, Postgres holds, lock after first sale); open decision D18 (ADA enforce/warn; seat ceiling — recommended: warn; Konva to 20k). Delivered in increments:

| # | Increment | Scope |
|---|---|---|
| a | Layout model and seat inventory | `@yayatoh/floorplan` (document v1, builders, validation, placement); `seating` module: floor plans, event layouts, event seats, categories, blocks, Postgres holds, lock after first sale, sweeper functions |
| b | Organizer editor | Konva editor (snap, rotate, multi-select, undo, autosave, templates, image underlay) with an accessible list/form alternative |
| c | Seated checkout | buyer seat picker with an accessible list mode, holds tied to the checkout hold, seat printed on the ticket and PDF, seats freed on refund/void |
| d | Organizer assignment | drag a guest, party or attendee onto a table or seat, with a keyboard/list alternative and an unseated queue |
| e | Public venue map and seat finder | entrances, stage and booths; name/email lookup with OTP; poster |
| f | Live availability, seating rules, box office seats | SSE availability feed (Ably adapter behind config), `seating_rules` (accessible seats, seats per order), box office seat choice, moving seated guests, assigned vs blocked, 5,000-seat performance; legacy chart import specified (Phase 2); per-date charts next (with M1.4b occurrences) |
| g | Per-date charts, floor plan image, Seat column | a date may have its own copy of the plan (copy-on-write) with its own seats, holds and sales; the organizer's floor plan image under the plan (upload, two-point scale, opacity, lock, optional faint underlay on the buyer's map); the seat label in the attendee list, its export and the order page |

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

## M1.7f — live availability, seating rules and the seating leftovers (done)

Roadmap M1.7 ("Availability over Ably with SSE fallback; `seating_rules` schema; legacy import"; acceptance "a 5,000-seat map runs at ≥ 50 fps on an iPad profile"), ADR 0009 and 0012, decision D18 ("ADA enforce/warn — **Warn**; tablet yes; Konva to 20k").

### Live seat availability
- **Where changes come from:** statement-level triggers on `seating.event_seats` (insert, update of status/block/price/hold, delete), a row trigger on `seating.seating_rules` and one on an event layout's status `NOTIFY seating_seats` with `"{org}:{event}"`. Postgres sends notifications **on commit only** (a rolled-back hold is never announced) and once per transaction, and the payload never says who. So every path is covered whatever code runs: checkout holds, payment, expiry (the sweeper), refunds and lost disputes (void), blocks, guest assignments (including the `seat_assignment_released` trigger), box office sales, prices, plan edits and rules.
- **The seat feed** (`createSeatFeed` in `seating`; one per server process, fed by one `LISTEN` connection — `listenChannel` in `packages/db`): for an event someone is watching, it re-reads the seats under that org's RLS, diffs them against what it last published and publishes **one coalesced message per burst** (it waits 100 ms after the first change and sends at most one message per event every 500 ms) through the platform **`RealtimePublisher`** port to two **org-scoped** channels:
  - `org:{org}:event:{event}:seats` — public: `{ on: [seat ids], off: [seat ids] }`, never who; `refresh` when seats are priced or repriced or the plan goes on sale (the page reloads its map).
  - `org:{org}:event:{event}:seat-states` — staff: each changed seat's state (available, held, sold, assigned, blocked) and the counts.
  A safety re-read every 15 s (and after the `LISTEN` connection reconnects) repairs anything missed; without `LISTEN` (a pooled connection) it re-reads watched events every 2 s. An event nobody watches is forgotten after 60 s.
- **The realtime port** (`packages/platform/src/realtime.ts`): `memoryRealtimeHub` (in-process fan-out: the SSE endpoints subscribe to it, dev/CI and production) and **`ablyRealtimePublisher`** (REST publish, basic auth; a stub until the owner's Ably account exists) behind config — `REALTIME_PROVIDER=ably` + `ABLY_API_KEY` publishes to both, otherwise SSE only. Channel names are always `org:{uuid}:…` (`orgChannel`, `channelOrg`); `ablySubscribeCapability` builds subscribe-only, org-scoped token capabilities for later. (ADR 0009 names the public channel `public:event:{e}:seats`; it is org-scoped here so a token or stream for one org can never name another org's channel.)
- **Server-Sent Events:** `GET /events/{slug}/seats/stream` (public; the event is the slug's, published and not private, and its map must be on sale), the same path on tenant sites (the proxy rewrites it to `/t/{org}/…` with the host's org, and another org's event is a **404**), and `GET /o/{org}/e/{event}/seating/stream` (organizer: signed in, a member of that org — otherwise 401/404 — and `events:read` on the event: viewers may watch). Each message has an id `{epoch}-{seq}`; a browser that reconnects sends `Last-Event-ID` (or `lastEventId`) and gets what it missed, or a **snapshot** when this server no longer has it (another server, a restart, too old). Limits: 30 connections a minute per device cookie (or user) and event (`platform.rate_limits`), 2,000 open streams per server process; a 20 s keep-alive comment; `retry: 2000`. The device cookie is now also set on public event pages.
- **Buyer's seat picker:** follows the public stream (`data-live` on the list says `connecting`/`live`/`offline`): a seat taken elsewhere goes grey in the list and on the map without a reload; a chosen seat that is taken is **dropped from the choice** and the buyer is told in a polite live region ("Seat Table 1 · 1 was just taken by someone else and is no longer in your choice."). A refused connection is reopened after 2 s, 4 s, … 30 s.
- **Organizer:** the Seating page's counts and the editor's seat colours follow the staff stream; the Assign guests view refreshes itself when seats change.
- **Large rooms:** above 400 seats the list shows each row and table closed ("Row A — 87 of 100 free · 1 chosen"), opening on request by keyboard or pointer; chosen seats in a closed row still post. (5,000 seats: the page is ready in ~2 s instead of ~10 s here.)

### Box office seat choice
- The box office (Tickets & Orders) of a seated event lists seated passes as "choose seats below" and shows the **same seat list and map** as buyers, following the organizer's live stream (so staff see holds and sales as they happen; accessible seats kept back from buyers stay choosable for staff).
- `orders.recordBoxOfficeSale` takes `seats` (≤ 50): the order id is minted first, the seats are held under it and sold to its tickets **in the same transaction**, each ticket keeps its seat label, and the plan locks — all or nothing: a seat held or sold meanwhile → `seats_taken`, nothing is sold (no order, no stock, the other seats stay free). Seated passes by quantity are still refused (`choose_seats`); an empty sale → `empty`; an unpriced seat → `seat_not_on_sale`; seats not on sale → `seats_not_on_sale`. The page reloads its map on `seats_taken` and keeps what was typed.

### Seating rules (`seating.seating_rules`)
- One row per event and kind (tenant table, RLS; `kind`, `severity`, `params` JSON; CHECKs on kind, severity and params type): **`ada_reserved`** `{ releaseDays: 0–365 }` — accessible seats are kept back until that many days before the event starts; **`max_per_order_seats`** `{ max: 1–50 }` — seats in one order (checkout and box office; never when seating guests).
- **Warn** is the default (D18); **Enforce** is the organizer's choice. `evaluateSeatRules` (pure, the same in the browser and on the server) and `checkSeatRulesTx`:
  - **Online checkout:** enforced → refused (`validation_failed` / `seat_rule`, the holds roll back); kept-back accessible seats show as taken on the public map ("Kept back until …"), and the picker stops at the cap ("That's the most one order can have: N seats."). Warn → the buyer is told as they choose ("Table 1 · 1 is an accessible seat, kept for guests who need them…", "3 seats chosen: the organizer asks for at most 2 per order.") and may go ahead.
  - **Box office:** warnings are shown; an enforced rule needs "Sell anyway: this buyer needs these seats (the override is recorded)" — `overrideRules`, audited.
  - **Seating guests:** a guest placed in a kept-back accessible seat → a warning with the seat and date; enforced → automatic placement skips those seats, and choosing one needs "This guest needs an accessible seat" (`overrideRules`, audited).
- **Organizer:** Seating → **Rules** (a new view): the rules in force, and the form (on/off, days or seats, warn/enforce) with field errors from the server ("Enter a whole number of days from 0 to 365."); viewers read only; a stale page's save is refused. Accessible seats are marked in the plan editor's list ("Accessible seats": seat numbers such as "1, 2").
- Commands and queries: `seating.setRules` (`events:write`, needs a plan, replaces the event's rules, audited), `seating.rules` (`events:read`); `publicSeatMap` carries the rules and the event's start (allowlisted), `{ audience: 'staff' }` for the box office.

### Leftovers from M1.7b/d/e
- **Assigned apart from blocked:** the Plan view's counts ("… 1 assigned to guests · 0 blocked"), the editor's colours (a guest's seat in accent, blocked in pink) and a legend of the colours; `EventSeatingDto` has per-seat `state` and `assigned` counts.
- **Moving a seated guest:** "Move to…" beside each seated guest (a small form: table or row, seat, Move / Cancel; keyboard first), dragging their name from a table's list onto the plan, or pressing on their seat on the plan and releasing on another table or seat (mouse, pen or touch — the plan takes touch gestures when you may edit). A move is `seating.assign` for that one person (they leave their old seat in the same transaction).
- **Zoom and pan:** the buyer's map and the editor have Zoom in / Zoom out / Whole room buttons (and Ctrl/⌘ + wheel or trackpad pinch); dragging pans once zoomed in.

### Performance (5,000 seats, iPad profile)
Measured by `apps/web/e2e/seating-perf.spec.ts`: a 50 × 100 plan built through the UI, then panned at 820 × 1180, 2× pixels, touch (iPad Air), best of three 2 s runs each.

What changed: seats are drawn as **one batched path per look** (not one node per seat), **cached as a bitmap** at the current zoom (panning moves the bitmap; it is redrawn when seats change or the zoom does), **culled** to the screen when zoomed in too far to cache (> 4,096 px), and **never listen** (taps are hit-tested in room centimetres), so there is no hit graph to redraw.

| Probe (iPad profile; full-suite gate run) | Seats drawn per frame | Drawing per frame (median / p95) | Frame rate (best of 3) | Same-size blank canvas on this machine |
|---|---|---|---|---|
| Before (M1.7b–e drawing) — editor pan | 5,000 | 6–12 ms | 20.6 fps | — |
| Before — buyer's map pan | 5,000 | ~20 ms | 20.1 fps | — |
| Editor, whole room | 0 (cached) | 1.4 / 9.8 ms | 36.9 fps | 43.1 fps |
| Editor, zoomed 2.6× | 0 (cached) | 1.3 / 6.2 ms | 44.5 fps | 46.1 fps |
| Editor, zoomed 12× | 59 (culled) | 1.2 / 9.2 ms | 38.3 fps | 43.1 fps |
| Buyer's map, whole room | 0 (cached) | 0.3 / 4.6 ms | **54.5 fps** | 54 fps |
| Buyer's map, zoomed 2.6× | 0 (cached) | 0.2 / 1.4 ms | **51 fps** (asserted) | 56.5 fps |
| Editor ready | — | — | 1.4 s | — |
| Buyer's page ready (live) / map opened | — | — | 1.1 s / 0.6 s (before: ~10 s / 3.5–5 s under load) | — |

The CI container renders without a GPU on 4 shared vCPUs (load average 12–24 while other suites ran): there, even a blank canvas of the map's size runs at 18–57 fps, so the frame rates above are the machine's ceiling, not the map's — the map pans at about the blank-canvas rate (the buyer's map above 50 fps whenever the machine allows it) while its own drawing takes 0.2–1.4 ms (median) of a 20 ms (50 fps) frame; earlier runs under heavier load gave 20–39 fps against blank-canvas baselines of 18–45 fps. The test therefore always asserts that panning draws **no seats** at room scale and at 2.6× (a small share when zoomed right in) and that the map's median drawing per frame is ≤ 4 ms, and asserts **≥ 50 fps** whenever the machine can show a blank canvas at ≥ 55 fps (otherwise it records the numbers). A check on a real iPad is in the owner inbox.

### Legacy chart import (specified; built with the Phase 2 migration, M2.x — needs the owner's masked dumps)
- **Source:** Eventmie Pro `seatcharts` (one chart image per ticket type, per date for multi-day events) and `seats` (`ticket_id`, `event_id`, `name`, `position` `"Xpx,Ypx"` or `{left, top}` in the image's natural pixels, `capacity` > 1 = a table, enabled/disabled, hold/booked state), `bookings.seat_id/seat_name`, `attendees.seat`, `distributions.seat`.
- **Target:** one `layout_v1` document per chart: the chart image as the underlay (`underlay.src`, natural size, cm per pixel), one **section per ticket type**, each legacy seat a seat point (or, with `capacity` > 1, a round table with that many seats), `seat_uuid = uuidv5(ns, "{instance}:seat:{id}")` (table seats `"{instance}:seat:{id}:{n}"`), label = the legacy name. Pixels → centimetres with one scale per chart (proposed default 1 px = 2 cm, to be checked against the owner's charts in the M0.4 seat-chart spec; the organizer can rescale; the room is the image's size). Disabled seats → blocked `kill`; the seat's ticket type → its price category.
- **Event seats:** materialized from the imported layout, `locked` when any booking holds a seat; booked seats → `sold` with the migrated ticket; imported guest seats → `seat_assignments` (`pinned`); legacy holds are not migrated (they expire at cut-over).
- **Per-date charts:** one layout per occurrence, once event occurrences exist (M1.4b).
- **Gates:** every seat referenced by a booking, attendee or distribution exists (V4, 0 orphans); every booked seat is `sold` to exactly one ticket; a Playwright screenshot diff of each migrated chart against the legacy image with its seat dots is within tolerance; seat counts per chart and ticket type match.

**Later / not yet**
- **Per-date charts** (a layout per occurrence): **done in M1.7g** (below).
- **Ably in the browser** (token auth with `ablySubscribeCapability`, capability tests in the isolation suite) and a worker-side publisher for events nobody watches on the web: with the owner's Ably account. Until then SSE everywhere; on Vercel, long streams end at the function's maximum duration and browsers reconnect and catch up.
- Best-available seat suggestions, orphan-seat checks and more rule kinds (keep together/apart, must sit at: M4.3 and M6.11/M6.12); overrides needing a manager.
- Pinch-zoom on touch screens (buttons and pan work on touch); the same caching for the Assign guests plan and the SVG venue map (M1.7e) with very large rooms (the editor and the buyer's map have it).
- Stream connection limits use the same Postgres fixed-window counter as the seat finder; Upstash token buckets when the owner account exists.

### Acceptance (M1.7f)
| ID | Criterion | Test |
|---|---|---|
| AC1 | The realtime port: org-scoped channel names only; the in-process hub delivers per channel and survives a failing listener; the Ably adapter posts with basic auth and never throws; config picks SSE unless Ably and its key are set | `packages/platform/tests/realtime.test.ts` |
| AC2 | Live states (assigned apart from blocked), public availability (priced seats; kept-back accessible seats off when enforced), pricing key, diffs, **delta coalescing**; the feed coalesces bursts, throttles to one message per interval, asks for a refresh on repricing, replays after Last-Event-ID or snapshots, ignores other orgs and malformed notifications, forgets unwatched events, re-reads on resync and poll | `packages/modules/seating/tests/live.test.ts` |
| AC3 | **Rules evaluation:** release date; accessible seats while kept back; seats per order at checkout and box office but never assignment; only enforced hits block; staff may override, buyers never | `packages/modules/seating/tests/rules.test.ts` |
| AC4 | **Published on every state change**, after commit only: checkout hold, payment (staff only), refund, expiry sweeper, block/unblock, guest assign/unassign, box office sale, repricing (refresh), plan put on sale, enforced/warn rules; not on a hold extension or a rolled-back hold; a burst becomes ≤ 3 messages; Last-Event-ID replay; **no cross-org attach** (another org can't watch, the organizer stream needs membership and `events:read`) | `packages/testing/tests/seat-live.int.test.ts` |
| AC5 | Box office seated sale: **atomic** (tickets carry seats, plan locks), quantities for seated passes and empty sales refused, a seat held online makes the whole sale fail with nothing sold, a race has one winner, unpriced seats refused, enforced rules need the (audited) override, viewers and other orgs can't sell | `packages/testing/tests/box-office-seats.int.test.ts` |
| AC6 | Rules: set, read, replace, switch off (audited); bad values, duplicates, events without a plan, viewers and other orgs refused; the public map carries them allowlisted; checkout enforce/warn for both kinds; released seats sell; assignment warnings, automatic placement skipping kept-back seats and the override; fixture rows for both orgs | `packages/testing/tests/seat-rules.int.test.ts`, `isolation.int.test.ts` |
| AC7 | In the browser (two contexts): a seat bought in one disappears live from the other's list and map without a reload; a chosen one is dropped with the polite notice; the organizer's counts update live and the colour legend shows assigned apart from blocked; a dropped connection reconnects and catches up; tenant sites stream only their own org's events (404 otherwise), events without seats on sale have no stream, the organizer stream answers 401 signed out, 404 to other orgs' members and 200 to viewers; axe | `apps/web/e2e/seat-live.spec.ts` |
| AC8 | In the browser: the box office sells a chosen seat (keyboard), refuses an empty sale keeping what was typed, the ticket shows the seat and the seat is taken; a seat taken online drops live from one box office screen and is refused (nothing sold) on a stale one; an enforced rule needs the override; viewers have no box office and a stale page's sale is refused; Arabic RTL; axe | `apps/web/e2e/box-office-seats.spec.ts` |
| AC9 | In the browser: rules page (no plan, empty, field errors, saved and persisted, viewer read only, stale save refused, Arabic RTL); buyers warned as they choose and able to continue; enforced rules take a kept-back seat away live and cap the choice with a notice; the assign view warns and, when enforced, asks for "This guest needs an accessible seat"; axe | `apps/web/e2e/seat-rules.spec.ts` |
| AC10 | In the browser: "Move to…" by keyboard (focus, errors, cancel, persisted), the plan's counts show the guest as assigned, not blocked, viewers can't move; drag a seated name onto another table and a guest's seat onto another seat on the plan; Arabic RTL; axe | `apps/web/e2e/seat-move.spec.ts` |
| AC11 | **5,000-seat plan at the iPad profile:** panning the editor and the buyer's map draws no seats per frame at room scale and 2.6× (few when zoomed right in), the map's median drawing per frame ≤ 4 ms, ≥ 50 fps wherever the machine can show a blank canvas at ≥ 55 fps; the large-room list opens rows by keyboard and keeps a seat chosen in a closed row | `apps/web/e2e/seating-perf.spec.ts` |
| AC12 | The seated checkout race still has one winner when the loser's live stream is down (server-side guarantee) | `apps/web/e2e/seated-checkout.spec.ts` |

## M1.7g — per-date charts, floor plan image and the Seat column (done)

Roadmap M1.7 ("per-date charts"; "Konva editor … image underlay"), M1.7f's "per-date charts next (with M1.4b occurrences)", M1.8f's "the attendee list's Seat column still shows —". Migration `0060_third_gambit.sql` (renumbered at merge). Risk tags: `db-migration`, `tenancy`.

### Per-date charts
- **Model.** A *chart* is an event layout with its seats and guest seats. `event_layouts`, `event_seats` and `seat_assignments` gain `occurrence_id` (the chart key): **null = the event plan** (every date without a chart of its own; single-date events always), otherwise the date that has its own copy. Uniques become partial per chart (seat ids repeat on a copy: that is what lets the same seat sell on two dates). `event_layouts.occurrence_id` has a composite FK to `events.occurrences` (dates are cancelled, never deleted).
- **Resolution.** Everything that takes a date resolves it to its chart (`chartKeyTx`: its own, else the event plan): the buyer's seat map and checkout holds and sales (`orders.startCheckout` passes the order's date; payment after expiry re-holds on the same chart), the box office, seating rules (enforced keep-backs count "days before" from the **date's** start), guest seating (one-by-one, groups, bulk, undo), the live seat feed and SSE streams (`?date=`), and the public seat finder and venue map (`?date=`). Nothing in the chart model reads another module's schema.
- **Copy-on-write** — `seating.giveDateOwnChart` (`events:write`, audited): the date's chart starts as a copy of the event plan: drawing, every seat's price category, organizer blocks (channel, accessibility, kill) and group blocks with their names; a guest's seat comes back with the block it had before the guest (pure `copySeat`, unit-tested). Never holds, sales or guests. The copy is on sale when the plan is (a locked plan's copy is published, not locked). Refused: the date isn't the event's (`not_found`), is cancelled (`date_cancelled`), already has a chart (`date_has_chart`), or any seat of the event plan is **held or sold for that date** — or for an unknown date (`seats_in_use`). To know that, a seat of the event plan held for a date records it (`event_seats.held_for_occurrence_id`, set with the hold, cleared on release, expiry and void; CHECK: only on held/sold seats of the event plan; the migration backfills it from ticket and order dates).
- **Locking follows the existing rules, per chart.** Selling on a date's chart locks that chart only; a locked chart can't be replaced or removed. `seating.removeDateChart` (`events:write`, category `delete` — it unseats the guests on that chart) sends a date back to the event plan while nothing is held or sold on its chart.
- **Default and backfill:** existing events keep working unchanged — every existing layout is the event plan (`occurrence_id` null) and "one plan for all dates" keeps today's single inventory (see the owner inbox for the alternative).
- **Console.** Seating → Plan and Assign guests show **Seating chart by date** (links with `aria-current`): the event plan and each date ("Own chart" / "Uses the event plan" / "Cancelled"). A date's card says which it uses and offers **Give this date its own chart** or **Use the event plan for this date**, with the server's refusal in words. The tabs keep `?date=`. The box office of an event with date charts picks the date first (**Seats for date**) and then sells that date's seats; without one chosen it sells the dates on the event plan. The attendee list's bulk **Assign seats** gets **For the date** when dates have their own charts.
- **Messages:** `seatingDates.*`, `bulk.seatDate`, `bulk.seatDatePlan`.

### Floor plan image (underlay)
- **Upload** through the M1.4e media pipeline (new slot `floorplan` for events, ≤ 20 per event: sniffed, re-encoded, EXIF stripped, org-scoped storage; `assets_slot_check` / `assets_owner_slot_check` widened `NOT VALID` + `VALIDATE`). The upload route returns the image's size and file for the editor; it is stored as decorative (the plan's list is its text alternative).
- **Document** (`@yayatoh/floorplan`, additive): `underlay` = `url`, `mediaId`, natural size (`imageWidth/imageHeight` px), place and size in centimetres (the scale), `opacity` (0.1–1, default 0.5), `locked`, `showOnMap` (default off). The server accepts only `/media/{its own org}/{asset}/{file}` (`underlay_url`), so a plan can never make a browser fetch anything else.
- **Two-point calibration** (`calibrationScale`, `scaleUnderlay`, `roomToImage`, pure and unit-tested): two points on the image and the real distance in metres → centimetres per pixel; problems are named (`points_too_close` < 5 px, `distance_out_of_range` 0.01–10,000 m, `point_outside_image`). **Keyboard/numeric alternative:** the points are number fields (pixels from the image's top-left); **Mark A/B on the plan** fills them from a click or tap on the canvas (the plan then only marks, nothing moves) and the marks are drawn on the plan. Position fields, an opacity slider (keyboard steps of 5 %), **Lock the image** (disables position, scale and remove), **Show it faintly on the buyer's seat map**, **Remove the image**. Everything autosaves with the plan (and is refused once the chart is locked).
- **Buyer's map:** the image is drawn under the seats at 25 % opacity only when shown. **Serving:** `media.serve_target_v2` returns the slot; the media route serves a `floorplan` file publicly only while a chart on sale shows it (`publicUnderlayShown`), cached for 5 minutes (not a year: the organizer may hide it again); otherwise only the org's members get it. Floor plan images never appear in the event's gallery (`publicMedia` leaves the slot out).
- **Messages:** `seatingUnderlay.*`.

### The Seat column
- `seating.attendeeSeatLabels` / `attendeeSeatLabelsTx` (`attendees:read`): each attendee's seat **for their date** — the seat bought with their ticket, else the organizer's seat on the chart their ticket's date uses (people without a date: the event plan, else the chart they sit on), with the section first ("Stalls · Row A · 5", "Table 3 · 2"). `ticketing.ticketSummaries` gains the ticket's date (`occurrenceId`, additive).
- **Attendee list:** the Seat column and the profile panel show it (previously "—"). **Exports:** `reports.attendeesCsv` gains a last column `seat` (`exportColumns.seat`, 13 locales). **Organizer order page:** a Seat column per ticket (`seating.ticketSeatLabels`; the order detail's tickets gain `occurrenceId`, additive).

### Migration `0060_third_gambit.sql` (expand only)
- New nullable columns: `seating.event_layouts.occurrence_id`, `seating.event_seats.occurrence_id`, `seating.event_seats.held_for_occurrence_id`, `seating.seat_assignments.occurrence_id`; new partial unique indexes per chart and `event_seats_org_held_for_idx`.
- Hand-written (between `-- hand-written: begin/end`): (1) statements reordered so the new partial unique indexes exist **before** the four old unique indexes (`event_layouts_org_event_key`, `event_seats_org_event_seat_key`, `seat_assignments_org_event_attendee_key`, `seat_assignments_org_event_seat_key`) are dropped — they are replaced by partial indexes enforcing the same rule on the event plan, never a data change; (2) `event_layouts_occurrence_fk` → `events.occurrences (org_id, id)` `NOT VALID` + `VALIDATE`; (3) backfill of `held_for_occurrence_id` from ticket and order dates; (4) `event_seats_held_for_check`, `assets_slot_check`, `assets_owner_slot_check` `NOT VALID` + `VALIDATE`; (5) SECURITY DEFINER `media.serve_target_v2` (REVOKE from PUBLIC, GRANT to `app_user`; v1 stays until the contract step); (6) `CREATE OR REPLACE` of `seating.seat_assignment_released()` to free the seat on the assignment's own chart.
- The legacy importer's T3 seating `ON CONFLICT` now names the event plan's partial index.

### Later / not yet (M1.7g)
- **Per-date inventory with one shared drawing** (a theatre run without a copy per date): see the owner inbox; today each such date gets its own copy.
- A bulk "give every date its own chart"; editing several date charts at once; importing legacy per-date charts (Phase 2, with the M2 ELT).
- The unseated queue on a date's chart lists every active attendee (the seating module can't read ticket dates, a same-tier module); people are placed on the chart you choose.
- Changing the image under a locked chart (today the whole plan is read-only once sold); cleaning up replaced floor plan images; drawing the image under the SVG venue map and the Assign guests plan (the editor and the buyer's map have it); rotating the image.
- Legacy seats sold before this change on events that later got dates have no recorded date, so those dates can't get their own chart while such a seat is sold (conservative by design).

### Acceptance (M1.7g)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Copy-on-write mapping: prices, accessibility and organizer/group blocks copied; holds, sales and guests never (a guest's seat gets its prior block back); public maps carry the image only when shown | `packages/modules/seating/tests/date-charts.test.ts` |
| AC2 | Calibration math: scale from two points and metres, every problem named, scaling keeps the corner, room → image pixels, old underlays still parse with the new defaults | `packages/floorplan/tests/calibrate.test.ts` |
| AC3 | Live feed: a date's chart has its own channels; another date without a chart joins the event plan; one notification re-reads every watched chart | `packages/modules/seating/tests/live.test.ts` |
| AC4 | **Per-date inventory isolation:** by default one inventory (and the sale's date recorded); a date gets its own copy (prices, blocks; published, not locked); refused twice, for foreign and cancelled dates; the same seat sells on both dates (two sold rows), the date's chart locks alone; holds per chart; a plan hold for a date blocks that date's copy; box office per date | `packages/testing/tests/date-charts.int.test.ts` |
| AC5 | Guests per date: one-by-one, both charts at once, unseating on one chart leaves the other; bulk assign per date (partial failures) and undo on that chart only; groups per chart; Seat labels (section first) in the query, the ticket query and the export | `date-charts.int.test.ts` |
| AC6 | Editing a date's chart changes only it; back to the event plan while unsold; locked charts can't be removed or replaced | `date-charts.int.test.ts` |
| AC7 | Permissions and isolation: viewers read but can't give or remove; other orgs see nothing (queries, public map, commands); viewers can't upload floor plan images; `removeDateChart` is refused while impersonating (`delete`) | `date-charts.int.test.ts`, `impersonation.int.test.ts` |
| AC8 | Floor plan image: the media pipeline stores it in the `floorplan` slot, never in the gallery; only the org's own media URLs are accepted; hidden from buyers until shown; served publicly only while shown, never to another org | `date-charts.int.test.ts` |
| AC9 | In the browser: give date 2 its own chart **by keyboard**, persisted; the same seat sells on both dates and is taken on each; the attendee list shows both buyers' seats; a locked date chart can't go back (reason shown); Arabic RTL; axe | `apps/web/e2e/date-charts.spec.ts` |
| AC10 | In the browser: a date back on the event plan; the box office sells the chosen date's seats (free on the other date); guest seating follows `?date=`; a viewer sees the charts without controls and a stale page's change is refused | `date-charts.spec.ts` |
| AC11 | In the browser: upload (and the empty-file error), calibrate **by keyboard** through every validation error to 2 cm/px, mark a point on the plan, opacity by keyboard, lock, persisted; the buyer's map has no image and the file is private until shown, then both; Arabic RTL; axe; a viewer has no controls and a stale page's upload is refused | `apps/web/e2e/seating-underlay.spec.ts` |
| AC12 | In the browser: the Seat column shows a guest's seat, "—" and a buyer's seat; the profile panel; the CSV's Seat column; the order page's Seat column; a viewer sees seats but can't export and a stale export is refused; Arabic RTL; axe | `apps/web/e2e/seat-column.spec.ts` |
