# Spec: M4.3 — Guest seating

- **Milestone:** M4.3 (roadmap §10 Phase 4, "M4.3 Guest seating (M)"; Phase 4 plan `docs/plans/phase-4.md`, Wave C)
- **Status:** M4.3a built (2026-10-03: the guest seating editor); M4.3b (cards and exports) to follow
- **Risk tags:** `db-migration`, `tenancy`
- **Related ADRs:** 0009 (realtime), 0012 (seating), 0018/0022 (tokens, design v2)

## M4.3a — guest seating editor (built 2026-10-03)

### 1. Goal and users
A couple, their planner or a gala host seats the guest list: parties with their plus-ones go to
tables, as whole households or as groups (the bride's side, a company), with a warning before
anything happens when they can't fit and a nudge when a VIP party lands outside the VIP zone. The
queue follows the guest list as it changes: an RSVP, a meal or a new plus-one shows up without a
reload. Everything a pointer does on the map, the keyboard does in the panes beside it.

### 2. References
- **Plan:** `docs/plans/phase-4.md` row M4.3a ("A three-pane editor: an unseated queue (fed by RSVP and meal changes), the map, and table details. Parties are dragged to tables, with a keyboard alternative. 'Can't fit' warnings; VIP zones; group assignment. Realtime through the M3.1b publisher"). Acceptance: "Keyboard-only path works; a plus-one change updates the queue in realtime".
- **Roadmap:** §3.5 (same-tier modules talk through ports: "seating's `OccupantDirectory` is implemented by guests"), M4.3, P4-3 (guest privacy), P4-8 (planners seat guests).
- **Built on:** M4.1a–f (parties, plus-ones, sub-events, RSVP, meals), M4.1c sub-event charts, M4.2b gala tables (named seats are guests), M3.1b realtime publisher, M1.7 floor plans.
- **Legacy evidence:** none (Eventmie Pro has no guest seating).

### 3. Scope
**In (built):**
- **Seat guests** (`/o/{org}/e/{event}/seating/guests`, a new "Seat guests" tab on every seating view of an org with the guests module; the Seating section guard applies, so planners and co-hosts reach it on their events). A chooser for the chart when the event has sub-events: "Whole event", "Ceremony", "Reception"… (`?sub=`); each is seated separately on the chart it uses (its own, its date's, else the event plan).
- **Pane 1, the unseated queue:** parties with guests still to seat (plus-ones after their host as "Guest of …"), each guest's reply (Attending / Awaiting reply; declined guests leave the queue) and meal. Search by party or guest name; filter by reply and by side. Tick a whole party, single guests, or several parties (a group: filter by side, tick them) and seat them with "Seat selected guests" at the chosen table. The table chooser says "{free} of {capacity} free" (and "VIP zone"); choosing a table the selection doesn't fit shows **"Can't fit: 3 guests selected, 2 seats free at Table 1."** before anything is sent.
- **Pane 2, the map** (Konva, drawing only, hidden from assistive tech): tables and rows with their fill ("3/8"), seats coloured in order (ticket holders, then guests), VIP zones ringed, the chosen table outlined. Dragging a party from the queue (its ticked guests plus every other ticked guest, else all of its own) onto a table seats them; while dragging, a polite live line says "Drop on Table 2: 4 free" or "Can't fit at Table 2: 3 guests, 2 free". A click on a table opens its details. A seated party can be dragged from the details pane onto another table.
- **Pane 3, table details:** the chosen table's counts (seated, free, seats held by tickets), sponsor ("Hosted by …", M4.2b), the **VIP zone** switch (or "In a VIP section of the plan"), meal counts ("Beef: 2"), warnings (a guest who declined but is still seated; a VIP party outside a VIP zone; a party that isn't VIP inside one), and who sits there by party with **Move to…** (keyboard: the chooser takes focus), **Unseat** per guest and **Unseat {party}**.
- **Rules (`seating`, pure in `domain/guest-seating.ts`, shared with the browser):** capacity = the table's seats − seats sold, held, given to an attendee or killed on the event plan − guests seated there. Seating is **all or nothing** (`cant_fit` with `asked` and `fits`); guests already at the table need no seat again; declined guests are refused; pending guests may be seated. VIP zones only warn (`vip_outside`, `not_vip_inside`).
- **Data:** `seating.guest_seats` (one place per guest per chart; table-level, no seat of the plan is held), `seating.vip_tables` (host-marked VIP zones, per event and item id, every chart). A place on a table the chart no longer has is ignored (the guest is back in the queue).
- **The `OccupantDirectory` port (roadmap §3.5):** seating defines it and reads guests only through it; guests implements it (`guestsOccupantDirectory`); the web app's and the test ports' composition roots register it (`setOccupantDirectory`). Neither module imports the other.
- **Realtime (M3.1b publisher):** two log channels, both `guests:read`:
  - `org:{o}:event:{e}:guests` (`GUESTS_CHANNEL`, guests module, entitlement `guests`): `party {partyId}` / `list`, published by both history writers in the change's own transaction, so every change that writes `rsvp_history` (plus-one added or named, meal, RSVP answer, move, import, invitations) reaches the queue; at most 20 party messages per transaction, then one `list`.
  - `org:{o}:event:{e}:guest-seats` (`GUEST_SEATS_CHANNEL`, seating, entitlement `seating`): `seats {subEventId, itemIds}`, published by every seating write.
  - The editor follows both (`useRealtime`), re-reads within half a second of a message, and shows Live / Connecting / Offline.
- **Permissions:** the editor needs `guests:read` (owners, admins, managers, viewers, event managers; co-hosts and planners on their events); changes need `seating:write` (viewers see everything read-only, with no controls; the commands refuse them).

**Later / not yet:**
- Seat-level places (a particular chair) and taking guest seats off sale on a plan that sells seats (pending owner).
- Automatic unseating when a guest declines (pending owner; today a warning in table details).
- Copying one sub-event's seating to another; auto-placement ("seat VIP parties nearest the stage") waits for M6.12.
- Place, escort and table cards, seating chart and caterer exports (M4.3b).
- `/v1` resources for guest seating.

### 4. `touches:`
```yaml
touches:
  - packages/modules/seating/src/{schema,guest-seating,domain/guest-seating,client,index}.ts, MODULE.md
  - packages/modules/guests/src/{seating-occupants,realtime,guests,sub-events,index}.ts, MODULE.md
  - packages/db/drizzle/0113_yielding_wind_dancer.sql (+ meta; renumbered at merge)
  - packages/testing/src/{fixtures,ports}.ts, tests/guest-seating.int.test.ts
  - apps/web/src/server/{ports,realtime}.ts
  - apps/web/src/app/[locale]/o/[org]/e/[event]/seating/guests/{page,actions}.ts(x)
  - apps/web/src/app/[locale]/o/[org]/e/[event]/seating/{page,assign/page,rules/page,finder/page}.tsx (the tab)
  - apps/web/src/components/guest-seating/{guest-seating-editor,guest-seating-canvas}.tsx, seating-tabs.tsx
  - apps/web/messages/*.json (seating.tabs.guests, seating.guestSeating.*)
  - apps/web/e2e/guest-seating.spec.ts
  - docs/specs/M4.3/spec.md, docs/owner-inbox.md
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `seating.guest_seats` | new (tenantTable) | event, sub-event (null = event plan), guest, item (table or row); partial uniques: one place per guest per chart; indexes lead with `org_id` |
| `seating.vip_tables` | new (tenantTable) | event, item; unique per event and item |

Hand-written in the migration: `guest_seats` → `events.events (org_id, id)`, → `guests.guests (org_id, id)` and → `guests.sub_events (org_id, event_id, id)`, `vip_tables` → `events.events`, all `ON DELETE CASCADE`. New tables only. No text columns (nothing to declare in `private-columns.ts`). Fixture rows for both orgs: the fixture wedding's host at row A of the reception's own chart; row A a VIP zone.

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Commands/queries:** `seating.guestSeating` (`guests:read`), `seating.seatGuests`, `seating.unseatGuests`, `seating.setVipTable` (`seating:write`; entitlement `seating`). Audit: `seating.guests.seat` (item, count), `seating.guests.unseat` (count), `seating.vip_table.set`.

### 7. Events
| Channel | Messages | Access | Producer |
|---|---|---|---|
| `org:{o}:event:{e}:guests` | `party {partyId, at}`, `list {at}` | `guests:read`; entitlement `guests` | guests history writers |
| `org:{o}:event:{e}:guest-seats` | `seats {subEventId, itemIds, at}` | `guests:read`; entitlement `seating` | seating guest commands |

No new outbox events.

### 8. Entitlements and flags
- Module keys `seating` (commands, the seating channel), `guests` (the page, the guest channel). No flag.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.3a-01 | **Keyboard only:** tick a party (Space), choose a table, Enter seats it; "can't fit" is shown before sending and refused if sent; Move to… (focus on its chooser) and Unseat; persists after reload | `apps/web/e2e/guest-seating.spec.ts` (×3 viewports) |
| AC-M4.3a-02 | **A plus-one change updates the queue in realtime:** another tab adds a plus-one; the open editor shows "Guest of …" without a reload; seating from another tab shows too | `guest-seating.spec.ts`; `packages/testing/tests/guest-seating.int.test.ts` (published in the transaction, nothing when refused) |
| AC-M4.3a-03 | A party is seated whole, plus-ones included; all or nothing with `asked`/`fits`; re-dropping where it sits needs no seat | `guest-seating.int.test.ts`; unit `packages/modules/seating/tests/guest-seating.test.ts` |
| AC-M4.3a-04 | Group assignment: filter by side, tick parties, seat them together | `guest-seating.spec.ts` |
| AC-M4.3a-05 | VIP zones (host-marked and plan sections) warn both ways, never refuse | `guest-seating.int.test.ts`, `guest-seating.spec.ts`, unit |
| AC-M4.3a-06 | Fed by RSVP: a sub-event's queue is its invited guests; declined guests leave it, are refused, and are flagged when still seated; the event plan derives each guest's reply | `guest-seating.int.test.ts`; unit `packages/modules/guests/tests/seating-occupants.test.ts` |
| AC-M4.3a-07 | Drag a party onto a table (and "can't fit" on drop) | `guest-seating.spec.ts` |
| AC-M4.3a-08 | Tickets and attendee seating on the event plan count as taken | `guest-seating.int.test.ts` |
| AC-M4.3a-09 | A removed guest loses their place; a table the plan loses sends its guests back to the queue | `guest-seating.int.test.ts` |
| AC-M4.3a-10 | Viewer: read-only (no controls; commands refused); another org reaches nothing; isolation rows for both orgs | `guest-seating.int.test.ts`, `guest-seating.spec.ts`, `isolation.int.test.ts` |
| AC-M4.3a-11 | Empty states (no plan, no guests) say what to do next; axe in light and dark; Arabic RTL | `guest-seating.spec.ts` |

### 11. Security and privacy
- Tenant from the route; the realtime channels name the org and are checked against the caller's membership and role (event roles included). Payloads are ids only.
- The editor's DTO is console-only and carries names, meals and replies; no private answer (P4-3). Nothing here creates contacts or marketing data.
- Every write through `tenantCommand` (validation, entitlement, permission, audit); capacity checked under a per-chart advisory lock.

### 15. Demo checklist
- [ ] A wedding → Seating: create a plan (2 round tables of 4). Guests: add Garcia (VIP: Luis, Ana) and Chen (Mei, Jun, Kai).
- [ ] Seating → Seat guests: tick Garcia, choose Table 1, Seat selected guests. Tick Chen, choose Table 1: "Can't fit…". Choose Table 2.
- [ ] Table details: Table 2 → VIP zone; see the warnings. Move Mei to Table 1; Unseat Ana.
- [ ] In a second tab, Guests → Edit Luis X → Add a plus-one: the first tab's queue shows "Guest of Luis X".

### Gate (2026-10-03)
- Base: `origin/m0.5-foundation-ey5gqp` + `origin/merge/next-3h` (which already carries next-3g, design-v2, M4.2b and M4.1d with their conflicts resolved); re-merged the latest build branch, next-3h and next-3g before the gate (clean).
- `pnpm lint`, `pnpm check:modules`, typecheck 59/59 (`--concurrency=2`), unit 2696/2696 (201 files), integration 1509/1509 (165 files).
- E2E at 375/768/1280 (`--workers=2`): `guest-seating` 18 passed; `seating`, `seat-assignment`, `party-guests`, `social-workspace` 60 passed; earlier on this branch `seat-rules`, `seat-move` (with seating/seat-assignment: 39), `rsvp`, `realtime`, `seat-finder` (with party-guests: 81), `gala-tables`, `guest-import`, `guest-invites`, `rsvp-questions` (72) all passed.
