# Spec: M4.6 — Social Command Center pack

- **Milestone:** M4.6 (Phase 4 plan `docs/plans/phase-4.md`, Wave D)
- **Status:** M4.6a built (2026-10-03)
- **Risk tags:** `db-migration` (a widened CHECK and a replaced SECURITY DEFINER function)
- **Related ADRs:** 0018/0022 (tokens, design v2)

## M4.6a — social Command Center pack (built 2026-10-03)

### 1. Goal and users
A couple, their planner or a gala chair opens the event's Command Center and sees what needs
chasing: who hasn't answered as the RSVP deadline nears, who has no table, what the kitchen
needs, and on the day who has arrived. The alert engine tells them at the right moments.

### 2. References
- **Plan:** row M4.6a ("Widgets and alert rules on the M3.2a/b alert engine: RSVP pending at deadline −7 d and −1 d, unseated guests, meal and dietary counts, arrivals"). Acceptance: "The fixture gives exactly '42 guests have not responded to RSVP', which clears as they answer".
- **Built on:** M3.2a (widget registry, role layouts, modes), M3.2b (alert engine, routing, lifecycle), M4.1c/d/e (sub-events, invitations, RSVP, menu and sealed answers), M4.2b (gala table seats), M4.3a (guest seating), M4.4b (guest arrivals, day-of read).

### 3. What was built
**Alert rules** (`@yayatoh/alerts`, event scope, group `attendees`, permission `guests:read`):
- `rsvpPending` — "{n} guests have not responded to RSVP": invited guests (plus-ones follow their host) with an invitation still unanswered; guests invited to nothing and gala seat holders aside. Warning from RSVP deadline −7 d, critical from −1 d (escalation re-sends it), until the event starts; params `parties`, `days`. Fix: `/e/{event}/guests/rsvp`.
- `guestsUnseated` — "{n} guests do not have a table": guests who haven't declined without a place on a guest chart, in the last 7 days (critical in the last day and while the event runs). Fix: `/e/{event}/seating/guests`.
- `mealsMissing` — "{n} attending guests have not chosen a meal": events with a menu, last 7 days. Fix: `/e/{event}/guests/answers`.
- Re-evaluated on `guests.party_responded@1` and `guests.rsvp_deadline_set@1`; the full sweep also takes events whose RSVP deadline is within the last 120 days or the next 8 (a wedding two months out is watched at −7 d), and `alerts.orgs_to_evaluate` finds those orgs. The worker now registers seating's `OccupantDirectory`.
- Wording in all 13 locales on the console (`alerts.rules.*`, `alerts.fix.*`) and in the alert emails, push and texts (notifications templates).

**Widgets** (`@yayatoh/command-center`, wedding and gala, `guests` module, no money):
- `rsvp` (owner, ops; planning, pre-show; `guests:read`): the same sentence as the alert, responded of invited with a meter, households still to answer, guests not yet sent an invitation, the deadline in the event's zone; link to RSVPs.
- `guestSeating` (owner, ops, door; planning to live; `events:read`): the alert's sentence, seated of guests, up to eight names (+n more); link to guest seating. Empty states: no floor plan, no guests, everyone seated.
- `meals` (owner, ops; planning to live; `guests:read`): attending count, a table per menu option (with its dietary notes), other choice, no meal, and counts of dietary requirements and accessibility needs (the sealed answers are opened only to count them).
- `arrivals` (owner, ops, door; pre-show to wrap; `events:read`): arrived of expected with a meter, not here yet, the latest eight arrivals (time in the event's zone, party, how checked in); link to the day-of view.
- Added to the owner, ops and door default layouts per mode; the door never gets RSVP or meals (refused when asked directly).

**Fixture:** `socialPackScenario` (`@yayatoh/testing`): a wedding 40 days out with an RSVP deadline 5 days away, 14 households of three waiting (ten sent), Rivera attending (Sofia: Beef, gluten-free; Diego: no meal, wheelchair access), Nakamura declined, a menu, two tables with 11 guests seated.

### 4. Later / not yet
- Realtime for these widgets: they poll every 30 s (guest changes emit no outbox events; guest seating has its own channel, arrivals none).
- Arrivals alerts (for example "half the guests not here at the start") are not in the plan row.
- Thresholds are pending the owner (`docs/owner-inbox.md`, M4.6a).

### 5. Acceptance

| Criterion | Test |
|---|---|
| The fixture gives exactly "42 guests have not responded to RSVP" | `packages/testing/tests/social-pack.int.test.ts` ("the acceptance fixture"), `apps/web/e2e/social-pack.spec.ts` (alerts page and Command Center) |
| … which clears as they answer | `social-pack.int.test.ts` ("it clears as guests answer": 42 → 39 from the outbox, 38 on a partial answer, resolved at the last), `social-pack.spec.ts` (a household answers on its RSVP page by keyboard → 39, then resolved) |
| RSVP pending at deadline −7 d and −1 d | `packages/modules/alerts/tests/social-rules.test.ts`, `social-pack.int.test.ts` ("levels") |
| Unseated guests, meal and dietary counts, arrivals | `social-rules.test.ts`, `packages/modules/guests/tests/social.test.ts`, `social-pack.int.test.ts` ("the widgets", "in the last week"), `social-pack.spec.ts` (widgets, live mode, empty states) |
| Role visibility (door never sees revenue; no RSVP or meals for the door) | `packages/modules/command-center/tests/social.test.ts`, `social-pack.int.test.ts` ("who may see them"), `social-pack.spec.ts` (door test, 403 on direct calls) |
| Tenant isolation | `social-pack.int.test.ts` ("tenant isolation") |
| Keyboard, axe light and dark, Arabic RTL | `social-pack.spec.ts` |

### 6. Gate (2026-10-03)
`pnpm verify` green (lint, check:modules, typecheck 59/59, unit 2731/2731, integration 1541/1541). E2E on 375/768/1280: `social-pack` 12/12; related `command-center`, `alerts`, `guest-checkin`, `live-mode`, `marketing-analytics`, `theme`, `rsvp`: 144 passed, 0 failed.
