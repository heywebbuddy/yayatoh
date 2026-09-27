# M1.5 — Ticketing, checkout, tickets, contacts and attendees

**Roadmap:** Phase 1 → M1.5; §5.3 (hybrid funds flow). **Risk tags:** `db-migration`, `payments`, `tenancy` (owner approval).

## M1.5a — ticket types and all-in pricing (this change)
- **`billing.fee_schedules`** (global, per plan × currency) and **`billing.org_fee_overrides`** (tenant; set by platform staff only). Launch rows are **0% / 0** until the owner confirms today's legacy commission (owner inbox).
- **`priceBreakdown`**: free tickets carry no fee; fee = bps share (half-even) + fixed amount.
  - `pass_on` adds the fee to the buyer's price.
  - `absorb` deducts it from the organizer's net.
  - **Every price a buyer sees is the all-in number** (FTC).
- **`ticketing.ticket_types`** (tier 3): composite foreign key to the event; inventory CHECK `sold + held ≤ total`, so nothing can oversell; per-order limits; sales window; public/hidden; soft archive.
- **Commands:** create, update (quantity can't drop below sold + held) and archive. The list query presents the all-in price and fee.
- **Public passes:** read only through `ticketing.public_ticket_types(event_slug)` (published, public/unlisted events; public live types).
  - Returns an availability state (`available` / `sold_out` / `not_yet_on_sale` / `sales_ended`) plus a "few left" hint.
  - No inventory counts leave the database.
- **Kernel:** `moneyFromDecimal` parses user-entered amounts into minor units with no floating-point math.
- **Web:**
  - The Tickets & Orders page lists ticket types with face value and all-in price, and has add and remove actions for writers only.
  - The public event page shows real passes at all-in prices and availability. Checkout arrives in M1.5b, so "Select" is disabled.

## Acceptance (M1.5a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | All-in price = face + fee when passed on; absorbed fees don't change the buyer price; free tickets carry no fee | `billing/tests/fees.test.ts`, `ticketing.int.test.ts` |
| AC2 | Public passes appear only for published events; hidden and archived types never appear; no inventory internals | `ticketing.int.test.ts` |
| AC3 | Invalid limits, windows and prices are rejected; quantity can't go below sold + held | `ticketing.int.test.ts` |
| AC4 | Another org can't add tickets to this event; a viewer can't create them; the isolation fixture covers the new tables | `ticketing.int.test.ts`, `isolation.int.test.ts` |
| AC5 | An owner adds a ticket type and sees it on the public page at the all-in price | `e2e/tickets.spec.ts` |

## Remaining M1.5 increments
- **M1.5b:** orders, holds (10 min, +5 at payment) with a sweeper, checkout for free and paid tickets through the `PaymentProvider` port, backed by a **fake adapter** until the owner's Stripe account exists. Acceptance: 200 concurrent buyers for 10 tickets never oversell; the fee snapshot is immutable; duplicate webhooks fulfil once.
- **M1.5c:** tickets (serial, short code), Ed25519-signed QR with a per-org `kid`, PDF ticket; attendees created at issue; contacts + consents.
- **M1.5d:** promo codes, early-bird tiers, donation tickets, `access_dates`, forms engine v1 (checkout questions).
- **M1.5e:** Stripe adapter for both funds flows (§5.3: direct charge + application fee on connected accounts; platform charge + separate charges & transfers). Wallet passes. **Blocked on the owner:** Stripe test access, Apple Pass Type ID, Google Wallet issuer, and counsel's opinion before live money.
