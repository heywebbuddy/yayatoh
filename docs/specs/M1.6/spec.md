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
