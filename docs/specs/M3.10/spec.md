# Spec: M3.10 — Orders and support console

- **Milestone:** M3.10 (roadmap §10 Phase 3, "M3.10 Orders and support console (L)"; Phase 3 plan `docs/plans/phase-3.md`, Wave A: M3.10a)
- **Status:** M3.10a built (2026-09-28); M3.10b refund operations and M3.10c support tools follow
- **Risk tags:** `db-migration`, `payments`, `tenancy` (owner approval)
- **Related:** M1.5 (inventory, holds, the hold sweeper, guest checkout with email OTP, M1.5f), M1.4b (multi-date events: one date per order, per-date capacity), M1.14 (rate limits, DSAR), M1.8b (bulk export path), M1.2e (impersonation categories), ADR 0015 (event times in the event's zone), ADR 0018 (tokens only)

## M3.10a — waitlists with timed offers (done)

### 1. Goal and users
When a pass (or one date of it) sells out, buyers can wait in line instead of leaving. When places
free up, the next people in line get a timed offer by email that holds the tickets for them; the
offer is bought through the normal checkout. Organizers see and steer each line.

### 2. References
- **Roadmap:** M3.10 ("Waitlists with timed offers; return-to-waitlist"), §4.4 domain (`waitlist_entries`), the registration/enrollment state machines (`waitlisted → offered(ttl) → enrolled | expired | declined`).
- **Phase 3 plan:** Wave A, "M3.10a Waitlists: waitlists with timed offers and return-to-waitlist; offer expiry sweeper".
- **Legacy evidence:** none (Eventmie Pro has no waitlist).

### 3. Scope (built)
**Model** (module `orders`, tier 4, schema `orders`; see §8 for why not `ticketing`):
- `orders.waitlists`: one per ticket type and date (`occurrence_id` null for a single-date event), created by the first person to join. `auto_offer` (default on) and `offer_minutes` (default **1,440 = 24 h**, pending owner; 15 minutes to 7 days).
- `orders.waitlist_entries`: name, email (lower-case), quantity (the pass's per-order limits), locale, status `waiting → offered → accepted | expired | declined`, plus `left` (the person) and `removed` (the organizer). Queue order `(position_at, id)`. An offer holds `offered_quantity` of the pass's stock (`ticket_types.quantity_held`) until `offer_expires_at`. One active place per address per list (partial unique index).

**Joining** (`/events/{slug}/waitlist?pass=…&date=…`, from "Join the waitlist" on a sold-out pass card or under a sold-out date in the date picker):
- Only published, listed events; public passes that are on sale, not seated and not choose-your-amount; a quantity within the pass's per-order limits; and only when the public can't buy that many now (sold out, or everything left is kept for the line). A multi-date event needs the date.
- The address is proved with the **M1.5f email-code helper** (new guest purpose `waitlist`, new email `guest.waitlist-code`): 6 digits, 10 minutes, 5 tries, 30 s cooldown, M1.14 limits `guestCode`/`guestVerify`; a browser that proved the address in the last 30 minutes (checkout included) skips the code.
- **Rate-limited** by the new M1.14 policy `waitlistJoin` (10 per device / 10 min, 10 per address / hour, 30 per anonymous IP, 300 per IP ceiling).
- The page answers with the **place in line** and the person's own link; joining again with the same address returns the same place. **Transactional messages only**: `orders.waitlist-joined` (place and link), `orders.waitlist-offer`, `orders.waitlist-expired`; no consent is recorded and no marketing is sent.

**The person's link** `/waitlist/{entryId}~{hmac}` (purpose `orders.waitlist`; the org comes from `orders.waitlist_entry_org()`, SECURITY DEFINER, live orgs only, ids only): place in line; **leave** (POST button, so mail scanners spend nothing); an open offer (tickets held until a time in the event's timezone, all-in price, checkout); **decline**; **rejoin** after an expired or declined offer; "checked out"; "not on this waitlist". Mobile first, 13 locales, Arabic right to left, `noindex`.

**Freed stock goes to the line first.** Public checkout only holds stock beyond the places people wait for: `holdInventoryTx` takes a per-ticket-type reserve (every waiting quantity of the type's lists), and a date's capacity check adds the date's waiting quantity and its open offers (`occurrenceTakenTx`). The event page shows such a pass as sold out with "Join the waitlist" (`waitlistHeldBack`: ids only). The box office is organizer-collected and not held back (the organizer's call).

**Timed offers and the sweeper.** `orders.sweepWaitlists` runs right after the hold sweeper in the worker (every 30 s, leader only; orgs from `orders.orgs_with_waitlist_work()` via the platform reader, audited; each org under its RLS):
1. Offers past `offer_expires_at` release their stock and become `expired` (`waitlist.offer_expired@1` → "your offer ended, rejoin" email).
2. For each list offering automatically (the list whose front joined first goes first): lock the list (`FOR UPDATE SKIP LOCKED`), the date, then the ticket type (the same date → ticket-type order as checkout), compute the free stock and the date's room, and offer **in strict line order while each whole quantity fits**; the first person who doesn't fit stops the list (a party of four is never starved by singles). Each offer holds its stock and emits `waitlist.offered@1` (email with the checkout link and the end time in the event's timezone; dedupe per offer).

Freed stock comes from any source — a refund, a cancelled ticket, an expired checkout hold, a capacity increase — because the sweeper looks at the stock itself, not at the event that freed it. It is idempotent: a second or concurrent sweeper skips locked lists, stock rows are locked, entries change state conditionally.

**Buying an offer through the normal checkout.** `orders.startCheckout` takes `waitlistToken`: the offer must be open, for this event and date, bought by the address it was made to, only its pass and at most its quantity. The entry becomes `accepted`, the order takes the offer's held stock (no new hold; any places not bought go back), and everything else is the normal checkout (checkout questions, promo codes, risk rules, fees, payment page or instant free order, tickets email). If that order lapses unpaid while the offer's window is still open, the hold sweeper gives the stock back to the offer instead of releasing it (the person can try again); if the provider's payment then arrives late, the order takes the offer's stock back.

**Return to the waitlist: back of the line.** An expired or declined offer may rejoin; it goes to the **back** of the line (new `position_at`). Keeping the place would let one person hold the front of the line — and a day of stock each time — by letting offers lapse repeatedly, while everyone behind waits; the back of the line gives everyone a turn and needs no limit on rejoins.

**Organizer console** (Tickets & Orders → Waitlists, `/o/{org}/e/{event}/tickets-orders/waitlists`; `orders:support`: owner, admin, manager, box office, event managers; viewers, finance and marketing get 404):
- One row per pass and date: people and tickets waiting, open offers, checked out, lapsed or declined, free now, automatic offers on/paused.
- The chosen list's people: open offers, the line in order (position), then history; offer now (any waiting person, out of line order, needs free stock regardless of the line's reserve), remove (an open offer's stock goes back).
- Settings: automatic offers on/paused, offer window in hours (0.25–168).
- **Export** (CSV: position, name, email, tickets, status, joined in the event's timezone) through the bulk-export path: `attendees:export`, a recent step-up, audited `bulk.start` (`orders.waitlistCsv`), category `export` (refused while staff act as a member), CSV-injection safe, downloadable only for the same event.

**Privacy.** Public DTOs are allowlisted (`PublicWaitlistEntryDto` on the person's own link only; `waitlistHeldBack` returns ticket type ids); no counts or people appear on public pages. The column-privacy registry declares `name`/`email` personal. Erasing a person (M1.14c) deletes their places and releases an open offer first; `waitlistDsarTx` lists them.

### 4. Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC1 | Queue order (position, then id); rejoin goes behind everyone waiting; strict line order: the front must fit, nobody behind is served first; date room caps offers | `packages/modules/orders/tests/waitlist.test.ts` |
| AC2 | Offer windows: 24 h default, end instant closed, 15 min – 7 days, whole minutes; only expired/declined may rejoin | `waitlist.test.ts` |
| AC3 | Join only a sold-out pass of a published event, within per-order limits; the same address keeps its place; the join event is emitted once; the link shows the place; forged links are not found | `packages/testing/tests/waitlist.int.test.ts` |
| AC4 | Freed stock (expired hold, capacity increase) is kept from public buyers and offered exactly once, in order, with 10 sweepers and 10 buyers racing; the sweeper is idempotent | `waitlist.int.test.ts` |
| AC5 | An accepted offer checks out through `startCheckout` with the held stock: wrong address, too many or a forged link refused; unbought places go back; the link is spent; payment sells it | `waitlist.int.test.ts` |
| AC6 | An offer order that lapses unpaid gives its stock back to the open offer (not the next person); a late payment reclaims it | `waitlist.int.test.ts` |
| AC7 | Expiry returns the stock and passes it to the next person in the same sweep; expired links can't buy; rejoin goes to the back; decline passes it on; leaving releases an open offer | `waitlist.int.test.ts` |
| AC8 | Dates: a date needs its own line and its capacity decides; other dates keep selling; the public can't take the date's waited-for place; the offer is for its date only | `waitlist.int.test.ts` |
| AC9 | Console: counts, pause stops automatic offers, manual offer out of order with the list's window, not enough stock refused, remove releases the offer, resume offers again; audited | `waitlist.int.test.ts` |
| AC10 | Export: step-up required, viewers forbidden, another org not found, CSV in line order with the event's time and escaped names, `bulk.start` audited | `waitlist.int.test.ts` |
| AC11 | Permissions and isolation: viewers refused on every console query and command; the public can't sweep; another org sees nothing, can't act on or join, and its sweeper never touches this org's line; link tokens resolve to their own org only; fixture rows for both orgs | `waitlist.int.test.ts`, `isolation.int.test.ts` |
| AC12 | DSAR erasure deletes the places and releases an open offer | `waitlist.int.test.ts` |
| AC13 | Browser: join from the sold-out page by keyboard (name required, emailed code), place in line, confirmation email; the organizer cancels a ticket; the offer email arrives; the place stays sold out to others; the guest checks out from the offer (free order); the link then says checked out; axe on each page | `apps/web/e2e/waitlist.spec.ts` |
| AC14 | Browser: an expired offer passes to the next person and emails the first, who rejoins by keyboard at the back; the next person declines in Arabic (RTL, axe) and the place goes back to the first | `waitlist.spec.ts` |
| AC15 | Browser: the organizer sees counts, pauses automatic offers (bad window refused), offers by hand out of order by keyboard, is refused without stock, removes someone, exports the CSV after a step-up; a viewer has no link and gets 404 | `waitlist.spec.ts` |
| AC16 | Email kinds and web strings in 13 locales with valid ICU plurals | `packages/modules/notifications/tests/render.test.ts`, `apps/web/tests/messages.test.ts` |

### 5. Migration (to be renumbered at merge)
`packages/db/drizzle/0066_ancient_dazzler.sql`: new tenant tables `orders.waitlists` and `orders.waitlist_entries` (`tenantTable`, ENABLE + FORCE RLS, org-leading indexes, composite FKs `waitlist_entries_waitlist_fk`, `waitlist_entries_order_fk`, partial uniques). Hand-written (between `-- hand-written: begin/end`):
- `guest_challenges_purpose_check` widened with `'waitlist'` (drop, then add `NOT VALID` + `VALIDATE CONSTRAINT`).
- Cross-module composite FKs down the tiers: `waitlists_event_fk` → `events.events`, `waitlists_ticket_type_fk` → `ticketing.ticket_types`, `waitlists_occurrence_fk` → `events.occurrences` (new tables, no `NOT VALID` needed).
- SECURITY DEFINER `orders.waitlist_entry_org(uuid)` (live orgs only; `REVOKE … FROM PUBLIC`, `GRANT EXECUTE … TO app_user`) and `orders.orgs_with_waitlist_work(integer)` (`GRANT EXECUTE … TO platform_reader`).

### 6. Changes to existing code
- `ticketing`: `holdInventoryTx(tx, lines, reserve?)` takes the places kept back; new `ticketTypeStockTx`.
- `orders`: `claimOccurrenceTx` counts open offers (and, for public checkout, the date's line) through `occurrenceTakenTx`; `startCheckout` (reserve, `waitlistToken`), `expireOrders` (`keepOfferHoldTx`), `applyProviderEvent` after expiry (`reclaimOfferHoldTx`); `eraseOrdersDsarTx` also erases places.
- Worker: `sweepWaitlists` after `sweepExpiredHolds`; `waitlistMailer` subscriber (also in the web's dev drain); `waitlistExportAction` registered with the bulk runners (web, worker, testing).
- Web: `waitlistHeldBack` on the event page (sold-out + "Join the waitlist" on pass cards and sold-out dates), the join page, the person's link page, the console page and its export route, `/api/dev/waitlist/sweep` (dev/CI only: runs the sweeper, optionally `hours` later).

### 7. Pending owner (owner inbox)
- The **24-hour default offer window**, and the 15 min – 7 day range organizers may set.
- **Back of the line** on rejoin (rather than keeping the place).
- **Strict line order** (the front of the line must fit before anyone behind is offered), and that paused lists still keep freed stock for their line.
- Waitlists **on for every public pass** that sells out (no per-event switch yet), and **not** for seated passes, choose-your-amount passes, hidden passes or private events.
- The box office is not held back by waitlists.
- The `waitlistJoin` rate limits.

### 8. Decisions and deviations
- **Module:** the roadmap lists `waitlist_entries` under `ticketing` (tier 3). They live in `orders` (tier 4) because a waitlist's lifecycle is tied to checkout (the offer is bought through `startCheckout`, lapsed offer orders give their stock back, guest email verification lives in `orders`), and a tier-3 module cannot call checkout. Inventory stays owned by `ticketing` (the only writer of `quantity_held`).
- **Across the dates of one pass:** the pass's stock is shared, so its reserve counts every date's line. A line whose date is full keeps the pass's stock held back from the public until the organizer removes those people or pauses/offers by hand (the console shows free stock per list).

### 9. Later
- A per-event "no waitlist" switch; waitlists for seated passes (seat holds per offer) and choose-your-amount passes.
- SMS/WhatsApp offers (M3.5b providers); a reminder a few hours before an offer ends.
- Purging entries of past events (retention job); showing the line on the /v1 API.
- An organizer-facing "offer to the next N" bulk action.
