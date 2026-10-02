# Spec: M5.1 — Advanced registration

- **Milestone:** M5.1 (roadmap §10 Phase 5, "M5.1 Advanced registration (L)"; Phase 5 plan `docs/plans/phase-5.md`, Wave 1: M5.1a)
- **Status:** M5.1a built (2026-09-29); M5.1b (multi-page forms), M5.1c (approval, groups, +1) and M5.1d (invoice, PO, pay later) follow
- **Risk tags:** `db-migration`, `payments` (checkout path), `tenancy` (owner approval)
- **Related:** ADR 0021 (conference module layout, written here), ADR 0001, 0002, 0003, 0013, 0014; M1.5 (inventory, holds, checkout, M1.5f email codes), M3.10a (waitlists with timed offers), P5-1, P5-5, P5-10, P5-11

## M5.1a — registration types and admission items (done)

### 1. Goal and users
Conferences sell **who** registers (Member, Non-member, Student, Exhibitor, Speaker, VIP) separately from
**what** they buy (full pass, day pass, workshop add-on, dinner), with a price per combination, a
capacity per type, and rules on who may pick a type. Organizers set this up on the conference
profile's **Registration** page; buyers see only the types open to them. Inventory, orders,
refunds and check-in stay the one system they are today.

### 2. References
- **Roadmap:** M5.1 ("Registration types × admission items … per-type capacity; waitlist"), §3.5 (tiers), §4.5 (profiles, entitlements), §5.1–5.2.
- **Phase 5 plan:** P5-1 (behind the `registration` key), P5-5 (pay later is per registration type: room left, nothing modeled), P5-10, P5-11 (conference pack).
- **Legacy evidence:** none (Eventmie Pro has no registration types).

### 3. Scope (built)
**Layout (ADR 0021).** New modules `registration` (tier 5), `badges` (tier 5), `engagement` (tier 4); `program` stays one package (tier 3) and grows in sub-areas; lead licenses and leads live in program's exhibitors area with consent read through a narrow interface. Roadmap §3.5 is unchanged.

**Module `packages/modules/registration`** (tier 5, schema `registration`, `MODULE.md`):
- `registration_types` (per event): key, name, description, order, `capacity` (null = no limit), the counter `quantity_held` + `quantity_sold` with the CHECK `held + sold ≤ capacity`, eligibility `open | access_code | email_domain` (code stored normalized; up to 20 domains, subdomains match), archived.
- `admission_items` (per event): key, name, description, kind `admission` (a pass; exactly one per registration) or `add_on`.
- `type_items` (the matrix cells): each enabled cell is **one ticket type** created with `managed_by = 'registration'` (hidden, one per order, named "Type · Item", priced per cell). Disabling archives the pass and the cell; re-enabling makes a new cell.
- `capacity_claims`: what each order counts against its type, as last applied to the counter.
- `RegistrationTypeRef` (id, key, name) and `registration.typeRefs` for M5.1b form paths and badges.

**Managed ticket types (ticketing).** `ticket_types.managed_by` (null or `registration`). `quoteTx` refuses a managed pass to every caller but its manager (so public checkout, the box office, access codes and `/v1` cannot sell it); the ticket-type update/archive commands refuse it (`invalid_state`, reason `managed`); registration edits through `createTicketTypeTx` / `updateTicketTypeTx` / `archiveTicketTypeTx`. `TicketTypeDto` gains `managedBy` (console only; `/v1` wire unchanged).

**Checkout (`registration.startCheckout`, `public:checkout`).** One registrant: a type, one admission item, any add-ons, each once. In one transaction: lock the type row → eligibility (refused with `forbidden`, reason `code_required` / `code_wrong` / `domain_not_allowed`, whatever the client sent) → items offered to the type → room left beyond the type's line (places waited for and open offers kept back) → orders' `startCheckoutTx` (the ordinary checkout, ticketing hold included) → the place claimed on the counter (conditional update; the CHECK is the backstop) → the claim row. A free registration is sold at once.

**Release exactly once (`registration.capacity` subscriber).** On `order.paid`, `order.expired`, `order.refunded`, `order.payment_orphaned` and `tickets.cancelled` (all v1) the order's claim is **recomputed** from orders and tickets (held = items while the order holds stock; sold = active admission tickets once paid) and only the difference reaches the counter. Replays, duplicates and reordered events change nothing. Only admission tickets count: refunding the dinner keeps the registrant's place. A late payment that no longer fits is left uncounted and emits `registration.type.over_capacity@1`.

**Per-type waitlist (M3.10a, no new engine).** A full type's buyer joins the M3.10a line of the admission item they want (`registration.joinWaitlist`, `public:waitlist`, eligibility checked, refused while places are open). Lines of managed passes have automatic offers off; the organizer's console refuses manual offers and turning auto-offer on (`managed`). When places free (a release, `waitlist.offer_expired@1`, the new `waitlist.offer_released@1` for left/declined/removed offers, or a capacity raise), registration offers them through `offerWaitlistEntryTx` in one queue across the type's lines, strict line order; open offers count against the type, so each place is offered once. The offer email is M3.10a's; its link checks out through registration (the waitlist page routes managed passes to `registration.startCheckout`), and eligibility was checked at join (orders still checks the address).

**Conference pack (P5-11).** `billing.addons` (global catalog; `conference_pack`: modules, `price_minor` null = free in beta, quotas `registrationTypes` 30, `admissionItems` 20, `registrants` 5,000) and `billing.event_addons` (per event: source `beta_free | purchase | override`, price snapshot). Setup commands activate it (`beta_free`) and enforce the quotas; checkout enforces `registrants`. A catalog price later makes activation a purchase with no code change here (`addon_purchase_required`).

**Console page** `/o/{org}/e/{event}/registration` (conference profile nav; 404 for profiles without the item): pack status; empty state with "Add standard types and items" (names in the organizer's language); types with eligibility summary, "taken of capacity" and waitlist counts, an edit form (name, description, capacity, who may register, access code, email domains, order) and archive; items with kind; the **type × item matrix** as a table (a labelled price field and Offer / Save price / Stop offering buttons per cell, in a keyboard-focusable scroll region). Viewers see it read-only.

**Public page** `/events/{slug}/register` (linked from the event page's passes section): email and optional code first ("Show my options", rate-limited by the new M1.14 policy `registrationLookup`), then only the types this buyer may pick with their all-in price range and "Full"; one pass (radio) and add-ons (checkboxes), full name; the emailed code (M1.5f, always, so domain eligibility means a proved address); then the payment page or the order. A full type offers "Join the waitlist" instead.

**House rules.** Every write is a `tenantCommand` with `entitlement: 'registration'` (P5-1), `events:write` (organizer) or `public:*`; events `registration.type.{created,updated,archived}@1`, `registration.item.{…}@1`, `registration.cell.{enabled,disabled}@1`; public output through `PublicRegistrationDto` (types: name, description, price range, full; items: name, description, kind, price); every text column declared in `private-columns.ts` (the access code `holder`, domains `internal`); 13 locales, Arabic RTL, logical CSS, tokens only, no inline styles.

### 4. Acceptance
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M5.1a-01 | Per-type capacity 20, **50 concurrent checkouts** → exactly 20 succeed, the rest `type_full`; the counter and claims agree; the CHECK refuses a write past capacity | `packages/testing/tests/registration.int.test.ts` (integration) |
| AC-M5.1a-02 | Release on expiry, cancel (no refund) and refund **exactly once** under replayed events; paid moves held → sold; an add-on refund keeps the place | same (integration) |
| AC-M5.1a-03 | **Ineligible buyer refused in the command** with a forged request (no code, wrong code, other domain, look-alike domain), for checkout and the waitlist; a forged public checkout naming the managed pass is `not_found` | same (integration) |
| AC-M5.1a-04 | Waitlist: a full type takes a line; a freed place is offered to the head of the type's line once; the public can't take it; the offer is bought with its link; a capacity raise offers at once; an offer on a code-only type is bought with the link alone, only by its address | same (integration) |
| AC-M5.1a-05 | Entitlement off (`registration` revoked) refuses queries, organizer commands and checkout (`module_not_enabled`) | same (integration) |
| AC-M5.1a-06 | Isolation: rows for both orgs in every new table (`createOrgFixture`); another org sees nothing and cannot buy | `isolation.int.test.ts`, `registration.int.test.ts` |
| AC-M5.1a-07 | Type × item mapping, eligibility (code, domain, subdomain), capacity maths, strict line-order offers | `packages/modules/registration/tests/domain.test.ts` (unit) |
| AC-M5.1a-08 | Organizer by keyboard: seed defaults, add a code-only and a domain-only type (validation errors shown), set capacity, set matrix prices (bad price refused), persisted after reload; axe clean; no horizontal page scroll | `apps/web/e2e/registration.spec.ts` (e2e ×3 viewports) |
| AC-M5.1a-09 | Buyer: the event page links to registration; ineligible buyers never see code/domain types; eligible buyer registers (keyboard, emailed code, payment); a full type offers its waitlist and joins it | same (e2e) |
| AC-M5.1a-10 | Viewer `jordan@lakeside.test`: page read-only (no write controls, axe clean); the owner's open forms submitted as the viewer are refused | same (e2e) |
| AC-M5.1a-11 | Arabic: console page and public registration render right-to-left, axe clean | same (e2e) |
| AC-M5.1a-12 | Messages in 13 locales with identical keys | `apps/web/tests/messages.test.ts` |

### 5. Migration (`0076_left_doomsday`)
New schema `registration` (4 tenant tables, FORCE RLS), `billing.addons` (global) and `billing.event_addons` (tenant), `ticketing.ticket_types.managed_by`. Hand-written, between `-- hand-written` markers: the `ticket_types_managed_by_check` CHECK added `NOT VALID` then validated; `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON billing.addons FROM app_user` and the `conference_pack` seed row; composite FKs down the tiers (`registration_types`, `admission_items`, `type_items`, `capacity_claims` → `events.events`; `type_items` → `ticketing.ticket_types`; `capacity_claims` → `orders.orders`). Additive only.

### 6. Changes to existing code
- ticketing: `managed_by`, `quoteTx` `manager`, `createTicketTypeTx` / `updateTicketTypeTx` / `archiveTicketTypeTx`, `ticketTypeStockTx` returns `managedBy`, `TicketTypeDto.managedBy`.
- orders: `startCheckoutTx`, `joinWaitlistTx`, `offerWaitlistEntryTx` (manual offers and auto-offer refused on managed lines), `waitlistDemandTx`, `waitingEntriesTx`, `waitlistEntryByTokenTx`, `orderStockTx`; new event `waitlist.offer_released@1` (left, declined, removed).
- billing: add-on catalog and `ensureEventAddonTx` / `eventAddonTx`.
- platform: M1.14 policy `registrationLookup`.
- web: Registration page, public registration page, event page link, waitlist offer checkout routed through registration for managed passes, `guestEmailStep` purpose `checkout`; worker and dev drain run `registration.capacity`.

### 7. Pending owner (owner inbox)
- Conference pack quotas (30 types, 20 items, 5,000 registrants per event) and its price (null = free in beta; D22).
- Registration always asks for the emailed code (even when the org turned the checkout email check off), so domain eligibility means a proved address.

### 8. Decisions and deviations
- **No second inventory:** capacity per type is a counter over ordinary tickets; the per-type limit is the only extra rule. Items have no capacity of their own yet (M5.2b: availability by admission item).
- **One registrant per checkout.** Groups and +1 are M5.1c.
- **Box office** cannot sell managed passes (refused as `not_found`); registration at the door is a later increment.
- Releases are eventually consistent (the subscriber), claims are immediate; a place freed by an expiry is kept back from nobody meanwhile (the counter is conservative).

### 9. Later
- M5.1b multi-page forms per registration type (keyed by `RegistrationTypeRef`); M5.1c approvals, groups, +1; M5.1d invoices, PO and pay later per type (P5-5); M5.2b availability by admission item and session enrollment; M5.5a badges by type; registration at the box office; day passes bound to access dates.
