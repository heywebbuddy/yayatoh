# Payments Orders Fraud

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.

> **Superseded in part:** destination charges with on_behalf_of. The owner chose the HYBRID model (docs/roadmap.md §5.3).


## Topic

Payments, orders, ticket inventory, distribution and fraud for a multi-tenant ticketing platform (US-based)

# Payments, Orders, Inventory, Distribution & Fraud — Yayatoh 2.0

Research date: 2026-09-26. All Stripe facts below were read from docs.stripe.com on this date unless marked UNVERIFIED. Grounding: the vision doc requires per-organization "payment configuration where applicable", white-label custom domains, preserved fraud detection / duplicate check-in, ticket distribution, and a Command Center that surfaces "14 payments failed", "120 purchased tickets not distributed", refunds, etc.

## 1. Recommended payments topology

**Decision: Yayatoh is the Stripe Connect platform; every organization gets a Stripe connected account; default funds flow is destination charges with `on_behalf_of` = organizer. Yayatoh owns loss liability and pays Stripe fees, monetized through `application_fee_amount`.**

### 1.1 Account model (not "Standard/Express/Custom")
Stripe now labels Standard/Express/Custom as **deprecated legacy types** and recommends either Accounts v2 or v1 accounts with **controller properties** (docs.stripe.com/connect/accounts). The v1 controller model is GA and maps 1:1 to v2 (`controller.fees.payer` ↔ `defaults.responsibilities.fees_collector`; `controller.losses.payments` ↔ `losses_collector`; `controller.stripe_dashboard.type` ↔ `dashboard`). Accounts v2 examples still require `Stripe-Version: 2026-08-26.preview` and v2 cannot use OAuth or Connect cross-border payouts (must use Global Payouts) — so **build on v1 + controller properties now**, isolate behind the provider adapter, migrate to v2 when GA.

Default organizer configuration ("Express-like"):
- `controller.losses.payments = application` (platform liable for negative balances — required for destination charges; Stripe explicitly says do not assign Stripe liability when charging on the platform).
- `controller.fees.payer = application` (platform pays Stripe fees; required when losses=application).
- `controller.stripe_dashboard.type = express` (or `none` + Connect embedded components for a fully white-labeled experience).
- `controller.requirement_collection = stripe` (Stripe runs KYC via hosted/embedded onboarding; the platform never touches SSNs/IDs). Dashboard type is immutable after creation.

Runner-up: `stripe_dashboard.type = full` + direct charges (true "Standard"). It loses because (a) PaymentIntents live on the connected account, so platform-level reporting/Command Center needs `Stripe-Account`-scoped queries, (b) platform Radar rules do not apply to direct charges, (c) Apple Pay/Link domains must be registered per connected account, (d) Stripe Tax registrations belong to the organizer. Keep it as a phase-2 "Enterprise: bring your own Stripe" option for organizers who already run Stripe and want to own disputes and tax.

### 1.2 Charge type
- **Destination charge** (`transfer_data[destination]`, `application_fee_amount`, `on_behalf_of`): charge lands on the platform, funds transfer immediately, Stripe debits fees/refunds/chargebacks from the platform. With `on_behalf_of` the organizer becomes settlement merchant: settles in its country/currency, its statement descriptor and (if abroad) address appear on the card statement, payout timing follows its `delay_days`.
- **Separate charges & transfers** (`transfer_group`, `source_transaction`): needed only for one-cart-many-organizers (an agency selling several clients' events in one cart) or pay-before-charge. Support it in the adapter for the "event agency" persona; not the default because reconciliation is harder and cross-region transfers are restricted.
- **Direct charge**: see 1.1 runner-up.
- `application_fee_amount` (preferred) creates an `ApplicationFee` object visible to the organizer (total and fee shown); `transfer_data[amount]` hides the gross from the organizer and reports only via balance-history export. Because `fees.payer=application`, the application fee must cover Yayatoh's fee **plus** the Stripe processing fee (Stripe: "set the application fee amount to include both"). Worked example from the docs: $10.00 charge, $1.23 app fee, $0.59 Stripe fee → platform nets $0.64.
- Never rely on the Platform Pricing Tool for fees; explicit `application_fee_amount` overrides it and keeps the ledger deterministic.

### 1.3 Payouts
- Default daily rolling; US minimum `delay_days` = 2 business days; platform may set `delay_days_override` up to **31** and `interval` = manual/daily/weekly/monthly (docs.stripe.com/connect/manage-payout-schedule). Events are future-delivery: Stripe's risk guidance says hold/delay payouts for riskier sellers until goods/services are delivered. Recommended tenant tiers: Trusted → daily/2-day; New → `delay_days_override` 7–14; High-risk or large advance sales → `interval=manual`, released by a job after event end (+ dispute buffer), with an optional rolling reserve (%) held in the platform balance. Stripe notes the US compliance holding limit for platform-held funds is 2 years.
- **Instant Payouts**: Stripe charges the platform 1% (US min $0.50, max $9,999 per payout, arrives ~30 min, 24/7). Requires full ToS onboarding, eligible debit card or bank, `interval=manual`, and the `instant_available.net_available` balance field if you monetize via application fee. Platform-wide daily cap resets midnight CT. Gate behind trust thresholds (volume, days active, chargeback rate).
- Track `payout.created/updated/paid/failed`; a failed payout disables the external account.

### 1.4 Merchant of record, refunds, disputes
- With `on_behalf_of` the organizer is the business of record for the card network/statement; without it, Yayatoh is. Sales-tax liability is a separate legal question (see 1.5). Stripe **Managed Payments** (Stripe/Link as MoR, +3.5% per transaction) covers digital goods/SaaS only — not applicable to tickets.
- **Refunds** (destination): platform balance is debited; pass `reverse_transfer=true` to pull funds back from the organizer and `refund_application_fee=true` to return Yayatoh's fee (proportional on partial refunds; refunding the app fee requires reversing the transfer). Stripe's original processing fee is **not** returned. If the organizer's balance is insufficient the refund call errors (not pending) → the policy engine must decide: retry later, refund from platform funds and create a receivable, or block. Refunds arrive 5–10 business days; `refund.failed` returns funds to the platform balance.
- **Disputes** (destination): platform is debited the amount plus fee. US fees since June 17 2025: $15 dispute received (non-refundable) + $15 dispute countered (returned if won). Listen to `charge.dispute.created`, create a transfer reversal to recover from the organizer, enable `debit_negative_balances=true` (US supported) so Stripe auto-debits the organizer's bank; Stripe reserves platform funds for organizer negative balances and after 180 days sweeps them (`connect_collection_transfer`). Respond within 7–21 days; outcomes take 2–3 months. Critical for ticketing: **the dispute window starts at the event date, not the payment date**. Early Fraud Warnings: ~40% become disputes; refund EFWs only when the charge is ≤ ~the $15 fee. Use Smart Disputes auto-responses and the Connect embedded disputes components to let organizers respond.

### 1.5 Stripe Tax
Stripe Tax with Connect requires choosing who is liable: "Tax for platforms" (connected account liable, needs direct charges or `on_behalf_of`; organizer registrations via the tax-settings/tax-registrations embedded components) vs "Tax for marketplaces" (platform liable under marketplace-facilitator laws). Model `tax_liable_party` per tenant and support both; get a tax opinion for admissions in MD/DC/VA. Pricing (US page): 0.5% per transaction on Checkout/Billing/Invoicing/Payment Links; Tax API $0.50 per transaction incl. 10 calculation calls, $0.05 per extra call. Refunds must be recorded as Tax reversals. No admissions-specific `txcd_` code was visible on the tax-codes page (UNVERIFIED — query the Tax Codes API; fall back to `txcd_20030000` General Services / `txcd_00000000` nontaxable per advice).

### 1.6 Radar
Plans: Lite (included), Standard (risk level, default rules, account fraud), **Plus** (risk score 0–99, custom rules, backtesting, reviews, adaptive 3DS, Radar Assistant), Pro (bot abuse, multi-account, dynamic thresholds). Default: block `risk_level = highest` (score ≥75), review `elevated` (≥65). For destination charges **only the platform's Radar config applies**; account-level rules can review or pause payouts for organizers. Rule syntax `{action} if {attribute} {op} {value}` with metadata `::key::` and velocity attributes (`card_count_for_ip_hourly`, `total_charges_per_ip_address_daily`, `efw_count_on_card_daily`, `is_disposable_email`, `is_anonymous_ip`, `seconds_since_card_first_seen`). Use traffic allocation (0% shadow) to test rules. Radar transaction fees are billed per collecting account (platform for destination charges); US per-transaction prices UNVERIFIED (India page shows Standard ₹5 / Plus ₹6.60 / Pro ₹8.50). Budget Radar Plus.

### 1.7 Terminal (on-site sales)
Readers: Stripe Reader S700/S710 (S710 has 4G), BBPOS WisePOS E, Stripe Reader M2 (US Bluetooth mPOS), Tap to Pay on iPhone (iPhone XS+, Apple entitlement `com.apple.developer.proximity-reader.payment.acceptance`, Apple app review) and Android; SDKs iOS/Android/React Native (public preview)/JS (smart readers only)/server-driven. Offline payments need the mobile SDK. With destination charges the **platform owns Locations and Readers**: create one Location per organizer/venue, register readers to it, mint `connection_tokens` scoped by `location`, create PIs with `payment_method_types[]=card_present`, `capture_method=manual`, `on_behalf_of`, `transfer_data[destination]`, `application_fee_amount`. Organizers need `card_payments`. Hardware can be ordered centrally or via the terminal-hardware-shop embedded component.

### 1.8 Apple Pay / Google Pay / Link
Use the Payment Element + Express Checkout Element (Link, Apple Pay, Google Pay, PayPal). Stripe handles Apple merchant validation, but **every domain and subdomain that renders the form must be registered** via `POST /v1/payment_method_domains` — for destination charges on the platform key; for direct charges with `Stripe-Account`. White-label consequence: the custom-domain onboarding job must register `events.organization.com` (and sandbox) before enabling wallets. Link also enables Instant Bank Payments; Link is unavailable in India.

### 1.9 When to use the platform's own Stripe account + transfers instead
Use separate charges & transfers (platform charge, later `transfers` with `transfer_group`) when: one cart spans several organizers; the organizer is unknown at charge time (agency/pending assignment); or you want to hold funds on the platform before releasing (with `source_transaction` to wait for availability). Constraint: cross-border only for US/UK/EEA/CA/CH recipients and only without `on_behalf_of`. Everything else: destination charges.

## 2. Provider abstraction
Define a `PaymentProvider` port with: `createMerchantAccount`, `getOnboardingLink`, `createPaymentIntent(order, splits)`, `capture`, `cancel`, `refund(amount, reverseSplit)`, `createPayout`, `listBalanceTransactions(cursor)`, `verifyWebhook(raw, sig)`, `normalizeEvent`, `createTerminalSession`, `registerDomain`. Persist `payment_account.provider` and `provider_account_id`; every money object stores `provider_ref` and a normalized `status`. Adapters: Stripe (v1 controller → v2), later PayPal Commerce Platform multiparty (Partner Referrals onboarding; platform fees must match transaction currency and settle daily; partner cannot hold a balance), Square (OAuth per seller, `app_fee_money` on CreatePayment), Adyen for Platforms (account holders/balance accounts, split payments, 40+ countries). Keep Stripe-specific concepts (application fee, transfer reversal) inside the adapter; the domain only knows "split", "reversal", "fee".

## 3. Order lifecycle and inventory

### 3.1 Holds and oversell prevention
- Source of truth is Postgres. `ticket_type` keeps `quantity_total`, `quantity_sold`, `quantity_held`; decrement with a single conditional statement: `UPDATE ticket_type SET quantity_held = quantity_held + $n WHERE id=$id AND quantity_total - quantity_sold - quantity_held >= $n RETURNING ...` — zero rows = sold out. No read-then-write.
- Reserved seating: `seat` rows locked with `SELECT ... FOR UPDATE SKIP LOCKED` for best-available; explicit seat picks use `FOR UPDATE NOWAIT` and return "seat just taken".
- Flash on-sales: wrap hold creation in `pg_advisory_xact_lock(hash(event_id, ticket_type_id))` to serialize hot rows and avoid deadlocks; put a waiting room in front (see 6).
- Redis is only a fast pre-check and rate limiter, never the inventory of record (it is not durable across the payment webhook path).
- `inventory_hold` has `expires_at` (default 10 min, one extension); a sweeper releases expired holds. If Stripe Checkout is used, `expires_at` must be 30 min–24 h and `checkout.session.expired` releases inventory; for the Payment Element flow the hold TTL governs and the PI is cancelled on expiry.
- Card authorizations stay valid 7 days (Visa MIT 5 days); use `capture_method=manual` only for approval-gated registrations, and capture before `capture_before`.

### 3.2 Idempotency
- Client sends `Idempotency-Key` on `POST /orders` and `/orders/{id}/pay`; store `(tenant_id, key) → request_hash, response` (24 h). Stripe keys are ≤255 chars, retained ≥24 h, replay returns the same body (even 500s), and mismatched params error. Derive the Stripe key from `order_id + attempt` (Stripe recommends keying on the cart/session id) so retries never create duplicate PaymentIntents.

### 3.3 Webhooks
- Verify `Stripe-Signature` (HMAC-SHA256, `t=`/`v1=`, 5-minute tolerance, raw body, constant-time compare), allowlist Stripe IPs, respond 2xx immediately, enqueue. Stripe retries for up to 3 days with backoff, **does not guarantee order**, and can deliver duplicates: `webhook_event.provider_event_id` UNIQUE, and handlers must be state-machine transitions that tolerate `charge.refunded` before `payment_intent.succeeded` (fetch the object if needed). Two endpoints: platform (`@self`: destination charges, PIs, transfers, application fees) and connected (`@accounts`: account.updated, payouts, external accounts). Pin the API version per endpoint; roll secrets periodically. Fulfil only on `payment_intent.succeeded` / `checkout.session.completed`, never on client callback.

### 3.4 Order features
- **Partial refunds / order edits**: refund per line item; store `refund_line` allocations; issue proportional transfer reversal and app-fee refund; order edits are "cancel lines + add lines" producing a delta PI or refund (never mutate a paid line).
- **Comps/free tickets**: zero-amount orders skip the provider entirely (no PI), still produce tickets and ledger entries with `source=comp`.
- **Group purchases**: one order, N tickets, buyer is `purchaser`, attendees assigned later (see 4).
- **Add-ons** (parking, meals, merch): `order_item.kind ∈ {ticket, addon, donation, fee, tax}`; add-ons have their own inventory and may be `attached_to_ticket_id`.
- **Donations**: separate line, non-taxable tax code, shown separately on receipts; support round-up.
- **B2B invoicing/PO**: Stripe Invoicing (draft → open → paid/void/uncollectible; hosted page; ACH/bank transfer; custom fields for PO number; credit notes; `paid_out_of_band` for checks/wires). Order state `awaiting_invoice_payment`; issue tickets on `invoice.paid` (option: provisional tickets before payment for trusted accounts).
- **Promo codes**: `promo_code` + rule (`percent`, `fixed`, `bogo` as buy-N-get-M) with scope (event/ticket types), windows, total and per-customer limits, min quantity, no stacking; reserve a redemption at hold time and confirm at payment to prevent over-redemption.
- **Fees display**: per tenant `fee_mode ∈ {absorb, pass_on}`; always materialize `platform_fee` and `processing_fee_estimate` lines; the actual Stripe fee arrives on the balance transaction — reconcile monthly and bill/refund the variance to the organizer.
- **Currency**: integer minor units + ISO code; store presentment and settlement amounts separately (`presentment_details` on events; `exchange_rate` on balance transactions). Foreign white-label tenants: onboard a connected account in their country and use `on_behalf_of` so charges settle locally at local fees; Adaptive Pricing (Checkout only; customer pays 2–4%, merchant 0%, refunds at the original rate) is the low-effort localization path.
- **Receipts**: tenant-branded receipts from Yayatoh (disable Stripe emails); statement descriptor from the organizer via `on_behalf_of` or `statement_descriptor_suffix` (22 chars incl. prefix).

## 4. Ticket distribution
- Separate the **entitlement** (`ticket`: serial, `barcode_version`, status) from the **holder** (`ticket_assignment` history). Assigning a named attendee creates an `attendee` record (the CRM person) and bumps `barcode_version`, invalidating any previously issued QR/wallet pass.
- **Claim links**: signed, single-use, expiring URL/email/SMS; recipient claims → status `claimed`; unclaimed tickets feed the Command Center alert ("120 purchased tickets not distributed").
- **Transfers**: `ticket_transfer` (from, to, status pending/accepted/declined/cancelled/expired). On accept: rotate the barcode, void old wallet passes (Apple `voided=true` + push; Google `state=INACTIVE`), record the fraud signal.
- **Bulk distribution**: organizer CSV/Excel import → validation report → batch create tickets + send claim links via the notification system; idempotent by `(import_id, row)`.
- **Restrictions** per ticket type: `transferable`, `transfer_deadline`, `max_transfers`, `resale_allowed=false` (Yayatoh should not run a secondary market initially), and name-on-ticket enforcement at check-in.

## 5. Fraud engine (preserve and extend existing "fraud detection")
Three layers:
1. **Pre-authorization rules + score (Yayatoh)** evaluated at hold and at pay: velocity per email/IP/device/card-fingerprint/phone per event per hour/day; quantity vs per-order limits; account age; disposable email; IP/billing/card country mismatch; multiple tenants hit by the same device; prior chargebacks/refund-abuse in the attendee CRM profile; transfer patterns (transfers within minutes of purchase, one buyer → many recipients, >N hops). Each rule yields points; decisions: `allow`, `challenge` (Cloudflare Turnstile, works on non-Cloudflare sites), `step_up` (pass `metadata[yayatoh_risk]=high` and a Radar rule `Request 3D Secure if ::yayatoh_risk:: = 'high'`), `review` (manual capture, decide within 7 days), `block`. Persist `fraud_assessment` (rules fired, score, decision, reviewer) for the Command Center and for tuning.
2. **Radar at payment** (platform config, Radar Plus): default block ≥75/review ≥65, custom velocity rules, blocklists fed by `refund(reason=fraudulent)`; account rules to review/pause payouts for organizers with dispute rate >0.75%.
3. **Post-purchase monitors**: EFW webhooks (`radar.early_fraud_warning`), dispute rate per organizer, duplicate check-in attempts and invalid QR scans streamed from devices, ticket-transfer anomalies, refund-abuse per attendee.
Card testing: use Payment Element/Checkout (Stripe's hCaptcha and rate limiters apply), load Stripe.js on every page for advanced fraud signals, require session/Turnstile before PI confirmation, rate-limit PI creation per IP/session, cap cards per account. Scalper/bot mitigation for high-demand on-sales: Cloudflare Waiting Room (one basic FIFO room on Business+; Enterprise add-on adds random/lottery, scheduled events, rules, Turnstile managed modes with infinite queue for failed challenges) or Queue-it (Invisible Challenge proof-of-work, CAPTCHA fallback, pre-queue randomization; Standard 15k queue visitors/month, Pro 100k, Enterprise custom, Essentials from $1,499/event for 5k). Account takeover: passkeys/2FA for organizer users, alerts on bank-account/email changes from new devices, step-up before payout destination changes (Stripe's own recommendation).

## 6. PCI scope
Payment Element/Checkout/Terminal SDKs/mobile SDKs keep Yayatoh at **SAQ A** (card data enters a Stripe-hosted iframe/SDK); Stripe.js with custom fields is SAQ A-EP; direct PAN handling is SAQ D; Terminal-only is SAQ C. Stripe's PCI guide notes 2025 SAQ A eligibility changes tied to script-management requirements 6.4.3/11.6.1 (PCI SSC wording UNVERIFIED). Rules: load Stripe.js only from js.stripe.com (never bundle), ship the documented CSP directives, TLS 1.2+, store only Stripe-returned non-sensitive fields (brand, last4, exp), complete the Dashboard PCI wizard annually.

## 7. Financial reporting, statements, 1099
- Build a double-entry `ledger` fed by balance transactions (`charge`, `refund`, `application_fee`, `application_fee_refund`, `transfer`, `transfer_refund`, `payout`, `payout_failure`, `adjustment` [disputes], `stripe_fee`, `reserve_transaction`, `connect_collection_transfer`, `topup`), keyed by `balance_transaction_id` and `reporting_category`. Organizer statements = per-event and per-period roll-ups: gross, refunds, disputes, platform fee, processing fee, net, transfers, payouts, reserves. Expose Stripe's balance-report and payout-reconciliation embedded components plus Sigma for platform finance.
- **1099**: with `controller.fees.payer=application`, Stripe does **not** file 1099-K for organizers — Yayatoh must. Federal 1099-K threshold: >$20,000 gross **and** >200 transactions (IRS page, reviewed June 2026); 1099-NEC/MISC $2,000 (TY2026). Use Stripe's 1099 tax reporting product (totals, TIN/W-9 collection, e-delivery via Express Dashboard/embedded components, federal + state e-file with state thresholds auto-applied; states with withholding not transmitted). Key dates TY2026: e-file by Jan 22, IRS postmark Feb 1. Per-form fee UNVERIFIED. Maryland/DC/VA state thresholds UNVERIFIED (Stripe applies them automatically).

## 8. Digital wallet passes
- **Apple Wallet**: `.pkpass` = `pass.json` + `manifest.json` (SHA-1) + `signature` (Pass Type ID cert + WWDR) + images. Style `eventTicket`; barcodes QR/PDF417/Aztec/Code128; `webServiceURL` + `authenticationToken`; implement register/unregister/serials/latest/log endpoints and APNs pushes (topic = pass type id) to update seat/gate/time changes and to set `voided`. iOS 18 poster tickets: `preferredStyleSchemes: ["posterEventTicket","eventTicket"]`, `artwork`/`secondaryLogo`, and semantic tags (`eventName`, `eventType` e.g. `PKEventTypeConference`/`PKEventTypeSocialGathering`, `eventStartDate`, `venueName`, `venueLocation` lat/long, `seats{seatSection,seatRow,seatNumber}`, `venueGatesOpenDate`, `entranceDescription`, `eventLiveMessage`) which also drive Live Activities and the Event Guide. Set `sharingProhibited` when transfers are disabled; `groupingIdentifier` per order.
- **Google Wallet**: `EventTicketClass` per event, `EventTicketObject` per ticket (`id = issuerId.serial`, `state` ACTIVE/EXPIRED/INACTIVE, `seatInfo{section,row,seat,gate}`, `barcode`, `rotatingBarcode`, `passConstraints`, `groupingInfo`, `notifyPreference=NOTIFY` on PATCH). Issue via signed-JWT "Add to Google Wallet" link (`pay.google.com/gp/v/save/<jwt>`, keep ≤1,800 chars → reference pre-created objects by id). Requires issuer account and publishing-access approval ("[TEST ONLY]" until then). Cost UNVERIFIED (believed free).
- Barcode payload: opaque ticket token (id + `barcode_version`, signed) so passes can be invalidated on transfer/refund; devices verify signatures offline.

## 9. State machines
**Order**: `draft → reserved (hold, TTL) → pending_payment (PI confirmed / ACH processing) → paid → {partially_refunded, refunded, disputed → {dispute_won → paid, dispute_lost}} ; reserved → expired ; pending_payment → payment_failed → reserved (retry) | expired ; draft/awaiting_invoice_payment → paid | void ; paid → cancelled (full refund, tickets voided)`. Guards: `paid` only via verified webhook; `refunded` only when all refunds `succeeded`.
**Payment (provider-level)**: `requires_payment_method → requires_confirmation → requires_action → processing → requires_capture → succeeded | canceled | payment_failed`; mirrors PaymentIntent statuses.
**Ticket**: `issued → assigned → claimed → checked_in ⇄ checked_out (multi-entry) ; issued|assigned|claimed → transfer_pending → {claimed (new holder), back to previous} ; any → voided (refund/fraud/organizer) ; claimed|assigned → expired (post-event)`. Every transition bumps `barcode_version` when the holder changes and emits an event for wallet-pass updates and the Command Center.
**Hold**: `active → consumed | released | expired`.
**Refund**: `requested → pending → succeeded | failed | canceled`. **Dispute**: `warning_needs_response → needs_response → under_review → won | lost` (plus late win). **Payout**: `pending → in_transit → paid | failed | canceled`.

## 10. Risks (summary)
Platform loss liability on future-delivery events (cancelled event after payouts); application-fee vs actual-fee drift; every white-label domain must be registered for wallets; Accounts v2 still preview-versioned; ACH disputes are final with a 60-day window; dispute clock starts at event date; 1099 filing burden shifts to Yayatoh; marketplace-facilitator tax exposure; Radar Plus and waiting-room costs; Tap to Pay entitlement/App Review lead time; Pass Type ID certificate and APNs key rotation; out-of-order webhooks; idempotency keys must be tenant-namespaced.


## Key recommendations

- Be the Connect platform: one connected account per organization created with v1 controller properties (losses.payments=application, fees.payer=application, stripe_dashboard.type=express or none+embedded components, requirement_collection=stripe); wrap in an adapter so Accounts v2 (still on a 2026-08-26.preview version) can replace it later.
- Default funds flow = destination charges with on_behalf_of=organizer and an explicit application_fee_amount that covers Yayatoh's fee plus Stripe's processing fee; keep separate charges & transfers only for multi-organizer carts/agencies; offer direct charges ('bring your own Stripe') as a phase-2 enterprise option.
- Treat events as future-delivery risk: tier organizer payout schedules (daily/2-day for trusted, delay_days_override 7-14 for new, interval=manual released after event end for high-risk) and enable debit_negative_balances; gate Instant Payouts (1% platform cost, $0.50 min, $9,999 max) behind trust thresholds.
- Inventory of record is Postgres: conditional UPDATE counters for GA, FOR UPDATE SKIP LOCKED/NOWAIT for seats, pg_advisory_xact_lock per (event, ticket_type) for flash on-sales, inventory_hold with a 10-minute TTL sweeper; Redis only for pre-checks and rate limits.
- Make every money path idempotent and webhook-driven: tenant-namespaced Idempotency-Key on order/pay endpoints mapped to Stripe keys (24 h retention), unique provider_event_id, signature verification on the raw body, async queue, and order-tolerant state-machine handlers; fulfil only on payment_intent.succeeded/checkout.session.completed.
- Model orders as line items (ticket, addon, donation, fee, tax) with explicit platform_fee and processing_fee_estimate lines and per-tenant absorb/pass-on mode; reconcile estimated vs actual Stripe fees from balance transactions monthly.
- Separate ticket entitlement from holder: barcode_version rotates on assignment/transfer, claim links for group/bulk distribution, transfer restrictions per ticket type, and automatic wallet-pass void/update on every holder change.
- Build a three-layer fraud engine: Yayatoh rules+score at hold and pay (velocity, device, geo, CRM history, transfer anomalies) with allow/challenge (Turnstile)/step-up 3DS via Radar metadata rule/review (manual capture)/block; Radar Plus on the platform account with velocity and account-level payout-pause rules; post-purchase monitors for EFWs, disputes, duplicate scans and transfer abuse.
- Put a waiting room (Cloudflare Waiting Room on Business+/Enterprise add-on for lottery mode, or Queue-it) in front of high-demand on-sales and require a Turnstile/session token before PaymentIntent confirmation to stop card testing and bots.
- Stay in PCI SAQ A: Payment Element/Express Checkout Element/Checkout and Terminal SDKs only, Stripe.js loaded from js.stripe.com on every page (advanced fraud signals), documented CSP, store only Stripe-returned card metadata.
- Register every white-label custom domain and subdomain with the Payment Method Domains API (platform key for destination charges) as part of domain onboarding, or Apple Pay/Link/Google Pay silently disappear on that tenant's checkout.
- Own financial reporting: double-entry ledger keyed by Stripe balance transactions, organizer statements per event/period, tax_liable_party per tenant with Stripe Tax (0.5% built-in / $0.50 API), and Stripe's 1099 product because with fees.payer=application Yayatoh, not Stripe, must file 1099-K (>$20,000 and >200 transactions federally).


## Data model implications

- organization.payment_account: provider, provider_account_id, controller config snapshot (losses/fees/dashboard/requirements), capabilities (card_payments, transfers, us_bank_account_ach_payments), onboarding status, payout schedule (interval, delay_days_override, reserve_pct), instant_payouts_enabled, tax_liable_party (platform|organizer), default settlement currency, fee_mode (absorb|pass_on), fee_schedule (pct, fixed).
- order: tenant_id, event_id, purchaser (attendee/customer id), status (draft, reserved, pending_payment, awaiting_invoice_payment, paid, partially_refunded, refunded, disputed, cancelled, expired), presentment currency/amounts, settlement currency/amounts, idempotency scope, fraud_assessment_id, invoice_id, promo redemptions, created_via (web|app|terminal|invoice|comp).
- order_item: kind (ticket|addon|donation|fee|tax|discount), ticket_type_id/addon_id, quantity, unit_amount, tax_code, attached_to_ticket_id; refund_line allocations reference order_items.
- ticket_type: event_id, quantity_total, quantity_sold, quantity_held, per-order min/max, sales window, price tiers, transferable, transfer_deadline, max_transfers, requires_name, seat_map linkage; addon has its own inventory counters.
- inventory_hold: order_id, ticket_type_id/seat_ids, quantity, expires_at, status (active|consumed|released|expired), extended_once.
- ticket: order_item_id, serial, barcode_version, status (issued, assigned, claimed, transfer_pending, checked_in, checked_out, voided, expired), current_holder_attendee_id, seat_id; ticket_assignment history; ticket_transfer (from, to contact, status, expires_at); claim_link (token hash, expires_at, used_at).
- payment: order_id, provider, provider_intent_id, provider_charge_id, status mirroring PaymentIntent, method type, wallet type, on_behalf_of account, application_fee_amount, transfer id, presentment/settlement amounts, exchange_rate, risk_level/risk_score from Radar outcome, capture_before.
- refund: payment_id, amount, reverse_transfer, refund_application_fee, provider_refund_id, status (requested|pending|succeeded|failed|canceled), reason, lines; dispute: provider_dispute_id, status, amount, fee, evidence_due_by, transfer_reversal_id, outcome.
- ledger_entry (double-entry): account (platform_revenue, organizer_payable, stripe_fees, reserves, refunds, disputes), debit/credit, currency, balance_transaction_id, reporting_category, source object; payout: provider_payout_id, account, amount, status, arrival_date, method (standard|instant).
- promo_code + promo_rule (percent|fixed|bogo, scope, windows, total/per-customer limits, min_qty) and promo_redemption (reserved_at, confirmed_at, order_id).
- fraud_assessment: order_id, stage (hold|pay|post), rules_fired[], score, decision (allow|challenge|step_up|review|block), reviewer, resolved_at; fraud_signal events (duplicate_scan, invalid_qr, efw, transfer_anomaly) linked to attendee/device/organization; attendee risk profile (chargebacks, refunds, blocks).
- webhook_event: provider, provider_event_id UNIQUE, type, api_version, received_at, processed_at, attempts, payload hash; idempotency_key: tenant_id, key, request_hash, response_status, response_body, expires_at.
- wallet_pass: ticket_id, platform (apple|google), serial/object_id, auth_token, last_pushed_version, voided; apple_device_registration (device_library_id, push_token, pass_type_id, serial).
- invoice: order_id, provider_invoice_id, status (draft|open|paid|void|uncollectible), due_date, po_number, payment_terms, paid_out_of_band flag; terminal_location and terminal_reader mapped to organization/venue.
- tenant custom_domain: hostname, verification status, payment_method_domain_id (Stripe), wallet_enabled flag.


## Risks

- Loss liability: with losses.payments=application the platform eats refunds and chargebacks when an organizer cancels an event after being paid out; mitigate with payout delays, manual release after event end, rolling reserves, debit_negative_balances and organizer underwriting.
- Fee drift: application_fee_amount must be computed before the actual Stripe fee is known; under-collection silently erodes margin (or over-collection breaches organizer terms) unless reconciled against stripe_fee balance transactions.
- White-label wallets: any tenant domain not registered via the Payment Method Domains API loses Apple Pay/Google Pay/Link; iframes across origins require both domains registered.
- Stripe API churn: Accounts v2 examples require a 2026-08-26.preview version and lack OAuth/cross-border payouts; embedded components split into GA and preview SDK lines; pin API versions and isolate the adapter.
- Disputes for ticketing start their 120-day clock at the event date, so exposure persists months after payout; ACH disputes are final, single-round and 60-day; refunding an ACH payment while a dispute is filed double-credits the buyer.
- Tax: marketplace-facilitator rules may make Yayatoh the liable party for admissions in some states regardless of on_behalf_of; no admissions-specific Stripe tax code was verified.
- 1099 burden shifts to the platform under fees.payer=application (Stripe files only when the account pays Stripe directly); missing TINs/addresses cause rejected filings and IRS penalties.
- Cost stack: Radar Plus per-transaction fees, Stripe Tax 0.5%, Instant Payouts 1%, dispute fees $15+$15, waiting room (Queue-it Essentials from $1,499/event; Cloudflare Business/Enterprise), Terminal hardware; USD card/Radar/Connect account rates were UNVERIFIED in this research.
- Concurrency: seat/GA oversell if any code path bypasses the conditional UPDATE/row locks (e.g., admin comps, imports, offline Terminal sales); expired holds not released promptly starve legitimate buyers.
- Webhook/idempotency defects (out-of-order events, duplicate deliveries, non-namespaced keys across tenants) can double-issue tickets or double-refund.
- Wallet passes: Apple Pass Type ID certificates expire annually and APNs keys rotate; Google publishing access must be approved before launch or passes show [TEST ONLY].
- Tap to Pay requires an Apple entitlement and App Store review; Terminal React Native SDK is public preview; offline Tap to Pay on iPhone is private preview.
- Direct-charge (BYO Stripe) organizers are invisible to platform Radar and platform-level reporting, and dispute/tax handling shifts to them; supporting both models doubles test surface.


## Open questions

- Who is the legal seller/merchant of record today on Yayatoh.com (does the current Laravel platform charge on its own Stripe account and pay organizers manually, or already use Connect)? What contractual terms do organizers currently accept for refunds, chargebacks and payout timing?
- Current fee model: does Yayatoh charge a platform fee (percent + fixed) and is it absorbed or passed on to buyers? Any existing organizer-specific pricing that must be grandfathered?
- Sales tax practice today for MD/DC/VA admissions: is tax collected, who remits, and is there a tax advisor opinion on marketplace-facilitator status?
- Which organizers need on-site card sales (Terminal/Tap to Pay), and which need B2B invoicing/PO or ACH for large registrations?
- Existing fraud-detection rules in the Laravel app: exact rules, thresholds and the data they use, so they can be reproduced in the new rules engine (this must be preserved per the vision doc).
- Appetite for platform loss liability and holding funds: are organizers willing to accept delayed or post-event payouts and reserves, and is Yayatoh willing to fund a top-up balance for refunds?
- Do any current or planned tenants sell in non-USD currencies or reside outside the US/UK/EEA/CA/CH cross-border payout regions?
- Is a secondary market/resale ever desired, or should transfers be strictly peer-to-peer with organizer-configurable restrictions?
- Do the existing mobile apps perform payments natively (Stripe SDK) or via web views, and do they need Terminal/Tap to Pay in the next release?
- Expected peak on-sale traffic (tickets/minute) to size waiting-room needs (Cloudflare plan level vs Queue-it) and whether any Cloudflare/Vercel edge is already in use.
- Which Radar plan is acceptable cost-wise (Plus is required for risk scores and custom rules), and who staffs manual reviews and dispute responses?
- Apple Developer and Google Wallet issuer accounts: do they exist, and is the Yayatoh brand or the tenant brand to appear on wallet passes for white-label tenants?


## Sources

- https://docs.stripe.com/connect/accounts
- https://docs.stripe.com/connect/migrate-to-controller-properties
- https://docs.stripe.com/connect/accounts-v2
- https://docs.stripe.com/connect/accounts-v2/connected-account-configuration
- https://docs.stripe.com/connect/integration-recommendations
- https://docs.stripe.com/connect/charges
- https://docs.stripe.com/connect/destination-charges?platform=web&ui=elements
- https://docs.stripe.com/connect/direct-charges?platform=web&ui=elements
- https://docs.stripe.com/connect/direct-charges-fee-payer-behavior
- https://docs.stripe.com/connect/payouts-connected-accounts
- https://docs.stripe.com/connect/manage-payout-schedule
- https://docs.stripe.com/connect/instant-payouts
- https://docs.stripe.com/connect/account-balances
- https://docs.stripe.com/connect/disputes
- https://docs.stripe.com/disputes/how-disputes-work
- https://support.stripe.com/questions/june-2025-pricing-updates-for-disputes
- https://docs.stripe.com/refunds
- https://docs.stripe.com/connect/risk-management/best-practices
- https://docs.stripe.com/connect/radar
- https://docs.stripe.com/radar/how-radar-works
- https://docs.stripe.com/radar/rules
- https://docs.stripe.com/radar/rules/supported-attributes
- https://docs.stripe.com/radar/transaction-risk-prevention
- https://docs.stripe.com/disputes/prevention/card-testing
- https://docs.stripe.com/disputes/prevention/advanced-fraud-detection
- https://docs.stripe.com/tax/connect
- https://docs.stripe.com/tax/tax-for-platforms
- https://docs.stripe.com/tax/tax-for-marketplaces
- https://stripe.com/tax/pricing
- https://docs.stripe.com/tax/tax-codes
- https://docs.stripe.com/terminal/features/connect?connect-charge-type=destination
- https://docs.stripe.com/terminal/payments/setup-reader
- https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay?platform=ios
- https://docs.stripe.com/payments/link
- https://docs.stripe.com/payments/payment-methods/pmd-registration
- https://docs.stripe.com/payments/checkout/managing-limited-inventory
- https://docs.stripe.com/payments/place-a-hold-on-a-payment-method
- https://docs.stripe.com/payments/payment-intents
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing
- https://support.stripe.com/questions/adaptive-pricing
- https://docs.stripe.com/connect/cross-border-payouts
- https://docs.stripe.com/payments/ach-direct-debit
- https://docs.stripe.com/invoicing/overview
- https://docs.stripe.com/connect/supported-embedded-components
- https://docs.stripe.com/reports/balance-transaction-types
- https://docs.stripe.com/connect/tax-reporting
- https://docs.stripe.com/connect/get-started-tax-reporting
- https://docs.stripe.com/connect/tax-forms-state-requirements
- https://support.stripe.com/questions/1099-tax-reporting-and-filing-for-platforms-and-marketplaces
- https://www.irs.gov/businesses/understanding-your-form-1099-k
- https://docs.stripe.com/security
- https://docs.stripe.com/security/guide
- https://stripe.com/guides/pci-compliance
- https://stripe.com/managed-payments
- https://developer.paypal.com/docs/multiparty/
- https://developer.paypal.com/docs/multiparty/seller-onboarding/
- https://developer.squareup.com/docs/payments-api/take-payments
- https://docs.adyen.com/platforms/
- https://developer.apple.com/documentation/walletpasses
- https://developer.apple.com/documentation/walletpasses/creating-the-source-for-a-pass
- https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes
- https://developer.apple.com/documentation/walletpasses/semantictags
- https://developer.apple.com/videos/play/wwdc2024/10108/
- https://developers.google.com/wallet/tickets/events
- https://developers.google.com/wallet/tickets/events/web
- https://developers.google.com/wallet/reference/rest/v1/eventticketobject
- https://developers.google.com/wallet/tickets/events/resources/faq
- https://developers.cloudflare.com/waiting-room/
- https://developers.cloudflare.com/waiting-room/plans/
- https://developers.cloudflare.com/turnstile/
- https://queue-it.com/pricing/
- https://queue-it.com/product/
- https://www.postgresql.org/docs/current/explicit-locking.html
- https://www.postgresql.org/docs/current/sql-select.html
- https://stripe.com/gb/pricing (fetched for locale comparison; US rates UNVERIFIED due to geo-redirect)
