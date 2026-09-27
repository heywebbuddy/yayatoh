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

## M1.5c — tickets with signed QR codes (done)
- **`ticket-crypto` package (universal, no Node APIs):**
  - yy1 code = `"YY1"` + base32(version ‖ kid ‖ ticket id ‖ rev ‖ Ed25519 signature).
  - That is 139 characters and fits a V7-M QR in alphanumeric mode.
  - Verifying needs only the public key, so offline scanners (M1.9) can check codes.
- **Signing keys:**
  - `ticketing.signing_keys` holds one active key per org (`kid`). It is created on first issue.
  - The private key is envelope-encrypted through the `KeyVault` port. The local adapter is AES-256-GCM with the org as AAD (`LOCAL_KMS_KEY`). The production KMS adapter waits on the owner (owner inbox).
- **Issue:**
  - `issueTicketsTx` runs in the same transaction that marks an order paid, on both the free path and the provider-event path.
  - It gives each ticket a per-event serial (under an advisory lock) and a per-org unique short code, retried on collision.
  - Each ticket gets a `ticket_barcodes` row. A second issue for the same order is refused.
- **Web:** the guest order page shows one card per ticket: a server-rendered SVG QR (no client JS), the serial, the short code and the holder. Strings are in 13 locales.
- **CI:** all per-run e2e secrets are masked in logs.

### Acceptance (M1.5c)
| ID | Criterion | Test |
|---|---|---|
| AC1 | A paid order has one signed ticket per unit, with sequential serials and short codes | `packages/testing/tests/tickets.int.test.ts` |
| AC2 | Codes verify with the org's public key and fail with another org's key | `tickets.int.test.ts`, `packages/ticket-crypto/tests` |
| AC3 | Private keys are never stored raw; issue is refused twice for one order | `tickets.int.test.ts` |
| AC4 | The guest sees a QR for each ticket after free and paid checkout | `e2e/checkout.spec.ts` |
| AC5 | Isolation: the fixture covers the new tables; another org sees none of these tickets | `isolation.int.test.ts`, `tickets.int.test.ts` |

## M1.5c2 — contacts, consents and attendees (done)
- **`crm` module (tier 1):**
  - `contacts`: org-scoped, unique on `email_norm` per org.
  - `consents`: an append-only ledger with evidence; the latest row wins, and no row means no consent.
- **`attendees` module (tier 2):** one attendee per ticket, created in the same transaction as the ticket, and linked both ways (`tickets.attendee_id`, `attendees.ticket_id`). `listAttendeesQuery` has server-side search with literal wildcards, behind `AttendeeDto`.
- **Checkout:**
  - The buyer becomes a contact (`orders.buyer_contact_id`).
  - An **unticked** "email me news and offers" checkbox records `email/marketing = granted` with evidence `checkout_checkbox:event:{id}`. Buying alone never records consent.
- **Permissions:**
  - `attendees:read`: owner, admin, manager, box office, viewer.
  - `contacts:read`: owner, admin, manager, marketing.
- **Web:**
  - The attendees page shows real attendees (pass name and ticket code) once an event has any. Seeded showcase events keep the dev demo list until then.
  - A plain seeded event, `lakeside-open-house`, is where purchase flows and e2e create real data.
- **Migration 0012:**
  - Cross-module foreign keys are hand-written, all pointing down the tiers. Existing tables use `NOT VALID` + `VALIDATE`.
  - The two new indexes on existing tables (`orders`, `tickets`) are built in the migration transaction. That is fine before launch (no production data); after launch they must be `CONCURRENTLY` in their own migration.

### Acceptance (M1.5c2)
| ID | Criterion | Test |
|---|---|---|
| AC1 | One contact per email per org, case-insensitive | `packages/testing/tests/attendees.int.test.ts` |
| AC2 | Buying is not consent; the explicit opt-in records consent with evidence | `attendees.int.test.ts` |
| AC3 | Every issued ticket has its own attendee, linked both ways, sharing the holder's contact | `attendees.int.test.ts` |
| AC4 | Organizers list and search attendees; viewers can, scanners can't; another org sees nothing | `attendees.int.test.ts`, `isolation.int.test.ts` |
| AC5 | End to end: a guest buys (one with opt-in), and the organizer finds each ticket's attendee | `e2e/checkout.spec.ts` |

## M1.5c3 — tickets email (done)
- **Subscriber:** `orders.ticket-mailer` subscribes to `order.paid@1` and emails the buyer an `orders.tickets` message: the link, event name and ticket count. The idempotency key is `order-tickets:{orderId}`, and the locale is the order's.
- **Manage token:**
  - It is still looked up only by its hash.
  - It is now also stored envelope-encrypted (`orders.manage_token_ciphertext`, KeyVault), so the worker can build the link. It never enters an event payload.
  - Rotating the token (M1.8 self-service) replaces both columns.
- **Mailer:** `consoleMailer` until SES and React Email templates land (M1.10, owner account).

### Acceptance (M1.5c3)
| ID | Criterion | Test |
|---|---|---|
| AC1 | A paid order emails one tickets link that opens the order; the token isn't in the event payload or stored in clear | `packages/testing/tests/tickets.int.test.ts` |

## Remaining M1.5 increments
- **M1.5c4:** PDF ticket (ADR 0017 spike: react-pdf vs Gotenberg).
- **M1.5d:** promo codes, early-bird tiers, donation tickets, `access_dates`, forms engine v1 (checkout questions).
- **M1.5e:** Stripe adapter for both funds flows (§5.3: direct charge + application fee on connected accounts; platform charge + separate charges & transfers). Wallet passes. **Blocked on the owner:** Stripe test access, Apple Pass Type ID, Google Wallet issuer, and counsel's opinion before live money.
