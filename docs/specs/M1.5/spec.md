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

## M1.5b — orders and checkout (done)
- **`orders` module (tier 4):**
  - `orders` stores status, buyer, totals and the fee-schedule snapshot, the funds flow, the provider payment id, a hashed manage token and the hold expiry.
  - `order_items` stores per-unit face, fee, all-in and organizer-net snapshots.
  - The lifecycle follows roadmap §5.2 with conditional transitions.
- **Checkout (public):**
  - The org and event are resolved server-side from the slug (`events.checkout_target`), and prices are recomputed from the database (`ticketing.quoteTx`).
  - Inventory is held by **one conditional UPDATE per line**, so nothing can oversell.
  - Holds last 10 minutes, extended by 5 when payment starts.
  - A zero-total order is paid at once.
- **Payments (`payments` module, tier 3):**
  - The `PaymentProvider` port, plus a **fake provider** (dev/preview/CI only, refused in production). Its hosted page posts an **HMAC-signed webhook**, and the webhook route verifies the raw body.
  - `applyProviderEvent` is platform-only. It dedupes by provider event id (`payments.provider_events`), checks the amount, currency and payment id, and is the only way a paid order becomes `paid`.
  - Paying after expiry re-holds stock if it is still available; otherwise it emits `order.payment_orphaned` for refund.
- **Sweeper:** the worker releases lapsed holds every 30 s. It finds the orgs through `orders.orgs_with_due_holds` (platform reader), then expires the orders per org under RLS.
- **Web:**
  - Checkout form on the public event page (quantities, name, email).
  - Fake payment page.
  - Guest order page `/orders/{manageToken}`.
  - Recent orders on the Tickets & Orders page.
  - 13-locale strings.
- **CI fix:** Playwright now starts `next start` directly with a bounded graceful shutdown. Before, the e2e job hung after the tests finished.

### Acceptance (M1.5b)
| ID | Criterion | Test |
|---|---|---|
| AC1 | 200 concurrent buyers for the last tickets never oversell; losers get `conflict` | `packages/testing/tests/checkout.int.test.ts` |
| AC2 | Duplicate webhooks fulfil once; mismatched amounts are rejected; a browser cannot mark an order paid | `checkout.int.test.ts` |
| AC3 | Free orders are paid at once; paid orders only after a verified provider event; the sweeper releases holds | `checkout.int.test.ts` |
| AC4 | Guest order page by manage token only, with allowlisted fields | `checkout.int.test.ts`, `e2e/checkout.spec.ts` |
| AC5 | End to end: organizer adds passes → guest buys free and paid tickets → organizer sees both paid orders; a forged webhook gets 400 | `e2e/checkout.spec.ts` |
| AC6 | Isolation: another org can't read these orders or check out into this org's events; the fixture covers the new tables | `checkout.int.test.ts`, `isolation.int.test.ts` |

## Remaining M1.5 increments
- **M1.5c:** tickets (serial, short code), Ed25519-signed QR with a per-org `kid`, PDF ticket; attendees created at issue; contacts + consents.
- **M1.5d:** promo codes, early-bird tiers, donation tickets, `access_dates`, forms engine v1 (checkout questions).
- **M1.5e:** Stripe adapter for both funds flows (§5.3: direct charge + application fee on connected accounts; platform charge + separate charges & transfers). Wallet passes. **Blocked on the owner:** Stripe test access, Apple Pass Type ID, Google Wallet issuer, and counsel's opinion before live money.
