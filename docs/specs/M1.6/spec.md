# M1.6 — Payments operations and payouts

Roadmap: M1.6; ADR 0005 (hybrid funds flow and ledger); roadmap §5.3. Delivered in increments:

| # | Increment | Scope | Risk tags |
|---|---|---|---|
| a | Double-entry ledger | `payments.post_journal` (owner `ledger_writer`), sale journals for both funds flows, balances | payments, db-migration |
| b | Refunds | full, partial and per line; refund policy engine with the platform minimum; provider refunds on the right account; ledger reversals | payments |
| c | Settlements and transfers at release | release tiers and reserves (defaults pending D3), settlement batches, transfers, explicit transfer reversals and receivables; the organizer's settlement view | payments |
| d | Disputes | dispute webhooks, fund holds (held → reserve → receivable), the evidence packet for human review | payments |

Live money stays gated on the counsel items in roadmap §5.3 and owner decision **D3** (release tiers, reserves, fee-refund policy). Everything runs on the fake provider until the owner's Stripe account exists.

## M1.6a — double-entry ledger (done)

- **Tables** (tenant, RLS): `payments.journal_entries` (idempotency key unique per org, kind, reference, occurred at, memo) and `payments.postings` (account, signed integer minor units — debit positive, credit negative — currency). Every journal is about one org; platform accounts are postings too, so platform totals are the sum over orgs (staff, `platform_reader`).
- **Accounts:** `platform:stripe_cash`, `platform:platform_fee_deferred`, `platform:platform_fee_revenue`, `platform:processing_fee_expense`, `org:payable_held`, `org:payable_releasable`, `org:reserve`, `org:receivable` (a CHECK constraint keeps it to this list).
- **One writer.** `payments.post_journal` is SECURITY DEFINER, owned by the NOLOGIN role `ledger_writer` (created by `db:bootstrap`; production gets it from the owner-run role runbook). It refuses another org's journal, fewer than two lines, and any currency that does not sum to zero; a repeated idempotency key returns the first journal. `app_user` can only SELECT its org's rows: no INSERT, UPDATE, DELETE or TRUNCATE for anyone but the table owner. Corrections are reversing journals.
- **Sales.** When a verified provider event marks an order paid, the same transaction posts `sale:<orderId>`:
  - `platform_mor`: `stripe_cash` +total; `payable_held` −(total − fee); `platform_fee_deferred` −fee.
  - `organizer_mor`: the charge is on the organizer's account; the platform books only the application fee (`stripe_cash` +fee; `platform_fee_revenue` −fee), with the gross as a memo for reconciliation.
  - Free orders post nothing.
- **Reading.** `payments.ledgerBalances` (`finance:read`: owner, admin, finance, and staff) — per account and currency. The staff console shows it on the tenant page.
- **Later in M1.6:** processing-fee expense from actual Stripe fees, fee recognition at event end (deferred → revenue), daily three-way reconciliation (ledger vs Stripe balance transactions vs transfers).

### Acceptance (M1.6a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | A paid order posts one balanced sale journal in the same transaction | `packages/testing/tests/ledger.int.test.ts` |
| AC2 | **Property (roadmap):** over 60 seeded random sales in both flows, with replays, cash equals organizer payables plus platform fees and every posting sums to zero | `ledger.int.test.ts` |
| AC3 | Unbalanced journals, another org's journal and direct INSERT/UPDATE/DELETE are refused | `ledger.int.test.ts` |
| AC4 | Balances need `finance:read`; orgs never see each other's; ledger tables have fixture rows for isolation | `ledger.int.test.ts`, `isolation.int.test.ts` |

## M1.6b — refunds (done, before transfers)

- **What can be refunded.** Paid or partially refunded orders with money on them. Either **whole tickets** (they are voided when the refund succeeds: scanners reject them from the next manifest, their attendees are cancelled, the places return to sale, the buyer's page drops their QR) or **an amount** (goodwill or partial; tickets stay valid). Never more than is left (`total − succeeded − pending`); a ticket already refunded, or in a pending refund, is refused.
- **Policy** (`refundsFee`, roadmap §5.3): the platform fee goes back for `event_cancelled`, `event_postponed` (over 90 days, no new date — the platform minimum), `duplicate` and `fraudulent`; it is kept for `requested_by_customer` and `goodwill` (**default until the owner decides D3**). Per ticket: fee back → the buyer gets the full all-in price; fee kept → the buyer gets the price less the fee when it was added on top, or the full price when the organizer absorbed it (the organizer then carries the kept fee).
- **Flow.** `orders.startRefund` (`orders:refund`: owner, admin, finance) records a pending refund with the policy's amounts and hands the server action the provider instructions → `PaymentProvider.refund` outside the transaction (`organizer_mor`: on the connected account, returning the refunded part of the application fee; `platform_mor`: the platform charge), idempotent per refund → `orders.completeRefund` records the answer. Succeeded: void tickets, ledger `refund:<id>` journal, order `partially_refunded`/`refunded`, `order.refunded@1`. Failed: nothing else changes and the ticket can be refunded again. A final refund is never changed again. `pending` (Stripe's asynchronous refunds) completes later by webhook with the Stripe adapter.
- **Ledger.** `platform_mor`: `stripe_cash` −amount; `payable_held` +(amount − fee back); `platform_fee_deferred` +fee back. `organizer_mor`: only the application-fee part (`stripe_cash` −fee back; `platform_fee_revenue` +fee back). After a transfer exists (M1.6c), refunds add an explicit transfer reversal and, if that fails, a receivable.
- **Console.** Buyer names in "Recent orders" open the order page: tickets with holders and status, refunds so far, and the refund form (reason, whole tickets or an amount, internal note).
- **Later:** the cancellation wizard (refund everyone at the platform minimum, preview the shortfall), buyer-initiated refund requests, refund webhooks.

### Acceptance (M1.6b)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Policy and per-ticket amounts for pass-on, absorbed and discounted tickets | `packages/modules/orders/tests/refund-policy.test.ts` |
| AC2 | A ticket refund voids the ticket, cancels the attendee, returns the place, books a balanced refund journal, emits `order.refunded@1` | `packages/testing/tests/refunds.int.test.ts` |
| AC3 | No double refunds (done or pending); a declined refund changes nothing and stays final | `refunds.int.test.ts` |
| AC4 | Amounts are capped; the platform minimum refunds face and fee; the order ends `refunded` with this order's cash netting to zero | `refunds.int.test.ts` |
| AC5 | Only refunders refund; orgs never see each other's refunds; fixture rows for isolation | `refunds.int.test.ts`, `isolation.int.test.ts` |
| AC6 | In the browser: an organizer refunds one ticket, sees it void and the refund listed, an over-refund is refused; the buyer's page shows the partial refund and one QR; axe passes | `apps/web/e2e/refunds.spec.ts` |

## M1.6c — settlements and transfers at release (done)

`platform_mor` only (separate charges & transfers; ADR 0005). `organizer_mor` sales are paid out by Stripe on the connected account's own schedule.

- **Release policy (Standard tier; defaults pending D3):** an event's held funds are released **5 business days after the event ends** (UTC weekdays; bank holidays not modelled yet), keeping a **5% reserve for 90 days**. Trusted (weekly advances) and New/high-risk (manual release) tiers come with the owner's D3 answer.
- **Journals carry the event** (`journal_entries.event_id`; `post_journal` gained the parameter, the 8-argument version stays until nothing calls it).
- **The release job** (`payments.releaseDueSettlements`, platform actor, serialized per org with a transaction advisory lock; the worker leader runs it every 10 minutes through `runSettlements`):
  1. For each event whose release date has passed: `payable_held` → `payable_releasable` + `reserve`, then any **receivable is netted** first, and a settlement is recorded (`released − reserve − netted = amount`).
  2. Reserves whose window has passed are released the same way (what refunds left of that event's reserve).
  3. Settlements that waited for a payout account become ready once payouts are enabled.
  4. Nothing moves while staff hold the org's payouts.
- **Transfers.** For each ready (or failed) settlement the worker calls `PaymentProvider.createTransfer` to the connected account (`transfer_group` = the event), idempotent per settlement, and records it (`payments.recordTransfer`): `payable_releasable` → out of `stripe_cash`, `payouts.transferred@1`. Failures are retried on the next run. No payout account yet → `waiting_account`.
- **Refunds after release** (roadmap §5.3): the organizer's share comes from the event's held funds, then the event's reserve, and the rest becomes a **receivable**. `completeRefund` then returns a reversal instruction; the server action calls `PaymentProvider.reverseTransfer` (explicit reversal — `reverse_transfer` does not apply to separate charges & transfers) and records it (`payments.recordTransferReversal`). A failed reversal leaves the receivable, netted from the next release.
- **Organizer view.** Payouts page → Settlements (owner, admin, finance): per event, released, kept back (reserve + netted), paid out, status. It replaces the legacy "Transferred" checkbox; migrated settlements arrive with the migration (Phase 2).
- **Later:** agency commission transfers in the same group, `source_transaction` linking, advances for far-future events, Stripe holding-limit checks, daily reconciliation.

### Acceptance (M1.6c)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Funds stay held until 5 business days after the event; released less 5%; released once; waits without a payout account | `packages/testing/tests/settlements.int.test.ts` |
| AC2 | With payouts enabled it becomes ready, a failed transfer is retried, a succeeded one is booked and not transferred again | `settlements.int.test.ts` |
| AC3 | A refund after transfer draws on the event's reserve, then a receivable, and asks for a reversal; a failed reversal leaves the receivable; the next release nets it | `settlements.int.test.ts` |
| AC4 | Reserves come back after the window (what refunds left); a staff hold stops releases; the books sum to zero; settlements are finance-only and per org | `settlements.int.test.ts` |
| AC5 | The worker job transfers a waiting settlement once payouts are enabled, exactly once, audited | `apps/worker/tests/settlements.int.test.ts` |

## M1.6d — disputes (done)

- **Webhooks.** `dispute.created` / `dispute.closed` (won or lost) arrive through the payments port (verified on the raw body, deduplicated by provider event id) and are applied by `orders.applyDisputeEvent` (system only). The order is found by its provider payment; the dispute must match its currency and not exceed its total. A close for an unknown dispute is refused (the provider retries).
- **The hold** (roadmap acceptance "a dispute places the hold"). `platform_mor`: the provider takes the disputed amount from the platform balance at once, so the same amount is held back from the organizer: the event's held funds first, then the event's reserve, then a receivable (netted from the next release). The organizer carries the whole disputed amount while the dispute is open. `organizer_mor`: the dispute is on the organizer's own account; the platform books nothing.
- **Won:** the hold journal is reversed exactly. **Lost:** the buyer keeps the money; the order's remaining tickets are voided (`dispute_lost`) and the order counts as refunded.
- **Evidence packet** (`reports.disputeEvidence`, `finance:read`): the dispute, the seller and merchant of record, the event (times in its timezone, with the zone), the order and items, every ticket with its door admissions, refunds, and the organizer's refund policy. It is rendered as an A4 PDF through the ADR 0017 renderer (HTML when no renderer is configured), in English because it goes to the card network, and bounded to 60 tickets and 6,000 characters of policy (the networks accept 4.5 MB / 19 pages).
- **Who answers.** `platform_mor`: Yayatoh is the merchant, so **staff** answer: the staff console lists the tenant's disputes, opens the packet, and submits evidence only after ticking "I reviewed the evidence packet" (`PaymentProvider.submitDisputeEvidence`, then `payments.markEvidenceSubmitted`, platform only). `organizer_mor`: the organizer downloads the packet from the order page and answers in their Stripe dashboard.
- **Organizer view.** The order page lists disputes (status, amount, reason, evidence deadline) with the packet link, for owner, admin and finance.
- **Later:** the dispute-ratio alert (roadmap risk 3), dispute fees, attaching the PDF file to the Stripe submission (Stripe adapter), messages sent to the buyer in the packet.

### Acceptance (M1.6d)
| ID | Criterion | Test |
|---|---|---|
| AC1 | **A dispute places the hold** (held funds, then a receivable); redelivery changes nothing | `packages/testing/tests/disputes.int.test.ts` |
| AC2 | The evidence packet has the order, event, admissions and refund policy, escaped in the document | `disputes.int.test.ts` |
| AC3 | Only staff submit evidence, once; won undoes the hold exactly; lost voids the tickets and refunds the order; the books sum to zero | `disputes.int.test.ts` |
| AC4 | Unknown disputes are refused; disputes are finance-only and per org; fixture rows for isolation | `disputes.int.test.ts`, `isolation.int.test.ts` |
| AC5 | In the browser: a signed dispute webhook shows on the order with a downloadable packet; staff see it on the tenant page and open the packet; axe passes | `apps/web/e2e/disputes.spec.ts`, `apps/admin/e2e/admin.spec.ts` |

## M1.6e — reconciliation, refund policy engine, receivables, dispute response, risk rules (done)

Closes the roadmap's remaining M1.6 items. The Stripe TEST-mode verification that ran first is in `docs/specs/M1.5/spec.md` → M1.5e3. Migration `0053_purple_abomination.sql` (renumbered at merge from `0046_cheerful_bastion.sql`).

### Daily reconciliation
- **Port.** `PaymentProvider.listBalanceTransactions({ from, to })` → normalized platform-balance movements: kind (`charge`, `refund`, `application_fee`, `application_fee_refund`, `transfer`, `transfer_reversal`, `dispute`, `other`), signed gross amount, org and **ledger reference**. The platform tags its own writes (`metadata.yayatoh_ref` = the idempotency key, and `orgId`) on refunds, fee refunds, transfers and reversals; charges are found by the order metadata. The Stripe adapter maps `balance_transactions` (checked live, M1.5e3); the fake provider keeps a balance store (per process; the web's dev tools share it) and returns `null` without one, so the job skips.
- **Matching** (`reconcileEntries`, pure): the ledger's `platform:stripe_cash` postings and the provider's movements are grouped by reference (`order:<id>`, `refund:<id>`, `settlement:<id>`, `reversal:<refundId>`, `dispute:<providerDisputeId>`) and currency. Each side is read from the day before to the day after, and only references with something *on* the day are compared, so a webhook booked after midnight still matches. Differences: `missing_at_provider`, `missing_in_ledger`, `amount_mismatch`. Days are UTC calendar days (Stripe's). Provider fees and payouts to the bank are not an org's drift.
- **Tables** (tenant, RLS, fixture rows): `payments.reconciliation_runs` (one per org and day; unique) and `payments.reconciliation_items` (unique per org, day, reference, currency; open/resolved with the note, who and when).
- **Job.** `payments.recordReconciliation` (platform actor, advisory lock per org and day, **idempotent**: a second run returns the first) emits `payments.reconciliation_drift@1` when it finds differences. The worker leader runs `runReconciliation` hourly for the previous UTC day (only the first run of a day does work), listing the provider once and finding orgs through `platform_reader` (audited).
- **Resolve.** `payments.resolveReconciliationItem` (new org permission `finance:reconcile`: owner, admin, finance; and staff) with a 3–500 character note, audited with the note.
- **Screens.** Console → **Finance** (owners, admins, finance; hidden from and 404 for others): daily checks, open differences with ledger/provider/difference and a resolve form, resolved list. Staff console → tenant page → Reconciliation (resolve with a note).

### Refund policy engine
- **Per-event policy** (`orders.refund_policies`, one per event, hand-written FK to `events.events`): `none` (no refunds on request), `until` N calendar days before the event's start date **in the event's timezone** (0 = through the day of the event; the deadline is midnight at the end of that day, DST-correct), or `always`; plus an optional **amount kept per refunded ticket**. No row = the organizer's discretion and no buyer text (the previous behaviour).
- **Evaluated in the refund command** (`orders.startRefund`, and the preview): the policy governs **discretionary** reasons only (`requested_by_customer`, `goodwill`, by ticket or amount). The **platform minimum** (roadmap §5.3) always refunds in full: `event_cancelled`, `event_postponed` (over 90 days, no new date); `duplicate` and `fraudulent` are not the buyer's choice either. Refusals are `invalid_state` with `reason` `policy_window_closed` (and the `deadline`) or `policy_no_refunds`; the console shows them in words. The kept amount comes off each ticket (never below the fee part) and is stored on the refund (`retained_minor`). The booking-fee rule from M1.6b is unchanged (kept on request: pending D3).
- **Override** (`orders.startPolicyOverrideRefund`, new permission `orders:refund_override`: owners and admins; platform staff): the same refund outside the policy with a required note; nothing kept; `policy_override` on the refund; audited as `order.refund_policy_override` with the note. Finance can refund within the policy but not override.
- **Buyer-facing text** on the event page (before buying) and the order page (`PublicOrderDto.refundPolicy`, additive), with the deadline in the event's timezone and the platform-minimum sentence. The organizer sets it on Tickets & Orders → Refund policy (event editors).

### Receivables
- A refund after the organizer was paid (platform_mor) draws the organizer's share from the event's held funds, then its reserve; the rest is a receivable. When the event was transferred, an **explicit transfer reversal** is attempted (M1.6c); if it fails the receivable stays and is **netted from the next release**. Box-office (organizer-collected) fees — the organizer_mor-style edge case where the organizer holds the money — are receivables too.
- `payments.receivables` (`finance:read`): what is owed per currency and its history (refund, dispute, dispute won, organizer-collected fee, transfer reversal, netting). Shown on **Payouts** under the settlements.
- Refund-after-transfer scenarios run on the fake provider with a controllable clock (release at event end + 5 business days less 5%, a reversal that succeeds, one that fails and is netted at the next release, and every day of it reconciling to zero differences). `pnpm --filter @yayatoh/payments stripe:test-clocks [-- --account acct_…]` runs the same against Stripe test mode with a test clock (manual): **passed on 2026-09-28** — clock advanced to the release date, 95% transferred, a refund reversed 7 000 of the 57 000 transfer, and a reversal larger than what was left failed (the debt stays a receivable).

### Dispute evidence: review, edit, submit
- The packet (`reports.disputeEvidence`) adds the **access log** (every door scan of the order's tickets, rejections included, with the entrance and offline flag; `checkin.scanLogForTicketsTx`), the **messages** sent to the buyer (kind, subject, status; no bodies), and the reviewer's **statement** first. Reviewers may leave out tickets, access log, refunds, messages or refund policy; dispute, seller, event and order always stay.
- **Limits** (4.5 MB / 19 pages): `fitEvidenceDocument` estimates pages and trims the access log, then messages, then tickets (keeping the first rows, saying how many were left out), long texts last; the rendered PDF is checked (`packetWithinLimits`) before submission, and the providers refuse packets over 4.5 MB.
- **Organizer review** (new permission `disputes:respond`: owner, admin, finance): Order → Disputes → "Review and respond" shows the packet exactly as it will be sent (English), the statement and section choices (`payments.saveEvidenceDraft`), and **Submit** only after "I read the evidence packet": the PDF is rendered (Gotenberg), `PaymentProvider.submitDisputeEvidence` uploads it as a file with the statement (on the connected account for organizer_mor), then `payments.markOrgEvidenceSubmitted` records it. All audited. Staff can still submit platform_mor evidence from the staff console (pre-filled with the organizer's statement). **Pending owner:** whether platform_mor disputes (Yayatoh is the merchant) should need staff sign-off instead of the organizer's.

### Checkout risk rules (Radar-style) and 1099
- A **risk port** (`CheckoutRiskProvider`) with the local rules adapter as its fake (`rulesRiskProvider`), assessed by the checkout server action before the order exists. Signals per org over the last hour: orders by the buyer's email (`email_velocity`), how many failed to pay (`payment_failures`), and the request country (host geo header) vs the event's country (`country_mismatch`). Default rules (**pending owner**, fraud policy): block at 10 orders or 5 payment failures per email per hour; review at 4 orders or a country mismatch. A block refuses the checkout ("We couldn't take this order…"); a review is recorded on the order (`orders.risk_review`) and shown to the organizer as "Flagged at checkout". Names are checkout's own; the door's fraud signals (M1.9: `two_entrances`, `invalid_burst`) stay with check-in. Stripe Radar still scores cards at payment time (platform Radar on platform_mor, the connected account's on organizer_mor).
- **1099.** No tax identity is captured or stored by Yayatoh: Stripe collects it in Connect onboarding (`individual.id_number` / `company.tax_id`, requirements on the account) and never returns it. Connected accounts are Standard-equivalent (Stripe collects fees and losses), so Stripe files the 1099-K for organizer_mor payments; transfers to organizers under platform_mor may make Yayatoh the payer of record — counsel decides the form (1099-K vs 1099-MISC/NEC) and the owner turns on Stripe Tax reporting (1099) on the live account (owner inbox). The data it needs — per-org transfers per calendar year — is already in `payments.settlements`/the ledger. Nothing is shown publicly.

### Settlement view and migrated settlements
The settlement view (M1.6c) now carries receivables. Migrated legacy settlements arrive with the ELT in Phase 2 (they need owner-signed opening balances, roadmap §5.3 legacy carry-over); no schema change is needed before then.

### Later / not yet
- The worker uses the fake provider until the owner's Stripe account is live; switching it to `paymentProviderFromEnv` comes with the live webhook endpoints.
- Unattributed provider movements (bank payouts, Stripe fees, disputes on payments with no org tag) are counted but not listed; a platform-level reconciliation view comes with the staff finance console.
- Buyer-initiated refund requests (the policy is ready for them), the cancellation wizard, Radar for Fraud Teams rules on the live account, dispute fees in the ledger.

### Acceptance (M1.6e)
| ID | Criterion | Test |
|---|---|---|
| AC1 | **Property (roadmap): ledger totals equal charges minus refunds, fees and transfers** — a seeded random life (sales in both flows, box office, refunds before and after payout, releases, transfers, reversals, receivables, disputes won and lost) keeps cash = organizer's due + fees after every step | `packages/testing/tests/ledger-identity.int.test.ts` (plus M1.6a's `ledger.int.test.ts`) |
| AC2 | **Refund-after-transfer scenarios** (fake provider, controllable clock): release less 5%, reversal succeeds, reversal fails → receivable netted at the next release; every day reconciles | `packages/testing/tests/refund-after-transfer.int.test.ts`; with **Stripe test clocks**: `packages/modules/payments/scripts/stripe-test-clocks.ts` (manual, passed in test mode) |
| AC3 | Reconciliation matching (midnight, netting, currencies, day bounds) and the fake balance store | `packages/modules/payments/tests/reconciliation.test.ts` |
| AC4 | Reconciliation is idempotent per org and day; drift becomes items and an event; finance resolves with an audited note; viewers and other orgs cannot; only the platform records runs; the worker job lists once and skips without a store | `packages/testing/tests/reconciliation.int.test.ts`, `apps/worker/tests/reconciliation.int.test.ts` |
| AC5 | Policy evaluation: timezones, DST, day boundaries, platform minimum, override | `packages/modules/orders/tests/refund-policy-engine.test.ts` |
| AC6 | Policy in the refund command: validation, permissions, retained fee, refusal reasons with the deadline, platform minimum, audited owner override, public text per org | `packages/testing/tests/refund-policy.int.test.ts` |
| AC7 | Evidence packet: access log and messages, statement and exclusions, submit once through the port with a size limit, permissions, audit | `packages/testing/tests/dispute-evidence.int.test.ts`, `packages/modules/reports/tests/evidence-limits.test.ts` |
| AC8 | Risk rules: velocity, failures, country mismatch, block over review; per-org signals; review flag on the order | `packages/modules/payments/tests/risk.test.ts`, `packages/testing/tests/checkout-risk.int.test.ts` |
| AC9 | In the browser: set a refund policy (keyboard, validation, persistence) and see it on the event and order pages; a refund refused by the policy with its reason, then an owner override; finance and viewer see no override/edit; axe; Arabic RTL | `apps/web/e2e/refund-policy.spec.ts` |
| AC10 | In the browser: a reconciliation difference listed and resolved (keyboard, note validation, persistence); viewers get no Finance link and a 404; the empty state; axe; Arabic RTL | `apps/web/e2e/reconciliation.spec.ts`; staff: `apps/admin/e2e/admin.spec.ts` |
| AC11 | In the browser: a refund after release shows as a receivable on the settlement view; viewers see none; axe; Arabic RTL | `apps/web/e2e/receivables.spec.ts` |
| AC12 | In the browser: build, review (preview, validation, keyboard, exclusions, persistence) and submit an evidence packet; finance may, viewers get a 404; axe; Arabic RTL | `apps/web/e2e/dispute-response.spec.ts` |
