# Spec: M6.11 — Advanced seating

- **Milestone:** M6.11 (roadmap Phase 6; Phase 6 plan `docs/plans/phase-6.md`, Wave 1: M6.11a best available and ADA, M6.11b channels and layouts)
- **Status:** M6.11a built (2026-10-02); M6.11b (channels, allotments, layout revisions, underlay tracing, venue library) is a separate builder
- **Risk tags:** `db-migration`, `tenancy` (owner approval)
- **Related:** decisions P6-1 (behind flags), P6-13 (`advanced_seating` entitlement), D18 (seating rules warn by default, enforce per event); ADR 0012 (floor plans, holds in Postgres); M1.7c/f/g (seat picker, rules, live availability, per-date charts), M1.8f (groups)

## M6.11a — best available and the ADA engine (done)

### 1. Goal and users
Buyers who don't want to study a seat map ask for "4 seats at $50" and get the best seats that sit
together; the box office does the same at the door. Organizers decide how sections rank. Wheelchair
users get an accessible seat with companion seats next to it, online, while everyone else is kept
off those seats until the organizer releases them; rules warn by default and are enforced per event
(D18).

### 2. References
- **Plan:** Phase 6 Wave 1, "M6.11a Best-available and ADA" (acceptance: *best available never splits a party when a contiguous block exists; ADA rules are enforced in the command*).
- **Decisions:** D18 (ADA warn by default, enforce per event), P6-1, P6-13.
- **Legacy evidence:** none (Eventmie Pro has no best-available or companion seats).

### 3. Scope (built)
**In:**
- **Best-available selection (`packages/modules/seating/src/domain/best-available.ts`, pure).** For a quantity at one price level (ticket type): together = one table, or consecutive seats of one row. Ranking: (1) section score — the organizer's score (0–100, higher first; scored sections before unscored ones), else the section's distance to the stage; (2) row — nearer the stage (else earlier in the plan); (3) not using accessible/companion seats the party did not ask for; (4) for a wheelchair party, using companion seats; (5) centre of the row. A party is never split when a fitting block exists (property test over 2,000 random plans); otherwise it is split into as few pieces as possible (largest first) and the buyer is told. 20,000-seat plans in well under the budget.
- **Holding the pick under concurrency (`best-available.ts`).** One advisory transaction lock per chart serializes best-available pickers (they never fight over a block); the claim is `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` and counts the rows, inside a savepoint: a seat someone chose by hand meanwhile makes the claim miss, the savepoint lets the rows go, the seat is excluded, and the pick runs again (5 attempts, then `seats_taken`). Proven with 100 concurrent best-available requests plus 20 concurrent hand holds: no seat held twice.
- **The hold is a capability.** The caller gets a random 32-character token; the seats are held under `holdIdForToken(token)` (a SHA-256-derived UUIDv4, never an order's UUIDv7) for 10 minutes. Checkout and the box office take the hold over into the order (`adoptSeatHoldTx`: the seats move to the order's hold; a lapsed or unknown token is `seat_hold_expired`). "Give these seats back", "Find seats again" and switching to "Choose my seats" release it; otherwise the sweeper does.
- **ADA engine.**
  - Companion seats (`seating.companion_seats`, per event): the organizer ticks seats in rows/tables that have an accessible seat; "Tick the seats next to accessible seats" fills in the engine's suggestion (the neighbours in the row, or at the table). A companion seat can't be an accessible seat or sit away from one (`companion_is_accessible`, `companion_far`).
  - New rule `ada_companion` (`seating_rules`, warn or enforce, `maxPerAccessible` 1–3): companion seats are sold only with an accessible seat in the same order, at most N per accessible seat. It ends with the `ada_reserved` release when that rule exists (the seats then go to everyone), else always applies. Organizer seating of guests is never affected.
  - The buyer's statement "Someone in my party uses a wheelchair and needs an accessible seat" (`accessibleNeed`; staff tick it for the buyer at the box office) lets them take kept-back accessible seats; the companion limit still counts. Recorded in the checkout and box office audit rows.
  - Release at a configurable time: `ada_reserved`'s `releaseDays` (M1.7f) releases unsold accessible seats, and now companion seats with them.
  - Enforced in the commands: `checkSeatRulesTx` (checkout, box office, best available) refuses with `seat_rule` and the rule (`ada_reserved`, `ada_companion`, `max_per_order_seats`); staff may override at the box office (audited); buyers online never can. Best available never picks kept-back accessible or companion seats for anyone who did not make the statement, whether the rule warns or is enforced.
- **Public checkout.** When the organizer offers it, the event page asks "How would you like to choose seats?" — *Best available* (default) or *Choose my seats*. Best available: price (when there are several), number of seats, Find seats; the result lists the seats (accessible/companion marked), the split notice when it had to split, and the 10-minute hold; the order posts `seatHold`. Plain form controls only: no map needed, every step works by keyboard. The seat list shows companion seats and the companion rule, warns as companion seats are chosen, and (enforced keep-back + best available) tells buyers who need an accessible seat how to get one online.
- **Box office.** The same choice, with staff actions (`orders:sell`); a sale adopts the hold.
- **Organizer page** `Seating → Best available` (`/o/{org}/e/{event}/seating/best-available`): offer best available; section scores (plans with sections: legacy imports; a section tool comes with M6.11b); companion seats. The companion rule is on the Rules tab. Viewers read only.
- **Gate.** Module key `advanced_seating` (P6-13), granted to `launch_standard` in beta by the migration; every new command and query checks it; the public map and the tab show the features only with it. Best available is off per event until the organizer turns it on.

**Out (Later / not yet):**
- Best available across several price levels at once ("any price up to $X"), and holding seats across dates in one request.
- A section editor in the plan editor (M6.11b's layout work); scores today apply to plans that have sections.
- Asking for more than one accessible seat in one best-available request (one wheelchair space per request; staff can sell more by hand).
- Proof of need (documents): the statement is self-declared, as recommended (pending owner, see owner inbox).
- Best available for private events opened by an access code (the find refuses private events; buyers choose seats by hand there).

### 4. `touches:`
```yaml
touches:
  - packages/modules/seating/src/{schema,index,client,private-columns,rules,layouts}.ts   # append-only + publicSeatMap flags
  - packages/modules/seating/src/best-available.ts
  - packages/modules/seating/src/domain/{best-available,rules}.ts
  - packages/modules/orders/src/{dto.ts,commands/checkout.ts,commands/box-office.ts}      # seatHold, accessibleNeed
  - packages/platform/src/modules.ts                                                     # advanced_seating
  - packages/db/drizzle/0102_shocking_husk.sql
  - packages/testing/src/fixtures.ts
  - apps/web/src/components/{best-available,seat-selection,seat-selection-settings,seat-picker,checkout-form,box-office-form,seating-rules-form,seating-tabs,public-event-view}.tsx
  - apps/web/src/app/[locale]/o/[org]/e/[event]/seating/{actions.ts,page.tsx,assign/page.tsx,rules/page.tsx,finder/page.tsx,best-available/page.tsx}
  - apps/web/src/app/[locale]/o/[org]/e/[event]/tickets-orders/{actions.ts,page.tsx}
  - apps/web/src/app/[locale]/events/[slug]/actions.ts
  - apps/web/src/app/api/dev/seating-sections/route.ts                                    # dev/preview only
  - apps/web/src/server/advanced-seating.ts
  - apps/web/messages/*.json
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `seating.selection_settings` | new | per event: `best_available` (default off), `section_scores` jsonb `{ sectionId: 0–100 }`; unique `(org_id, event_id)`; FK `(org_id, event_id)` → `events.events` on delete cascade |
| `seating.companion_seats` | new | per event: `seat_uuid`; unique `(org_id, event_id, seat_uuid)`; same FK. Per event because seat ids repeat across an event's charts (a date's own chart keeps them) |
| `seating.seating_rules` | CHECK widened | `kind in ('ada_reserved', 'max_per_order_seats', 'ada_companion')` (added NOT VALID, then validated) |
| `billing.plan_modules` | row | `('launch_standard', 'advanced_seating')` |

- [x] Tenant tables use `tenantTable()` (ENABLE + FORCE RLS, canonical policy, org-leading indexes, org-scoped uniques, composite FKs)
- [x] Both new tables have rows for both orgs in `createOrgFixture` (isolation suite)
- [x] `section_scores` declared `internal()` in `private-columns.ts` (never on the public map)

**Migration:** `0102_shocking_husk.sql` (renumbered at merge). New tables (no locks on existing data); the CHECK on the existing `seating_rules` is added `NOT VALID` then validated. Hand edits: the NOT VALID/VALIDATE pair; the two composite FKs to `events.events`; the `plan_modules` row. Nothing destructive.

### 6. API diff
- **`/v1`:** none.
- **Commands / queries (all `advanced_seating`):** `seating.setSelectionSettings`, `seating.setCompanionSeats` (`seating:write`); `seating.selectionPage` (`events:read`); `seating.holdBestAvailable`, `seating.releaseBestAvailable` (`public:checkout`); `seating.holdBestAvailableStaff` (`orders:sell`). `seating.setRules` takes the `ada_companion` rule. `orders.startCheckout` and `orders.recordBoxOfficeSale` take `seatHold` and `accessibleNeed` (optional; additive).
- **`PublicSeatMapDto`:** `seats[].companion`, `bestAvailable` (defaults false).
- **`/api/v2`:** none.

### 7. Events
None new (holds and sales already notify the live seat feed; orders emit as before).

### 8. Entitlements and flags
- **Module key:** `advanced_seating` (new, P6-13; free in beta via `launch_standard`).
- **Per-event switch:** "Offer best available" (off by default).
- **Profiles affected:** every profile whose nav shows Seating.

### 9. ELT impact
None. Legacy charts with sections become scoreable.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M6.11a-01 | **Given** any plan **When** a block that fits the party exists **Then** best available never splits it (2,000 random plans, brute-force oracle) | `packages/modules/seating/tests/best-available.test.ts` (unit, property) |
| AC-M6.11a-02 | **Given** no block fits **When** best available runs **Then** the party is split into as few pieces as possible and the buyer is told | `best-available.test.ts`; `best-available.int.test.ts` ("never splits…"); `apps/web/e2e/best-available.spec.ts` ("when no block fits…") |
| AC-M6.11a-03 | Ranking: organizer section score, then distance to the stage, then row, then centre | `best-available.test.ts`; `best-available.int.test.ts` ("is off until…", "holds the best block…") |
| AC-M6.11a-04 | **Given** 100 concurrent best-available requests and 20 hand holds **Then** no seat is held twice and the database agrees | `packages/testing/tests/best-available.int.test.ts` ("no seat is ever held twice…") |
| AC-M6.11a-05 | Checkout and the box office adopt a hold; the token works once; lapsed/unknown tokens and "both ways at once" are refused | `best-available.int.test.ts` ("holds the best block…", box office test) |
| AC-M6.11a-06 | ADA rules enforced in the command: companion without accessible refused (`ada_companion`), kept-back accessible without the statement refused (`ada_reserved`), over the companion limit refused; staff override at the box office | `best-available.int.test.ts` (ADA engine); `packages/modules/seating/tests/rules.test.ts` |
| AC-M6.11a-07 | Best available keeps accessible and companion seats for those who need them; a wheelchair party gets an accessible seat with its companion; none left → `no_accessible_seat` | `best-available.int.test.ts`; e2e "a wheelchair user gets…" |
| AC-M6.11a-08 | Kept-back seats are released at the configured time | `best-available.int.test.ts` ("kept-back seats are released…"); `rules.test.ts` |
| AC-M6.11a-09 | Permissions: only `seating:write` changes settings and companions, only `orders:sell` holds at the box office; viewers read only (hidden controls and refused actions) | `best-available.int.test.ts`; e2e "an organizer offers…", "the box office…" |
| AC-M6.11a-10 | Isolation: another org can't see, hold or release this org's seats; each org's rows stay its own | `best-available.int.test.ts` (isolation); `packages/testing/tests/isolation.int.test.ts` (fixtures) |
| AC-M6.11a-11 | Module gate: without `advanced_seating` every command refuses (`module_not_enabled`) | `best-available.int.test.ts` ("needs the advanced_seating module") |
| AC-M6.11a-12 | E2E: buy 4 best available by keyboard only; an accessible seat with a companion; box office; validation errors, empty states, persistence, axe on every screen, Arabic RTL | `apps/web/e2e/best-available.spec.ts` (5 tests × 3 viewports) |

### 11. Security and privacy
- Every output goes through Zod DTOs; section scores never leave the console.
- The public find is rate limited with checkout's per-device budget (`checkoutStart`); the org and event come from the slug server-side.
- Hold tokens are unguessable (192 bits) and only their SHA-256-derived id is stored; a token can't touch an order's seats.
- Audit rows: settings, companion seats, every best-available hold (with `accessibleNeed`, `overrideRules`), checkout and box office sales mark `bestAvailable`/`accessibleNeed`.

### 12. Performance budget
The pick reads the chart's seats once per attempt (≤ 20,000 rows) and runs in tens of milliseconds; pickers of one chart are serialized only for the length of the claim transaction.

### 13. Rollout
Module granted in beta; per-event switch off by default. Rollback: turn best available off per event (checkout falls back to choosing seats); revoke `advanced_seating` per org.

### 14. Demo checklist
- [ ] Seating → Best available: tick "Offer best available", save; tick the suggested companion seats, save.
- [ ] Rules: keep accessible seats (enforce) and "Sell companion seats only with an accessible seat" (enforce).
- [ ] Event page: Best available, 4 seats → Find seats → the middle of the front row; continue to payment.
- [ ] Tick "Someone in my party uses a wheelchair", 2 seats → an accessible seat and its companion seat.
- [ ] Choose my seats: a companion seat alone shows the refusal message.
- [ ] Box office: tick "The buyer needs a wheelchair-accessible seat", find, record the sale.

### 15. Owner tasks
See `docs/owner-inbox.md` (M6.11a): defaults pending owner confirmation.
