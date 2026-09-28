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

## M1.5c4 — ticket PDF (done)
- **ADR 0017 accepted:** Gotenberg (Chromium). The spike found react-pdf's Arabic shaping broken and no tagged-PDF support, while Gotenberg was correct for Arabic, Hindi and Japanese and produced tagged output with `/Lang`.
- **`packages/pdf`:**
  - The `PdfRenderer` port and the Gotenberg adapter.
  - The `ticketsHtml` template: one A6 page per ticket, logical CSS, system Noto fonts, every value escaped, no remote assets.
  - `qrPath`, which the web order page reuses.
- **Web:**
  - `GET /{locale}/orders/{token}/pdf` returns the buyer's tickets as a PDF (`private, no-store`, `noindex`); an unknown token gets 404.
  - The order page shows "Download tickets (PDF)" only when `GOTENBERG_URL` is set.
  - The public order now includes an allowlisted event summary: name, times, timezone, place and organizer.
- **Ops:** Gotenberg 8.37.0 in `docker-compose.yml` and as a CI e2e service container. Production runs it on Fly (ADR 0004); that waits on the owner's Fly account, already in the inbox.

### Acceptance (M1.5c4)
| ID | Criterion | Test |
|---|---|---|
| AC1 | The template sets `lang`/`dir`, renders one page per ticket with its QR, escapes all values and loads nothing remote | `packages/pdf/tests/tickets.test.ts` |
| AC2 | The adapter posts tagged-PDF HTML to Gotenberg | `packages/pdf/tests/tickets.test.ts` |
| AC3 | A guest downloads their tickets PDF by manage token (application/pdf, no-store); an unknown token gets 404 | `e2e/checkout.spec.ts` |

## M1.5d1 — promo codes (done)
- **`ticketing.promo_codes`:**
  - Event-scoped and upper-case, unique per event.
  - `percent` (basis points) or `amount` (minor units) off **each ticket's face price, before fees**, so fees are charged on the discounted price and the all-in total stays honest.
  - Optionally limited to some ticket types, with an optional window, maximum uses and on/off switch.
- **Checkout:**
  - `resolvePromoTx` reports every failure (unknown, paused, outside its window, used up, or nothing to discount in this cart) as the same `promo_invalid`, so codes can't be probed one condition at a time.
  - A use is claimed with a conditional UPDATE in the checkout transaction and returned when the hold expires. If the buyer pays after expiry, the use is re-counted when one is left.
- **Orders:** snapshot `discount_minor`, `promo_code_id`/`promo_code`, and per-item `unit_discount_minor`. Migration 0014 is additive; new CHECKs on existing tables use `NOT VALID` + `VALIDATE`, and the FK to `ticketing.promo_codes` is hand-written.
- **Web:**
  - The Tickets & Orders page gets a promo code list (uses, pause/resume) and an add form.
  - Checkout gets an optional promo code field.
  - The order page notes "Includes {amount} off with {code}".
  - Strings are in 13 locales.

### Acceptance (M1.5d1)
| ID | Criterion | Test |
|---|---|---|
| AC1 | The discount comes off the face price before fees; codes are case-insensitive | `packages/testing/tests/promo.int.test.ts` |
| AC2 | Amounts are capped at the face price; codes limited to some passes don't apply to others; a code that discounts nothing is refused | `promo.int.test.ts` |
| AC3 | Unknown, paused, not-yet-started and ended codes are all just "not valid" | `promo.int.test.ts` |
| AC4 | 50 concurrent checkouts never use a 5-use code more than 5 times; an expired hold returns its use | `promo.int.test.ts` |
| AC5 | Viewers can't create codes; another org sees none; the fixture covers the table | `promo.int.test.ts`, `isolation.int.test.ts` |
| AC6 | End to end: an organizer adds a one-use code, the first guest saves 25%, and the second is told it's not valid | `e2e/promo.spec.ts` |

## M1.5d2 — early-bird, donation and multi-day passes (done)
- **`ticket_types` additions:**
  - `early_price_minor` + `early_ends_at` (legacy `sale_price` window): charged until the end instant, which the organizer sets in event time.
  - `is_donation` (legacy "choose-your-amount"): `price_minor` becomes the minimum.
  - `access_dates` `[{date, name}]` (legacy multi-day entitlement): stored sorted and unique, and shown on the pass. Check-in enforces them in M1.9.
  - The early price must be below the regular price and needs an end; a donation pass has no early price. These rules are checked on create, on the merged row at update, and by DB CHECKs (`NOT VALID` + `VALIDATE`).
- **Quote:**
  - A donation line must carry `amountMinor` ≥ the minimum (`donation_amount` otherwise); a fixed-price line must not.
  - Promo codes never discount donations.
  - The public page shows the early price, the "(then {regular})" note and access-date chips via `ticketing.public_ticket_types_v2` (expand; v1 is dropped later).
- **Bug fix (all update commands):** Zod `.partial()` kept `.default()`s, so updating one field silently reset the others (for example, event currency → USD, org profile → default, ticket description → null). The new `partialNoDefaults` in `@yayatoh/contracts` is now used by the ticket type, event and organization updates, with a regression test for each.

### Acceptance (M1.5d2)
| ID | Criterion | Test |
|---|---|---|
| AC1 | The early-bird price is charged and shown with the regular price until it ends, then the regular price | `packages/testing/tests/pricing.int.test.ts` |
| AC2 | An early price at or above the regular price, or without an end, is rejected on create and on update | `pricing.int.test.ts` |
| AC3 | Donations charge the chosen amount, never below the minimum; promo codes don't apply to them | `pricing.int.test.ts` |
| AC4 | Access dates are stored sorted and unique, and returned publicly | `pricing.int.test.ts` |
| AC5 | Updates change only the fields they name (tickets, events, orgs) | `pricing.int.test.ts`, `events.int.test.ts`, `tenancy.int.test.ts`, `contracts/tests/partial.test.ts` |
| AC6 | End to end: an organizer adds early-bird, donation and multi-day passes; the public page shows them; a too-low donation is refused and a valid one is charged | `e2e/pricing.spec.ts` |

## M1.5d3 — forms engine v1: checkout questions (done)
- **`forms` module (tier 1):**
  - `forms` (one per kind and subject), `form_versions` (immutable JSON definitions) and `form_responses` (each points at the exact version answered).
  - Field types: short/long text, number, count, one choice, several choices, checkbox. Each field can be required and/or private.
  - Conditions (`showIf`) use a safe JsonLogic subset (`var == != > >= < <= in and or !`); anything else is rejected at publish.
- **Answers:**
  - Validated server-side in the checkout transaction: unknown keys rejected, hidden fields dropped, counts are whole numbers ≥ 0, choices must match an option. A bad answer fails the whole order with `form_invalid` and the question's key.
  - Private answers are stored as one KeyVault envelope.
- **Web:**
  - The Tickets & Orders page lists the questions (reorder and remove through buttons, no drag), has a one-click "guest counts" preset (legacy kids/seated/standing, labels in the organizer's language) and an add form.
  - The public checkout shows the questions with conditions applied as you answer.
  - The orders table shows answers in question order, with choice labels.
  - Strings are in 13 locales.
- **Deviation from roadmap §4.4:** answers are JSON on the response row for now; a normalized `form_answers` table arrives with reporting (M3+).

### Acceptance (M1.5d3)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Definitions reject duplicate keys, stray options and unsafe conditions; the evaluator handles the subset | `packages/modules/forms/tests/definition.test.ts` |
| AC2 | Every publish writes a new version; old answers stay tied to theirs | `packages/testing/tests/forms.int.test.ts` |
| AC3 | Valid answers are stored and normalized, hidden ones dropped, private ones encrypted (no plaintext in the DB) | `forms.int.test.ts` |
| AC4 | An invalid answer names the question and rolls back the order; an event without questions accepts no answers | `forms.int.test.ts` |
| AC5 | Viewers can't publish; another org sees nothing; the fixture covers all three tables | `forms.int.test.ts`, `isolation.int.test.ts` |
| AC6 | End to end: an organizer adds a guest-count preset and a required choice question and reorders them; a guest answers; the organizer reads the answers | `e2e/questions.spec.ts` |

## Remaining M1.5 increments
- **M1.5e2:** wallet passes. **Blocked on the owner:** Apple Pass Type ID, Google Wallet issuer. Live money also waits for counsel's opinion (roadmap §5.3).

## M1.5f — organizer-collected sales: box office, Zelle, cash (done)

Roadmap §5.3 "organizer-collected sales" and §4.4 receipt variant.

- **Who:** the new `orders:sell` permission — owner, admin, manager, box office, and event managers for their event. Finance and viewers cannot sell.
- **What:** `orders.recordBoxOfficeSale` sells from the same all-in quote as online checkout (hidden passes included, donations excluded), takes stock atomically (never oversells), and marks the order paid at once with `created_via = box_office`, `collected_by = organizer`, the method (`cash`, `zelle`, `card_terminal`, `other`) and an optional reference. Tickets are issued and `order.paid@1` is emitted, so the tickets email goes out like an online sale. A published event is required, and staff's "pause checkout" also pauses the box office.
- **Money:** no charge exists. The organizer holds the money, so the platform fee becomes their **receivable** (`org:receivable` +fee; `platform_fee_deferred` −fee), netted from their next release (M1.6c). Free and zero-fee sales post nothing.
- **Receipts:** the buyer's order page says "Payment collected by {Org}" instead of the "Sold by" line; the console order page shows "Collected by you · method · reference".
- **Refunds:** money the organizer holds is refunded in person. The refund form is hidden for these orders, and `orders.startRefund` refuses them (`no_payment`). Recording an in-person refund (void tickets, reverse the fee receivable) comes with the M3.10 orders console.
- **Later:** walk-up buyers without an email (printed tickets), card-present payments on the platform (Stripe Terminal), invoicing the receivable when there is nothing to net it from.

### Acceptance (M1.5f)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Only published events; tickets issued at once, organizer-collected, same all-in price, hidden passes included; the fee becomes a receivable with no platform cash; `order.paid@1` emitted; provider refunds refused | `packages/testing/tests/box-office.int.test.ts` |
| AC2 | Never oversells | `box-office.int.test.ts` |
| AC3 | Box office staff can sell; finance and viewers cannot; other orgs never see the order | `box-office.int.test.ts`, `packages/modules/tenancy/tests/permissions.test.ts` |
| AC4 | In the browser: an organizer records a Zelle sale, opens the order, sees "Collected by you · Zelle · ZL-777", two valid tickets and no refund form; axe passes | `apps/web/e2e/box-office.spec.ts` |

## M1.5e1 — Stripe adapter for both funds flows (done; live test-mode run pending network access)

Roadmap §5.3. `stripePaymentProvider` in `@yayatoh/payments` implements the whole `PaymentProvider` port with the official SDK (`stripe` 22.6.2, API version pinned to `2026-08-26.dahlia`).

- **Choosing the provider:** `PAYMENTS_PROVIDER=stripe` with `STRIPE_SECRET_KEY` and at least one webhook secret; otherwise the fake provider stays the default, so adding test keys never switches the dev personas or the e2e suites off the fake pages (`paymentProviderFromEnv`). Live keys (`sk_live_`/`rk_live_`) are refused outside production.
- **Charges:** a hosted **Checkout Session** per order attempt (idempotency key per attempt, 30-minute session, one line named after the event, buyer email, `client_reference_id` and metadata = org, order and funds flow).
  - `organizer_mor`: a **direct charge** on the connected account (`Stripe-Account`) with `application_fee_amount` = the platform fee (legacy's model).
  - `platform_mor`: a charge on the platform account; money moves later by transfer at release.
  - The order's provider payment id is the Checkout Session id; refunds and disputes resolve its PaymentIntent.
- **Webhooks** (`/api/webhooks/stripe`, shared handler with the fake route; only the configured provider's route answers, the other is a 404): verified on the raw body against the platform and the Connect endpoint secrets. `checkout.session.completed` (paid) and `async_payment_succeeded` → paid; `async_payment_failed` and `expired` → failed; a completed session still `unpaid` (bank debits) waits; `account.updated` → the payout account; `charge.dispute.created/closed` → the dispute, matched to the order's session by PaymentIntent on the right account. Other apps' sessions and other event types are acknowledged (200) and ignored. Dedupe, amount/currency/payment-id checks and fulfilment are the existing order commands.
- **Refunds:** on the connected account for `organizer_mor`, then exactly the policy's share of the application fee as its own fee refund (not Stripe's pro-rata flag); on the platform for `platform_mor`. Pending refunds report `pending`; rejected ones `failed`.
- **Transfers and reversals:** `transfer_group` per event, explicit reversals; Stripe's refusals come back as `failed` (the settlement retries; a failed reversal stays a receivable).
- **Connect:** Standard-equivalent accounts (`controller`: full dashboard, the account pays fees, Stripe covers losses) tagged with the org, hosted onboarding links, Payment Method Domains registered once per host and account.
- **Disputes:** reviewed evidence submitted as text (`submit: true`); attaching the packet PDF as a Stripe file comes with the live run.
- **The hosted payment page** shows what is being paid for (the event name), on Stripe and on the fake page.
- **Live test-mode smoke:** `PAYMENTS_PROVIDER=stripe pnpm --filter @yayatoh/payments stripe:smoke` (not in CI). This environment currently blocks `api.stripe.com` (owner inbox).
- **Later:** Stripe Tax and Radar rules, `source_transaction` on transfers, embedded onboarding components, the dispute packet as a file, application-fee reconciliation (M1.6).

### Acceptance (M1.5e1)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Direct charges carry `Stripe-Account` and the application fee; platform charges carry neither; every write has its idempotency key | `packages/modules/payments/tests/stripe.test.ts` |
| AC2 | Webhooks are verified on the raw body (both endpoints' secrets); tampered, unsigned and foreign-signed bodies are refused; every event type maps as specified; unknown ones are acknowledged | `stripe.test.ts` |
| AC3 | Refunds route to the right account with the exact fee share; transfers, reversals and evidence map Stripe's refusals to `failed` | `stripe.test.ts` |
| AC4 | The provider is only Stripe when chosen, with its key and a webhook secret | `packages/modules/payments/tests/config.test.ts` |
| AC5 | On a real database: session → signed webhook → order paid once (replay is a duplicate), a mismatched amount is refused, the refund hits the session's PaymentIntent, a dispute finds its order, other apps' events are ignored | `packages/testing/tests/stripe-flow.int.test.ts` |
| AC6 | In the browser: the payment page names the event; the Stripe webhook endpoint is a 404 while Stripe is off | `apps/web/e2e/checkout.spec.ts` |


## M1.5e3 — Stripe TEST-mode verification (done, 2026-09-28)

The owner's Stripe **test** keys were in the session environment (a `sk_test_` secret key and a `pk_test_` publishable key; no webhook secret). Only the manual scripts below called Stripe; automated tests and CI keep the fake provider and a fake Stripe API. No key was printed, written to a file or committed.

**What ran**
- `PAYMENTS_PROVIDER=stripe pnpm --filter @yayatoh/payments stripe:smoke`: a platform Checkout Session (`cs_test_a1ev3A…`) and a connected account with an onboarding link (`acct_1UKSwh…`, closed afterwards). It failed twice first, which found the two fixes below.
- New `pnpm --filter @yayatoh/payments stripe:contract [-- --capture] [-- --account acct_…]` (not in CI): exercises every call `stripePaymentProvider` makes and asserts the adapter parses the real answers. **11/11 steps passed** (last run):
  1. `platform_mor` Checkout Session: amount, metadata, Managed Payments off, hosted URL.
  2. Connect account (Accounts v2, Standard-equivalent), idempotent per org, `accountState` parses the v1 view, org metadata present, hosted onboarding link on `connect.stripe.com`.
  3. A test merchant account onboarded **by API with Stripe's test data** (dashboard `none`, platform-collected requirements: test identity, `address_full_match`, SSN `000000000`, `btok_us_verified`, `accessible.stripe.com`) reaches `charges_enabled` + `payouts_enabled`. Stripe's verification takes one to several minutes; `--account` reuses one that is already active. A full-dashboard (Standard) account cannot be onboarded by API (Stripe owns its requirements and refuses API terms-of-service acceptance): that needs the hosted onboarding.
  4. `organizer_mor` direct-charge Checkout Session with the application fee, on the connected account.
  5. `organizer_mor` refund on the connected account plus exactly 200 of the 500 application fee refunded (checked on the fee object).
  6. `platform_mor` partial refund; replaying the idempotency key returns the same refund.
  7. Transfer at release to the connected account, an explicit transfer reversal, and an impossible reversal reported as `failed` (the debt stays a receivable).
  8. A transfer to an account without the transfer capability fails cleanly (`insufficient_capabilities_for_transfer`).
  9. A test dispute (`pm_card_createDispute`), the evidence packet uploaded to `files.stripe.com` as a PDF and attached (`uncategorized_file`), `submit: true` (Stripe's `winning_evidence` text closes it as won).
  10. `balance_transactions` (daily reconciliation, M1.6e): every movement of the run attributed to the org and the ledger reference.
  11. Real event payloads from `events.list` (about 100 across the runs) signed locally with a throwaway secret and run through `verifyWebhook`: none throws; `checkout.session.completed` → paid, `expired` → failed, dispute events → ignored when the payment has no Yayatoh Checkout Session, everything else acknowledged as ignored.
- `node apps/web/scripts/stripe-hosted-checkout.ts`: **a hosted Checkout Session paid with 4242 4242 4242 4242 in headless Chromium** (`payment_status: paid`). The page needed `checkout.stripe.com`, `js.stripe.com`, `m.stripe.network`, `m.stripe.com`, `r.stripe.com`, `b.stripecdn.com`, `api.stripe.com`, `merchant-ui-api.stripe.com`, `checkout-cookies.stripe.com`, `*.hcaptcha.com`, and for the wallet buttons `applepay.cdn-apple.com`, `smp-paymentservices.apple.com`, Amazon Pay and Klarna hosts: all reachable. Chromium had to trust the egress proxy's CA (added to its NSS store in this container; nothing in the repo). The return URL's host (`example.test`) is not reachable, which is expected.
- Cleanup: every connected account the runs created was closed (Accounts v2 `close`).

**Bugs found and fixed (with unit tests on captured, redacted payloads in `packages/modules/payments/tests/fixtures/stripe/`)**
- **Managed Payments.** The account has Stripe's Managed Payments (Stripe as merchant of record) on by default, so Checkout refused sessions without a product tax code. Tickets are never sold by Stripe: sessions now send `managed_payments[enabled]=false` (owner inbox: turn the default off).
- **Accounts v1 refused.** Stripe no longer lets this platform create v1 connected accounts. `createConnectedAccount` now uses **Accounts v2** (`dashboard: full`, merchant `card_payments` + recipient `stripe_transfers`, Stripe collects fees and carries losses, org metadata). The account id and every v1 call on it (Checkout, refunds, account links, `accounts.retrieve`) work unchanged.
- **Balance-transaction mapping** (new in M1.6e, caught by the contract before it shipped): a transfer reversal's balance transaction points at the *transfer*, and an application-fee refund's at the *fee*; the adapter now maps by the transaction's `type` and finds the reversal or refund by its balance transaction. `stripe-live-shapes.test.ts` replays the captured list.
- Evidence packets are now uploaded as files (≤ 4.5 MB, refused above) and submitted on the connected account for `organizer_mor` disputes.
- Refunds, fee refunds, transfers and reversals carry `metadata.yayatoh_ref` (the ledger reference) and `orgId`, so reconciliation can attribute them.

**Still needs the owner / a public URL**
- Webhook endpoints (platform + Connect) on a public preview URL and their signing secrets; until then webhooks were proven only by signing real payloads locally.
- Whether `account.updated` arrives for Accounts v2 accounts on the Connect endpoint (or the v2 thin events are needed).
- Stripe test clocks for the refund-after-transfer scenarios (`stripe:test-clocks`, M1.6e) run against the API the same way; live money stays gated on D3 and counsel.

### Acceptance (M1.5e3)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Every adapter call works against Stripe test mode and parses the real answers | `packages/modules/payments/scripts/stripe-contract.ts` (manual, 11/11) |
| AC2 | Real event payloads parse through the webhook verifier; captured shapes are unit fixtures | `stripe-contract.ts`, `packages/modules/payments/tests/stripe-live-shapes.test.ts` |
| AC3 | Managed Payments off, Accounts v2 creation, evidence file upload on the right account, reconciliation tags | `packages/modules/payments/tests/stripe.test.ts` |
| AC4 | A hosted Checkout Session is paid with the 4242 card in headless Chromium | `apps/web/scripts/stripe-hosted-checkout.ts` (manual) |
