# Attendee Self Service Refunds Support Tooling

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

attendee-self-service-refunds-support-tooling

# Attendee Self-Service, Refunds and Support Tooling — Yayatoh 2.0

Grounding: the vision doc calls for an attendee/customer database that spans events ("Event CRM"), a Command Center that surfaces refunds and failed payments, white-label domains, and a stable mobile API. This design treats support as a first-class module ("Orders & Support") that sits on top of Orders, Payments, Ticketing, Contacts and Notifications rather than a bolt-on.

## 1. What the market does (verified vs. unverified)

| Platform | Attendee self-service | Organizer tooling | Notes |
|---|---|---|---|
| Eventbrite | Log in → Tickets → order: *Request a refund*, *Edit* (name/email only; not quantity, billing or card), "transfer" is really a name/email change that emails the new holder to claim; only original purchaser, only if organizer allows. | Organizer Refund Policy Requirements: policy must be posted on the event page, give request instructions, response time ≤5 business days, be "fair and reasonable"; mandatory refunds regardless of policy for cancelled/unperformed events, events postponed >90 days without a new date, materially different events, safety/access failures; no retroactive policy changes unless better for the consumer; Eventbrite may refund on the organizer's behalf (from proceeds or by invoice) if the organizer does not respond in 5 business days; Eventbrite fees are not obligated to be refunded. Attendees get 45 days to file a refund request form for cancelled/postponed events. | Verified from help.eventbrite 721549, 431834, 441118, 827759. |
| Humanitix | "1-Click Ticket Manager": guests update details without an account; "Assign tickets later" for bulk buyers. | Refunds and changes from guest list; automated waitlist that releases tickets and notifies waitlisted guests. Pricing 2.1% + $0.99 + 2.9% + $0.30 processing. | Verified (humanitix.com/us/features, /pricing). Booking-fee refundability UNVERIFIED. |
| Ticket Tailor | Attendee "manage order" link; organizer full/partial refunds from dashboard; waitlist; per-ticket fee credit is not returned on refund. | | UNVERIFIED (help center returned 403). |
| DICE | App-only: "Return to Waiting List" when sold out (refund only once resold), send tickets to friends, automatic refunds for cancelled shows. | | UNVERIFIED (dice.fm blocked). |
| Tito | Attendee reassigns ticket from its unique ticket URL; organizer void/refund (partial supported), waiting list, Admin API v3.0/v3.1 covering registrations, ticket reassign/void, refunds, waiting list, webhooks. | | API scope verified from ti.to/docs/api/admin overview; specific webhook names UNVERIFIED. |
| Cvent | Registrant self-service "Modify registration" / substitute / cancel from confirmation email; refund policies with date-tiered percent/fixed cancellation fees; waitlist per registration type. | | UNVERIFIED (support.cvent.com blocked). Widely documented behavior. |

Takeaways: (1) every consumer platform allows name/email change but treats "transfer" as re-issue to a new holder with a claim step; (2) the strongest organizer contract in the market is Eventbrite's 5-business-day SLA plus mandatory-refund exceptions; (3) sold-out waitlists with automatic release are table stakes; (4) DICE's "return to waitlist" is the model for fair, resale-safe refunds on sold-out shows.

## 2. Consumer-protection baseline (design constraints, not legal advice)

- **US**: No federal refund mandate for consumer-initiated cancellations. FTC Rule on Unfair or Deceptive Fees (16 CFR 464) is effective 12 May 2025 and covers live-event tickets: the most prominent price must be the all-in total; fees may not be misrepresented (this includes claims about refundability). State law examples: NY Arts & Cultural Affairs Law 25.07 requires full refund on cancellation (disclosed handling/delivery fees may be retained). Maryland enacted live-event ticket legislation in 2025 (all-in pricing, resale rules) — UNVERIFIED, needs counsel review since Yayatoh is Maryland-based. Card-network rules are the practical enforcer: a cancelled event with no refund is a near-certain "product_not_received / credit_not_processed" chargeback.
- **EU**: Consumer Rights Directive 2011/83/EU Art. 16(l): no 14-day withdrawal right for leisure services with a specific date (concert tickets are the EU's own example). When the trader cancels, national contract law requires a full refund; refunds are generally due within 14 days.
- **UK**: Consumer Contracts Regs 2013 reg. 28(1)(h) mirrors the EU exemption (UNVERIFIED quote; legislation.gov.uk blocked). CMA guidance: full refund when the business cancels, no admin fee for processing refunds, non-refundable-deposit terms likely unfair; consumer-initiated cancellation charges must reflect genuine losses (Consumer Rights Act 2015 unfair-terms test).

Design consequence: the refund engine must hard-code "organizer cancellation ⇒ full face-value refund, no processing charge" as a platform minimum, expose refundability terms clearly at checkout (screenshot-able for disputes), and keep organizer-defined rules only for consumer-initiated refunds.

## 3. Stripe behavior to build around (docs.stripe.com, Sept 2026)

- Stripe processing fees are **not** returned on refund. Refunds draw on the available balance; if insufficient, card refunds sit `pending`, other methods fail.
- Destination charges (Yayatoh's model): refunds debit the **platform**; `reverse_transfer=true` pulls funds back proportionally from the connected account; `refund_application_fee=true` returns the platform fee proportionally and requires `reverse_transfer`. Failed/cancelled refunds land in the platform balance; re-transfer manually. Refund `reason` enum: `duplicate`, `fraudulent`, `requested_by_customer`. Events: `refund.created/updated/failed`, `charge.refunded`.
- Dashboard bulk refund is full-refund only; partials must be individual. Refunds only go to the original payment method. Some methods enter `requires_action` and Stripe emails the customer for bank details.
- Negative balances: `losses_collector` / `controller.losses.payments` says who eats losses; `debit_negative_balances` lets Stripe auto-debit the organizer's bank (US/CA/EU/UK/AU/NZ); platform `connect_reserved` is held; after 180 days Stripe forcibly transfers platform funds to zero the account (`connect_collection_transfer`). Payouts pause while an account is negative.
- Disputes: response window 7–21 days; fee $15 received + $15 countered (countered fee refunded on win; effective 17 Jun 2025). Evidence via `POST /v1/disputes/{id}` with the `evidence` hash and files uploaded with purpose `dispute_evidence`; limits 4.5 MB combined, <50 pages (19 for Mastercard), 150,000 chars text. Relevant fields: `product_description`, `service_date`, `service_documentation`, `access_activity_log`, `customer_communication`, `refund_policy`, `refund_policy_disclosure`, `refund_refusal_explanation`, `cancellation_policy(_disclosure)`, `customer_email_address`, `customer_purchase_ip`, `receipt`, `uncategorized_text/file`. Visa CE 3.0 auto-pulls prior undisputed transactions. Platform is debited for disputes on destination charges; recover with a transfer reversal.

## 4. Recommended design

### 4.1 Attendee identity model
- **Person** (platform-global, keyed by verified email, optional phone, passkeys) vs **Contact** (org-scoped CRM record: name, tags, lifetime value, consents). A Person may map to many Contacts; Contacts may exist without a Person (imports, guest lists).
- **Guest orders by default, magic-link management always.** Every order gets a signed, revocable `manage_token` (32+ bytes, hashed at rest, rotates on sensitive actions). Emails/SMS carry `https://{tenant-domain}/orders/{id}?t=…`. This covers the marketplace and every white-label domain without cross-domain SSO. Actions above a risk threshold (refund to a different email, transfer) require a fresh 6-digit OTP to the order email.
- **Accounts are an upgrade**, passwordless (email OTP + passkeys). Session cookies are per domain; a Person logging in on `events.org.com` sees only that org's Contacts/orders; on yayatoh.com they see everything. Mobile apps use the same Person via OAuth2/PKCE against `/v1`.
- Runner-up: mandatory accounts (Eventbrite/DICE). Lost because white-label buyers would be asked to "create a Yayatoh account," which breaks the brand promise and conversion.

### 4.2 Order / ticket state machine
Order: `draft → awaiting_payment → paid → partially_refunded → refunded`; terminal `cancelled` (unpaid) and `voided`. Orthogonal flags: `disputed`, `on_hold`. Ticket (one row per seat/admission): `reserved → issued → checked_in`, side exits `transfer_pending → transferred(void)`, `void(refunded|cancelled|fraud)`; `checked_in` tickets are not self-refundable. Registration (conference module) wraps tickets with `registered → modified → cancelled` and session bookings. Every transition writes an `order_events` row (actor, reason, before/after, IP) — this table is the audit log, the timeline in the console, and the dispute evidence source.

Transfers are re-issues: create `ticket_transfers(from_ticket, to_email, to_contact?, status pending/claimed/expired/revoked, expires_at)`; on claim, void the old barcode and issue a new ticket with a new barcode and new wallet pass (Apple: return 410 from the pass web service to void; Google: set `state=INACTIVE/EXPIRED`). Seat stays attached. Organizer policy toggles: allow name change (Eventbrite-style edit) until `T-x`, allow transfer, allow ticket-type upgrade/downgrade with price difference collected or refunded, allow seat change via seat map.

### 4.3 Refund policy engine
Layers evaluated in order: platform minimums → org default → event override → ticket-type override. Policy fields:
- `consumer_refunds`: `none | window | tiers | request_only`
- `tiers[]`: `{until: "P7D" before event, refund_pct, fixed_fee}` (Cvent-style, also covers Eventbrite 1/7/30-day presets)
- `self_service_auto_approve_max` (amount) and `requires_approval` flag
- `platform_fee_refunded`, `stripe_fee_borne_by: organizer|attendee|platform` (attendee variant reduces payout by the unrecoverable Stripe fee)
- `refund_method`: `original | credit_note | attendee_choice`; credit notes are org-scoped balances redeemable on that org's events (marketplace credit is out of scope v1).
- Non-overridable minimums: cancellation/unperformed event and postponement >90 days without a date ⇒ 100% face value + platform fee refunded, no processing charge; response SLA 5 business days with auto-escalation to Yayatoh support and, after 10 business days, platform-executed refund from organizer proceeds (Eventbrite precedent); policy edits after first sale may only loosen; policy text is rendered at checkout and snapshotted (`policy_version_id`) on the order for `refund_policy_disclosure`.

Stripe execution: `refunds.create({payment_intent, amount, reverse_transfer:true, refund_application_fee: policy.platform_fee_refunded, reason, metadata:{order_id, refund_id}})` with an idempotency key = internal refund id. Because reversal is proportional, when the organizer keeps a cancellation fee the reversal automatically nets correctly. Unrecovered Stripe processing fees are posted to an internal ledger (`org_ledger`) and netted from the org's next payout or invoiced, unless policy says platform absorbs. Listen to `refund.failed` → open a support task ("arrange alternative refund"), and `refund.updated` to store the ARN for "where is my money" tickets.

### 4.4 Organizer support console (module: Orders & Support)
- **Order page**: header (status, amounts, fees, payout state), tickets with seats/check-in status, payment timeline (PI, charges, refunds with ARN, disputes), **communication history** (every email/SMS/WhatsApp/push with provider status and opens, sourced from the Notifications module), notes, and the Contact card with lifetime history (vision §11).
- **Actions**: resend confirmation/tickets, regenerate barcode, edit attendee details, transfer, change ticket type/seat (price delta collected via new PI or refunded), comp ticket (0-price order with `comp_reason`), full/partial/line-item refund, issue credit note, cancel registration, force check-in/undo check-in, block contact (fraud), add tag.
- **Queues**: refund requests (SLA timer, auto-approve rules), transfers pending claim, failed refunds, disputes, waitlist. Role split: support agent (up to `refund_approval_limit`), finance approver, org owner. Bulk actions on filtered orders (vision §15). Macros/templates per org for replies, sent through the tenant's branded channels.
- Command Center feeds: "14 payments failed", "3 refund requests past SLA", "1 dispute due in 2 days", "$4,200 pending refunds exceed available balance".

### 4.5 Waitlist and return-to-waitlist
`waitlist_entries(ticket_type_id, contact, qty, position, status waiting/offered/claimed/expired)`. Triggers: refund/void, transfer revoke, capacity increase. Offer creates a 24h hold (configurable) with a magic-link checkout; expiry moves to the next entry. Optional DICE-style "return my ticket": attendee lists a ticket for return when the type is sold out; refund executes only when the waitlisted buyer completes payment, at face value (fees per policy). Runner-up: instant refund + relist — loses because it exposes the organizer to unsold inventory.

### 4.6 Event cancellation / postponement workflow
Event lifecycle adds `postponed(new_date?)`, `rescheduled`, `cancelled`. A wizard: (1) choose outcome; (2) choose remedy per ticket type: full refund, keep-valid-with-refund-window (rescheduled), credit note with refund opt-out (allowed only where law permits — default refund in EU/UK and for US cancellations); (3) financial preview: refund total, platform fee returned, unrecoverable Stripe fees, connected-account available balance (`GET /v1/balance` as the account), projected negative balance; (4) pre-conditions: if projected balance < 0, require top-up, confirm `debit_negative_balances`, or Yayatoh-covered with signed debt acknowledgment and payout hold; (5) execute as a background job (queue, 10–20 refunds/s, per-order idempotency, retry on rate limit, skip disputed charges to avoid double credit, write `refund_batch` progress); (6) notify via Marketing module with a branded template and the 5–10 business-day expectation; (7) reconcile `refund.failed` and `requires_action` refunds into the support queue. Wallet passes are voided or updated with the new date.

### 4.7 Dispute evidence assembly
On `charge.dispute.created`: create a `disputes` row, notify the org, reverse the transfer (recover funds), and auto-generate a packet: `product_description` (event, date, venue, ticket type, seat), `service_date`, `service_documentation` PDF (check-in scan log: timestamp, gate, device id, scanner user, duplicate-scan attempts), `access_activity_log` (ticket page views, PDF downloads, wallet adds with IP/UA), `customer_communication` (delivery/open log excerpts), `receipt`, `refund_policy` + `refund_policy_disclosure` (checkout screenshot of the snapshotted policy), `refund_refusal_explanation`, `customer_email_address/name/purchase_ip`. Organizer reviews and submits from the console (`submit=true`); never auto-submit. Auto-accept rule for disputes below the countered fee where the ticket was never scanned.

### 4.8 /v1 API and webhooks
- Attendee (magic-link or OAuth): `GET /v1/me/orders`, `GET /v1/orders/{id}` (token), `POST /v1/orders/{id}/resend`, `PATCH /v1/tickets/{id}` (name/email), `POST /v1/tickets/{id}/transfers`, `POST /v1/transfers/{id}/claim`, `GET /v1/tickets/{id}/wallet/{apple|google}`, `POST /v1/orders/{id}/refund-requests`, `POST /v1/registrations/{id}/cancel`, `POST /v1/ticket-types/{id}/waitlist`.
- Organizer (API key, scoped): `POST /v1/orders/{id}/refunds` (amount, line items, reason, fee options), `POST /v1/orders/{id}/comp`, `PATCH /v1/refund-requests/{id}` (approve/reject), `POST /v1/events/{id}/cancel` (dry_run for preview), `GET /v1/disputes`, `GET /v1/orders/{id}/timeline`.
- Webhooks (signed, versioned): `order.paid`, `order.updated`, `order.refunded`, `refund.succeeded|failed`, `refund_request.created|approved|rejected`, `ticket.issued|transferred|voided|checked_in`, `waitlist.offered|claimed`, `event.postponed|cancelled`, `dispute.created|submitted|closed`. Mobile apps consume the attendee endpoints and receive push via the Notifications module.

## 5. Phasing
Phase 1 (parity + must-haves): magic-link order management, name change, resend, wallet passes, organizer refund/partial/comp, policy engine with platform minimums, Stripe refund execution and ledger, order timeline. Phase 2: transfers with claim, waitlist and return-to-waitlist, refund-request queue with SLA, cancellation wizard and bulk refunds, dispute packet. Phase 3: credit notes, ticket-type/seat self-change with price delta, approval workflows, API/webhook completeness for partners.


## Key recommendations

- Use guest checkout with signed, revocable magic-link order management on every domain (marketplace and white-label); make accounts an optional passwordless upgrade tied to a global Person mapped to org-scoped Contacts.
- Model transfers as void-and-reissue (new barcode, new wallet pass, claim step with expiry) rather than mutating the ticket, so duplicate check-in prevention and fraud detection keep working.
- Build a layered refund policy engine (platform minimums > org default > event > ticket type) with date tiers, fee options and a snapshot of the policy text on each order for dispute evidence; hard-code cancellation/postponement>90d = full refund, 5-business-day SLA, no retroactive tightening (Eventbrite precedent).
- Execute Stripe refunds with reverse_transfer=true and policy-driven refund_application_fee, idempotent per internal refund id; post unrecoverable Stripe processing fees to an org ledger netted from payouts.
- Ship an Orders & Support console with a unified per-order timeline (payments, refunds with ARN, transfers, check-ins, every message with provider status) and role-gated actions, integrated with the Contact record and Command Center alerts.
- Implement the event cancellation wizard with a financial preview (refund total vs connected-account available balance), negative-balance guardrails (top-up, debit_negative_balances, or platform-covered debt with payout hold), and a resumable background batch that skips disputed charges and handles refund.failed/requires_action.
- Add per-ticket-type waitlists with timed offers and an optional DICE-style return-to-waitlist that refunds only once the returned ticket is resold.
- Auto-assemble Stripe dispute evidence packets from check-in logs, ticket access logs and communication history, filling the documented evidence fields within the 4.5 MB / 19-page limits; organizer reviews and submits, never auto-submit.
- Expose attendee self-service and organizer support operations through /v1 endpoints and signed webhooks so the mobile apps, white-label tenants and integrations use the same state machine.
- Have counsel review the FTC Unfair or Deceptive Fees Rule (all-in pricing, no misrepresenting refundability), Maryland's 2025 ticketing law (UNVERIFIED), NY ACA 25.07, and EU/UK withdrawal exemptions before finalizing checkout copy and policy defaults.


## Data model implications

- Person (global identity: email, phone, passkeys) separate from org-scoped Contact; PersonContact link table; Contact has lifetime value, consents, tags.
- Order: status enum (draft, awaiting_payment, paid, partially_refunded, refunded, cancelled, voided), disputed/on_hold flags, manage_token_hash, policy_version_id snapshot, tenant/domain of purchase.
- Ticket: status enum (reserved, issued, checked_in, transfer_pending, transferred, void) with void_reason, barcode rotation history, seat_id, wallet pass ids (apple serial, google object id).
- TicketTransfer: from_ticket, to_email/contact, status (pending, claimed, expired, revoked), expires_at, claimed_ticket_id.
- RefundPolicy (org/event/ticket-type scope, versioned): consumer_refunds mode, tiers[], self_service_auto_approve_max, platform_fee_refunded, stripe_fee_borne_by, refund_method.
- RefundRequest: order, requested lines, reason, status, SLA due_at, decided_by; Refund: amount, line allocations, stripe_refund_id, reverse_transfer, application_fee_refunded, status, failure_reason, arn.
- CreditNote (org-scoped balance) and OrgLedger entries for unrecovered processing fees, platform-covered refunds and dispute fees.
- OrderEvent (append-only audit/timeline: actor, action, before/after, ip, channel) and MessageLog links (email/SMS/WhatsApp/push with provider status).
- WaitlistEntry: ticket_type, contact, qty, position, status (waiting, offered, claimed, expired), offer_expires_at; ReturnListing for return-to-waitlist tickets.
- Event lifecycle fields: status (live, postponed, rescheduled, cancelled), original_date, new_date, remedy config; RefundBatch with progress and per-order results.
- Dispute: stripe_dispute_id, reason, status, due_by, evidence packet file ids, transfer_reversal_id, outcome.
- CheckInLog rows must retain device id, gate, scanner user, timestamp and duplicate-attempt flags to serve as dispute evidence.


## Risks

- Stripe processing fees are never returned on refunds; without an explicit ledger the platform silently absorbs them on every refund and mass cancellation.
- Mass cancellations can drive connected accounts negative; if losses_collector is the platform, Yayatoh is on the hook (connect_reserved held, forced collection transfer after 180 days).
- Refunding a charge that is simultaneously disputed causes double credit; batch jobs must skip disputed charges and prefer accepting the dispute.
- Retroactively tightening a refund policy after sales is prohibited by marketplace norms and likely unfair under UK/EU law; policy versioning must enforce loosen-only edits.
- Magic links leak if forwarded; sensitive actions need OTP step-up and token rotation, and tokens must be hashed at rest.
- Transfers that mutate tickets in place break duplicate-scan detection and wallet passes; void-and-reissue is required.
- Competitor details for Ticket Tailor, DICE, Cvent and Tito webhooks are UNVERIFIED (help centers blocked); Maryland 2025 ticket law details are UNVERIFIED.
- Dispute evidence limits (4.5 MB, 19 pages Mastercard, one file per evidence type) mean auto-generated packets must be compact or they will be rejected.
- Credit-note-only remedies for cancellations may violate US state law, EU and UK expectations of a cash refund; refunds must remain available.
- Refunds via bank-debit or voucher methods can enter requires_action or fail; support tooling must handle manual alternatives.


## Open questions

- Who is the losses collector on Yayatoh's Stripe Connect accounts today (platform vs Stripe), and is debit_negative_balances enabled for organizers?
- Does Yayatoh currently refund its own platform fee on organizer-initiated cancellations, and should that become the platform minimum?
- Should white-label tenants be allowed to set stricter refund rules than the marketplace default, or only looser?
- Are credit notes (org-scoped) acceptable to Yayatoh's finance team, and should they ever be redeemable across organizations?
- Do the existing mobile apps expect password-based login, and can they move to OTP/passkey auth in the migration window?
- Which markets beyond the US (EU, UK, others among the 12 UI languages) actually have paying organizers, to prioritize legal review?
- What refund approval limits and roles exist in current organizer teams (who may refund without approval)?
- Should attendees be allowed to change seats/ticket types themselves with price deltas, or is that organizer-only in v1?
- Is return-to-waitlist (refund only on resale) desirable for Yayatoh's concert/gala organizers, or is a simple waitlist enough?
- Does Yayatoh want to auto-accept low-value disputes to save the $15 countered fee, and at what threshold?


## Sources

- https://docs.stripe.com/refunds
- https://docs.stripe.com/api/refunds/create
- https://docs.stripe.com/connect/destination-charges.md?platform=web&ui=stripe-hosted
- https://docs.stripe.com/connect/account-balances
- https://docs.stripe.com/disputes/responding
- https://docs.stripe.com/disputes/api
- https://docs.stripe.com/disputes/best-practices
- https://docs.stripe.com/api/disputes/evidence_object
- https://support.stripe.com/questions/june-2025-pricing-updates-for-disputes
- https://www.eventbrite.com/help/en-us/articles/827759/eventbrites-organizer-refund-policy-requirements/
- https://www.eventbrite.com/help/en-us/articles/721549/can-i-get-a-refund/
- https://www.eventbrite.com/help/en-us/articles/431834/how-to-transfer-tickets-to-someone-else/
- https://www.eventbrite.com/help/en-us/articles/441118/how-to-update-your-ticket-registration-information/
- https://humanitix.com/us/features
- https://humanitix.com/us/pricing
- https://ti.to/docs/api/admin
- https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_en.htm
- https://www.gov.uk/government/publications/cma-to-investigate-concerns-about-cancellation-policies-during-the-coronavirus-covid-19-pandemic/the-coronavirus-covid-19-pandemic-consumer-contracts-cancellation-and-refunds
- https://www.gov.uk/government/publications/consumer-rights-act-2015/consumer-rights-act-2015
- https://www.ftc.gov/news-events/news/press-releases/2024/12/federal-trade-commission-announces-bipartisan-rule-banning-junk-ticket-hotel-fees
- https://www.nysenate.gov/legislation/laws/ACA/25.07
- https://developer.apple.com/documentation/walletpasses
- https://developers.google.com/wallet/tickets/events
- /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx
