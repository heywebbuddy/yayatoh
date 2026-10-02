# Spec: M6.11 — Advanced seating

- **Milestone:** M6.11 (roadmap Phase 6; Phase 6 plan `docs/plans/phase-6.md`, Wave 1: M6.11a best available and ADA, M6.11b channels and layouts)
- **Status:** M6.11a built (2026-10-02); M6.11b built (2026-10-02): sales channels and allotments, layout revisions with diff and rollback, PDF underlay tracing, the venue layout library
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

### 16. Gate results (2026-10-02)
- `pnpm lint`, `pnpm check:modules`, typecheck (57/57), unit (186 files, 2,381 tests), integration (152 files, 1,353 tests): pass.
- E2E (3 viewports): `best-available.spec.ts` 15/15; `box-office-seats`, `seat-rules`, `seated-checkout`, `registration` pass. The wider seating/checkout set (`checkout`, `box-office`, `seat-live`, `seating`, `date-charts`, `seat-assignment`) passed before the last two fixes, which touched only the rules form order and the public map's optional fields.
- Not merged here: `origin/agent/design-v2` (conflicts outside this milestone's files: e2e helpers, command center, speakers, exhibitors, seat finder, drizzle meta, web package.json, and the shared seat picker, checkout and box office forms). The merge session takes it; the new screens use only `@yayatoh/ui` components and tokens.

## M6.11b — channels and layouts (done)

### 1. Goal and users
Organizers keep blocks of seats for the box office, sponsors and promoters, and know a seat kept for
one channel is never sold through another. A promoter gets a link with a code; their buyers see the
promoter's block open and buy it online. Every save of a seating plan is a revision the organizer can
compare and bring back, without ever disturbing a seat that is held or sold. A venue's PDF or image
floor plan goes under the editor to trace over. Plans saved to the org's library start new events.

### 2. References
- **Plan:** Phase 6 Wave 1, "M6.11b Channels and layouts" (acceptance: *a seat in one channel can never be sold through another; restoring a revision keeps sold seats*).
- **Decisions:** P6-1 (behind flags), P6-13 (`advanced_seating`), D18 (rules model reused: per event, explained refusals).
- **Builds on:** M1.7b/g (floor plan editor, per-date charts, the image underlay with calibration), M6.11a (best available, hold adoption).
- **Legacy evidence:** none (Eventmie Pro has no channels or plan history).

### 3. Scope (built)
**In:**
- **Sales channels (`packages/modules/seating/src/channels.ts`, pure rules in `domain/channels.ts`).** Per event: `public` (online without a code), `box_office`, `sponsor` and `promoter` (online with the channel's code; at most one `public` and one `box_office`). A channel may have a release time: its unsold seats then go back to every channel. Codes are 3–32 letters, digits, dashes or underscores, stored upper-case, unique per event.
- **Allotments.** Whole rows or tables, sections, or single seats (the console types seat numbers, "1-4, 9") go to a channel or back to "no channel"; a seat is in at most one channel per event, and every chart of the event follows (seat ids repeat across charts). Removing a channel frees its seats.
- **Enforced in the commands — a seat in one channel is never sold through another.** A sale goes through exactly one channel (`resolveSaleChannelTx`): online with a code → that code's channel (an unknown code is refused, `channel_code_invalid`, never a silent fallback), online without → the `public` channel, the box office → the `box_office` channel; an event without such a channel sells through "no channel". `holdSeatsTx` checks the allotment **in the same UPDATE that takes the seat** (`sellableThroughSql`), with "no channel" as the default for any caller that names none; a refused seat is `seat_channel`. `adoptSeatHoldTx` re-checks a best-available hold against the order's channel; best available never picks another channel's seats. An order's channel is recorded (`channel_orders`); the payment marks it sold (`sellSeatsTx`), and an order paid after its hold lapsed re-holds through the same channel.
- **Public side.** `/events/{slug}?channel=CODE` (marketplace and tenant sites): the seat map opens the channel's seats (`otherChannel` marks the rest; the seat list never offers them, whatever the live feed says), the page says "You're buying through {name}", and checkout and best available go through that channel. An invalid link says so and shows the public's map. The box office's map is the box office channel's.
- **Console: Seating → Channels** (`/o/{org}/e/{event}/seating/channels`, with advanced seating): the channels (kind, code and the promoter's link, release time in the event's zone, seats, paid orders and seats sold through each), add/edit/remove, and the allot form (channel, rows and tables by checkbox, optional seat numbers) — the keyboard alternative to choosing on the map. Viewers read only.
- **Layout revisions (`revisions.ts`, pure diff and restore plan in `domain/revisions.ts`).** Every save of a chart's plan is a numbered revision (unchanged saves are not repeated; a date's own chart starts with its copy as revision 1; the newest 100 per chart are kept). A revision shows what it changed against the one before (seats added, removed, renumbered, moved; the lists of seats) and what restoring it would change now.
- **Rollback keeps sold seats.** Restoring (`seating.restoreLayoutRevision`) keeps every held and sold seat exactly: the same seat id in the revision with the same label → kept; not there, but a free seat with the same label is → **remapped** (that seat takes the sold seat's id, so the hold, the sale and the ticket's label are untouched); otherwise **refused** (`restore_conflicts`, naming each seat: removed, or renumbered to another label). Works on a plan on sale and on a locked plan (the editor stays read-only once locked; a restore is the one way a locked plan's drawing changes, and only without touching a sold seat). Other seats keep their price and blocks when they keep their id; guests keep seats that still exist. A restore is itself a revision.
- **Console: Seating → Revisions** (`/seating/revisions`, per chart with the date picker): the list, a revision's detail (changes, "restoring it would change", held and sold seats: kept / remapped / in the way), Restore. Viewers read only.
- **Underlay tracing.** M1.7g's image underlay (upload, scale by two points, position, opacity, lock, show on the buyer's map) now also takes **a page of a PDF**: the organizer picks the page; pdf.js draws it in the browser (main thread, eval off: the console's strict CSP allows no workers) at 2,400 px on its longest edge as PNG (JPEG if needed, smaller until it fits 4 MB) and uploads it through the media pipeline like any image. Wrong page and unreadable PDFs are explained. Every step has a form control (opacity is a keyboard range).
- **Venue layout library** (`library.ts`, `/o/{org}/seating-library`, linked from Venues and from an event's "Save as a reusable plan"): the org's saved plans with seats, rows, tables, image, how many events started from each; **start a new event from a plan** (name, kind of event among those with seating, time zone, start and end; idempotent per form), which lands on its seating page to price and publish; rename; remove (events keep their copy). Viewers read only.

**Out (Later / not yet):**
- Choosing allotments on the canvas (the list form is the way today); per-channel prices or fees.
- Selling a sponsor's or promoter's block at the box office (staff free the seats or wait for the release).
- Revisions of library plans (only event charts have history); a side-by-side visual diff on the canvas.
- Sharing a library plan with other orgs or a venue's portal (M6.14).
- Copying channels when an event is duplicated or saved as a template.

### 4. `touches:`
```yaml
touches:
  - packages/modules/seating/src/{schema,index,client,private-columns,holds,layouts,best-available}.ts   # append-only + channel checks
  - packages/modules/seating/src/{channels,revisions,library}.ts
  - packages/modules/seating/src/domain/{channels,revisions}.ts
  - packages/modules/seating/MODULE.md
  - packages/modules/orders/src/{dto.ts,commands/checkout.ts,commands/box-office.ts}                   # channelCode, channel holds
  - packages/db/drizzle/0103_powerful_richard_fisk.sql
  - packages/testing/src/fixtures.ts
  - apps/web/src/app/[locale]/o/[org]/e/[event]/seating/{page.tsx,channel-actions.ts,channels/page.tsx,revisions/page.tsx}
  - apps/web/src/app/[locale]/o/[org]/(org)/seating-library/{page.tsx,actions.ts}
  - apps/web/src/app/[locale]/o/[org]/(org)/venues/page.tsx
  - apps/web/src/app/[locale]/events/[slug]/{page.tsx,actions.ts}
  - apps/web/src/app/[locale]/t/[org]/events/[slug]/page.tsx
  - apps/web/src/components/{seat-channels,seating-library,seating-tabs,seating-underlay,seat-picker,checkout-form,box-office-form,public-event-view}.tsx
  - apps/web/src/lib/pdf-page.ts
  - apps/web/src/types/pdfjs-worker.d.ts
  - apps/web/package.json   # pdfjs-dist (already in the workspace for badges)
  - apps/web/messages/*.json
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `seating.seat_channels` | new | per event: `kind` (public, box_office, sponsor, promoter), `name`, `code` (upper-case; required for sponsor/promoter only, CHECK), `release_at`; unique `(org_id, event_id, code)` where code is set; unique `(org_id, event_id, kind)` for public and box office |
| `seating.channel_seats` | new | `(event_id, channel_id, seat_uuid)`; unique `(org_id, event_id, seat_uuid)` (one channel per seat); composite FK to the channel, on delete cascade |
| `seating.channel_orders` | new | an order's channel: `order_id` (the hold id; orders is a higher tier, no FK), `seats`, `sold_at`; unique `(org_id, order_id)` |
| `seating.layout_revisions` | new | per chart: `number`, `kind` (save, restore), `restored_from`, the whole `doc`, `checksum`, `seat_count`, `actor_id`; unique per chart and number (partial indexes, like `event_layouts`) |

- [x] Tenant tables use `tenantTable()` (ENABLE + FORCE RLS, canonical policy, org-leading indexes, org-scoped uniques, composite FKs)
- [x] All four tables have rows for both orgs in `createOrgFixture` (isolation suite; revisions come from the fixture's plan saves)
- [x] `private-columns.ts`: channel `name` and `code` internal (code-shaped canary), revision `doc` internal, `kind`s vocab

**Migration:** `0103_powerful_richard_fisk.sql` (renumbered at merge). New tables only; nothing destructive, no locks on existing data. Hand edits (between `-- hand-written` markers): composite FKs `(org_id, event_id)` → `events.events` on delete cascade for all four tables; `(org_id, occurrence_id)` → `events.occurrences` on delete cascade for `layout_revisions`.

### 6. API diff
- **`/v1`:** none.
- **Commands / queries (`advanced_seating` unless noted):** `seating.saveChannel`, `seating.deleteChannel`, `seating.allotSeats`, `seating.restoreLayoutRevision` (`seating:write`); `seating.channels`, `seating.layoutRevisions`, `seating.layoutRevision` (`events:read`); library (`seating` entitlement): `seating.layoutLibrary` (`events:read`), `seating.renameLayout`, `seating.deleteLayout` (`seating:write`, delete category). `seating.holdBestAvailable` takes `channelCode`; `orders.startCheckout` takes `channelCode` (optional; additive).
- **`PublicSeatMapDto`:** `seats[].otherChannel` (only when true), `channel` (`{ name }` or `invalid`; only when a code was given).
- **`/api/v2`:** none.

### 7. Events
None new (holds and sales notify the live seat feed as before; the public feed stays channel-blind and the buyer's map masks other channels' seats).

### 8. Entitlements and flags
- **Module key:** `advanced_seating` (P6-13, free in beta) for channels and revisions; the library stays on `seating`.
- **Allotments apply whatever the module** (an org that loses it never oversells kept seats).

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M6.11b-01 | **A seat in one channel can never be sold through another**: checkout without a code, with another channel's code, at the box office, through best available, by adopting a hold, and by a hold that names no channel — all refused (`seat_channel`); an unknown code is refused, never the public | `packages/testing/tests/channels-layouts.int.test.ts` ("a seat in one channel…", "best available never picks…"); `packages/modules/seating/tests/channels.test.ts` |
| AC-M6.11b-02 | Channels: kinds, codes (required, format, unique), one public/box office, release times; allot rows/tables/seats, move, free; removing frees; viewers read only | `channels-layouts.int.test.ts` ("the organizer creates channels…"); e2e |
| AC-M6.11b-03 | Release: at the release time unsold allotted seats go back to every channel; the public map follows; `?channel=` opens the channel's seats, an invalid code says so | `channels-layouts.int.test.ts` ("released seats go back…"); e2e |
| AC-M6.11b-04 | The channel's report counts paid orders and seats through it | `channels-layouts.int.test.ts`; e2e |
| AC-M6.11b-05 | Every save is a revision (unchanged saves aren't); diff of seats added, removed, renumbered, moved | `packages/modules/seating/tests/revisions.test.ts`; `channels-layouts.int.test.ts` ("every save is a revision…") |
| AC-M6.11b-06 | **Restoring a revision keeps sold seats**: kept, remapped by label (same id, same ticket), or refused naming the seats; works on a locked plan | `revisions.test.ts`; `channels-layouts.int.test.ts` ("restoring a revision keeps sold seats…", "a remapped restore…"); e2e (held seat blocks a restore) |
| AC-M6.11b-07 | Library: list with use, rename, remove (events keep their copy), start a new event from a plan | `channels-layouts.int.test.ts` (library); e2e |
| AC-M6.11b-08 | Underlay tracing: a PDF page under the editor, wrong page and unreadable PDF explained, opacity by keyboard, persisted | e2e ("underlay tracing…") |
| AC-M6.11b-09 | Isolation: another org can't see, allot, use or restore; every new table's rows stay its own | `channels-layouts.int.test.ts` (isolation tests); `packages/testing/tests/isolation.int.test.ts` (fixtures) |
| AC-M6.11b-10 | Module gate: without `advanced_seating` channels and revisions refuse (`module_not_enabled`) | `channels-layouts.int.test.ts` ("needs the advanced_seating module") |
| AC-M6.11b-11 | E2E: allot a block to a promoter code and buy through it; make a revision and roll back; start from the library; keyboard-only list alternative; axe on every new screen and state; Arabic RTL | `apps/web/e2e/channels-layouts.spec.ts` (4 tests × 3 viewports) |

### 11. Security and privacy
- Channel codes are not secrets (a promoter hands them out) but are never listed publicly; the public map only names the channel a valid code opened. The org and event come from the slug, server-side.
- The PDF is parsed in the organizer's browser only (pdf.js with eval off, no worker); the server receives an image and re-encodes it like any upload.
- Every output goes through Zod DTOs; audit rows for channel create/update/delete, allot/unallot, restore, library rename/delete; checkout audit marks a channel code.

### 12. Performance budget
The allotment check is one `NOT EXISTS` on an indexed `(org_id, event_id, seat_uuid)` inside the hold statement. Revision lists parse at most 100 documents per chart (≤ 20,000 seats each) once per page view.

### 13. Rollout
Behind `advanced_seating` (free in beta). Rollback: remove channels (seats go back to everyone); revisions are history only.

### 14. Demo checklist
- [ ] Seating → Channels: add "DJ Kai" (promoter, code DJ-KAI); allot row A seats 1-4.
- [ ] Open `/events/{slug}`: row A 1–4 can't be chosen. Open the promoter's link: "You're buying through DJ Kai"; buy A·2.
- [ ] Channels: "1 order · 1 seat" for DJ Kai.
- [ ] Plan: rename row A in the list. Revisions: revision 2 "4 seats renumbered"; open revision 1, Restore.
- [ ] Hold a seat as a buyer; the revision that would rename it shows the held seat in the way and no Restore button.
- [ ] Underlay: upload a PDF floor plan, page 1; fade it by keyboard.
- [ ] Venues → Seating library: start a new event from a saved plan; rename, remove.

### 15. Owner tasks
See `docs/owner-inbox.md` (M6.11b): defaults pending owner confirmation.
