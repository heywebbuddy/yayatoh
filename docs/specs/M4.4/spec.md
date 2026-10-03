# Spec: M4.4 — Seat finder, kiosk and day-of

- **Milestone:** M4.4 (roadmap §10 Phase 4, "M4.4 Seat finder, kiosk and day-of (M)"; Phase 4 plan `docs/plans/phase-4.md`, Wave C)
- **Status:** M4.4a built (2026-10-03: the guest seat finder); M4.4b (kiosk, TV board and check-in) to follow
- **Risk tags:** `db-migration`, `tenancy`
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
