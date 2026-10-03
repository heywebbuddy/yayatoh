# Spec: M4.4 — Seat finder, kiosk and day-of

- **Milestone:** M4.4 (roadmap §10 Phase 4, "M4.4 Seat finder, kiosk and day-of (M)"; Phase 4 plan `docs/plans/phase-4.md`, Wave C)
- **Status:** M4.4a built (2026-10-03: the guest seat finder); M4.4b built (2026-10-03: kiosk, TV board, check-in and the day-of view)
- **Risk tags:** `db-migration`, `tenancy`, `mobile-contract` (M4.4b: additive `/v1` heartbeat field)
- **Related ADRs:** 0012 (seating), 0018/0022 (tokens, design v2)

## M4.4a — guest seat finder (built 2026-10-03)

### 1. Goal and users
On the day, a wedding or gala guest finds their table on their phone. With the QR code on their
invitation (or escort card) they see their table on the venue map and who sits with them; with a
paper invitation and no QR code, their full name and the PIN printed on it give them their table.
Nobody who isn't signed in through their party's own link ever sees a name, and nobody can find
out who is on the guest list.

### 2. References
- **Plan:** `docs/plans/phase-4.md` row M4.4a ("The existing seat finder extended for guests: a permanent QR code, map highlight, a PIN mode, and tablemates for guests signed in through their party link only (P4-3)"). Acceptance: "Unauthenticated lookups never show names; there is no enumeration".
- **Decisions:** P4-2 (party magic link, QR, strict name + PIN, rate limits and a human check, never a guest list), P4-3 (d) (tablemates only for guests signed in through their party link, as the names the host chose).
- **Built on:** M1.7e (venue map, seat finder, device budget and human check), M4.1d (party links and PINs, `findRsvpByName`'s uniform matching), M4.3a (guest seating, `guest_seats`, the `OccupantDirectory` port), M1.14 (limiter), M4.2b (table sponsors).
- **Legacy evidence:** none (Eventmie Pro's attendee seat finder has no parties or tablemates).

### 3. Scope
**In (built):**
- **The party's seat page `/rsvp/{token}/seat`** (public, `noindex`, mobile first): reached by the party's own signed link, so the QR code of that link is **permanent**: it always shows the party's current table, however the host moves it (a "Reset link" on the party's RSVP page revokes it, like the RSVP itself). For every chart the party has a place on (the event plan; each sub-event it is invited to, on the chart that sub-event uses) it shows each table or row with "Table 3" large, the hosted table's sponsor, where it is on the map and the nearest entrance, **who of the party sits there**, and its **tablemates** (the other parties' guests at that table or row, as the host named them; an unnamed plus-one is "Guest of …"; declined guests are left out). The table is **highlighted on the venue map** (a ring around it, the map opening zoomed on it) and marked "Your table" in the venue guide (the map's text alternative). Until the organizer opens the seat finder the page says "Seating isn't ready yet"; a party not seated yet is told its table isn't set. Bad, reset, forged or expired links 404.
- **The RSVP page** shows a "Find your table" card (→ "Show my table") once the party is seated and the finder is open.
- **PIN mode** (a third "How guests look up their seat" option on Seating → Seat finder, with the guests module: "By full name and the PIN on their invitation"): on `/events/{slug}/seat-finder` the guest types their exact full name and the party's six-digit PIN (the M4.1d PIN). The answer is the party's tables (per chart), highlighted on the map, with **how many of the party sit at each: never a name**, not even the guest's own. Unknown, partial or misspelled names and wrong PINs get one answer ("We couldn't find a table with that name and PIN…") after the same work (`matchPartyByNamePinTx`, now shared with the RSVP paper fallback). Limits: M1.14 `rsvpLookup` per device and per event, then the human check; plus the seat finder's own 30 a minute per device (`challenge`). The poster's steps read "Enter your full name and the PIN on your invitation."
- **Host side:** the party's RSVP page (`/guests/rsvp/{party}`, `guests:write`) has a **Seat page QR code** section: the link (copy) and its QR code, with a note while the finder is closed. Seating → Seat finder gains the PIN option and a **Party links** pointer to the RSVP links page. Viewers see neither link nor QR code.
- **The `PartyCredentials` port** (roadmap §3.5, as `OccupantDirectory`): seating defines it (`partyByLinkTx`, `partyByNamePinTx`) and never imports guests; guests implements it (`guestsPartyCredentials`); the web app's and the test ports' composition roots register it (`setPartyCredentials`).
- **Map highlight for tables:** `VenueMap` and `VenueGuide` take `highlightItems` (tables or rows; guest places are table-level).

**Later / not yet:**
- Kiosk/display mode with an offline snapshot, the A–Z TV board, check-in by name and the day-of host view (M4.4b).
- The seat-page QR code on escort and place cards (M4.3b cards are a separate increment; the link is ready for them).
- An event-wide PIN (pending owner; see the owner inbox), a per-guest display name, phone lookup.
- The PIN page for private events and on tenant custom domains (the party page works for private events already).

### 4. `touches:`
```yaml
touches:
  - packages/modules/seating/src/{guest-finder.ts,domain/guest-finder.ts}            # new
  - packages/modules/seating/src/{schema.ts (FINDER_MODES + 'pin'),seat-finder.ts (2 exports),guest-seating.ts (viewTx exported),index.ts}, MODULE.md
  - packages/modules/guests/src/seat-finder-party.ts                                 # new
  - packages/modules/guests/src/{rsvp.ts (matchPartyByNamePinTx extracted, linkPartyTx exported),index.ts}, MODULE.md
  - packages/db/drizzle/0114_thankful_skaar.sql (+ meta; renumbered at merge)
  - packages/testing/src/{ports.ts,guest-seat-finder.ts,index.ts}, tests/guest-seat-finder.int.test.ts
  - packages/modules/seating/tests/guest-finder.test.ts
  - apps/web/src/server/ports.ts
  - apps/web/src/app/[locale]/rsvp/[token]/{page.tsx,seat/page.tsx}
  - apps/web/src/app/[locale]/events/[slug]/seat-finder/{page,actions}.ts(x), poster/page.tsx
  - apps/web/src/app/[locale]/o/[org]/e/[event]/seating/{actions.ts,finder/page.tsx}
  - apps/web/src/app/[locale]/o/[org]/e/[event]/guests/rsvp/{links.ts,[party]/page.tsx}
  - apps/web/src/components/{guest-seat-finder,guest-places,venue-map,venue-guide}.tsx
  - apps/web/messages/*.json
  - apps/web/e2e/guest-seat-finder.spec.ts
  - docs/specs/M4.4/spec.md, docs/owner-inbox.md
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `seating.event_layouts` | `finder_mode` CHECK widened | `code`, `name`, `pin` (v2 constraint added `NOT VALID`, validated, old dropped, renamed) |

No new tables, no new text columns. Fixtures unchanged (no new tenant table).

**Migration:** `0114_thankful_skaar.sql` (expand only; renumber at merge). Entirely hand-written (between `-- hand-written: begin/end`): the widened CHECK as add v2 `NOT VALID` → `VALIDATE` → drop old → rename, so the table is never without the check.

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Routes:** `/rsvp/{token}/seat` (public, `noindex`; under the front door's `/rsvp` prefix).
- **Queries/commands** (entitlement `seat_finder`, permission `public:seat_finder`): `seating.partySeats` (query; allowlist `PartySeatsDto`), `seating.findGuestSeatByPin` (command; allowlist `GuestSeatResultDto`: labels, counts and the plan only; audit `seating.finder_pin_lookup` with the status). `seating.setFinderSettings` accepts `mode: 'pin'`.

### 7. Events
None.

### 8. Entitlements and flags
Module `seat_finder` (wedding profile); PIN mode is offered with the `guests` module. Rate-limit policy `rsvpLookup` (scope `seat-finder-pin`). No flag.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.4a-01 | **Unauthenticated lookups never show names:** a PIN hit carries tables, counts and the plan only; the public venue map carries no names; the PIN page shows no guest's name, not even the party's own | `packages/testing/tests/guest-seat-finder.int.test.ts` ("…labels and counts, never a name", "the public venue map…"); e2e `apps/web/e2e/guest-seat-finder.spec.ts` ("PIN mode: tables and counts only…") |
| AC-M4.4a-02 | **No enumeration:** wrong PIN, partial, misspelled, unknown name and another party's guest all get `no_match`, same timing class (medians within 4×); identical page text; a reset PIN stops working | int ("every miss is the same answer…"); e2e ("…every miss reads the same") |
| AC-M4.4a-03 | Past the limits the human check comes first (device budget `challenge`; M1.14 limiter in the page) | int ("past the device budget…"); e2e ("PIN mode: past the limit…") |
| AC-M4.4a-04 | PIN mode only when the finder is open in PIN mode; another org's event is unknown | int ("is refused unless…") |
| AC-M4.4a-05 | **Tablemates only through the party's own link:** its places per chart, its own guests, tablemates as the host named them ("Guest of …"), declined guests left out, other tables never shown; a sub-event seated apart is its own named chart | int ("sees its tables…", "a sub-event seated on its own…"); unit `packages/modules/seating/tests/guest-finder.test.ts`; e2e ("a party's link shows its table…") |
| AC-M4.4a-06 | **Permanent QR:** the host's party page shows the seat-page QR code; it decodes to `/rsvp/{token}/seat` and stays the same when the finder opens; a reset or forged link finds nothing | e2e ("the host's party page…", "…forged links 404"); int ("a link works for its own party only…") |
| AC-M4.4a-07 | **Map highlight:** the party's table is ringed on the map and marked "Your table" in the venue guide (PIN result too) | e2e (`data-highlight-item`, `data-your-place`) |
| AC-M4.4a-08 | Closed finder: "Seating isn't ready yet" and no RSVP card; unseated party: "Your table isn't set yet" | int ("sees nothing about tables until…"); e2e ("until the seat finder opens…") |
| AC-M4.4a-09 | Settings: PIN mode chosen by keyboard, saved, kept after reload; poster wording; viewers see no QR code and no settings controls | e2e ("the host's party page…") |
| AC-M4.4a-10 | Keyboard only (RSVP → seat page → map keys → back; PIN form typed and sent with Enter; start over), axe in light and dark on every new screen and state, Arabic RTL | e2e (all; "Arabic…") |

### 11. Security and privacy
- The party's signed link is the only credential that returns names; its org comes from the M4.1d SECURITY DEFINER lookup (`rsvpLinkRef`), never from a header. A reset link fails at once.
- PIN lookups: exact names only, one answer for every miss, the same work (every named guest read and compared in memory, a PIN always compared, a dummy one on a miss), per-device and per-event limits, the human check past the budget. The answer is an allowlist with no names.
- Nothing is public until the organizer opens the seat finder; P4-3: nothing here creates contacts or marketing data.

### 12. Performance budget
A party page reads the event's charts once per sub-event (`viewTx`: parties, places, ≤ 3,000 guests); a PIN lookup does the M4.1d matching work, then the same for a hit.

### 15. Demo checklist
- [ ] As `pani@lakeside.test`, a wedding with a plan (2 tables), parties seated in Seating → Seat guests, RSVP links created.
- [ ] Guests → RSVP → a party: **Seat page QR code** (note: closed). Seating → Seat finder: tick "Show guests…", choose **By full name and the PIN on their invitation**, Save.
- [ ] Scan the party's seat QR on a phone: the table ringed on the map, "From your party", "Also at this table".
- [ ] Publish the event, open the seat finder: wrong PIN and unknown name give the same answer; the right name and PIN show "Table 1 · 3 of your party sit here", no names.

### Gate (2026-10-03)
- Base: `origin/m0.5-foundation-ey5gqp` + `origin/merge/next-3g` + `origin/merge/next-3h` (design v2 included) + `origin/agent/m4.3a`; re-merged the latest next-3g and next-3h before the gate (clean).
- `pnpm lint`, `pnpm check:modules`, typecheck 59/59 (`--concurrency=2`), unit 2701/2701 (202 files), integration 1519/1519 (166 files).
- E2E at 375/768/1280 (`--workers=2`): `guest-seat-finder` 18 passed; `seat-finder`, `seat-poster`, `rsvp`, `rsvp-questions`, `gala-tables`, `assistance`, `guest-invites` 117 passed; `canary-crawl` 7 passed (14 skipped by design).

## M4.4b — kiosk, TV board and check-in (built 2026-10-03)

### 1. Goal and users
On the day, the host's team checks wedding and gala guests in by name or party (no tickets
needed), a tablet at the door lets guests find their table and check themselves in, a TV shows an
A–Z table board, and the host sees who has arrived, who still has no table and how many of each
meal to plate. All of it keeps working when the venue's internet drops.

### 2. References
- **Plan:** `docs/plans/phase-4.md` row M4.4b ("Kiosk/display mode with an offline snapshot and PIN exit (`kiosk_operator`). An A–Z TV board. Guest check-in by name or party with labels in the Scan PWA. A day-of host view: arrivals, unseated guests, meal counts"). Acceptance: "The kiosk keeps working after the network is cut (offline drill in Playwright)".
- **Decisions:** P4-3 (guest data: names as the host wrote them, never a private answer; nothing reaches marketing), P4-8 (planners get day-of; co-hosts everything on their event).
- **Built on:** M1.9 (Scan PWA, sealed offline store, device tokens), M3.4a (kiosk mode, PIN exit by WebCrypto, supervisor mode), M4.1 (parties, labels, RSVP, menu), M4.3a (guest seating; `viewTx`), M4.4a.
- **Legacy evidence:** none (Eventmie Pro has no guest-list check-in, kiosk or table board).

### 3. Scope
**In (built):**
- **Guest snapshot for devices** (`checkin.guestSnapshot`, `GET /api/scan/guests`, device token only): every party (name, the host's free-text labels) with its guests (first/last name, display name or "Guest of …", whole-event RSVP status, places on every chart: event plan and each sub-event's, with table/row kind and label, arrival time). An allowlist: no contact detail, meal, dietary, accessibility, address or note. Sealed in IndexedDB with the device token like the ticket manifest; refreshed with every sync.
- **Guest check-in in the Scan PWA** (a **Guests** mode next to Scan/Staff/Supervisor when the event has a guest list): search by a guest's **or** party's name (accents and case aside), **label filter chips** (`aria-pressed`, every chosen label required), per-guest **Check in** and **Check in everyone in {party}**, the table on every row, "Arrived {time}", declined guests marked (staff may still let them in), "{arrived} of {expected} arrived". Instant and offline: arrivals queue with the ticket scans ("n scans waiting to sync") and sync with `POST /api/scan/guests` → `checkin.recordGuestArrivals`.
- **Arrivals** (`checkin.guest_arrivals`): one per guest, **first wins on corrected time** (device time + measured clock offset, never later than now), idempotent per `clientId` (a resend is a no-op), unknown guests answered `unknown`; batches of an event serialized by a transaction advisory lock (like M3.4a's scan sync).
- **Kiosk kinds:** `checkin.startKiosk` takes `kind`: `tickets` (M3.4a, the default), **`guests`** (the guest kiosk) or **`board`** (the A–Z table board; no entrance). The heartbeat hands the kind to the device (`kiosk.kind`, additive on `/v1`); supervisor mode gets a "Kiosk screen" choice and shows the kind.
- **Guest kiosk:** large targets, the name field focused; the guest types their **exact full name**: one guest, not declined → "Welcome, {name}!", "Your table: Table 2" (every chart), checked in; again → "Welcome back"; an unseated guest is checked in and told to see staff about the table; partial names, unknown names → "We couldn't find that name…"; shared names and declined guests → "Please see a member of staff." Never a list, never another guest's name. Offline from the snapshot; answers clear after 10 s.
- **A–Z table board:** seated, named, not-declined guests by **last name** (then first name), grouped by letter (accents folded; "#" last), name and table(s), in 1/2/3 columns by screen width, pages sized to the screen that turn every 15 s (Pause / Next page for staff), "Page n of m". Unnamed plus-ones, unseated and declined guests are not on it. Offline from the snapshot; follows each sync.
- **PIN exit** on both (the M3.4a pad: checked on the device, offline too, 5 misses lock 30 s; the exit is reported later).
- **Day-of host view** `/o/{org}/e/{event}/day-of` (wedding nav item `dayOf`, module `checkin`; `guests:read` to see it): stat cards (arrived of expected with progress, not here yet, without a table, declined), **Check a guest in** (search by guest or party name, `checkin:scan`), **Arrivals** (time in the event's zone, guest, party, table, checked in by scanner / guest kiosk / host, **Undo**), **Guests without a table** (with "Seat guests"; "No floor plan yet" without a chart), **Meals** (attending guests by meal choice, arrived of them; "No choice yet"), **Guest kiosk and table board** (`checkin:kiosk`: add a device, start it as the guest kiosk or the board with a PIN validated inline, stop it). Success messages in one polite live region; refresh every 15 s.
- Removed `day-of` from the readiness placeholder sections (the page exists now).

**Later / not yet:**
- Printed labels or badges at check-in (M5.5 badges; "labels" here are the host's party labels, see the owner inbox).
- Realtime push of arrivals to the day-of page (it re-reads every 15 s), arrivals per sub-event, check-out.
- Offline reload of the board in airplane mode is covered by the M1.9 service worker but tested manually (the drill cuts the network on a running kiosk and board).
- A dedicated display-only device type (the board is a kiosk kind on a Scan PWA device).

### 4. `touches:`
```yaml
touches:
  - packages/checkin-engine/src/{guests.ts,index.ts}, tests/guests.test.ts                 # new (shared with the PWA)
  - packages/modules/checkin/src/{guest-checkin.ts (new),schema.ts,staff-mode.ts,devices.ts,routes.ts,private-columns.ts,index.ts}, package.json (+guests, seating)
  - packages/modules/seating/src/{guest-day-of.ts (new),index.ts}
  - packages/modules/guests/src/{day-of.ts (new),index.ts}
  - packages/modules/command-center/src/domain/readiness.ts (day-of no longer a placeholder)
  - packages/db/drizzle/0115_special_enchantress.sql (+ meta; renumbered at merge)
  - packages/testing/src/{guest-checkin.ts (new),fixtures.ts,index.ts}, tests/guest-checkin.int.test.ts
  - apps/api/openapi.json, packages/sdk/src/schema.ts (heartbeat kiosk.kind)
  - apps/web/src/app/api/scan/guests/route.ts                                              # new
  - apps/web/src/app/[locale]/o/[org]/e/[event]/day-of/{page.tsx,actions.ts}               # new
  - apps/web/src/components/{scan-guests,scan-guest-kiosk,day-of}.tsx (new), scan-app.tsx, scan-kiosk.tsx (PinPad exported), scan-supervisor.tsx
  - apps/web/src/scan/{guests.ts (new),client.ts}, src/server/scan-supervisor-actions.ts
  - apps/web/messages/*.json, apps/web/tests/event-routes.test.ts (day-of section)
  - apps/web/e2e/guest-checkin.spec.ts
  - docs/specs/M4.4/spec.md, docs/owner-inbox.md
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `checkin.guest_arrivals` | new tenant table | `event_id`, `guest_id`, `arrived_at`, `source` (`scanner`/`kiosk`/`host`), `device_id`, `recorded_by`, `client_id`; unique `(org_id, guest_id)` and `(org_id, client_id)`; index `(org_id, event_id, arrived_at)`; CHECKs on `source` and "host ⇒ no device"; FORCE RLS + the NULLIF policy |
| `checkin.devices` | `kiosk_kind text` (nullable = tickets) | CHECK `kiosk_kind in ('tickets','guests','board')` |

Fixture rows for both orgs (`createOrgFixture`: the door device checks the wedding host in). Private columns: `guest_arrivals.source`, `devices.kiosk_kind` → `vocab`.

**Migration:** `0115_special_enchantress.sql` (expand only; renumber at merge). Hand edits (between `-- hand-written: begin/end`): (1) `devices_kiosk_kind_check` added `NOT VALID` then `VALIDATE CONSTRAINT` (existing table); (2) foreign keys `guest_arrivals_event_fk` → `events.events` (cascade), `guest_arrivals_guest_fk` → `guests.guests` (cascade), `guest_arrivals_device_fk` → `checkin.devices` (`ON DELETE SET NULL (device_id)`). The `guest_arrivals_device_check` was relaxed by hand in the generated SQL, the schema and the snapshot alike (`source <> 'host' or device_id is null`) so a removed device can't break the FK's SET NULL.

### 6. API diff
- **`/v1`:** additive: `POST /devices/heartbeat` response `kiosk.kind` (optional enum `KioskKind`). OpenAPI and SDK regenerated; Spectral clean. **`/api/v2`:** none.
- **Device routes (web, bearer device token):** `GET /api/scan/guests?eventId=` (snapshot), `POST /api/scan/guests` (arrivals).
- **Queries/commands** (entitlement `checkin`): `checkin.guestSnapshot` (device; `GuestSnapshotDto`), `checkin.recordGuestArrivals` (device; audit `guest.arrivals_synced` with counts), `checkin.markGuestsArrived` (`checkin:scan`; audit `guest.arrived`), `checkin.undoGuestArrival` (`checkin:scan`; audit `guest.arrival_undone`), `checkin.dayOf` (`guests:read`; `DayOfDto`), `checkin.startKiosk` (+ `kind`; audit data + `kind`, never the PIN).

### 7. Events
None (arrivals are not ticket admissions; the day-of page re-reads).

### 8. Entitlements and flags
Module `checkin` (the wedding nav's `dayOf` item already requires it; wedding `defaultModules` don't list it — see the owner inbox). Permissions unchanged: `guests:read` (view), `checkin:scan` (check in, undo), `checkin:kiosk` (start/stop kiosks; `kiosk_operator`, co-hosts).

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.4b-01 | **The kiosk keeps working after the network is cut:** guest kiosk and board started from the day-of page; both devices offline; the board lists A–Z with tables; the kiosk checks guests in by full name (found, partial, declined, again, unseated); PIN exit offline; back online the arrivals reach the host once, as "Guest kiosk" | e2e `apps/web/e2e/guest-checkin.spec.ts` ("guest kiosk and A–Z board…") |
| AC-M4.4b-02 | Guest check-in by name or party with labels in the Scan PWA: label chips, name and party search, single and party check-in, offline queue, synced once, host sees each arrival once | e2e ("Scan PWA: check guests in…"); unit `packages/checkin-engine/tests/guests.test.ts` (search, labels) |
| AC-M4.4b-03 | Arrivals: two offline devices with skewed clocks, concurrent resends, unknown guests → one arrival per guest at the earliest corrected time; a future clock never dates after now | int `packages/testing/tests/guest-checkin.int.test.ts` ("two offline devices…", "a device clock in the future…"); unit (`correctedArrival`, `earlierArrival`) |
| AC-M4.4b-04 | Snapshot is an allowlist: names, labels, tables, status, arrivals only (no meal, contact or private answer); device credentials only; another org → not found | int ("carries names…", "needs device credentials…") |
| AC-M4.4b-05 | Guest kiosk matching: exact full name only, accents/case aside; partial, first-name-only, plus-one, shared names and declined guests never reveal a table | unit ("matchGuestByName"); e2e (kiosk results) |
| AC-M4.4b-06 | A–Z board: last name order, letters folded, "#" last; no plus-ones, declined or unseated; pages never overflow | unit ("boardGroups", "boardPages"); e2e (board offline) |
| AC-M4.4b-07 | Day-of view: counts, unseated (only with a chart), meals by choice with arrived, recent arrivals with how; host check-in and undo; viewer reads but may not act; scanner role may; other org refused | int ("counts arrivals…", "viewers read…", "each org's wedding…"); e2e ("the host's day-of view…", "a viewer reads…") |
| AC-M4.4b-08 | Kiosk kinds: a kiosk operator starts guest kiosk and board; heartbeat and supervisor view carry the kind; default tickets; board at no entrance; audit has the kind, never the PIN; viewer refused | int ("a kiosk operator starts…") |
| AC-M4.4b-09 | Keyboard only, axe in light and dark on every new screen and state, Arabic RTL (day-of, Scan PWA guests, kiosk, board) | e2e (all) |
| AC-M4.4b-10 | Isolation: `guest_arrivals` has rows for both orgs; the isolation suite passes | `packages/testing/tests/isolation.int.test.ts` |

### 11. Security and privacy
- Devices learn the org only from their token; the snapshot is an allowlist (P4-3: no meal, contact or private answer leaves for a device). It sits sealed in the device's IndexedDB (obfuscation, as the ticket manifest) and is wiped with the device.
- The guest kiosk never lists names: exact full name only, one answer for misses; it is a staffed device at the venue (no PIN like M4.4a's remote PIN mode — see the owner inbox).
- The board shows names and tables by design; the host turns it on per device, with a PIN to leave.
- Every write is a command: check-in, undo and kiosk starts are audited; the kiosk PIN is never logged.

### 12. Performance budget
A snapshot or day-of read is one `viewTx` per chart (event plan + sub-events) plus one names and one arrivals read (≤ 3,000 guests). The device searches and matches in memory; a sync applies ≤ 500 arrivals under one advisory lock.

### 15. Demo checklist
- [ ] As `pani@lakeside.test`, a wedding with seated parties (labels on parties, meals chosen).
- [ ] Day-of: stats, unseated, meals. Search "garcía" → Check in → it appears under Arrivals → Undo.
- [ ] Guest kiosk and table board: Add device ×2, open each setup link on a tablet/TV; start one as the guest kiosk and one as the board (PIN 2468).
- [ ] Turn the venue Wi-Fi off: type a full name on the kiosk → "Your table: Table 2"; the board keeps paging. Staff: exit kiosk with the PIN. Wi-Fi on: the arrivals show on Day-of as "Guest kiosk".
- [ ] On a phone's Scan PWA: Guests → pick "Bride" → Check in everyone in a party.

### Gate (M4.4b, 2026-10-03)
- Base: build branch + `merge/next-3g` + `merge/next-3h` + `agent/m4.3a` + `agent/m4.4a`, re-merged before the gate.
- `pnpm lint`, `pnpm check:modules`, typecheck 59/59 (`--concurrency=2`), unit 2716/2716 (203 files), integration 1529/1529 (167 files), `pnpm contracts:check`.
- E2E at 375/768/1280 (`--workers=2`): `guest-checkin` 12 passed; `social-workspace`, `staff-mode`, `scan-pwa`, `door-staff`, `assistance`, `guest-seat-finder`, `canary-crawl`, `noindex` 87 passed (the rest skipped by design).

